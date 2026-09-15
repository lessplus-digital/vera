# Workflow Principal — n8n

> El flujo principal de n8n, el más importante

---

## Trigger

**Nodo:** WhatsApp Trigger
**Tipo:** Webhook de Meta WhatsApp Cloud API
**Recibe:** Todos los mensajes entrantes (texto, imagen, interactive, etc.)

---

## Switch inicial: Tipo de mensaje

**Nodo:** Switch (mode: Rules)
**Entrada:** Payload del WhatsApp Trigger
**Evalúa:** Tipo de mensaje recibido

| Salida | Condición | Destino |
|---|---|---|
| 0 · Texto | Existe `messages[0].text.body` | → Ruta de texto (flujo principal) |
| 1 · Imagen | `messages[0].type` contiene `image` | → Ruta de imagen (comprobante) |
| 2 · Tap de botón | `messages[0].type` ∈ `button` \| `interactive` | → `Normalizar tap` → Ruta de texto |
| (sin match) | Cualquier otra cosa | Se descarta (el Switch no tiene fallback) |

El Switch no tiene "send to all matching outputs", así que gana la **primera** regla que
matchea. Evalúa el payload **crudo** del trigger: un tap de Quick Reply no trae
`text.body`, por eso no cae en la salida 0.

> ⚠️ Los **status updates** (`statuses[]`, sin `messages[]`) que llegan porque el trigger
> está suscrito a `messageStatusUpdates: ['sent']` tampoco matchean ninguna regla y se
> descartan ahí. Es lo esperado, no un bug: son la mitad de las ejecuciones del workflow.

### `Normalizar tap` (Code) — taps de Quick Reply

Un tap de botón de plantilla llega como `messages[0].type = 'button'` con
`button: { text, payload }` (**no** como `interactive`; eso es solo para botones enviados
por mensaje interactivo, que se cubren igual por si acaso). Como no trae `text.body`, el
resto del flujo lo ignoraba por completo.

Este nodo inyecta el texto del botón en `messages[0].text.body` y reenvía el payload a
`Extraer datos del mensaje`, así que **todo el flujo de texto sirve sin cambios** (incluido
`No > Crear Cliente`, que referencia `$('Extraer datos del mensaje').item.json.telefono` —
por eso el tap pasa por ese nodo y no por una rama paralela).

Además desambigua los taps que solos no se entienden, porque la plantilla la manda el
**dashboard**, no el agente, y el historial de chat no tiene contexto:

| Botón (label real en Meta) | Plantilla | `mensaje` que ve el orquestador | Agente |
|---|---|---|---|
| `Quiero pedir` | `reactivacion_cliente` | `Quiero pedir` | menu |
| `No, gracias` | `reactivacion_cliente` | `No, gracias` | soporte |
| `Confirmar` | `recordatorio_reserva` | **`Confirmar mi reserva`** | reservas |
| `Cancelar` | `recordatorio_reserva` | **`Cancelar mi reserva`** | reservas |

Sin el remapeo, `Confirmar` suelto cae en la regla de "pedidos" del orquestador
(`"confírmalo"`) o en el fallback a soporte. El mapeo aplica **solo a taps**, no a texto
que el cliente escriba.

---

## RUTA DE IMAGEN (comprobante de pago)

```
Switch (imagen)
  │
  ├─ Obtener datos cliente1 (Supabase — get row)
  │   └─ SELECT * FROM clientes WHERE telefono = {{ telefono }}
  │
  ├─ ¿Cliente Existe?1 (IF)
  │   ├─ FALSE → No > Crear Cliente1 (Supabase — create row)
  │   │            └─ INSERT con nombre='Pendiente', modo='bot'
  │   └─ TRUE → Continuar
  │
  ├─ Merge Data Cliente1 (Merge — append)
  │   └─ Combina los datos del cliente (nuevo o existente, Input 1 / Input 2)
  │       con el payload de la imagen
  │
  ├─ Mapear imagenes de wpp (Edit Fields — manual)
  │   └─ Extrae image_id, mime_type, metadata del payload
  │
  ├─ Traer imagen de whatsapp (HTTP Request — GET)
  │   └─ Obtiene la URL de descarga desde Meta API usando el image_id
  │
  ├─ Descargar imagen de whatsapp (HTTP Request — GET)
  │   └─ Descarga el binary de la imagen
  │
  └─ Router de modo1 (Switch — mode: Rules, evalúa {{ $json.modo }})
       │   Mismas reglas que el Router de modo del flujo de texto
       │
       ├─ modo == 'humano' → RUTA SOPORTE
       │   ├─ Preparar Upload Soporte (Code node)
       │   ├─ Subir a supabase storage1 (HTTP Request)
       │   │   └─ Sube la imagen al bucket de Supabase Storage
       │   └─ Guardar mensaje imagen (Supabase — create row)
       │        └─ INSERT en mensajes_soporte con la imagen, para el panel de soporte
       │
       ├─ modo == 'bot' → RUTA COMPROBANTE (pago de un pedido)
       │   ├─ Buscar pedido activo (Supabase — get row)
       │   │   └─ telefono + estado='pendiente' + metodo_pago='Transferencia'
       │   │      + estado_pago='pendiente'.  ⚠️ Puede devolver VARIAS filas:
       │   │      el nodo Supabase no tiene sort ni limit.
       │   └─ ¿Pedido existe? (IF)
       │       ├─ FALSE → Pedido no encontrado (WhatsApp — message.send)
       │       │            └─ Avisa al cliente que no tiene pedido activo
       │       └─ TRUE →
       │           ├─ Preparar Upload (Code node)
       │           │   └─ ELIGE el pedido: el más reciente por fecha_pedido
       │           │      que aún no tenga comprobante_url. NO usar .first()
       │           │      (ver edge-cases.md#18) y nombra el archivo {pedido_id}.{ext}
       │           ├─ Subir a supabase storage (HTTP Request)
       │           │   └─ Sube la imagen al bucket de Supabase Storage
       │           ├─ Update a row (Supabase — update row)
       │           │   └─ Actualiza pedidos.comprobante_url del pedido que eligió
       │           │      Preparar Upload ($('Preparar Upload').first().json.pedidoId)
       │           └─ Comprobante recibido (WhatsApp — message.send)
       │                └─ Confirma al cliente que se recibió el comprobante
       │
       └─ modo == 'esperando_feedback' → Pedir nota de nuevo (WhatsApp — message.send)
            └─ Mandó imagen pero se espera su calificación → le pide la nota (1–5)
```

---

## RUTA DE TEXTO (flujo principal)

### Fase 1: Deduplicación y acumulación de mensajes

```
Switch (texto)  ·  y también Switch (tap de botón) → Normalizar tap
  │
  ├─ Extraer datos del mensaje (Edit Fields — manual)
  │   └─ Extrae telefono, nombre, texto del payload del Trigger
  │      (para un tap, el texto ya lo puso Normalizar tap en messages[0].text.body)
  │
  ├─ Crear mensaje pendiente (Supabase — create row)
  │   └─ Guarda el mensaje en una tabla de mensajes pendientes
  │
  ├─ Wait
  │   └─ Espera N segundos para acumular mensajes rápidos del cliente
  │       (evita que cada mensaje dispare el flujo por separado)
  │
  ├─ Obtener ultimo mensaje (HTTP Request — GET Supabase)
  │   └─ Consulta el último mensaje del cliente
  │
  ├─ ¿Es el último? (Code node)
  │   └─ Valida si este mensaje es el más reciente del cliente
  │       (si no es el último, este hilo se descarta → otro hilo lo procesa)
  │
  └─ IF
      ├─ FALSE → No hagas nada (No Operation) — este hilo se descarta
      │           (el último mensaje se encarga)
      └─ TRUE → Continuar ↓
```

> **Reintentos (2026-09-15, BUG-053).** `Crear mensaje pendiente`, `Obtener ultimo mensaje`,
> `Obtener ultimo mensaje1` y `Eliminar temp de pendientes` tienen `retryOnFail` (3 intentos, 1 s).
> Antes un 504 pasajero de Supabase mataba el turno: el cliente no recibía respuesta y su fila
> quedaba en el buffer, y como `Combinar mensajes` une **todos** los pendientes sin mirar la edad,
> reaparecía pegada a su siguiente mensaje días después (se reprodujo en vivo). Red de seguridad en
> BD: cron `limpiar-mensajes-pendientes` borra filas de más de 5 min. Contrapartida aceptada: si el
> INSERT se escribió pero se perdió la respuesta, el reintento duplica la fila y el mensaje llega
> repetido — preferible a perderlo.

### Fase 2: Combinar mensajes acumulados

```
  ├─ Obtener ultimo mensaje1 (HTTP Request — GET Supabase)
  │   └─ Obtiene todos los mensajes pendientes del cliente
  │
  ├─ Combinar mensajes (Code node)
  │   └─ Concatena todos los mensajes acumulados en uno solo
  │
  ├─ Eliminar temp de pendientes (Supabase — delete row)
  │   └─ Limpia los mensajes pendientes ya procesados
  │
  └─ Agrupar (Aggregate node)
      └─ Agrupa los datos para pasarlos como un solo item
```

### Fase 3: Datos del cliente

```
  ├─ Obtener datos cliente (Supabase — get row)
  │   └─ SELECT * FROM clientes WHERE telefono = {{ telefono }}
  │
  ├─ ¿Cliente Existe? (IF)
  │   ├─ FALSE → No > Crear Cliente (Supabase — create row)
  │   │            └─ INSERT con nombre='Pendiente', modo='bot'
  │   └─ TRUE → Continuar
  │
  ├─ Merge Data Cliente (Merge — append)
  │   └─ Combina datos del cliente (nuevo o existente) con el mensaje
  │
  └─ Edit Fields (Set — manual)
      └─ Prepara el JSON final: telefono, nombre, direccion, mensaje combinado
```

### Fase 4: Router de modo (handoff)

Tras `Edit Fields`, un Switch enruta el mensaje según el modo del cliente.

```
  Edit Fields
    │
    └─ Router de modo (Switch — mode: Rules, evalúa {{ $json.modo }})
         │
         ├─ modo == 'humano' → Modo Humano (Crear Soporte) (Supabase — create row)
         │     └─ INSERT INTO mensajes_soporte (telefono, origen='cliente', mensaje)
         │     └─ FIN — no pasa a ningún agente (lo atiende el panel de soporte)
         │
         ├─ modo == 'bot' → ORQUESTADOR ↓ (ver Fase 5)
         │
         └─ modo == 'esperando_feedback' → Ejecutar Retener feedback (Execute Workflow)
               └─ Procesa la nota/comentario del cliente.
                  Ver: feedback.md → "Subworkflow de respuesta (Retener feedback)"
```

### Fase 5: Orquestador + Agentes

> Detalle completo (prompts, tools, reglas) en [ai-agents.md](ai-agents.md).
> Todos los agentes usan **gpt-5.1** + Postgres Chat Memory (sessionKey = telefono, ventana 10).

```
  ├─ ORQUESTADOR (AI Agent) — clasifica intención → JSON { agente, razon }
  │
  ├─ Parse Orquestador (Code node) — parsea el JSON; fallback a 'soporte'
  │
  └─ Decision Orquestador (Switch por {{ $json.agente }}) — 4 salidas
       │
       ├─ menu     → AGENTE MENÚ     · tools: leer_carrito, consultar_menu,
       │                                      crear_carrito, actualizar_carrito
       ├─ pedidos  → AGENTE PEDIDOS  · tools: leer_carrito1, crear_orden_completa,
       │                                      actualizar_cliente1
       ├─ soporte  → AGENTE SOPORTE  · tools: info_local, consultar_faq,
       │                                      actualizar_cliente, solicitar_handoff
       └─ reservas → AGENTE RESERVAS · tools: consultar_disponibilidad,
                                              crear_reserva, consultar_reservas_cliente,
                                              cancelar_reserva

  Los 4 agentes convergen en → Code in JavaScript2 → Send message (WhatsApp)
```

---

## Diagrama resumido del flujo completo

```
WhatsApp Trigger
  │
  └─ Switch (tipo de mensaje)
       │
       ├─ IMAGEN → Datos cliente → Mapear/Descargar imagen → Router de modo1:
       │              · humano              → subir a storage + Guardar mensaje (soporte)
       │              · bot                 → ¿pedido activo? → subir comprobante → Confirmar
       │              · esperando_feedback  → Pedir nota de nuevo
       │
       ├─ TEXTO → Acumular msgs (Wait / ¿es último? / combinar) → Datos cliente → Edit Fields
       │              → Router de modo:
       │                 · humano              → Modo Humano (Crear Soporte) → FIN
       │                 · bot                 → Orquestador → Agente (menú/pedidos/soporte/reservas)
       │                 · esperando_feedback  → Ejecutar Retener feedback
       │              → Code in JavaScript2 → Send message
       │
       ├─ TAP DE BOTÓN → Normalizar tap → se une a la RUTA DE TEXTO ↑
       │
       └─ (sin match: status updates, audio, etc.) → se descarta
```

---

## Notas de implementación

### Sistema de acumulación de mensajes (Wait)

**Problema que resuelve:** En WhatsApp, los clientes envían mensajes rápidos seguidos ("hola" + "quiero una pizza" + "hawaiana"). Sin acumulación, cada mensaje dispara un flujo independiente y el agente responde 3 veces.

**Cómo funciona:**
1. Cada mensaje se guarda como "pendiente" en BD
2. Se espera N segundos (el Wait)
3. Al despertar, verifica si hay mensajes más recientes del mismo cliente
4. Si SÍ hay más recientes → este hilo se descarta (el último se encarga)
5. Si NO hay más recientes → este es el último, combina todos los pendientes y procesa

**Resultado:** El agente recibe un solo mensaje concatenado con todo lo que el cliente escribió.

### Ruta de imagen

**Flujo de 2 pasos para descargar:**
1. `Traer imagen de whatsapp` — Obtiene la URL de descarga de Meta (requiere token)
2. `Descargar imagen de whatsapp` — Descarga el binary de la imagen

**Enrutamiento por modo:** tras descargar, `Router de modo1` (mismas reglas que el
`Router de modo` del flujo de texto) decide qué hacer con la imagen según `cliente.modo`:
- `humano` → la imagen se guarda como mensaje en `mensajes_soporte` (panel de soporte).
- `bot` → se asume **comprobante de pago**: busca los pedidos `pendiente` + `Transferencia` +
  `estado_pago = 'pendiente'` del teléfono y, si hay alguno, sube la imagen a Supabase Storage y
  guarda la URL en `pedidos.comprobante_url`. **La búsqueda puede devolver varias filas** (un cliente
  puede arrastrar pedidos viejos sin cerrar); el desempate lo hace `Preparar Upload` por
  `fecha_pedido` desc. Ver `edge-cases.md#18` y BUG-028.
- `esperando_feedback` → `Pedir nota de nuevo` (se espera la calificación, no una imagen).

### Routers de modo (compartidos)

Tanto la ruta de texto como la de imagen enrutan con un Switch sobre `{{ $json.modo }}`
(`humano` / `bot` / `esperando_feedback`). El modo lo fijan: `solicitar_handoff` → `humano`;
el [job de feedback](feedback.md) → `esperando_feedback`; el subworkflow de feedback lo
restaura a `bot` al terminar.

---

## Variables de entorno en n8n

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | Anon key |
| `OPENAI_API_KEY` | API key de OpenAI |
| `WA_PHONE_NUMBER_ID` | ID del número de WhatsApp Business |
| `WA_ACCESS_TOKEN` | Token permanente de Meta |
| `WA_VERIFY_TOKEN` | Token de verificación del webhook |