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

## 15. Los adblockers ocultan clases CSS con prefijo `ad-` (2026-07-22)

**Síntoma:** El dropdown del admin en el Header se veía como un recuadro en blanco en la app desplegada; en local funcionaba perfecto.
**Causa:** Las clases internas del dropdown se llamaban `ad-header`, `ad-item`, `ad-divider`, etc. Las listas de filtros cosméticos de los adblockers (EasyList: uBlock, ABP, Brave) aplican `display:none !important` a clases que empiezan por `ad-` porque parecen anuncios. En `localhost` los bloqueadores no suelen aplicar filtros, por eso el bug solo aparecía en producción.
**Solución:** renombrar el prefijo a `am-` (admin menu) en `index.css` + `Header.jsx`. Lección: nunca nombrar clases/ids con `ad`, `ads`, `advert`, `sponsor`, `banner` ni prefijos parecidos; si algo "se ve vacío solo en producción", probar con el adblocker desactivado antes de tocar código.

## 16. WhatsApp acepta texto libre fuera de la ventana de 24h pero no lo entrega (2026-07-23)

**Síntoma:** Desde el dashboard se respondió una reseña de un cliente cuyo pedido fue hace 2 días; la UI mostró "mensaje enviado" pero al cliente nunca le llegó.
**Causa:** La Cloud API de Meta **acepta** (responde 200, status `accepted`) un mensaje de texto libre (`type: text`) aunque el cliente esté fuera de la ventana de servicio de 24h. El fallo de entrega (`131047`) llega **después, por webhook**, no en la respuesta síncrona del POST. Por eso `res.ok` era `true` y mostrábamos "enviado" en falso. El diseño que "revelaba la plantilla solo si el envío fallaba con 131047" casi nunca se disparaba.
**Solución:** Para contactar clientes que no escribieron en <24h (reseñas viejas, reactivación), usar **siempre plantilla aprobada** (`type: template`, `sendWhatsAppTemplate`) — esa sí falla sincrónicamente si algo está mal. No confiar en el 200 del texto libre como prueba de entrega. Lección: el texto libre solo es fiable dentro de una ventana que sepas abierta (p. ej. justo tras un mensaje entrante o en modo humano en Soporte).

## 17. Filtrar por `disponible` en la tool hace que el LLM confunda "agotado" con "no existe" (2026-07-28)

**Síntoma:** Un producto marcado como **agotado** desde la pestaña Menú del dashboard; al preguntarle al bot por él, respondía *"no lo manejamos"*. Comercialmente es lo peor: el cliente se lleva la idea de que ese producto no está en la carta.
**Causa:** `Sub — Consultar_menu` llamaba al RPC `buscar_menu` con `solo_disponibles: true`. El agotado no venía en el resultado, y para el LLM **ausencia = inexistencia**: no tiene forma de distinguir "no está en la carta" de "está pero hoy no hay".
**Solución:** No filtrar en la consulta — filtrar en la **forma de la respuesta**. El sub pide todo (`solo_disponibles: false`) y devuelve dos listas: `productos_por_categoria` (solo disponibles) y `agotados`. El agente sigue sin poder ofrecer ni agregar un agotado (no está en la lista con la que construye los items del carrito) pero **sabe que existe** y responde "sí lo tenemos, hoy se agotó" + alternativa.
**Lección general:** cuando una tool oculta filas por un flag de estado, el LLM no ve un estado — ve un vacío, y el vacío lo interpreta como negación total. Si el estado importa para la respuesta al cliente, **devuélvelo en un campo aparte** en vez de filtrarlo. Aplica igual a pedidos cancelados, reservas vencidas o clientes bloqueados.

## 18. `.first()` sobre un query sin `order` escribe en la fila equivocada — y el workflow queda verde (2026-07-29)

**Síntoma:** El cliente manda el comprobante, el bot responde "✅ ¡Recibimos tu comprobante!", el archivo aparece en Storage… y el dashboard sigue mostrando *"Esperando comprobante de transferencia"*. Debuggear n8n no revelaba nada: **todos los nodos en verde, ejecución `success`**.
**Causa:** `Buscar pedido activo` filtraba solo por `telefono` + `estado = 'pendiente'` y devolvía **2 filas** (el cliente tenía un pedido viejo sin cerrar de 4 semanas antes, en Efectivo). `Preparar Upload` tomaba `$('Buscar pedido activo').first()`, y Postgres sin `ORDER BY` no garantiza orden: ganó el viejo. El comprobante se subió como `PED-109.jpg` y `comprobante_url` se escribió en `PED-109` (¡un pedido en **Efectivo**!) en vez de `PED-223`. El nodo Supabase **no tiene opciones de sort/limit** (0 de 27 propiedades), así que el orden nunca estuvo definido.
**Solución:** estrechar el filtro (`metodo_pago = 'Transferencia'`, `estado_pago = 'pendiente'`) **y** decidir el orden explícitamente en el Code node (`sort` por `fecha_pedido` desc, descartando los que ya tienen `comprobante_url`) en vez de `.first()`. Además, `Update a row` ahora referencia `$('Preparar Upload').first().json.pedidoId` — el pedido que realmente se subió — y no el `.item` del IF anterior, que con varios items podía resolver a otra fila.
**Lección general:** un workflow "verde" solo prueba que cada nodo no lanzó excepción, **no** que escribió en la fila correcta. Cuando un nodo puede devolver N filas y el siguiente asume 1, `.first()` es un bug latente que solo se manifiesta cuando aparece la segunda fila — y se manifiesta como *dato silenciosamente mal escrito*, no como error. Si el consumidor asume una sola fila, hace falta un criterio de desempate explícito. Corolario: los datos viejos sin cerrar (pedidos `pendiente` de semanas atrás) son la munición que activa estos bugs.

## 19. Un Switch sin fallback descarta en silencio los tipos de mensaje que no enumeraste (2026-07-29)

**Síntoma:** La promo (`reactivacion_cliente`) llegaba perfecto al cliente, pero al tapear el botón **"Quiero pedir"** el bot no hacía **nada**. Ni respuesta, ni error, ni pista en n8n.
**Causa:** El `Switch` inicial del workflow principal tenía **2 reglas** (existe `messages[0].text.body` → texto; `type` contiene `image` → imagen) y **ningún fallback output**. Un tap de Quick Reply de plantilla llega como `messages[0].type = 'button'` con `button: { text, payload }` y **no trae `text.body`** → no matcheaba ninguna regla → n8n descartaba el item y terminaba la ejecución como `success`. Buscar el bug en el prompt del ORQUESTADOR era la pista falsa obvia: el mensaje **nunca entró al flujo**.
**Solución:** tercera salida en el Switch (`type` ∈ `button` | `interactive`) → Code node `Normalizar tap` que inyecta el texto del botón en `messages[0].text.body` y reenvía el payload al mismo `Extraer datos del mensaje` del camino de texto. Así el resto del flujo no cambia.
**Dos trampas que vale la pena recordar:**
- Los taps de **plantilla** son `type: 'button'` (`button.text`). Los `type: 'interactive'` (`interactive.button_reply.title`) son solo para botones enviados por mensaje interactivo. Son payloads **distintos** y es fácil cablear el equivocado.
- El texto de un botón suelto puede ser ambiguo para el orquestador porque **la plantilla la manda el dashboard, no el agente**: el historial de chat no tiene contexto. `Confirmar` (de `recordatorio_reserva`) caía en la regla de *pedidos* (`"confírmalo"`). Hay que **reescribir el tap a una frase autoexplicativa** ("Confirmar mi reserva") antes de que lo vea el LLM.
**Lección general:** en un Switch de entrada que clasifica payloads de terceros, la ausencia de fallback convierte "tipo no contemplado" en **silencio absoluto**, que es el síntoma más caro de debuggear. Cuando algo "no hace nada" (en vez de fallar), sospecha primero del enrutado de entrada y **mira el payload crudo del trigger en una ejecución real** antes de tocar prompts o lógica de negocio. Y no confíes en los docs para los labels de botones: la fuente de verdad es `GET /{waba_id}/message_templates?fields=components` (el backlog listaba un botón `Sí, les cuento` que no existe en ninguna plantilla).

## 20. Un paso borrado de un prompt numerado deja al LLM rellenando el hueco (2026-07-29)

**Síntoma:** dos pedidos seguidos creados mal. En uno el bot preguntó *"¿Pagas en efectivo o por transferencia?"* y **en el mismo turno** ya había insertado el pedido con `Transferencia`. En el otro nunca preguntó: el cliente mandó la dirección y el bot respondió con el resumen y creó el pedido con `Efectivo`. Ningún error, ejecución `success`, `metodo_pago` inventado en la BD.
**Causa:** el `systemMessage` de `AGENTE PEDIDOS` había perdido el **PASO 4** — la numeración saltaba de PASO 3 a PASO 5. El PASO 3 decía *"crea el pedido … y muestra el resumen"*: crear y resumir en el **mismo turno**, sin ningún turno donde parar y esperar. Mientras tanto la sección de reglas seguía exigiendo `✓ El cliente confirmó explícitamente`, un check imposible de cumplir con ese flujo. Las plantillas del resumen empujaban en la misma dirección: cada una fija una línea `💳 [pago]` y cierra con *"Lo mando a cocina 🍕"*, una afirmación, no una pregunta.
**Solución:** PASO 3 pasa a ser *"RESUMEN Y CONFIRMACIÓN (NO crea el pedido)"* con las plantillas cerrando en *"¿Te lo confirmo así?"*, y vuelve el PASO 4 que dispara la tool solo tras un "sí"/"dale"/"confirmo". Dos reglas duras nuevas: **"nunca preguntes y crees en el mismo mensaje"** y **"prohibido asumir `metodo_pago`; 'Efectivo' no es el valor por defecto"**. La misma condición se duplica en el `toolDescription` de `crear_orden_completa` — el prompt del agente y la descripción de la tool son **dos superficies distintas** y el modelo lee la segunda justo cuando decide llamarla.
**Lección general:** cuando un LLM tiene un dato obligatorio que no posee y ninguna instrucción que lo obligue a **detenerse**, no pregunta: **inventa un valor plausible**. Un prompt no falla ruidosamente como el código — el hueco se rellena solo. Dos corolarios prácticos: (1) una **numeración rota** (PASO 3 → PASO 5) es una señal barata y fiable de que alguien borró o fusionó un paso en una edición anterior — vale la pena revisarla antes de dar por bueno un prompt; (2) si una checklist exige una condición ("el cliente confirmó") que el flujo narrado nunca produce, el modelo resuelve la contradicción a favor de **actuar**, no de esperar. La instrucción de parar tiene que estar en el flujo, no solo en la lista de reglas.

## 21. Lo que dispara un handoff nunca queda registrado, porque viaja por el camino que se acaba de apagar (2026-08-10)

**Síntoma:** el cliente escribe *"tengo un problema con el pedido, necesito hablar con un humano"*, el bot escala y la conversación aparece en el dashboard **vacía**. El operador no tiene más remedio que preguntar otra vez lo que el cliente ya explicó — la peor primera impresión posible justo cuando el cliente ya venía molesto.
**Causa:** el `Router de modo` lee `clientes.modo` **al entrar** el mensaje. Ese mensaje entra todavía como `bot`, se procesa por la ruta de agentes y es el Agente Soporte quien, a mitad de camino, llama `solicitar_handoff` y pone `modo='humano'`. El nodo que escribe en `mensajes_soporte` está en la **otra** rama del router, así que solo captura los mensajes **siguientes**. El mensaje que causó la escalada —el único que importa— es precisamente el que nunca se guarda.
**Solución:** no reconstruirlo en n8n, sino recuperarlo de donde ya estaba: `n8n_chat_histories` (la memoria de los agentes, `session_id = telefono`). Un trigger sobre `clientes` que dispara al pasar a `humano` llama a `registrar_contexto_handoff()`, que vuelca los turnos recientes a `mensajes_soporte` (`human`→`cliente`, `ai`→`bot`).
**Lo que hace que funcione (no es obvio):** el turno del cliente **ya está en la memoria** cuando el trigger dispara, porque el **ORQUESTADOR** corre primero y guarda al cerrar su cadena, antes de que el agente especializado siquiera arranque. Si solo hubiera un agente, el mensaje aún no estaría escrito y el backfill llegaría vacío.
**Tres trampas de esa memoria compartida:**
- Es **una sola sesión por teléfono para todos los agentes**, así que el mismo mensaje del cliente aparece **una vez por cadena que corre** en el turno (orquestador + agente). Hay que deduplicar consecutivos, no todas las repeticiones: un "sí" dicho dos veces en momentos distintos es información real.
- El ORQUESTADOR guarda su clasificación (`{"agente":"soporte","razon":"..."}`) como un mensaje `ai` normal. Es ruido interno que **no** puede acabar en el chat del cliente.
- Los `content` no siempre son texto: en una llamada a tool es un array vacío, y hay filas `type: 'tool'` con el resultado crudo. Filtrar por `jsonb_typeof(content) = 'string'`.
**Y una del lado del dashboard:** varios turnos del mismo intercambio comparten `created_at` (se escriben juntos al cerrar la cadena). Como el chat ordena por esa columna, con empates el planner decide y **la respuesta del bot puede pintarse antes de la pregunta del cliente**. Se desempata sumando microsegundos según el `id` de la memoria, que sí es secuencial.
**Lección general:** cuando un evento **cambia la ruta por la que viajan los mensajes**, el mensaje que provocó el cambio se procesa por la ruta vieja y cae en el hueco entre las dos. Ese hueco no se ve en los logs (todo queda `success`), solo en la experiencia. Y si el dato existe en algún lado (aquí, la memoria conversacional), **el arreglo correcto es un trigger en la BD y no un nodo más en el workflow**: cubre todas las vías de escalada —la tool, el dashboard, un UPDATE manual— en vez de solo la que recordaste cablear.

## 22. `NEW` en un trigger de DELETE no explota: devuelve NULL, y el `WHERE` no encuentra nada (2026-08-18)

**Síntoma:** borrar un ítem de un pedido dejaba `pedidos.total` clavado en el valor anterior.
Verificado en producción antes del fix: al borrar una de las 2 líneas de `PED-102`, el total
seguía en $332.300.

**Causa:** `actualizar_total_pedido()` estaba declarado `AFTER INSERT OR DELETE OR UPDATE` pero
por dentro usaba `NEW.pedido_id`. En un trigger de DELETE, PL/pgSQL deja `NEW` como un **registro
nulo**: acceder a `NEW.pedido_id` no lanza error, **devuelve NULL**. El `UPDATE ... WHERE
pedido_id = NULL` no matchea ninguna fila y el trigger termina "bien". Ningún log, ningún fallo.

**Por qué nadie lo notó:** estaba enmascarado. La única ruta que borra ítems es `editar_pedido`,
que hace DELETE + INSERT y además escribe `total` a mano al final — el INSERT sí trae `NEW`, y el
`UPDATE` explícito tapaba cualquier diferencia.

**Solución:** `v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id)` y `RETURN COALESCE(NEW, OLD)`.

**Lección:** en un trigger que cubre INSERT **y** DELETE, `NEW`/`OLD` son la mitad del contrato.
Un `WHERE pk = NULL` es la forma más silenciosa de no hacer nada en SQL: no falla, no avisa, y el
dato queda viejo. Si el trigger va a correr en DELETE, hay que probarlo **en DELETE** — un
`DO $$ ... RAISE EXCEPTION $$` que compara el antes y el después y revierte cuesta 30 segundos.

## 23. Recalcular un total desde cero destruye las filas que ya estaban mal (2026-08-18)

**Síntoma (evitado, no sufrido):** al rehacer el trigger de totales para tarifa variable, la
versión obvia era `total = suma de ítems + costo_domicilio`. Aplicada a los pedidos existentes en
un UPDATE de barrio, habría convertido un pedido de $3.365.000 en $3.000.

**Causa:** en producción había **8 pedidos con cero líneas en `detalle_pedidos`** y un `total`
escrito a mano (entre $29.000 y $3.365.000; seed antiguo o pruebas). Para esas filas "suma de
ítems" es 0, y cualquier recálculo completo las aplana.

**Solución:** el trigger sobre `pedidos` ajusta **por delta** (`total − OLD.costo + NEW.costo`) en
vez de recalcular. El recálculo completo se queda solo en el trigger de `detalle_pedidos`, que
por definición corre cuando el pedido **sí** tiene líneas.

**Lección:** antes de escribir un trigger que recalcula un agregado sobre una tabla viva, medir
primero cuántas filas **ya** violan el invariante que vas a asumir. Un `GROUP BY (total − suma)`
tarda un segundo y aquí cambió el diseño: delta en vez de recálculo. Un trigger correcto sobre
datos incorrectos sigue destruyendo datos.

## 24. Un total que ya venía sumado, sumado otra vez en el mensaje al cliente (2026-08-19)

**Síntoma:** al cablear las zonas de domicilio en el prompt del Agente Pedidos, el PASO 5 (el
mensaje de "¡Pedido registrado!") quedó como `💰 Total a pagar: $[total + costo_domicilio]`. Con
un pedido de $50.000 y envío de $8.000 el bot habría anunciado **$66.000**: $8.000 de más,
contradiciendo el resumen que él mismo mostró un turno antes y el total que ve el dashboard.

**Causa:** el mismo número se arma en dos sitios que parecen iguales y no lo son. En el **PASO 3**
el pedido todavía no existe en la BD, así que el agente suma a mano `Subtotal + costo_domicilio`.
En el **PASO 5** el número viene de `crear_orden_completa`, y ahí ya pasó por el trigger
`actualizar_total_pedido`, que hace `SUM(items) + costo_domicilio`. La sustitución mecánica
`5000 → costo_domicilio` es correcta en el PASO 3 e incorrecta en el PASO 5, donde el reemplazo
correcto era **quitar la suma entera**.

**Cómo se detectó:** releyendo el nodo por MCP y comparándolo contra la definición real del
trigger en Postgres (`pg_get_functiondef`), no contra lo que el doc decía que hacía.

**Lección:** cuando un valor cruza la frontera hacia la BD, deja de ser "lo que calculamos" y pasa
a ser "lo que la BD devuelve" — y los agregados calculados por trigger casi siempre vuelven **ya
compuestos**. Antes de escribir una fórmula sobre un valor que viene de una tool, leer qué
devuelve esa tool. Un buscar-y-reemplazar sobre un prompt es especialmente propenso a esto: acierta
en las N-1 apariciones donde el contexto es el mismo y falla justo en la que cambió de lado.

## 25. Un carrito vacío no es lo mismo que no tener carrito, y el agente sí nota la diferencia (2026-08-19)

**Síntoma:** en una prueba real por WhatsApp (CLI-039), el bot le pidió al cliente barrio, dirección
y método de pago, le anunció un total y le confirmó una pizza… que nunca existió. Cuatro mensajes
después se dio cuenta y respondió *"No tienes un pedido armado todavía"*.

**Causa, en dos capas:**

1. **El ruteo.** El Agente Menú preguntó *"¿confirmas que quieres 1x Vera Pizza familiar
   estofada?"* y el cliente respondió *"Si confirmo"*. El prompt del Orquestador listaba
   literalmente `"sí confirmo"` entre las frases que mandan a **pedidos**, así que la confirmación
   se desvió del agente que la había pedido. Nadie llamó `actualizar_carrito` y el producto nunca
   entró. Verificado en la ejecución 12706: `agente: "pedidos"`, razón *"cliente confirma
   explícitamente creación del pedido"*.
2. **La guarda que no guardó.** El Agente Menú ya había llamado `crear_carrito`, así que existía
   una fila en `carritos` con `items: []`. El PASO 1 decía *"si el carrito está vacío **o no
   existe**"*, pero para el modelo un carrito que **existe** no es lo mismo que uno vacío: siguió
   el flujo y sacó la pizza de la **memoria de conversación**, que es compartida por sesión. En dos
   de las cuatro ejecuciones ni siquiera llamó `leer_carrito1`.

**Solución:** el Orquestador clasifica las confirmaciones por **a qué pregunta responden**, no por
la frase; y el PASO 1 define el carrito vacío como dos casos explícitos (`no devuelve nada` **o**
`items: []`), obliga a releerlo en cada turno y prohíbe deducir productos de la conversación.

**Lección:** al escribir la guarda de un estado, enumera los estados **reales** que devuelve la
herramienta, no el concepto. "Vacío o no existe" suena exhaustivo y deja fuera justo el caso que se
da en producción: la fila creada pero sin contenido. Y ojo con la memoria compartida entre agentes:
si un agente puede *leer* lo que otro escribió en el chat, va a tratarlo como dato aunque su tool
diga lo contrario — hay que prohibírselo por escrito.

## 26. Un job de limpieza por `updated_at` no limpia nada si nadie refresca `updated_at` (2026-08-21)

**Síntoma:** al arreglar BUG-032 se iba a crear "un job que borre carritos sin actividad en 24h".
Resultó que ya existía: `limpiar_carritos_abandonados()` en pg_cron (`0 8 * * *`), corriendo a
diario y en `succeeded` desde hacía semanas. Y aun así los carritos abandonados seguían dejando
clientes en bucle.

**Causa:** la columna se veía bien —`updated_at timestamptz NOT NULL DEFAULT now()`— pero ese
`DEFAULT` **solo aplica al INSERT**. No había trigger de `touch`, y el `PATCH` de
`actualizar_carrito` manda `items` y `total`, no `updated_at`. O sea: el valor era la **fecha de
creación**, congelada de por vida. El `WHERE updated_at < now() - interval '24 hours'` se leía como
"sin actividad en 24h" y en realidad decía "creado hace más de 24h": borraba un carrito vivo en una
conversación larga y, al revés, uno abandonado hace 3 horas seguía bloqueando el teléfono hasta la
próxima corrida.

**Solución:** trigger `trg_carritos_touch_updated_at` BEFORE UPDATE (migración
`bug032_carritos_touch_updated_at`).

**Lección:** un `DEFAULT now()` **no** es una columna "última modificación" — es "fecha de
creación" con otro nombre. Antes de confiar en cualquier housekeeping que filtre por `updated_at`,
verifica que algo la escriba en el UPDATE: `pg_trigger` sobre la tabla, o la columna en el body de
quien escribe. Y ojo con el otro sesgo de este bug: **el job ya existía**. Antes de implementar un
punto del "fix propuesto", comprueba contra el sistema real si ya está — puede estar ahí y estar
roto, que es peor que no estar, porque nadie lo vuelve a mirar.
