# Casos Límite y Lecciones Aprendidas

> Cada entrada es un bug real encontrado en producción o testing. Agrega nuevos al final con fecha.

## 1. El LLM inventaba producto_ids

**Síntoma:** El agente construía IDs como `PIZZA-DULCE-JUMB-PQ` en lugar de usar los reales (`PROD-001`).
**Causa:** Sin restricción explícita, GPT "adivina" el formato del ID.
**Solución:** Regla en el system prompt: "NUNCA inventes un producto_id. Solo usa IDs recibidos de consultar_menu." + obligar llamada a consultar_menu antes de agregar_items.

## 2. Filtros OR con múltiples palabras fallan

**Síntoma:** Buscar "hawaiana premium" no encontraba "Premium Hawaiana".
**Causa:** Supabase `ilike` busca la frase exacta, no palabras individuales.
**Solución:** Dividir en palabras. Primera palabra → filtro Supabase. Resto → `.filter()` en Code node post-proceso.

## 3. n8n Code nodes no tienen APIs de browser

**Síntoma:** `URLSearchParams`, `fetch`, `$helpers.httpRequest` dan error.
**Causa:** El sandbox de n8n Code node es limitado.
**Solución:** Usar nodo HTTP Request separado con "Send Query Parameters" → "Fields Below".

## 4. n8n envía `undefined` como string

**Síntoma:** Supabase recibe `"undefined"` como valor de texto, causando errores de parseo.
**Causa:** Si un campo del JSON no existe, n8n lo serializa como `"undefined"`.
**Solución:** No incluir campos opcionales en el objeto si no tienen valor. No usar `null` tampoco — simplemente omitir el campo.

## 5. El LLM se saltaba consultar_menu

**Síntoma:** El agente respondía con precios de memoria sin consultar la BD.
**Causa:** GPT "cree saber" datos que vio en conversaciones anteriores.
**Solución:** Regla ABSOLUTA en prompt + mover la llamada a consultar_menu al momento de confirmar tamaños (cuando ya tiene el nombre exacto).

## 6. Total del pedido llegaba como 0

**Síntoma:** Se creaba el pedido con `total: 0` porque el LLM no tenía los precios de los items aún.
**Causa:** crear_pedido se ejecuta antes de agregar_items.
**Solución:** Trigger en Supabase que recalcula automáticamente `pedidos.total` cada vez que se inserta/actualiza/elimina un detalle.

## 7. El bot mencionaba "el sistema"

**Síntoma:** Cuando un producto no existía, el bot decía "el sistema no encontró resultados" o "hubo un error en la búsqueda".
**Causa:** Comportamiento default de GPT al reportar errores de tools.
**Solución:** Regla en prompt: PROHIBIDO mencionar "el sistema", "herramientas", "buscar" ni nada técnico. En su lugar: "No tenemos X, pero te puedo ofrecer Y."

## 8. Mensajes duplicados por webhook retry

**Síntoma:** El mismo mensaje del cliente se procesaba 2-3 veces.
**Causa:** Meta envía reintentos si el webhook no responde 200 rápido.
**Solución:** Responder 200 inmediatamente al webhook antes de procesar. En n8n: "Respond Immediately" en el Webhook node.

## 9. Comprobante como imagen sin contexto

**Síntoma:** El cliente envía una imagen sin texto. El bot no sabe qué hacer con ella.
**Causa:** El webhook recibe tipo `image` pero el agente solo procesa texto.
**Solución:** Detectar tipo de mensaje en el Code node inicial. Si es imagen y hay un pedido pendiente de pago, guardar URL como `comprobante_url`. Si no hay contexto, pedir al cliente que explique.

## 10. Cliente envía emoji o sticker como nombre

**Síntoma:** El bot guardaba "🙏" o "Jesús Cristo Rey" como nombre.
**Causa:** El cliente respondía con algo que no es un nombre real.
**Solución:** Regla en prompt: si el nombre parece raro, religioso, emoji o no real → saludar sin nombre y no registrarlo.

---

## Plantilla para nuevos casos

```
## N. Título corto

**Síntoma:** Qué se observó
**Causa:** Por qué pasó
**Solución:** Qué se hizo para resolverlo
**Fecha:** YYYY-MM-DD
```
