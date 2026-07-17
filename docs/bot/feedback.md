# Sistema de Feedback de Pedidos

El feedback tiene **dos mitades**, en dos workflows distintos de n8n:

1. **[Parte 1 — Job programado](#parte-1--job-programado-solicitud)** (`TRIGGER JOB FEEDBACK`):
   un cron que detecta pedidos entregados y **pide** la calificación por WhatsApp.
2. **[Parte 2 — Subworkflow de respuesta](#parte-2--subworkflow-de-respuesta-retener-feedback)**
   (`Ejecutar Retener feedback`): lo invoca el `Router de modo` del
   [workflow principal](n8n-workflow.md#fase-4-router-de-modo-handoff) cuando el
   cliente —ya en modo `esperando_feedback`— **responde**, y procesa la nota/comentario.

---

## Parte 1 — Job programado (solicitud)

> Workflow n8n **independiente** (tiene su propio Schedule Trigger).

### Propósito

Cada **15 minutos** busca pedidos `entregado` que **aún no** tienen feedback
solicitado y que se entregaron hace **entre 1 y 6 horas**. A cada uno le envía un
WhatsApp pidiendo calificar del 1 al 5, marca el pedido, pasa al cliente a modo
`esperando_feedback` y registra la espera en `feedback_pendiente`.

### Flujo

```
trigger_feedback (Schedule Trigger — cada 15 min)
  │
  └─ Buscar pedidos pendientes de feedback (HTTP GET — Supabase REST /pedidos)
       │   select: pedido_id, cliente_id, telefono, fecha_entrega, clientes(nombre,modo)
       │   filtros: estado=eq.entregado · feedback_solicitado=eq.false
       │            fecha_entrega gte (now−6h) y lte (now−1h) · limit 50
       │   (retryOnFail 2 s · alwaysOutputData)
       │
       └─ Split In Batches (batchSize 5, reset)
            │  ├─ done → (fin)
            │  └─ loop ↓ (procesa de a 5; vuelve tras Wait1)
            │
            ├─ Code — Preparar payload (Code node)
            │   ├─ Valida pedido_id / telefono / cliente_id (si falta → descarta item)
            │   ├─ Extrae nombre y modo del JOIN clientes(...)
            │   ├─ SOLO procesa clientes en modo 'bot' (si no → descarta item)
            │   ├─ Usa el primer nombre solo si es válido (≠ 'Pendiente' / no vacío)
            │   └─ Arma el mensaje "¿Cómo estuvo tu pedido? Califica del 1 al 5"
            │        → { pedido_id, cliente_id, telefono, mensaje }
            │
            ├─ Marcar pedido como solicitado (HTTP PATCH /pedidos?pedido_id=eq.{id})
            │   └─ body: { "feedback_solicitado": true }   (idempotencia)
            │
            ├─ Activar modo esperando_feedback (HTTP PATCH /clientes?cliente_id=eq.{id})
            │   └─ body: { "modo": "esperando_feedback" }
            │
            ├─ feedback_pendiente (HTTP POST /feedback_pendiente)
            │   └─ body: { telefono, pedido_id, cliente_id, estado: "esperando_nota" }
            │
            ├─ Enviar WhatsApp (WhatsApp — message.send)
            │   └─ Envía el mensaje al telefono del cliente
            │
            └─ Wait1 (Wait — 2 s)
                 └─ Vuelve a Split In Batches (siguiente lote)
```

### Notas

- **Idempotencia:** `feedback_solicitado = true` evita volver a pedir feedback del
  mismo pedido en la próxima corrida.
- **Ventana 1–6 h:** espera ≥1 h tras la entrega y no persigue pedidos de más de 6 h.
- **Solo modo `'bot'`:** no interrumpe a clientes en `humano` / `esperando_feedback`.
- **Batching + Wait 2 s:** espacia los envíos y evita ráfagas contra la API de WhatsApp.

---

## Parte 2 — Subworkflow de respuesta (Retener feedback)

> Subworkflow invocado por **Execute Workflow** desde el `Router de modo` del
> workflow principal. Recibe `{ telefono, mensaje, cliente_id }`.

### Flujo — despacho por estado

```
When Executed by Another Workflow (inputs: telefono, mensaje, cliente_id)
  │
  └─ Obtener feedback pendiente (Supabase get — feedback_pendiente WHERE telefono)
       │
       └─ ¿Existe feedback pendiente? (IF — pedido_id exists)
            ├─ FALSE → Limpiar modo huérfano (Supabase update clientes modo='bot')
            │            └─ FIN (modo de feedback sin fila pendiente → se resetea)
            │
            └─ TRUE → Estado del feedback (Switch por feedback_pendiente.estado)
                 ├─ 'esperando_nota'        → FASE A (calificación) ↓
                 ├─ 'esperando_comentario'  → FASE B (comentario) ↓
                 └─ (fallback)              → Limpiar modo huérfano → FIN
```

### FASE A — el cliente responde la calificación (`esperando_nota`)

```
Parsear calificación (Code)
  │   Busca un dígito 1–5 en el mensaje → { tipo, nota, es_positiva: nota > 3 }
  │
  └─ Nota valida (IF — tipo == 'valido')
       ├─ FALSE → Pedir nota de nuevo (WhatsApp "responde solo 1–5")
       │            └─ FIN (sigue en esperando_nota)
       │
       └─ TRUE → Guardar calificación (Supabase INSERT feedback:
            │        feedback_id=FB-{pedido_id}, cliente_id, pedido_id,
            │        fecha=now, calificacion_general=nota)
            │
            └─ ¿Nota > 3? (Switch por es_positiva)
                 ├─ true (nota 4–5) → RUTA POSITIVA:
                 │     Eliminar feedback pendiente → Restaurar modo bot
                 │       → Invitar reseña Google (WhatsApp con link) → FIN
                 │
                 └─ false (nota 1–3) → RUTA NEGATIVA:
                       Cambiar a esperando_comentario (update feedback_pendiente.estado)
                         → Pedir comentario (WhatsApp "¿qué pasó? escribe 'saltar'")
                         → FIN (queda en esperando_comentario; cliente sigue en modo feedback)
```

### FASE B — el cliente responde el comentario (`esperando_comentario`)

```
Procesar comentario (Code)   'saltar' → comentario=null · si no → texto (máx 2000)
  │
  └─ ¿Hay comentario?1 (IF — comentario exists)
       ├─ TRUE → Guardar comentario (Supabase update feedback.comentario WHERE pedido_id) ┐
       └─ FALSE ──────────────────────────────────────────────────────────────────────────┤
                                                                                            ▼
              Eliminar feedback pendiente1 → Restaurar modo bot1 → Agradecer feedback → FIN
```

### Ciclo de vida del `modo` del cliente

```
bot ──[job pregunta]──▶ esperando_feedback
                          │
   nota 4–5 ─────────────▶ (guarda feedback, borra pendiente) ──▶ bot  + invita reseña Google
   nota 1–3 ─────────────▶ (guarda feedback, estado→esperando_comentario)   [modo sigue en feedback]
                              │
                              └─[cliente comenta o 'saltar']──▶ (guarda comentario, borra pendiente) ──▶ bot
   nota inválida ─────────▶ "responde 1–5"                     [modo sigue en feedback]
   sin fila pendiente ────▶ Limpiar modo huérfano ─────────────▶ bot
```

### ⚠️ Posibles bugs (confirmar en n8n)

En n8n un valor de campo debe empezar con `=` para evaluarse como expresión, y la
variable del item es `$json` (no `json`):

- **`Guardar comentario`** — filtro `pedido_id` con `keyValue: "{{ $json.pedido_id }}"`
  **sin `=` inicial** → se trata como texto literal, el `WHERE` no matchea y el
  **comentario no se guarda**. (Los demás nodos usan `={{ ... }}`.)
- **`Limpiar modo huérfano`** — filtro `cliente_id` con `={{ json.cliente_id }}`
  (**`json` en vez de `$json`**) → expresión indefinida; el reset de modo huérfano
  no matchea al cliente.

> Si se confirman, registrar en [`../shared/edge-cases.md`](../shared/edge-cases.md).

### Nota de diseño

- **`Parsear calificación`** toma el **primer dígito 1–5** que aparezca en el texto
  (`/[1-5]/`). Un mensaje como "quiero 3 pizzas" se interpretaría como nota 3.
- **Credenciales:** este subworkflow usa la credencial de n8n `Supabase account`
  (no claves hardcodeadas) — patrón correcto, a diferencia de los nodos HTTP del job.

---

## Impacto en el esquema (sincronizar en `../database/schema.md`)

Tablas/columnas que usa el sistema de feedback:

- **`feedback_pendiente`** (cola de espera) — `telefono`, `pedido_id`, `cliente_id`,
  `estado` ∈ { `'esperando_nota'`, `'esperando_comentario'` }.
- **`feedback`** (resultado final) — `feedback_id` (`FB-{pedido_id}`), `cliente_id`,
  `pedido_id`, `fecha`, `calificacion_general` (1–5), `comentario` (nullable).
- **`pedidos`** — `feedback_solicitado` (boolean), `fecha_entrega` (timestamp).
- **`clientes.modo`** admite `'esperando_feedback'` (además de `'bot'` / `'humano'`).

## Credenciales (no hardcodear)

La `service_role` de Supabase y el token de Meta deben vivir como **credenciales /
variables de entorno de n8n**, nunca en git ni en estos docs. La `service_role`
salta RLS: trátala como secreto de servidor.
