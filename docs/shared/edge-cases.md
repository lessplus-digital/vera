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

## 11. RLS bloquea writes de n8n en silencio (pedidos sin líneas)

**Síntoma:** Pedidos con `total` pero 0 filas en `detalle_pedidos` (8 casos en producción, BUG-007).
**Causa:** Un nodo HTTP de n8n escribía con la **anon key hardcodeada** contra una tabla con RLS
(política solo `authenticated`) → el INSERT devuelve 4xx pero el flujo siguió y borró el carrito,
perdiendo los datos. RLS no "avisa": simplemente rechaza, y si el workflow no corta, el daño pasa
desapercibido.
**Solución:** Todo nodo n8n que toque Supabase usa `authentication: predefinedCredentialType` con
la credencial `Supabase account` (service_role) — nunca keys pegadas en headers. Al auditar,
verificar el rol decodificando el JWT del header (`"role":"anon"` vs `"service_role"`), y validar
sobre la **versión publicada** del workflow, no el borrador.
**Fecha:** 2026-07-22

## 12. Keys con espacio invisible al final en inputs de n8n

**Síntoma:** Validaciones que nunca se disparan: un Code node lee `input.telefono` /
`input.cliente_id` y recibe `undefined`, aunque el dato "sí llega" (BUG-004 y BUG-009 — mordió
dos veces con el mismo patrón).
**Causa:** Al escribir los inputs de un subworkflow (o el schema de una tool) en la UI de n8n se
coló un espacio al final del nombre (`'telefono '`, `'cliente_id '`). n8n lo acepta y lo propaga
tal cual, así que los nodos que leen la key "bien escrita" (sin espacio) ven `undefined` — y un
`if (input.x && ...)` se salta en silencio, incluso checks de seguridad.
**Solución:** Renombrar la key sin espacio en **todo** el camino (schema de la tool en el main +
trigger del subworkflow + cada nodo que la lea). Al auditar, comparar las keys del trigger
carácter a carácter contra lo que leen los Code nodes. Y escribir los checks de seguridad
**fail-closed** (`!input.x || ...`), para que un input ausente falle ruidoso en vez de saltarse
la validación. Ojo: el pinData conserva las keys viejas — re-pinnear tras el rename.
**Fecha:** 2026-07-23

---

## Plantilla para nuevos casos

```
## N. Título corto

**Síntoma:** Qué se observó
**Causa:** Por qué pasó
**Solución:** Qué se hizo para resolverlo
**Fecha:** YYYY-MM-DD
```

## 13. Re-derivar el "día de negocio" a mano rompe el kanban de noche (2026-07-22)

**Síntoma:** Pedidos reales del bot no aparecían en el kanban entre 19:00 y 24:00 Colombia (BUG-025); parecía un problema de zona horaria al guardar (BUG-022), pero el guardado era correcto.
**Causa:** `useOrders` calculaba el inicio del día con `new Date(); setUTCHours(5,0,0,0)`. Cuando UTC ya cruzó la medianoche (00:00–05:00 UTC), eso produce las 05:00 UTC del día SIGUIENTE → umbral en el futuro → `gte` devuelve vacío.
**Solución:** usar SIEMPRE `colombiaDayStart()` de `src/utils/dateRanges.js` (desplaza −5h antes de anclar la fecha). Nunca re-derivar lógica de fechas/timezone a mano en un hook: si estadísticas y kanban difieren, el que no usa el helper es el que está mal.

## 14. Realtime con RLS filtra eventos en silencio si el socket no lleva JWT (2026-07-22)

**Síntoma:** El badge de soporte no se actualizaba en vivo (BUG-023) aunque la tabla estaba en la publicación realtime; los INSERT de `mensajes_soporte` sí llegaban.
**Causa:** postgres_changes aplica RLS por suscriptor: `clientes` (solo `authenticated`) no emitía nada a un socket con token anon; `mensajes_soporte` llegaba solo porque tenía una política `public` (que era un hueco de seguridad, BUG-024, ya eliminada).
**Solución:** propagar el JWT al socket (`supabase.realtime.setAuth(token)` en getSession + onAuthStateChange). Lección: si un canal realtime "no recibe nada" y la tabla está en la publicación, sospecha del par RLS/token antes que del canal — y una política `public` que "hace funcionar" algo puede estar ocultando una fuga.
