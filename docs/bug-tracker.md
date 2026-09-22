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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-061**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

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
- **Falta:** verificación por WhatsApp (G11) — ver `qa/RESULTADOS.md` §0.
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

### BUG-055 · 🔴 Alta · 🟠 En progreso (aplicado, falta verificar por WhatsApp) — el agente de menú pide "¿te la dejo?" sin guardar, y el "sí" del cliente cae en soporte: el pedido no avanza

- **Componente:** n8n `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`) → prompt de `AGENTE MENÚ` + tool
  `actualizar_carrito` · prompt de `ORQUESTADOR` (regla de seguridad 3) · prompt de `AGENTE SOPORTE`.
- **Síntoma medido (2026-09-15, intento de G2 desde `573184821317`, ejecuciones `15604` y `15607`):**
  1. `Hola para hacer un pedido, dame una pizza vera` → menú: `consultar_menu` y pregunta masa y
     tamaño. Correcto.
  2. `Estofada y familiar` → menú responde *"¿Te la dejo 1 Vera Pizza Estofada familiar por
     $83.000?"* **sin llamar a ninguna tool**: ni `leer_carrito` ni `crear_carrito`. El precio es
     correcto (PROD-038, familiar = 83.000), pero **el carrito no se crea**.
  3. `Si` → `Leer estado` devuelve `estado: null` → *"sin pedido en curso"*. El orquestador lo
     clasifica como `soporte` (*"respuesta corta sin pedido activo ni carrito"*). Soporte, que
     comparte la memoria del cliente, responde *"Ya tienes entonces: 1 Vera Pizza Estofada
     familiar. […] te paso con el agente que crea pedidos."* **No existe ese carrito, no pasa a
     nadie** y además menciona detalles internos. Queda en un callejón sin salida:
     `carritos` sigue sin fila para ese teléfono.
- **Causa 1 (la raíz): el prompt de `AGENTE MENÚ` se contradice.** La *SECUENCIA OBLIGATORIA* y
  *PROHIBIDO* dicen *"NUNCA pidas confirmación para agregar items. El cliente pide → tú agregas"*,
  pero la sección *"Regla crítica: consultar antes de actuar"* dice *"2. Muéstrale las opciones con
  precios → 3. Cliente CONFIRMA explícitamente → 4. SOLO ENTONCES llama actualizar_carrito"*. La
  descripción de `actualizar_carrito` refuerza la segunda (*"Usa SOLO cuando el cliente haya
  confirmado explícitamente"*). El modelo siguió la versión con confirmación.
- **Causa 2: el orquestador no ve lo que preguntó el agente.** Su memoria (`orq:<tel>`) solo tiene
  los mensajes del cliente y sus propios JSON. Un "sí" sin carrito cae en la regla de seguridad 3:
  *"Sin contexto claro → soporte"*, aunque la regla 4 diga que sin carrito se va a `menu`.
- **Causa 3: soporte inventa el carrito.** Lo reconstruye a partir del historial compartido, y su
  prompt no le prohíbe afirmar productos ni nombrar a otros agentes.
- **✅ Aplicado 2026-09-15** por `n8n-native` (`update_workflow` + `publish_workflow`). Versión activa
  **`f1f5f902`** (antes `b1b7d52f`). Antes de escribir se comprobó que el borrador era igual a la
  versión publicada. Después, los 4 textos guardados (3 prompts + la descripción de
  `actualizar_carrito`) se compararon **carácter por carácter** contra el texto esperado, generado
  por un script que exige que cada fragmento reemplazado aparezca una sola vez: idénticos.
  Copia en `docs/bot/agent-prompts.md`. Lo aplicado, respecto a lo propuesto: el orquestador manda
  una respuesta corta sin carrito a `menu`, **o a `reservas`** si su historial muestra una reserva
  en curso. Soporte, ante un "sí" suelto, responde *"¿me repites qué te agrego?"* para que el
  siguiente mensaje nombre el producto y vaya a `menu`.
- **Fix propuesto** (a mano en el editor de n8n o por `n8n-native`, porque el workflow principal no
  acepta escrituras por el MCP de la comunidad, BUG-030):
  1. **Menú:** quitar los pasos 2-4 de *"consultar antes de actuar"* y dejar solo lo que sí vale:
     *"muéstrame / ¿tienen X? / ¿cuánto vale?"* es una consulta y no toca el carrito; *"dame X"* o
     completar masa/tamaño es un pedido y se agrega **sin preguntar**. En la descripción de
     `actualizar_carrito`, cambiar *"confirmado explícitamente"* por *"pidió el producto (no solo
     preguntó por él)"*.
  2. **Orquestador:** en la regla 3, cambiar *"Sin contexto claro → soporte"* por *"afirmación corta
     (sí/dale/ok/listo) sin carrito → menu"*. Así el agente que tiene la pregunta en su memoria es
     el que recibe la respuesta.
  3. **Soporte:** *"NUNCA afirmes qué hay en el carrito ni menciones a otros agentes; si el cliente
     está pidiendo productos, pregúntale qué quiere agregar"*.
- **Verificación:** repetir los 3 mensajes tras un reset → debe existir la fila en `carritos` con
  PROD-038 después del mensaje 2, y el "sí" no debe caer en `soporte`. Luego correr G2 completo.

---

### BUG-052 · 🔴 Alta · 🔴 Abierto — el job de expiración cancela pedidos que el cliente YA PAGÓ, y nada marca el reembolso

- **Componente:** BD → `expirar_pedidos_pendientes()` (cron `expirar-pedidos-pendientes`, diario 16:00 UTC).
- **Síntoma medido (2026-09-12, datos reales, no semilla):** dos pedidos de un cliente habitual
  (`573184821317`, 6 entregas a su nombre) con **comprobante de transferencia subido** fueron
  cancelados por el job, y al cliente le llegó *"❌ Tu pedido fue cancelado, no alcanzamos a
  procesarlo antes del cierre del día."*

  | Pedido | Creado | Comprobante subido | Δ | Total | Estado final | `estado_pago` |
  |---|---|---|---|---|---|---|
  | PED-242 | 2026-09-01 21:56:33 | 2026-09-01 21:57:05 | **+32 s** | $42.500 | cancelado | `pendiente` |
  | PED-240 | 2026-08-21 17:39:23 | 2026-08-21 17:40:49 | **+86 s** | $88.000 | cancelado | `pendiente` |

  **$130.500** transferidos por un cliente real al que el bot le dijo que su pedido no se pudo
  procesar. `motivo_rechazo` en ambos es exactamente el texto por defecto del job, así que la
  autoría es del job, no de una cancelación manual.
- **Causa:** el `WHERE` del job es solo `estado = 'pendiente' AND fecha_pedido < v_inicio_dia`.
  **No mira `comprobante_url` ni `estado_pago`.** Para el job, un pedido pagado y uno abandonado
  son indistinguibles.
- **Lo que agrava el daño:** `estado_pago` se queda en `'pendiente'`, así que **ningún indicador
  del dashboard señala que hay dinero recibido por un pedido cancelado**. La plata entró, el
  pedido no existe, y nada lo cruza. Se descubre solo si el cliente reclama.
- **No es un fallo de la interfaz:** `OrderCard.jsx:184` sí muestra el botón "Ver comprobante de
  pago" y `:177` avisa cuando falta. El comprobante estaba visible; lo que falló es que el job
  pasó por encima sin preguntar.
- **Por qué las pruebas no lo vieron:** `qa/sql/07-housekeeping.sql` verificó del job las tres
  fronteras temporales, que no queda ningún pendiente viejo sin cerrar y que el texto encaja en la
  plantilla de WhatsApp — **19/19 verde**. Todo correcto, y aun así el bug estaba ahí: la batería
  comprobó que el job *hace lo que dice*, nunca que *lo que dice sea lo correcto para un pedido
  pagado*. Ver `edge-cases.md` §33.
- **Fix propuesto — requiere decisión de negocio** (cuál de los dos):
  1. **Excluir y escalar** (recomendado): el job no toca pedidos con `comprobante_url is not null`;
     quedan visibles como pendientes para que alguien los resuelva a mano. Riesgo: si nadie los
     mira, se quedan ahí para siempre.
  2. **Cancelar pero marcar**: se cancelan igual, pero con `motivo_rechazo` propio
     ("pago recibido, pendiente de reembolso"), un `estado_pago = 'rechazado'` que los haga
     visibles, y un mensaje distinto al cliente que mencione la devolución — nunca el genérico
     actual.
- **Aparte del fix, hay dos casos vivos que atender:** PED-240 y PED-242 son dinero real de un
  cliente real. Hay que decidir reembolso o reposición con él.
- **Regresión:** añadir a `qa/sql/07-housekeeping.sql` el caso "pendiente viejo **con
  comprobante**" — hoy se cancela; con el fix no debe, o debe salir con el motivo nuevo.

---

### BUG-049 · 🟢 Baja · 🔴 Abierto — `reservas` acepta fechas pasadas y horas con el local cerrado

- **Componente:** BD → tabla `reservas` (faltan CHECK) · escrito directo por el modal de reservas
  del dashboard.
- **Síntoma (medido con `qa/sql/09-basura.sql · T9`, 2026-09-12):** se aceptan sin rechistar una
  reserva con `fecha = 2020-01-01` (cuatro años en el pasado), otra a las **04:00** y otra a las
  **23:59**. Los CHECK que sí existen (`personas` 1-12, `origen`, `estado`) muerden correctamente.
- **Causa:** la única validación de horario del sistema (12:00-21:00, máx 14 días, mín 5h de
  anticipación) vive en el subworkflow n8n `OTQp2O8QDw1mMKOZ`, o sea **sólo protege el camino del
  bot**. El dashboard hace `insert into reservas` directo y no pasa por ahí.
- **Relación con BUG-044:** son el mismo hueco por los dos lados — allí el modal ofrece valores que
  la BD rechaza; aquí la BD acepta valores que el negocio rechaza. Conviene arreglarlos juntos.
- **Fix propuesto:** bajar la regla a la capa que comparten las tres — un CHECK de rango horario en
  `reservas` y un trigger que rechace `fecha` anterior a hoy. Ojo antes: la ventana correcta
  **no es 12:00-21:00** sino la que diga `info_negocio` (hoy el local cierra a 22:00/23:00, ver la
  incoherencia abierta en la Fase 0 de `qa/RESULTADOS.md`); decidirla es prerrequisito del fix.

---

### BUG-030 · 🟢 Baja · 🔴 Abierto — el n8n-mcp de la comunidad no puede escribir el workflow principal

> **Degradado de 🔴 Alta a 🟢 Baja el 2026-08-25.** El bug sigue existiendo tal cual está descrito,
> pero dejó de bloquear: el **MCP nativo de n8n** (`n8n-native`, `/mcp-server/http`) escribe por el
> SDK, no por la API pública v1, y no reenvía `settings`. Las 4 ediciones de BUG-033 se aplicaron
> por ahí sin tocar el editor. Lo que queda roto es la vía `n8n-mcp` (npx), que sí sigue rebotando.

- **Componente:** n8n → workflow `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`)
- **Síntoma:** **cualquier** `PUT` sobre el workflow falla con
  `Invalid request: request/body/settings must NOT have additional properties`. No es específico
  de un cambio: verificado con un `moveNode` que reposiciona un sticky note a su propia posición,
  y con tres `updateSettings` distintos. El workflow **no se modifica** (el error es de
  validación, previo a la escritura).
- **Causa (identificada 2026-08-18 con el export del workflow):** `settings` contiene claves que
  el editor de n8n escribe pero que el esquema de la API pública v1 **no** acepta. Estado real:

  ```json
  "settings": {
    "executionOrder": "v1",              // ✔ legal
    "timezone": "America/Bogota",        // ✔ legal
    "availableInMCP": false,             // ✔ la tiene el subworkflow, que sí guarda
    "binaryMode": "separate",            // ✘ fuera del esquema
    "timeSavedMode": "fixed",            // ✘ fuera del esquema
    "callerPolicy": "workflowsFromSameOwner"  // ✘ fuera del esquema
  }
  ```

  El esquema solo admite `executionOrder`, `errorWorkflow`, `timezone`, `executionTimeout`,
  `saveExecutionProgress`, `saveManualExecutions`, `saveDataErrorExecution`,
  `saveDataSuccessExecution`. El `PUT` reenvía `settings` tal cual está guardado, así que
  **cualquier** escritura rebota antes de tocar nada.
- **Por qué no se puede arreglar por MCP (las 4 vías, todas descartadas con evidencia):**
  1. `updateSettings` hace **merge**, no reemplazo — verificado mandando solo
     `{executionOrder:"v1"}`: siguió fallando, o sea las claves viejas seguían viajando.
  2. Pasar `null` **no elimina** la clave — verificado con las tres a la vez.
  3. `n8n_update_full_workflow` con `settings` explícito **también mergea** — verificado
     2026-08-18. (Efecto colateral útil: se comprobó que **no** manda `nodes: []` cuando se
     omiten; el workflow quedó intacto en 101 nodos y ni siquiera cambió `updatedAt`.)
  4. Guardar desde la UI tampoco sirve: esas tres claves las **escribe el editor**, así que
     vuelven a aparecer. Verificado — tras un guardado manual el error se repitió idéntico.
- **Impacto (actualizado 2026-08-19):** las zonas de domicilio **ya no están bloqueadas** — se
  aplicaron a mano en el editor y el bot cobra por barrio (ver changelog 2026-08-18). Lo que queda
  es el impacto estructural: **todo cambio futuro sobre `Pizzeria Vera` hay que hacerlo a mano**,
  con el costo que eso tiene (en la aplicación manual de las zonas se coló un error —
  `$[total + costo_domicilio]` en el PASO 5, que cobraba el domicilio dos veces— que solo se
  detectó al releer el workflow por MCP; por API el diff habría sido evidente).
- **Workaround vigente (2026-08-25):** escribir con **`n8n-native`** (`update_workflow` +
  `publish_workflow`), que no toca la API pública v1. Antes de eso los cambios se aplicaban a
  mano en el editor. La lectura por `n8n_get_workflow` (mode `filtered`) **sí** funciona en
  ambas vías y sigue siendo la forma de verificar. De fondo, la vía `n8n-mcp` se destraba solo
  con una de estas dos, ninguna urgente:
  1. Actualizar el n8n-mcp a una versión que **filtre** `settings` a las 8 claves del esquema
     antes del `PUT` — es lo correcto: el problema es del cliente, no del workflow.
     **Comprobado el 2026-08-19: n8n-mcp está en 2.73.0, que es la última publicada, y sigue sin
     filtrar.** Hay que esperar una versión nueva; no tiene sentido reintentar hasta entonces.
  2. Actualizar n8n a una versión cuyo esquema de API pública ya incluya `binaryMode`,
     `timeSavedMode` y `callerPolicy`. (La instancia dejó de reportar su versión a la API desde
     n8n 1.119.0, así que hay que mirarla desde la UI.)
- **Alcance (corregido 2026-08-25):** afecta a la vía `n8n-mcp` (npx) sobre `Pizzeria Vera`, no a
  todo cambio futuro, como decía este entry antes. Con `n8n-native` configurado las escrituras
  van por ahí; esto queda como registro de por qué `n8n_update_partial_workflow` sigue fallando
  si alguien lo intenta.
- **Recomprobado 2026-08-21** trabajando BUG-032: un `patchNodeField` de un solo header sobre
  `crear_carrito` rebotó con el mismo `request/body/settings must NOT have additional properties`.
  Sigue vigente; los dos cambios de BUG-032 van a mano.

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

Fixes ya aplicados cuya verificación final depende de tráfico real.

- **BUG-050 (flujo de reseñas) — las tres piezas EN VIVO desde el 2026-09-12.** Verificado tras el
  despliegue: `Pizzeria Vera` tiene `versionId == activeVersionId` (`6c5b09b3…`), con la cadena
  reordenada (*crear cola → enviar WhatsApp → marcar → cambiar modo*) y la cabecera
  `Prefer: resolution=merge-duplicates,return=minimal` en la versión **activa**. Más el cron
  `expirar-feedback-pendiente` y la limpieza de los 7 clientes atrapados.
  **Qué falta confirmar con tráfico real** — nada de esto lo prueba el SQL:
  1. Que a un cliente **con entrega reciente le LLEGUE** el WhatsApp pidiendo la nota. El síntoma
     original era justamente que no llegaba: 51 días sin un solo feedback.
  2. Que a un **cliente repetido** (segundo pedido entregado dentro de las 48 h) le llegue también,
     y que su fila de cola apunte al pedido **nuevo** — ése era el caso que mataba la ejecución.
  3. Que la nota quede guardada contra el pedido correcto y el modo vuelva a `'bot'`.
  Es el guion **G11** de `qa/guiones-bot.md`. Hasta correrlo, el fix está verificado en estructura
  pero no en comportamiento.

> **Tanda de fixes 2026-09-15** (detalle en `changelog.md`). Todo lo de BD quedó verificado con las
> baterías; lo de abajo es lo que además necesita una conversación real.

- **BUG-051 + BUG-027 (reseñas)** — `Sub — Feedback Pendiente` publicado dos veces el 2026-09-15:
  `cb2ff4b5…` (parser estricto, BUG-051) y `61dd4711…` (saltos de línea y comillas reales en los 4
  WhatsApp, BUG-027). `activeVersionId` verificado en ambos. **Falta G11:** que `10/10` y
  `quiero 2 pizzas` reciban *"responde solo 1–5"*, que `5` y `cinco` guarden la nota, y que los
  mensajes lleguen en varias líneas y sin `\n` a la vista.
- **BUG-038 (número de pedido)** — `Sub — Crear_orden_completa` publicado (`05099286…`):
  `Respuesta de salida` devuelve `pedido_id`. **Falta G4:** que el cliente reciba *"tu número de
  pedido es #PED-…"* y no *"no disponible en este momento"*. Si el agente sigue sin darlo, el
  problema pasa a ser el prompt, no la tool.
- **BUG-053 (buffer de mensajes)** — dos capas en vivo: cron `limpiar-mensajes-pendientes` (cada
  5 min, borra filas de más de 5 min) y `retryOnFail` ×3 en los 4 nodos del buffer de `Pizzeria
  Vera` (publicado `b1b7d52f…`). El síntoma se reprodujo en vivo esa misma tarde: el primer mensaje
  de G1 le llegó al bot con la dirección del 12-09 delante. **Falta:** no hay forma de provocar un
  504; confirmar en `search_executions` que no reaparecen errores en `Obtener ultimo mensaje` y que
  `n8n_mensajes_pendientes` no acumula filas.
- **BUG-039 (búsqueda de menú)** — `buscar_menu` puntúa ahora por cobertura de la búsqueda.
  Batería 02 en verde, pero **la banda de confianza del prompt (≥0.5 agregar / 0.2–0.5 confirmar)
  es la que decide qué hace el bot**. Correr G1 otra vez: `pan de ajo`, `una copa de vino`,
  `lasaña de pollo` y `arepa de pollo` deben agregar lo pedido sin preguntar; `pizza de pollo`
  (varias a 0.81) debería ofrecer opciones. G1 del 2026-09-15 corrió **antes** de este cambio.

> **Campaña de pruebas 2026-09-09** — la Capa A (SQL determinista, `qa/sql/`) cerró las
> verificaciones que no necesitaban una conversación real. Lo que sigue aquí es lo que **solo** se
> puede comprobar hablando con el bot por WhatsApp. Resultados en `qa/RESULTADOS.md`.

- **BUG-033** — cobertura fuera de Bello. ✅ **Capa SQL verificada** (`qa/sql/01-cobertura.sql`):
  los 59 barrios resuelven con tarifa y tiempo, 295 variantes de escritura son consistentes, y los
  10 municipios de fuera devuelven `cubierto:false` con costo y tiempo en NULL. Falta **solo** la
  prueba por WhatsApp, que es la única que ejercita al modelo — y sigue siendo necesaria porque la
  RPC ya devolvía bien el dato cuando el prompt mentía (edge-case §27):
  «¿Tienen servicio en Envigado?» y «¿Llegan a Sabaneta?» → debe decir que no llegan y ofrecer
  recoger, **sin precio ni tiempo**; «¿Llegan a Niquía?» → $7.500, 30 a 45 min; «estoy en niqia»
  → debe preguntar «¿te refieres a Niquía?»; «¿cuánto el domicilio al centro?» → $5.000; y un
  pedido a domicilio diciendo «estoy en Itagüí» **no** puede terminar creado como domicilio.
- **BUG-032** — carrito idempotente. Las tres capas están aplicadas y verificadas por MCP (upsert
  en `crear_carrito`, regla nueva en el Agente Menú, trigger `trg_carritos_touch_updated_at`), pero
  el camino completo solo se prueba con una conversación real: **dejar un carrito con items sin
  convertirlo en pedido y, desde ese mismo teléfono, pedir otra cosa**. El producto debe entrar y el
  carrito quedar con los items nuevos (`select * from carritos where telefono = '...'`). Confirmar
  también que si la escritura falla el bot **no** muestra el 🛒 — antes lo cantaba igual.
- **BUG-025** — tras desplegar, confirmar en una noche real (19:00–24:00 Colombia) que el
  kanban muestra los pedidos que entran (antes se vaciaba en esa franja).
- **BUG-023/024** — tras desplegar el build con `realtime.setAuth`, confirmar que el badge
  de soporte y el panel siguen actualizándose en vivo (las políticas `public` de
  `mensajes_soporte` ya no existen; todo el realtime va autenticado).

- **BUG-005/009** — probar una cancelación de reserva real por WhatsApp: camino feliz
  y un intento con reserva ajena (debe responder "esta reserva no es tuya").
- **pinData viejo (cosmético)** — `Sub — Crear Reserva` y `Sub — Cancelar Reserva` conservan
  pins con las keys viejas (`cliente_id `/`telefono ` con espacio), y `Sub — Consultar_menu`
  los query params del `ilike`. Solo afecta pruebas manuales en el editor — re-pinnear al abrirlos.
