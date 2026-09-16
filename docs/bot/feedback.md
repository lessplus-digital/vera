# Sistema de Feedback de Pedidos

> **Rediseñado el 2026-09-16 (BUG-057/058/059/060).** La máquina de estados ya **no vive en n8n**:
> vive en dos RPCs transaccionales de Supabase. n8n solo decide *cuándo* llamarlas y *qué texto*
> enviar. Verificado vía MCP tras publicar: `Sub — Feedback Pendiente` `05b3415f…`,
> `Pizzeria Vera` `1f351a3b…`. Historia del cambio al final.

El feedback tiene **dos mitades**, las dos dentro de n8n pero con toda la lógica en la BD:

| Mitad | Dónde corre en n8n | RPC que hace el trabajo |
|---|---|---|
| **Preguntar** | rama `trigger_feedback` del workflow principal `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`) | `solicitar_feedback_lote(p_limite)` |
| **Responder** | subworkflow `Sub — Feedback Pendiente` (`xGsKJf2u3bFmL6mA`), invocado por el `Router de modo` cuando el cliente está en `esperando_feedback` | `procesar_respuesta_feedback(p_telefono, p_mensaje)` |

Contrato completo de las dos funciones: [`../database/schema.md`](../database/schema.md) §Funciones.
Pruebas: `qa/sql/10-resenas.sql` T10–T15.

---

## Por qué está en la BD y no en n8n

Hasta el 2026-09-16 las dos mitades eran ~20 nodos de n8n que escribían en tres tablas **sin
transacción**. Cada paso podía fallar en silencio — un filtro PostgREST que no matchea ninguna fila
responde **204**, y n8n lo marca como éxito — y dejar al cliente a medias. En el incidente que lo
destapó, tres defectos así se encadenaron: un DELETE que no borró, un PATCH que no marcó y un INSERT
que chocó con 409. Resultado: un cliente respondió `5` dos veces, no recibió nada y quedó **fuera del
bot** con cada mensaje muriendo igual.

La regla desde entonces: **ninguna transición de estado del feedback se escribe desde n8n.** Si hace
falta una nueva, va a la RPC, con su caso en `10-resenas.sql`.

---

## Mitad 1 — Preguntar (cron cada 15 min)

```
trigger_feedback (Schedule Trigger — cada 15 min)
  │
  └─ Solicitar lote de feedback (RPC)   POST /rest/v1/rpc/solicitar_feedback_lote  {"p_limite": 20}
       │   Devuelve [{pedido_id, cliente_id, telefono, nombre}] y, EN LA MISMA TRANSACCIÓN,
       │   ya marcó feedback_solicitado, encoló en feedback_pendiente y pasó al cliente
       │   a 'esperando_feedback'.   (retryOnFail · alwaysOutputData)
       │
       └─ Split In Batches (de a 5)
            ├─ Code — Preparar payload   solo redacta: "Hola {primer nombre} 👋 … Califícalo del 1 al 5"
            ├─ Enviar WhatsApp
            └─ Wait1 (2 s) → vuelve al Split
```

**Qué pedidos elige la RPC:** `entregado` · `feedback_solicitado = false` · entregado hace entre 1 y
6 h · cliente `activo` en modo `'bot'` · **sin fila en `feedback`** · sin cola abierta para ese
teléfono. `FOR UPDATE SKIP LOCKED`, así dos ticks solapados no se llevan el mismo pedido.

**Trade-off asumido:** la RPC marca **antes** de que salga el WhatsApp. Si el envío falla, el
cliente queda en `esperando_feedback` sin haber sido preguntado — hasta que el cron de expiración lo
libera (≤ 7 h). Se prefirió eso a lo contrario: marcar después permitía **repreguntar**, que fue
justo lo que causó el incidente.

---

## Mitad 2 — Responder (subworkflow)

```
When Executed by Another Workflow   {telefono, mensaje, cliente_id}
  │
  └─ Procesar respuesta (RPC)   POST /rest/v1/rpc/procesar_respuesta_feedback   (retry 3× / 2 s)
       │   → {accion, nota?, pedido_id?}
       │
       └─ ¿Qué contestar?  (Switch sobre accion)
            ├─ 0 positiva          → Invitar reseña Google
            ├─ 1 pedir_comentario  → Pedir comentario   ("¿qué pasó? … escribe 'saltar'")
            ├─ 2 agradecer         → Agradecer feedback
            ├─ 3 nota_invalida     → Pedir nota de nuevo ("responde solo 1–5")
            └─ fallback            → (sin conectar, a propósito)
```

El **fallback sin conectar** es `sin_pendiente`: el cliente estaba en `esperando_feedback` pero no
había cola. La RPC ya lo devolvió a `'bot'`; no hay nada que contestar. Tiene una nota en el nodo
para que nadie lo "arregle" (y no se descarta en silencio: ver `edge-cases.md` §19).

Todos los WhatsApp leen el destinatario de `$('When Executed by Another Workflow')`, nunca de
`$json` — tras el Switch, `$json` es la respuesta de la RPC y no trae teléfono.

### Lo que hace la RPC según el estado de la cola

| Estado en `feedback_pendiente` | Mensaje del cliente | Escribe | `accion` |
|---|---|---|---|
| *(no hay fila)* | cualquiera | `modo → 'bot'` si estaba huérfano | `sin_pendiente` |
| `esperando_nota` | **es** una nota: `5`, ` 4 `, `cinco`… | UPSERT `feedback` · borra cola · `modo → 'bot'` | `positiva` (4–5) |
| `esperando_nota` | **es** una nota 1–3 | UPSERT `feedback` · cola → `esperando_comentario` | `pedir_comentario` |
| `esperando_nota` | *contiene* un número pero no **es** una nota: `10/10`, `quiero 2 pizzas` | nada | `nota_invalida` |
| `esperando_comentario` | texto | `feedback.comentario` · borra cola · `modo → 'bot'` | `agradecer` |
| `esperando_comentario` | `saltar` | borra cola · `modo → 'bot'` (no pisa un comentario previo) | `agradecer` |

Garantías: la fila de la cola se bloquea (`FOR UPDATE`), así dos mensajes seguidos se serializan; una
segunda calificación del mismo pedido **actualiza** en vez de reventar; "cerrar" siempre es borrar la
cola **y** restaurar el modo, en la misma transacción.

### Ciclo de vida del `modo`

```
bot ──[cron: solicitar_feedback_lote]──▶ esperando_feedback
                                           │
   nota 4–5 ───────────────▶ bot  + invitación a Google
   nota 1–3 ───────────────▶ (sigue en feedback, cola = esperando_comentario)
                               └─[comenta o 'saltar']──▶ bot + gracias
   no es una nota ─────────▶ (sigue igual) + "responde 1–5"
   sin cola ───────────────▶ bot
   6 h sin responder ──────▶ bot   (cron expirar-feedback-pendiente, cada hora; nunca pisa 'humano')
```

---

## Red de seguridad

`expirar_feedback_pendiente()` corre **cada hora** (`7 * * * *`) y libera toda cola de más de **6 h**.
Es la garantía de último recurso: venga el fallo de donde venga, ningún cliente queda sin bot más de
~7 h. Hasta el 2026-09-16 era 48 h con corrida diaria — hasta ~3 días.

`10-resenas.sql` **T15** es la invariante en vivo (debe dar `0/0/0/0`): nadie en `esperando_feedback`
sin cola, nadie con cola y en `'bot'`, ninguna cola sobre un pedido ya calificado, ninguna cola vencida.

---

## Esquema que usa

- **`feedback_pendiente`** — PK `telefono` (un slot por cliente), `pedido_id`, `cliente_id`,
  `estado` ∈ {`esperando_nota`, `esperando_comentario`}, `fecha_solicitud` (default `now()`).
- **`feedback`** — `feedback_id` = `FB-{pedido_id}` (PK determinista: un feedback por pedido, además
  de `UNIQUE(pedido_id)`), `calificacion_general` 1–5, `comentario`, `fecha` (`timestamp` en **UTC**,
  la escribe la RPC).
- **`pedidos.feedback_solicitado`** · **`clientes.modo`** ∈ {`bot`, `humano`, `esperando_feedback`}.

Las dos RPCs son `SECURITY DEFINER` con `EXECUTE` solo para `service_role`: n8n las llama con la
credencial `Supabase account`; el dashboard no puede.

---

## Historia

- **2026-07-22 · BUG-001/002** — expresiones sin `=` y `json.` en vez de `$json.` en la Fase B.
- **2026-09-12 · BUG-050** — el POST a la cola sin upsert mataba el cron con 409; se añadió upsert,
  reorden y el cron de expiración (48 h).
- **2026-09-15 · BUG-051** — el parser tomaba el primer dígito del texto (`10/10` → nota 1). Regla
  estricta: el mensaje tiene que *ser* la nota.
- **2026-09-15 · BUG-056** — el switch de la nota leía `$json.es_positiva` de la fila insertada:
  todo caía en la ruta negativa.
- **2026-09-16 · BUG-057/058/059/060** — el incidente de los dos `5` sin respuesta: el reorden de
  BUG-050 dejó el PATCH de idempotencia leyendo `$json` de la respuesta de WhatsApp (nunca marcaba),
  el DELETE de la Fase B filtraba por una columna inexistente (nunca borraba) y el INSERT chocaba con
  409 al repreguntar. Además `fecha` se guardaba 2 h adelantada. **Se movió toda la lógica a RPCs.**
  Detalle en `docs/shared/bug-tracker.md` y lecciones en `edge-cases.md` §37–38.
