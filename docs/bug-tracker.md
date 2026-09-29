# Bug Tracker — Bugs abiertos

> Solo bugs **por corregir** y verificaciones pendientes de fixes recientes.
>
> - Historial de lo resuelto → [`changelog.md`](changelog.md) (entrada condensada por tema;
>   el detalle completo de cada fix vive en el git history de este archivo).
> - Features y mejoras pendientes (no-bugs) → [`backlog.md`](backlog.md).
> - Lecciones reutilizables → [`edge-cases.md`](edge-cases.md).
>
> **Al resolver un bug:** quita su entrada de "Abiertos", registra una entrada condensada en el
> changelog (qué se hizo + cómo se verificó), y si dejó lección, resúmela en edge-cases.

## Convención

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-063**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

### BUG-061 · 🔴 Alta · 🟠 En progreso (n8n publicado 2026-09-28 · falta verificar por WhatsApp) — el bot promete domicilio y canta la tarifa cuando la tool dijo `cubierto: false`: se la inventa de la memoria de la conversación

- **Componente:** prompt del Agente Pedidos / Cobertura (n8n) · efecto colateral en `carritos.barrio`.
- **Encontrado en:** **G3, paso 3.5** (Capa B, 2026-09-22, `573113298122`). Ninguna batería de la
  Capa A podía verlo: la RPC hace exactamente lo que debe.
- **Síntoma, con la evidencia de los dos lados:**

  El cliente escribe `estoy en niqia` (typo). `consultar_cobertura('niqia')` devuelve:

  ```json
  { "cubierto": false, "costo_domicilio": null, "tiempo_estimado": null,
    "sugerencias": ["Niquía"], "coincidencia_exacta": false,
    "mensaje": "FUERA DE COBERTURA: no hay domicilio a \"niqia\". … No prometas domicilio ni des
                ninguna tarifa ni tiempo de entrega. Si hay sugerencias, pregunta si el cliente se
                refería a uno de esos barrios; si no, ofrece recoger en el punto." }
  ```

  Y el bot contestó:

  > *"Perfecto Juan, si estás en Niquía sí te podemos llevar domicilio ✅ El envío allá está en
  > $7.500 y suele tardar entre 30 y 45 minutos."*

  Es decir: **promete domicilio, da tarifa y da tiempo** — las tres cosas que el mensaje de la tool
  le prohíbe explícitamente— y **no pregunta** por la sugerencia, que es lo único que le pedía.
- **Causa:** los números no salieron de esa llamada (venían en `null`): salieron de la **memoria de
  la conversación**, del turno anterior en el que el cliente sí había escrito «Niquía» bien. El
  prompt no tiene una regla que ate la respuesta al `cubierto` de la **llamada actual**, así que un
  dato correcto de hace tres turnos pisa un `false` de ahora.
- **Por qué importa en dinero, no solo en redacción:** el carrito quedó con
  `barrio = 'niqia'` (el texto crudo del cliente, no el nombre canónico) y
  `cobertura_ok = null`, `costo_domicilio = null`. **`resolver_barrio('niqia')` no devuelve nada** —
  verificado—, así que si ese carrito se convierte en pedido, el trigger `aplicar_tarifa_domicilio`
  cae a su rama `ELSE` y aplica `tarifa_base()` = **$5.000 en vez de los $7.500 de Niquía**, con
  `zona` en NULL. El restaurante pierde $2.500 por pedido y nada lo señala.
- **Ojo con la asimetría que lo hace invisible:** `consultar_cobertura` tiene emparejamiento
  difuso y devuelve `sugerencias`, pero `resolver_barrio` (la que usa el trigger) solo resuelve el
  nombre canónico. Las dos normalizan distinto. La batería `01 · T2` prueba 295 variantes contra
  `consultar_cobertura` y sale verde — **ninguna las prueba contra `resolver_barrio`**.
- **Fix aplicado (2026-09-28, n8n `8LI3J7PLi35zf4EJ`, versión `8c21cac4…`, publicado):**
  Solo capa de **prompt** — ver la re-verificación de la capa "Dato" abajo, no hacía falta tocarla.
  1. `AGENTE PEDIDOS` (`options.systemMessage`): la sección **"Cambios de opinión"** ahora dice
     explícitamente que un cambio de BARRIO invalida la tarifa sin excepción, obliga a releer
     `faltantes` (`'cobertura'` vuelve a aparecer) y a **volver a llamar `consultar_cobertura` en
     el mismo turno** antes de responder nada de envío — nunca citar el costo/tiempo de un mensaje
     anterior de la misma conversación, aunque el barrio suene parecido. Se agregó también un bullet
     gemelo en `PROHIBIDO ASUMIR DATOS`. La sección `'cobertura' →` (que ya decía correctamente
     "pregunta '¿te refieres a…?' y solo si confirma, guarda ESE barrio") no se tocó: el hueco no
     era esa lógica, era que un barrio corregido a mitad de flujo nunca llegaba a ejecutarla porque
     el agente respondía de memoria antes de volver a leer `faltantes`.
  2. Nodos `consultar_cobertura` y `consultar_cobertura1` (`toolDescription`): mismo refuerzo —
     "si el cliente cambia de barrio o lo corrige, vuelve a llamar esta herramienta, nunca
     reutilices el resultado de una llamada anterior, ni para el mismo barrio".
  3. **`AGENTE SOPORTE`** (`options.systemMessage`, versión `a5fea00b…`, publicado por separado):
     tiene su **propia** sección `consultar_cobertura` (para "¿a dónde llevan?" sin pedido activo) y
     tenía el mismo hueco. G3 son preguntas sueltas de cobertura sin carrito armado — lo más probable
     es que el orquestador las mande a **este** agente, no a AGENTE PEDIDOS, así que sin este tercer
     cambio el fix de los puntos 1-2 no se habría ejercitado en la prueba real. Mismo refuerzo:
     "vuelve a llamar la herramienta, nunca repitas de memoria, ni para el mismo barrio".
- **Re-verificación de la capa "Dato" (2026-09-28):** la sospecha original — que `resolver_barrio`
  debería tener el mismo emparejamiento difuso que `consultar_cobertura` — **no aplica**:
  `resolver_barrio('niqia')` no devuelve nada porque su umbral (`similarity ≥ 0.45`) es **a propósito**
  más estricto que el de las *sugerencias* de `consultar_cobertura` (`≥ 0.40` + una segunda pasada de
  transposición/deleción) — "niqia" da 0.444, justo por debajo. Es el guardián de que el trigger
  `aplicar_tarifa_domicilio` nunca cobre una zona por una corazonada: si el LLM guarda un barrio sin
  confirmar, cae a `tarifa_base()`, no a una zona equivocada. Bajar ese umbral para que alcance a
  "niqia" reabriría exactamente el riesgo que `resolver_barrio` existe para evitar, y no está probado
  contra las 295 variantes de la batería. La capa de datos correcta ya existía en el prompt (guardar
  el barrio **canónico** de la sugerencia confirmada, no el texto crudo) — el fix de arriba es lo que
  hacía falta para que esa ruta se ejecute siempre que cambie el barrio.
- **Primer retest, 🔴 rojo (2026-09-28 18:57, `573113298122`, Juan por WhatsApp real):**
  ```
  Juan: ¿llegan a Niquía?
  Bot:  ¡Hola Juan! Sí, sí llegamos a Niquía 🙌 El domicilio a Niquía tiene un costo
        de $7.500 y el tiempo estimado de entrega es de 30 a 45 minutos.
  Juan: estoy en niqia
  Bot:  Perfecto, Juan 😊 Sí cubrimos Niquía sin problema.
        Si quieres, dime qué se te antoja (pizza, patatas, bebidas, postres) y te
        ayudo a armar el pedido y dejarlo listico en el carrito 🍕
  ```
  **Mejoró** (no repitió "$7.500" ni "30-45 min" — el refuerzo de AGENTE PEDIDOS/SOPORTE sí surtió
  efecto ahí), pero **sigue afirmando cobertura sin verificarla** ("sí cubrimos… sin problema") y
  la frase "dime qué se te antoja (pizza, patatas, bebidas, postres)" es literal de **AGENTE MENÚ**
  (la misma que documenta BUG-062). Diagnóstico: `estoy en niqia` se enrutó a **menú**, no a
  soporte ni a pedidos — un agente que **no tiene** `consultar_cobertura` y que improvisó una
  confirmación de cobertura por su cuenta. Causa raíz: "estoy en niqia" es una **frase corta**, no
  una palabra suelta, así que no calzaba en la excepción que el fix de BUG-062 le puso a la Regla 3
  del orquestador — y la Regla 1 ("no hay carrito → menu") ganaba primero.
- **Segundo fix (2026-09-28/29, n8n, versión `67272ec5…`, publicado):**
  1. `ORQUESTADOR` — **Regla de seguridad #1** (antes solo tenía la excepción en la Regla 3): ahora
     dice explícitamente que un barrio/lugar suelto o dentro de una frase corta, sin carrito armado,
     NO es "menu" — es "soporte", aunque la Regla 1 general diga "no hay carrito → menu".
  2. `AGENTE MENÚ` — refuerzo defensivo por si el ruteo falla otra vez: se agregó a su lista
     `PROHIBIDO` "confirmar, negar o cotizar si hay domicilio a un barrio — no tienes esa
     herramienta", con la respuesta de respaldo "¡Claro! ¿Qué te gustaría pedir?".
- **Segundo retest, 🔴 rojo otra vez (2026-09-28 19:09, `573113298122`, misma secuencia):**
  ```
  Juan: ¿llegan a Niquía?
  Bot:  Hola Juan 🙌 Sí, sí llegamos a Niquía 🏍️ El domicilio tiene un costo de $7.500
        y el tiempo estimado de entrega es de 30 a 45 minutos.
  Juan: estoy en niqia
  Bot:  Perfecto, a Niquía sí llegamos sin problema 😊
        Cuéntame qué se te antoja de Vera y te ayudo a armar el pedido 🍕🥤
  ```
  **Diagnóstico con la ejecución real (n8n, id `17030`), no solo con el texto del bot:** el propio
  `ORQUESTADOR` devolvió `{"agente":"menu","razon":"respuesta corta sin carrito se asume para
  menú","senales":{"barrio":"niqia"}}` — la `razon` es casi literal la regla **vieja** que ya se
  había reemplazado dos veces. **El LLM clasificador no respeta de forma confiable una excepción de
  texto** enterrada entre docenas de reglas, aunque sí extrae bien `senales.barrio` de forma
  consistente. `AGENTE MENÚ` (que recibió el mensaje) hizo **0 llamadas a herramientas**
  (`tool_calls.requested: 0`) — "sí llegamos sin problema" es 100% improvisado, no viene de
  `consultar_cobertura`.
- **Tercer fix, definitivo (2026-09-29, n8n, versión `7bd2f302…`, publicado):** se abandona el
  enfoque de prompt para este caso — **override determinista en código**, en el nodo
  `Parse Orquestador` (el mismo que ya sanea `agente` contra una lista blanca): si
  `senales.barrio` viene poblado (eso sí es confiable) y no hay carrito armado, se fuerza
  `agente = 'soporte'` **en JavaScript**, sin importar lo que haya decidido el LLM. No depende de
  que el modelo "se acuerde" de una regla de texto.
- **Verificación pendiente (expectativa actualizada tras la decisión de UX):** repetir **G3.5
  completo** (`¿llegan a Niquía?` → `estoy en niqia`, número `573113298122`, reset ya hecho) y
  confirmar que responde algo como *"¡A Niquía sí llegamos! El domicilio cuesta $7.500 y tarda
  30-45 min"* — directo, sin preguntar "¿te refieres a…?", pero **verificado**: debe venir de una
  llamada real a `consultar_cobertura('Niquía')` en ese turno (revisar la ejecución en n8n, no solo
  el texto), no de lo que se dijo 2 mensajes atrás. Rojo si vuelve a decir "sin problema" sin tarifa,
  o si el mensaje se enruta a `menu` otra vez. Solo entonces pasa a cerrado.
- **Decisión de negocio de Juan (2026-09-29):** preguntar "¿te refieres a Niquía?" para un typo
  obvio es fricción innecesaria — confirmó la propuesta de responder directo cuando hay una sola
  sugerencia clara, siempre que sea con dato verificado (no de memoria).
- **Cuarto cambio, UX (2026-09-29, n8n, versión `1d7f7d87…`, publicado):** en `AGENTE PEDIDOS`,
  `AGENTE SOPORTE` y las dos tools `consultar_cobertura`/`consultar_cobertura1`: cuando
  `sugerencias` trae **exactamente una**, ya no se pregunta — se vuelve a llamar
  `consultar_cobertura` con esa sugerencia (nombre canónico) y se responde directo con el
  `costo_domicilio`/`tiempo_estimado` reales de esa nueva llamada. Con **0 o 2+** sugerencias
  sigue preguntando (ahí sí hay ambigüedad real entre lugares distintos). Sigue siendo dato
  verificado en el turno, nunca de memoria — solo cambia si se pregunta o no antes de responder.

---

### BUG-062 · 🟡 Media · 🟠 En progreso (n8n publicado 2026-09-28 · falta verificar por WhatsApp) — un nombre de barrio suelto se rutea al agente de Menú y el cliente recibe la carta

- **Componente:** orquestador (n8n) → ruteo de intención.
- **Encontrado en:** **G3, paso 3.6** (Capa B, 2026-09-22).
- **Síntoma:** el cliente escribe `pardo` (una sola palabra, un barrio mal escrito) y el bot
  responde con el **PDF del menú completo** y *"dime qué se te antoja (pizza, pastas, patatas,
  bebidas, postres)"*. No consultó cobertura.
- **Lo que debería haber pasado:** `consultar_cobertura('pardo')` devuelve hoy
  `sugerencias: ["Prado"]` — verificado. O sea que **la tool ya sabe responder** y el cliente debía
  haber recibido *"¿te refieres a Prado?"*.
- **Nota sobre el guion:** G3.6 estaba escrito para confirmar el síntoma de BUG-040 (*"hoy responde
  «solo repartimos en Bello» sin sugerir Prado"*). Esa expectativa está **obsoleta**: BUG-040 se
  cerró y la sugerencia existe. Lo que falla ahora es anterior, es el ruteo: la pregunta no llega
  al agente que sabe contestarla. El guion ya está actualizado con la expectativa nueva.
- **Fix aplicado (2026-09-28, n8n `8LI3J7PLi35zf4EJ`, versión `2576a6b7…`, publicado):** se eligió
  la primera opción, no la del agente de Menú — AGENTE MENÚ no tiene conectada la tool de cobertura
  (solo la tienen AGENTE PEDIDOS y AGENTE SOPORTE, ver `consultar_cobertura`/`consultar_cobertura1`
  en el grafo del workflow), así que hacerlo ahí habría exigido cablear una tool nueva. En vez de
  eso, `ORQUESTADOR` → `options.systemMessage` → **Reglas de seguridad #3**: cuando no hay carrito
  ni reserva en curso y el mensaje de una sola palabra **parece nombre de barrio/lugar** (y no es
  talla, sabor, ingrediente ni una confirmación tipo "sí"/"no"/"dale"), rutea a **"soporte"** — que
  ya tiene `consultar_cobertura1` — en vez de caer al default "menu". No se tocó nada de AGENTE MENÚ
  ni de las tools.
- **Riesgo aceptado:** depende de que el LLM del orquestador reconozca "parece un nombre de lugar"
  sin ver la lista real de 59 barrios (no se le dio esa lista para no inflar el prompt en cada
  turno). Si en la verificación por WhatsApp confunde un barrio real con un ingrediente o viceversa,
  la vía más robusta sí sería la del agente de Menú con la tool cableada — queda anotado como
  alternativa si este fix no basta.
- **Verificación pendiente:** repetir **G3.6** (`pardo` suelto, sin carrito ni reserva activa) y
  **G10.6** (regresión de ruteo) y confirmar que llega *"¿te refieres a Prado?"* del agente de
  soporte, no el PDF del menú. Solo entonces pasa a cerrado.

---


### BUG-057 · 🔴 Alta · 🟠 En progreso (BD + n8n **publicados** · falta verificar por WhatsApp) — el cliente responde la calificación y el bot **no contesta nada**: `Guardar calificación` choca con 409 y mata el subworkflow (y deja al cliente atrapado para siempre)

- **Componente:** n8n `Sub — Feedback Pendiente` (`xGsKJf2u3bFmL6mA`) → `Guardar calificación`
  (INSERT a `feedback`).
- **Síntoma reportado y reproducido (2026-09-15, `573113298122` / `CLI-038`):** el job pregunta a
  las 18:30 (hora CO); el cliente responde `5` a las 18:57 y otra vez a las 18:59. **Silencio
  absoluto las dos veces.** En la BD queda en `modo = 'esperando_feedback'`.
- **Causa (verificada vía MCP — ejecuciones `15687`/`15688` y `15689`/`15690`, ambas `error`):**
  `Guardar calificación` es un INSERT plano y `feedback_id` se construye como `FB-{{ pedido_id }}`,
  o sea **PK determinista por pedido**. Para `PED-246` ya existía `FB-PED-246` (lo insertó la
  ejecución `15674` una hora antes). Resultado:
  `409 - {"code":"23505", "details":"Key (feedback_id)=(FB-PED-246) already exists."}`.
  El nodo no tiene `onError`, así que **el subworkflow muere ahí** y arrastra al workflow padre —
  no hay WhatsApp de salida, no se limpia `feedback_pendiente`, no se restaura `modo`.
- **Lo grave no es el 409, es el estado que deja:** el cliente queda en `esperando_feedback` con
  fila viva en `feedback_pendiente`. El `Router de modo` manda **todos** sus mensajes siguientes al
  subworkflow → los que parezcan nota 1–5 vuelven a chocar con el mismo 409. **El cliente queda
  fuera del bot de forma permanente**, sin ningún job que lo rescate (BUG-050 dejó pendiente el job
  de expiración de la cola).
- **Cómo llegó a haber dos solicitudes para el mismo pedido:** cadena BUG-058 + BUG-059 + el upsert
  de `feedback_pendiente`. Ver esas dos entradas.
- **Diagnóstico de fondo:** BUG-057, 058 y 059 no son tres bugs sueltos, son tres variantes del
  mismo fallo de diseño — **la máquina de estados vivía repartida en ~20 nodos de n8n sin
  transacción**, y cada paso podía fallar en silencio (un filtro PostgREST que no matchea responde
  204, n8n lo da por éxito). Parchear los tres nodos lo arreglaba hoy y dejaba intacta la clase de
  bug. Por eso el fix no es de nodos, es de capa.
- **Fix — capa BD ✅ aplicada y probada (2026-09-16):**
  1. `procesar_respuesta_feedback(p_telefono, p_mensaje) → jsonb` — puerta única para todo mensaje
     de un cliente en `esperando_feedback`. Lee la cola con `FOR UPDATE`, parsea la nota (regla
     estricta de BUG-051, ahora en SQL), hace **UPSERT** en `feedback`, cierra o pide comentario,
     restaura el modo — **en una transacción** — y devuelve `{accion}` ∈ `positiva` ·
     `pedir_comentario` · `agradecer` · `nota_invalida` · `sin_pendiente`.
  2. `solicitar_feedback_lote(p_limite) → table` — elige pedidos elegibles y, en la misma
     transacción, marca `feedback_solicitado`, encola y cambia el modo. Guarda nueva: **no toma un
     pedido que ya tenga `feedback`** aunque el flag mienta. `FOR UPDATE SKIP LOCKED` contra ticks
     solapados.
  3. `expirar_feedback_pendiente()`: umbral **48 h → 6 h**, cron **diario → horario** (`7 * * * *`).
     Con 48 h y un job diario un cliente atrapado podía pasar ~3 días sin bot.
  4. Las dos funciones nuevas: `SECURITY DEFINER`, `EXECUTE` revocado a `public/anon/authenticated`,
     solo `service_role`.
  - **Probado:** `qa/sql/10-resenas.sql` T10–T15, verde entero (T11 = este 409 exacto, ya no revienta).
- **Fix — capa n8n ✅ publicada (2026-09-16):**
  - `Sub — Feedback Pendiente` → `activeVersionId 05b3415f…`: de 20 nodos a 7 —
    `trigger → Procesar respuesta (RPC) → ¿Qué contestar? (Switch sobre accion) → 4 WhatsApp`. El
    fallback del Switch (`sin_pendiente`) queda sin conectar a propósito, con nota en el nodo.
  - `Pizzeria Vera` → `activeVersionId 1f351a3b…`: `Buscar pedidos…` pasa a
    `Solicitar lote de feedback (RPC)` (`p_limite 20`); quitados `feedback_pendiente`,
    `Marcar pedido como solicitado` y `Activar modo esperando_feedback`; el Code solo redacta.
  - Antes de publicar se verificó que el borrador de ambos workflows era idéntico a la versión activa
    (no se arrastró ningún cambio ajeno).
- **Falta:** verificación por WhatsApp (G11) — ver el guion **G11** en `qa/guiones-bot.md`.
- **Limpieza manual ✅ hecha (2026-09-16):** borrada la fila de `573113298122` en
  `feedback_pendiente`, `CLI-038` devuelto a `modo = 'bot'`, y `feedback_solicitado = true` en todo
  pedido que ya tenía `feedback`.

### BUG-058 · 🔴 Alta · 🟠 En progreso (BD + n8n **publicados** · falta verificar por WhatsApp, ver BUG-057) — `feedback_solicitado` nunca se marca: el PATCH apunta a `pedido_id=eq.undefined` y el job vuelve a pedir feedback del mismo pedido cada 15 min

- **Componente:** n8n `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`) → rama `trigger_feedback` → nodo
  `Marcar pedido como solicitado` (HTTP PATCH a `/rest/v1/pedidos`).
- **Síntoma (verificado vía MCP el 2026-09-16):** `PED-246` se entregó el 2026-09-15 21:06 UTC, el
  job le pidió feedback al menos dos veces (22:15 y 23:30 UTC, ejecuciones con envío de WhatsApp
  confirmado) y **hoy sigue con `feedback_solicitado = false`**.
- **Causa:** el fix de BUG-050 reordenó la cadena a
  `Code — Preparar payload → feedback_pendiente → Enviar WhatsApp → Marcar pedido → Activar modo`,
  pero **el nodo `Marcar pedido` se quedó leyendo `={{ $json.pedido_id }}`**. Tras el reorden su
  `$json` es la respuesta de la API de WhatsApp (`messaging_product`, `contacts`, `messages`), que
  no tiene `pedido_id`. La query sale como `pedido_id=eq.undefined` → PostgREST hace match de 0
  filas, responde **204 vacío**, y n8n lo da por exitoso. En la ejecución `15679` el nodo aparece
  `success` con output `{}`.
- Sus hermanos sí se migraron a `$('Code — Preparar payload').item.json.…` (`Activar modo`,
  `Enviar WhatsApp`, `feedback_pendiente`). **Este quedó solo.** Por eso `modo` sí cambia y
  `feedback_solicitado` no.
- **Efecto compuesto:** la idempotencia documentada (`feedback_solicitado = true` evita repreguntar)
  **no existe**. Lo único que frena la repregunta es el filtro `modo === 'bot'` del Code node: en
  cuanto algo devuelve el cliente a `bot`, el siguiente tick del cron (15 min) le vuelve a pedir
  feedback del mismo pedido mientras siga dentro de la ventana 1–6 h. Es lo que produjo el segundo
  ciclo de `PED-246` y, con él, el 409 de BUG-057.
- **Fix propuesto:** `pedido_id` → `={{ $('Code — Preparar payload').item.json.pedido_id }}`. Y
  como cinturón, `Prefer: return=representation` en ese PATCH para que un match de 0 filas sea
  visible (hoy un no-op es indistinguible de un éxito).

### BUG-059 · 🟡 Media · 🟠 En progreso (BD + n8n **publicados** · falta verificar por WhatsApp, ver BUG-057) — Fase B: `Eliminar feedback pendiente1` filtra por un `telefono` que no existe en la fila de `feedback` → no borra nada y deja la cola huérfana

- **Componente:** n8n `Sub — Feedback Pendiente` (`xGsKJf2u3bFmL6mA`) → `Eliminar feedback
  pendiente1` (rama del comentario, Fase B).
- **Causa (verificada vía MCP, ejecución `15677`):** el nodo filtra por `={{ $json.telefono }}`, y
  cuando viene de `Guardar comentario` su `$json` es la fila de `feedback`
  (`feedback_id, cliente_id, pedido_id, fecha, comentario, …`) — **`telefono` no es columna de
  `feedback`**. El DELETE sale con `telefono=eq.undefined`, borra 0 filas y devuelve `{}`; como
  tiene `alwaysOutputData: true`, la cadena sigue y nadie se entera.
- Es exactamente el "segundo defecto latente" de BUG-056, pero en el nodo gemelo: el fix se aplicó
  a la rama positiva (`Eliminar feedback pendiente`) y **no** a este.
- **Consecuencia medida:** en `15677` `Restaurar modo bot1` sí funcionó (usa `cliente_id` del
  trigger), así que el cliente volvió a `modo = 'bot'` **con la fila de `feedback_pendiente` viva**.
  Ese desfase es lo que dejó el terreno listo para BUG-058 → BUG-057.
- **Nota:** por la rama `saltar` (`¿Hay comentario?1` = false) el nodo **sí** funciona, porque su
  entrada es `Procesar comentario`, que sí trae `telefono`. Falla solo cuando hay comentario.
- **Fix propuesto:** `telefono` → `={{ $('When Executed by Another Workflow').first().json.telefono }}`,
  igual que el de la rama positiva.

### BUG-060 · 🟢 Baja · 🟠 En progreso (BD + n8n **publicados** · falta verificar por WhatsApp, ver BUG-057) — `feedback.fecha` se guarda 2 horas en el futuro: `$now.toISO()` usa el huso de la instancia n8n (UTC+2) sobre una columna `timestamp` que el resto del sistema lee como UTC

- **Componente:** n8n `Sub — Feedback Pendiente` → `Guardar calificación`, campo `fecha` =
  `={{ $now.toISO() }}`.
- **Evidencia (MCP, 2026-09-16):** la ejecución `15674` corrió a las **23:22:35.677 UTC** y la fila
  `FB-PED-246` quedó con `fecha = 2026-09-16 01:22:35.841`. Mismos milisegundos, **+2 h exactas**.
- **Causa:** `feedback.fecha` es `timestamp without time zone` y la convención del proyecto es que
  guarda **UTC** (ver CLAUDE.md y `parseDb()` en `src/utils/dateRanges.js`). `$now.toISO()` de n8n
  resuelve en el huso de la instancia (UTC+2), y PostgREST descarta el offset al escribir en una
  columna sin zona. El dashboard lo reinterpreta como UTC → toda calificación nueva aparece 2 h
  adelantada (y 7 h respecto a la hora de Colombia).
- **Fix propuesto:** `={{ $now.toUTC().toISO() }}` (o dejar que la BD ponga el default). Revisar de
  paso si otros nodos del mismo workflow escriben fechas con `$now.toISO()`.

### BUG-056 · 🔴 Alta · 🟠 En progreso (**publicado**, falta verificar por WhatsApp: hoy lo tapa BUG-057) — toda nota válida cae en la ruta NEGATIVA: el cliente califica 5 y el bot responde *"Lamento que no fuera lo esperado"*

- **Componente:** n8n `Sub — Feedback Pendiente` (`xGsKJf2u3bFmL6mA`) → switch `¿Nota > 3?`
  (y, detrás de él, toda la rama positiva).
- **Síntoma medido (2026-09-15, `573113298122`, ejecución `15674`):** el cliente responde `5`; el bot
  contesta *"Lamento que no fuera lo esperado 🙏 ¿Nos cuentas qué pasó?"* y lo deja en
  `esperando_comentario`. Su siguiente mensaje (`Dije 5`) se guarda como **comentario de queja** en
  `feedback.comentario`. Nunca recibe la invitación a reseñar en Google.
- **Causa (verificada vía MCP, datos de la ejecución `15674`):** `Parsear calificación` emite
  `{ tipo: 'valido', nota: 5, es_positiva: true, … }` — correcto, el fix de BUG-051 funciona. Pero
  entre el parser y el switch está `Guardar calificación` (INSERT a Supabase), y el switch evalúa
  `={{ $json.es_positiva }}`: su `$json` **ya no es el del parser**, es la fila insertada
  (`feedback_id, cliente_id, pedido_id, fecha, calificacion_general, comentario, resuelta_at`).
  `es_positiva` ahí es `undefined` → la salida 0 (`is true`) no matchea, la salida 1 (`is false`)
  sí → **ruta negativa para 1, 2, 3, 4 y 5 por igual**. No hay nota que salga por la positiva.
- **Segundo defecto, latente detrás del primero:** la rama positiva tampoco habría funcionado.
  `Eliminar feedback pendiente` filtra por `={{ $json.telefono }}` y `Restaurar modo bot` por
  `={{ $json.cliente_id }}` sobre esa misma fila de `feedback` — y `telefono` **no es columna de
  `feedback`**. El delete no borraría nada, no emitiría item, y la cadena se cortaría ahí: cliente
  atrapado en `modo = 'esperando_feedback'` y sin invitación a Google.
- **Fix publicado el 2026-09-15 23:41** — verificado vía MCP el 2026-09-16: `versionId` =
  `activeVersionId` = `3f00d92d-4dcc-43e5-bb43-549ff2a8b44f`, y los 4 nodos traen las expresiones
  nuevas. **Falta la verificación por WhatsApp**: desde que se publicó, ninguna ejecución llega al
  switch, porque `Guardar calificación` revienta antes con 409 (→ **BUG-057**). Los 4 cambios:
  1. `¿Nota > 3?`, ambas reglas: `leftValue` → `={{ $('Parsear calificación').item.json.es_positiva }}`
     (el `pairedItem` sobrevive al nodo Supabase; está en la data de `15674`).
  2. `Eliminar feedback pendiente`: `telefono` → `={{ $('When Executed by Another Workflow').first().json.telefono }}`
     + `alwaysOutputData: true` para que la cadena no se corte nunca.
  3. `Restaurar modo bot`: `cliente_id` → `={{ $('When Executed by Another Workflow').first().json.cliente_id }}`.
  4. `Invitar reseña Google`: `.item` → `.first()` (con `alwaysOutputData` arriba, el item sintético
     puede no traer `pairedItem`).
- **Lección:** en n8n, `$json` es la salida del nodo **inmediatamente anterior**. Un campo calculado
  en un Code node no sobrevive a un nodo Supabase/HTTP intermedio: hay que referenciarlo con
  `$('Nodo').item.json`. El daño es silencioso — el switch no falla, solo enruta mal.
- **Estado de la BD tras la prueba:** `FB-PED-246` = nota 5 con comentario `"Dije 5"`; `CLI-038`
  sigue en `modo = 'esperando_feedback'` con fila en `feedback_pendiente` (`estado = 'esperando_nota'`).
- **Ojo:** el "segundo defecto, latente" se arregló **solo en la rama positiva**. El nodo gemelo de
  la Fase B (`Eliminar feedback pendiente1`) quedó con el mismo patrón roto → **BUG-059**.

### BUG-049 · 🟢 Baja · 🟠 En progreso (**BD cerrada 2026-09-22** · falta la capa n8n) — `reservas` aceptaba fechas pasadas y horas con el local cerrado

- **Componente:** BD → tabla `reservas` · subworkflow n8n `OTQp2O8QDw1mMKOZ` (*Sub — consultar_disponibilidad*).
- **Síntoma (medido con `qa/sql/09-basura.sql · T9`, 2026-09-12):** se aceptaban sin rechistar una
  reserva con `fecha = 2020-01-01`, otra a las **04:00** y otra a las **23:59**.
- **Causa:** la única validación de horario vivía en el subworkflow de n8n, o sea **sólo protegía el
  camino del bot**. El modal del dashboard hace `insert into reservas` directo y no pasa por ahí —
  su `type="time"` es libre, sin `min`/`max`, así que un admin podía escribir cualquier hora.

**✅ Hecho el 2026-09-22 — la mitad de BD, verificada.** Trigger `validar_ventana_reserva`
(BEFORE INSERT OR UPDATE) que rechaza fecha+hora ya pasadas, hora < 12:00 y hora > 20:30 (L-V) /
21:30 (S-D), ambos límites **inclusive**. Regresión en `qa/sql/06-reservas.sql · T11–T18`, y `06`
sigue en 14/14.

**⬜ Lo que falta, y por qué no se hizo:**

1. **El subworkflow `OTQp2O8QDw1mMKOZ`**, nodo `Validar parámetros`, sigue con
   `HORA_INICIO='12:00'` y `HORA_LIMITE='21:00'`: una sola ventana para los siete días, sin
   distinguir el finde, y **validando solo la hora de inicio** — hoy acepta las 21:00, que con el
   bloque de 90 min termina a las 22:30, ya cerrado. Ese subworkflow **solo consulta
   disponibilidad, no crea la reserva**, así que no puede meter un dato malo (la BD lo ataja
   desde hoy); el daño es que el bot ofrezca una hora que luego se rechaza.
   > ⚠️ El MCP de n8n **no edita un parámetro suelto: reescribe el workflow entero desde código
   > SDK**, incluido el nodo de Supabase con su credencial. Reemplazar un subworkflow de
   > producción para cambiar dos constantes merece hacerse con alguien delante.
2. **Armonizar los textos.** n8n devuelve seis mensajes literales propios (entre ellos *"El horario
   de reservas es de 12:00 PM a 9:00 PM"*) y ahora la BD rechaza con los suyos. Si no coinciden, el
   cliente recibe un texto u otro según por dónde caiga la petición.
3. **`min`/`max` en el `type="time"` del modal**, derivados del día elegido, con el helper debajo
   del campo (design system). Es lo que cierra el otro lado de BUG-044.

---

### BUG-034 · 🟢 Baja · 🔴 Abierto — 5 nodos `OpenAI Chat Model` con un parámetro fuera de esquema

- **Componente:** n8n → `Pizzeria Vera`, nodos `OpenAI Chat Model` … `OpenAI Chat Model4`
- **Síntoma:** cada escritura por `n8n-native` devuelve la misma advertencia para los cinco:
  `Field "parameters.builtInTools": This field is only allowed when: /responsesApiEnabled=true`.
- **Detectado:** 2026-08-25, aplicando BUG-033. Son advertencias de validación, **no** errores:
  la escritura se guarda igual y el bot funciona. Preexistente — no lo introdujeron esos cambios.
- **Causa probable:** los nodos conservan `builtInTools` de cuando se probó la Responses API;
  con `responsesApiEnabled` en false el campo queda huérfano y el validador lo marca.
- **Riesgo:** hoy ninguno visible. Importa si una versión futura de n8n endurece la validación y
  pasa de advertencia a error, o si alguien enciende `responsesApiEnabled` sin mirar qué tools
  quedaron ahí dentro.
- **Fix propuesto:** abrir uno de los cinco nodos, confirmar que `builtInTools` está vacío o es
  irrelevante, y quitarlo con `update_workflow` (`setNodeParameter`). Verificar que la
  advertencia desaparece en la siguiente escritura.

---

### BUG-031 · 🟡 Media · 🔴 Abierto — 8 pedidos con total escrito a mano y cero líneas de detalle

- **Componente:** BD → `pedidos` / `detalle_pedidos`
- **Síntoma:** 8 pedidos tienen `total` > 0 y **ninguna fila** en `detalle_pedidos`:
  `PED-096` ($216.200), `PED-097` ($3.365.000), `PED-098` ($29.000), `PED-099` ($332.300),
  `PED-100` ($115.400), `PED-109` ($77.000), `PED-111` ($115.500), `PED-113` ($33.300).
  Seis están `entregado`, dos `cancelado`. Fechas entre 2026-05-17 y 2026-07-01.
- **Causa:** sin confirmar. Encajan con datos sembrados a mano o pruebas tempranas; el de
  $3.365.000 es claramente ficticio. No los pudo producir el flujo normal, que inserta las líneas
  y deja que el trigger calcule el total.
- **Impacto:** ensucian las estadísticas de ingresos (`historial_resumen` suma `total` de los no
  cancelados, así que los ~$3.7M entran en el reporte) y el detalle del pedido se ve vacío en el
  dashboard. **No bloquean nada:** el trigger de tarifa por barrio se diseñó por delta justamente
  para no aplanarlos (ver edge-cases §23).
- **Fix propuesto:** decidir con el negocio si se borran o se marcan. **No tocarlos sin
  confirmar** — dos de ellos son del mismo rango de fechas que los datos de prueba de roles que ya
  se acordó dejar vivos.

---

### BUG-029 · 🟢 Baja · 🔴 Abierto — el bot no puede guardar notas en una reserva

- **Componente:** bot → n8n `Sub — Crear Reserva`, nodo `Validar y verificar cupo`; nodo
  `crear_reserva` del workflow principal
- **Síntoma:** el Code node arma la fila con `notas: input.notas || null`, pero **`notas` nunca se
  declaró** como input del `executeWorkflowTrigger` y el nodo `crear_reserva` del main tampoco lo
  manda vía `$fromAI`. Resultado: `reservas.notas` entra **siempre `null`** en las reservas creadas
  por WhatsApp. Si el cliente dice "mesa cerca de la ventana", se pierde.
- **Verificado vía MCP (2026-08-10):** los `workflowInputs` del sub son `telefono`, `nombre`,
  `fecha`, `hora`, `personas`, `cliente_id` y `motivo` — no hay `notas`. El campo del INSERT existe
  y apunta al Code node, así que el cableado se corta un paso antes.
- **Contraste:** las reservas creadas desde el **dashboard** sí guardan notas (`ReservationModal`
  tiene el campo y `useReservations` lo inserta). Solo falla el camino del bot.
- **Fix propuesto:** declarar `notas` como input del sub, agregar
  `notas: {{ $fromAI('notas', '...') }}` al nodo `crear_reserva` del main y una línea en el prompt
  del Agente Reservas para que capture peticiones especiales. No se hizo junto con `motivo`
  (2026-08-10) porque amplía la firma de la tool y el flujo conversacional: es una feature aparte,
  no parte de los motivos.

---

## En observación

Fixes ya aplicados y verificados en estructura (MCP, baterías), cuya confirmación final es una
conversación real. **Una línea por bug y el guion que lo cierra** — los pasos, los mensajes exactos
y el SQL viven en [`../qa/guiones-bot.md`](../qa/guiones-bot.md), no aquí.

| Bug | Qué está aplicado | Lo cierra | Estado |
|---|---|---|---|
| **BUG-032** carrito idempotente | upsert en `crear_carrito`, regla del Agente Menú, trigger `trg_carritos_touch_updated_at` | **G2** | ✅ **verde 2026-09-22**, repetido en verde el 23-09 con otros productos |
| **BUG-033** cobertura fuera de Bello | `consultar_cobertura` + prompts; `01-cobertura.sql` verde | **G3** | ✅ en lo suyo (3.1-3.4, 3.7). Lo que salió rojo son bugs **nuevos**: BUG-061 y BUG-062 |
| **BUG-039** búsqueda de menú | `buscar_menu` puntúa por cobertura de la búsqueda; `02-menu.sql` verde | **G1** | 🟡 **1.1–1.6 verdes el 2026-09-23**. Falta **G1.7** (`quiero una pizza`), que es donde la banda de confianza del prompt decide |
| **BUG-038** número de pedido | `Sub — Crear_orden_completa` publicado (`05099286…`), `Respuesta de salida` devuelve `pedido_id` | **G4** | ⬜ si el agente sigue sin darlo, el problema pasa a ser el prompt, no la tool |
| **BUG-050 · 051 · 027** flujo de reseñas | rehecho contra la BD el 16-09 (RPC `procesar_respuesta_feedback`), n8n republicado | **G11** | ⬜ ver también BUG-056…060, que están arriba |
| **BUG-053** buffer de mensajes | cron `limpiar-mensajes-pendientes` (5 min) + `retryOnFail` ×3 en los 4 nodos del buffer | — | ⬜ no hay forma de provocar un 504: vigilar que no reaparezcan errores en `Obtener ultimo mensaje` ni se acumulen filas |
| **BUG-005 · 009** cancelar reserva ajena | subworkflows saneados | **G9.7** | ⛔ G9 bloqueado (precios de `motivos_reserva`) |
| **BUG-023 · 024 · 025** dashboard | `realtime.setAuth`, políticas `public` eliminadas, día de negocio con `colombiaDayStart` | — | ⬜ formalmente sin confirmar desde julio, pero el panel lleva dos meses en uso diario y la lógica del corte nocturno está verificada en `dateRanges.js`. Riesgo residual bajo |

> ⚠️ **Por qué esta lista no se puede dar por buena sola** (§32): el último pedido del sistema es
> del **15-09**. Los indicadores en vivo de los flujos de arriba están en cero **por falta de
> tráfico**, no por estar arreglados. Un job arreglado y un job sin trabajo se ven idénticos.

