# n8n — Flujo de comprobante de pago (Transferencia)

## Resumen del flujo completo

```
WhatsApp Trigger
  └─ IF type === 'image'  ──────────────────────────────────────────────────────────────┐
  └─ IF type === 'text' (flujo principal existente)                                     │
                                                                              ▼
                                                               Set (extraer variables)
                                                                              │
                                                               HTTP — obtener URL de media (WhatsApp API)
                                                                              │
                                                               HTTP — descargar imagen binaria
                                                                              │
                                                               Supabase SELECT — buscar pedido pendiente
                                                                              │
                                                               IF — ¿pedido encontrado?
                                                                 │               │
                                                               (No) Reply       (Sí)
                                                               "No encontré     │
                                                               pedido activo"   HTTP — subir a Supabase Storage
                                                                                │
                                                                                HTTP — actualizar comprobante_url
                                                                                │
                                                                                WhatsApp — "Comprobante recibido ✅"
```

---

## Pre-requisito: Bucket en Supabase Storage

En el dashboard de Supabase → Storage → crear bucket:
- **Nombre**: `comprobantes`
- **Acceso público**: ✅ activado (para que el dashboard pueda ver la imagen sin auth)

---

## Paso 1 — Modificar el nodo IF principal

El nodo IF del paso 2 del flujo principal probablemente filtra por `type === 'text'` (o similar). Agrega una segunda salida para imágenes:

**Condición existente (verdadero = texto):**
```
{{ $json.body.entry[0].changes[0].value.messages[0].type === 'text' }}
```

**Nueva rama (también True, usar nodo IF separado antes):**
Agrega un **nuevo nodo IF** al inicio, antes del flujo principal, que detecte imágenes:
```
{{ $json.body.entry[0].changes[0].value.messages[0].type === 'image' }}
```
- **True** → rama de comprobante (nueva)
- **False** → flujo de texto existente (sin cambios)

---

## Paso 2 — Set: extraer variables de la imagen

**Nodo tipo**: Set (Edit Fields)

| Variable | Expresión |
|---|---|
| `mediaId` | `{{ $json.body.entry[0].changes[0].value.messages[0].image.id }}` |
| `mimeType` | `{{ $json.body.entry[0].changes[0].value.messages[0].image.mime_type }}` |
| `telefono` | `{{ $json.body.entry[0].changes[0].value.messages[0].from }}` |

---

## Paso 3 — HTTP Request: obtener URL de descarga del media

WhatsApp no da el binario directamente; primero hay que obtener la URL firmada.

**Configuración:**
- **Method**: GET
- **URL**: `https://graph.facebook.com/v17.0/{{ $json.mediaId }}`
- **Headers**:
  - `Authorization`: `Bearer TU_WHATSAPP_ACCESS_TOKEN`

**Respuesta esperada:**
```json
{
  "url": "https://lookaside.fbsbx.com/...",
  "mime_type": "image/jpeg",
  "file_size": 123456,
  "id": "MEDIA_ID"
}
```

---

## Paso 4 — HTTP Request: descargar imagen en binario

**Configuración:**
- **Method**: GET
- **URL**: `{{ $json.url }}`
- **Headers**:
  - `Authorization`: `Bearer TU_WHATSAPP_ACCESS_TOKEN`
- **Response Format**: `File` (o `Binary` según tu versión de n8n)

> ⚠️ Este nodo descarga el binario de la imagen. En n8n, en el panel de opciones avanzadas, asegúrate de que "Response Format" = `File` para que el body sea datos binarios.

---

## Paso 5 — Supabase SELECT: buscar el pedido pendiente

**Configuración HTTP Request:**
- **Method**: GET
- **URL**: 
  ```
  https://TU_PROYECTO.supabase.co/rest/v1/pedidos?telefono=eq.{{ $('Set').item.json.telefono }}&estado=eq.pendiente&metodo_pago=eq.Transferencia&order=fecha_pedido.desc&limit=1
  ```
- **Headers**:
  - `apikey`: `TU_SUPABASE_ANON_KEY`
  - `Authorization`: `Bearer TU_SUPABASE_SERVICE_ROLE_KEY`
  - `Accept`: `application/json`

---

## Paso 6 — IF: ¿se encontró pedido?

**Condición:**
```
{{ $json.length > 0 }}
```

- **True** → continuar con la subida
- **False** → responder al cliente que no hay pedido activo (ver paso 6b)

### Paso 6b — Rama False: responder que no hay pedido

Enviar mensaje WhatsApp:
```
Hola 👋 No encontré ningún pedido pendiente de transferencia asociado a tu número.
Si hiciste un pedido, escríbenos para ayudarte.
```

---

## Paso 7 — HTTP Request: subir imagen a Supabase Storage

**Configuración:**
- **Method**: POST
- **URL**: 
  ```
  https://TU_PROYECTO.supabase.co/storage/v1/object/comprobantes/{{ $('Supabase SELECT').item.json[0].pedido_id }}.jpg
  ```
- **Headers**:
  - `Authorization`: `Bearer TU_SUPABASE_SERVICE_ROLE_KEY`
  - `Content-Type`: `image/jpeg`
  - `x-upsert`: `true`
- **Body**: datos binarios del paso 4 (`{{ $binary.data }}`)

> En n8n, para enviar el binario: en **Body Content Type** selecciona `Binary`, y en el campo `Input Data Field Name` coloca `data` (o el nombre del campo binario que produjo el paso 4).

---

## Paso 8 — HTTP Request: actualizar comprobante_url en pedidos

**Configuración:**
- **Method**: PATCH
- **URL**: 
  ```
  https://TU_PROYECTO.supabase.co/rest/v1/pedidos?pedido_id=eq.{{ $('Supabase SELECT').item.json[0].pedido_id }}
  ```
- **Headers**:
  - `apikey`: `TU_SUPABASE_ANON_KEY`
  - `Authorization`: `Bearer TU_SUPABASE_SERVICE_ROLE_KEY`
  - `Content-Type`: `application/json`
  - `Prefer`: `return=minimal`
- **Body (JSON)**:
  ```json
  {
    "comprobante_url": "https://TU_PROYECTO.supabase.co/storage/v1/object/public/comprobantes/{{ $('Supabase SELECT').item.json[0].pedido_id }}.jpg"
  }
  ```

> Una vez actualizado `comprobante_url`, el dashboard detecta el cambio vía Realtime y muestra el botón "Ver comprobante" en la tarjeta del pedido automáticamente.

---

## Paso 9 — WhatsApp: confirmar al cliente

Enviar mensaje al cliente (`{{ $('Set').item.json.telefono }}`):

```
✅ ¡Recibimos tu comprobante de pago!

El equipo lo revisará en breve. Te avisaremos cuando tu pedido sea aprobado y entre a preparación. 🍕

Mientras tanto puedes escribirnos si tienes alguna duda.
```

---

## Actualización del prompt del AI Agent

En el nodo **AI Agent (INTENCION CLIENTE)**, agrega estas instrucciones al system prompt:

```
## Pagos por transferencia — comprobante obligatorio

Cuando crees exitosamente un pedido con metodo_pago = 'Transferencia', SIEMPRE al confirmar el pedido debes:

1. Mostrar el resumen del pedido y el total.
2. Incluir el siguiente aviso (textual):
   "⚠️ IMPORTANTE: Tu pedido NO entrará a preparación hasta que verifiquemos tu pago."
3. Solicitar el comprobante:
   "Por favor envíanos el pantallazo del comprobante de transferencia directamente en este chat. 📸"
4. No ofrecer más opciones hasta que el cliente envíe el comprobante.

Cuando el cliente pregunte por el estado de su pago o pedido y tenga método Transferencia:
- Si aún no fue verificado: recuérdale que debe enviar el comprobante si no lo ha hecho, o que el equipo está revisando si ya lo envió.
```

---

## Flujo completo de estados con comprobante

```
Cliente hace pedido (Transferencia)
  → Bot confirma pedido + pide comprobante ⚠️
  → Cliente envía imagen
  → n8n: sube imagen a Storage + actualiza comprobante_url
  → Dashboard: tarjeta muestra "Ver comprobante de pago" 🖼️
  → Admin abre modal → ve la imagen → decide:
      ✓ Aprobar  → estado: en_cocina, estado_pago: confirmado
      ✕ Rechazar → estado: cancelado, estado_pago: rechazado
```

---

## Variables de entorno recomendadas en n8n

Usar **credenciales** o variables de entorno para:
- `WHATSAPP_ACCESS_TOKEN` — token de la API de WhatsApp Business
- `SUPABASE_URL` — `https://TU_PROYECTO.supabase.co`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — requerido para Storage y updates
