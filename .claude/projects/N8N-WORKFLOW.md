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
  ├─ Mapear Imagenes de wpp (Edit Fields — manual)
  │   └─ Extrae image_id, mime_type, metadata del payload
  │
  ├─ Traer Imagen de whatsapp (HTTP Request — GET)
  │   └─ Descarga la imagen desde Meta API usando el image_id
  │
  ├─ Descargar Imagen de whatsapp (HTTP Request — GET)
  │   └─ Obtiene el binary de la imagen
  │
  ├─ Buscar pedido activo (Supabase — get row)
  │   └─ Busca pedido del cliente con estado pendiente de comprobante
  │
  ├─ ¿Pedido existe? (IF)
  │   │
  │   ├─ FALSE → Pedido no encontrado (WhatsApp — message.send)
  │   │            └─ Le dice al cliente que no tiene pedido activo
  │   │
  │   └─ TRUE →
  │       ├─ Preparar Upload (Code node)
  │       │   └─ Prepara el archivo para subir al storage
  │       │
  │       ├─ Subir a supabase storage (HTTP Request)
  │       │   └─ Sube la imagen al bucket de Supabase Storage
  │       │
  │       ├─ Update a row (Supabase — update row)
  │       │   └─ Actualiza pedidos.comprobante_url con la URL del storage
  │       │
  │       └─ Comprobante recibido (WhatsApp — message.send)
  │            └─ Confirma al cliente que se recibió el comprobante
```

---

## RUTA DE TEXTO (flujo principal)

### Fase 1: Deduplicación y acumulación de mensajes

```
Switch (texto)
  │
  ├─ Extraer datos del mensaje (Supabase — raw/get)
  │   └─ Extrae telefono, nombre, texto del mensaje
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
      ├─ FALSE → (se descarta, el último hilo se encarga)
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

### Fase 4: Handoff check + Agentes

```
  ├─ Handoff Humano (IF)
  │   │
  │   ├─ cliente.modo == 'humano'
  │   │   └─ Create a row (Supabase — create row)
  │   │       └─ INSERT INTO mensajes_soporte (telefono, origen='cliente', mensaje)
  │   │       └─ FIN — no pasa a ningún agente
  │   │
  │   └─ cliente.modo == 'bot' → Continuar al ORQUESTADOR
  │
  ├─ ORQUESTADOR (AI Agent)
  │   ├─ OpenAI Chat Model
  │   ├─ Postgres Chat Memory
  │   └─ Clasifica intención del mensaje
  │
  ├─ Parse Orquestador (Code node)
  │   └─ Extrae la categoría del output
  │
  └─ Decision Orquestador (Switch — Routes)
       │
       ├─ → AGENTE MENÚ
       │    ├─ OpenAI Chat Model1 + Postgres Chat Memory2
       │    ├─ Tools: leer_carrito, crear_carrito, actualizar_carrito,
       │    │         actualizar_cliente2, consultar_menu
       │    └─ Code in JavaScript → Send message
       │
       ├─ → AGENTE PEDIDOS
       │    ├─ OpenAI Chat Model2 + Postgres Chat Memory3
       │    ├─ Tools: leer_carrito1, crear_orden_completa,
       │    │         actualizar_cliente/editar_pedido
       │    └─ Code in JavaScript2 → Send message
       │
       └─ → AGENTE SOPORTE
            ├─ OpenAI Chat Model4 + Postgres Chat Memory4
            ├─ Tools: solicitar_handoff, actualizar_cliente
            └─ Code in JavaScript1 → Send message
```

---

## Diagrama resumido del flujo completo

```
WhatsApp Trigger
  │
  └─ Switch (tipo de mensaje)
       │
       ├─ IMAGEN ──→ Mapear → Descargar → ¿Pedido? → Subir storage → Confirmar
       │
       ├─ TEXTO ───→ Guardar msg → Wait → ¿Es último? → Combinar msgs
       │              → Datos cliente → ¿Existe? → Edit Fields
       │              → ¿Handoff? → Orquestador → Agente → Send message
       │
       └─ OTRO ───→ No Operation (ignorar)
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

### Ruta de imagen (comprobante)

**Flujo de 2 pasos para descargar:**
1. `Traer Imagen de whatsapp` — Obtiene la URL de descarga de Meta (requiere token)
2. `Descargar Imagen de whatsapp` — Descarga el binary de la imagen

**Storage:** La imagen se sube a Supabase Storage (bucket) y la URL pública se guarda en `pedidos.comprobante_url`.

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