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

| Ruta | Condición | Destino |
|---|---|---|
| Texto | Mensaje tipo `text` | → Ruta de texto (flujo principal) |
| Imagen | Mensaje tipo `image` | → Ruta de imagen (comprobante) |
| Otro | Cualquier otro tipo | → No Operation, do nothing! |

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
       │   │   └─ Busca el pedido del cliente pendiente de comprobante
       │   └─ ¿Pedido existe? (IF)
       │       ├─ FALSE → Pedido no encontrado (WhatsApp — message.send)
       │       │            └─ Avisa al cliente que no tiene pedido activo
       │       └─ TRUE →
       │           ├─ Preparar Upload (Code node)
       │           │   └─ Prepara el archivo para subir al storage
       │           ├─ Subir a supabase storage (HTTP Request)
       │           │   └─ Sube la imagen al bucket de Supabase Storage
       │           ├─ Update a row (Supabase — update row)
       │           │   └─ Actualiza pedidos.comprobante_url con la URL del storage
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
Switch (texto)
  │
  ├─ Extraer datos del mensaje (Edit Fields — manual)
  │   └─ Extrae telefono, nombre, texto del payload del Trigger
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
       ├─ soporte  → AGENTE SOPORTE  · tools: info_local, actualizar_cliente,
       │                                      solicitar_handoff
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
       └─ OTRO → No Operation (ignorar)
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
- `bot` → se asume **comprobante de pago**: busca el pedido activo y, si existe, sube la
  imagen a Supabase Storage y guarda la URL en `pedidos.comprobante_url`.
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