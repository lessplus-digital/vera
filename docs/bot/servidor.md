# Servidor del bot (Node) — reemplazo de n8n

> **Estado (2026-10-05): el corte se hizo.** El servidor corre en el VPS de Hostinger (`/root/vera/server`,
> `bot.plateo.cloud` por el Traefik de n8n; guía en `despliegue.md`), Meta le manda los mensajes del número
> de pruebas (322 681 7466; aún no hay clientes reales), el trigger `notificar-estado-pedido` apunta aquí,
> `FEEDBACK_ACTIVO=true` y los 7 workflows de n8n están **desactivados (no borrados)**. Falta: quitar el token
> del dashboard (Vercel) y rotarlo, y las pruebas manuales (Reservas). `n8n-*.md` pasan a histórico. Plan completo y fases:
> `docs/changelog.md` § 2026-09-29. Punto de vuelta atrás: tag git `pre-migracion-node`.

## Por qué

En n8n el **orquestador es un LLM que decide solo**, guiado por reglas en texto, y no las
respeta de forma fiable: BUG-061/062 necesitaron tres rondas de prompt y al final se
resolvieron con un override en código. Tampoco había pruebas unitarias ni forma de automatizar
las pruebas de WhatsApp. Principio del servidor nuevo: **la IA conversa, el código decide.**
Las acciones críticas (crear pedido, crear/cancelar reserva, handoff, cobertura) las ejecuta
código probado; el LLM clasifica y redacta.

## Dónde vive

- Código: `server/` en este repo (paquete aparte; no afecta el build del dashboard).
- Producción: Docker en el VPS de Hostinger donde corre n8n (`docker-compose.yml`), detrás
  del proxy HTTPS que ya publica n8n → `bot.plateo.cloud`. n8n queda apagado como respaldo.

## Comandos (desde `server/`)

```bash
npm run dev        # servidor con recarga (lee server/.env; ver .env.example)
npm test           # pruebas unitarias (Vitest, sin red, ~2 s)
npm run typecheck  # chequeo de tipos
npm run sim        # simulador de WhatsApp: escenarios de test/escenarios/*.yaml, 5 corridas c/u
npm run sim -- g3 --veces 1     # filtrar por nombre de archivo / una sola corrida
npm run chat       # conversar con el bot desde la terminal, sin WhatsApp
npm run build && npm start      # producción local
```

El subagente **`bot-sim`** corre el simulador y devuelve solo lo que falla.

## Cómo fluye un mensaje (Fase 1)

```
Meta ─POST─▶ /webhook/whatsapp  (src/http/app.ts)
  1. Verifica X-Hub-Signature-256 con WA_APP_SECRET        → 401 si no cuadra
  2. parsearWebhook(): texto · imagen · botón (remapeado) · no_soportado; ignora `statuses`
  3. Dedupe por wamid (Meta reintenta)                     → src/cola/dedupe.ts
  4. BufferPorTelefono: espera BUFFER_MS desde el ÚLTIMO mensaje y junta el turno;
     nunca dos turnos del mismo teléfono a la vez           → src/cola/buffer.ts
  5. Procesador de turno (determinista, sin LLM)            → src/turno/procesador.ts
  6. Envío por la Graph API (o FakeWhatsApp en pruebas)     → src/whatsapp/cliente.ts
  7. Registro del turno en bot_turnos                        → src/log/turnos.ts
  Responde 200 a Meta en el paso 3; el turno corre después.
```

### El procesador de turno (Fase 3)

Decide por el **modo del cliente** (`clientes.modo`) y el **tipo de mensaje**; no hay LLM aquí.
Toda la BD pasa por la interfaz `Repo` (`src/bd/repo.ts`): `RepoSupabase` en producción y
`RepoMemoria` (`src/sim/`) en pruebas y simulador. Los textos fijos viven en `src/textos.ts`.

| Modo | Texto | Foto | Audio / ubicación / sticker |
|---|---|---|---|
| `humano` | al chat de soporte (`mensajes_soporte`), el bot no contesta | se sube a `comprobantes/soporte/<tel>/…` y va a soporte como imagen | nota para el operador en soporte |
| `esperando_feedback` | RPC `procesar_respuesta_feedback` → texto fijo según la acción. Si ya no había calificación pendiente (`sin_pendiente`), **el texto sigue al bot** (en n8n se perdía) | "No aceptamos imágenes…" | igual que foto |
| `bot` | `Conversador`: con `OPENAI_API_KEY`, el pipeline de decisión (abajo); sin clave, un eco, con historial en `n8n_chat_histories` | **comprobante**: pedido pendiente por transferencia más reciente sin comprobante → `comprobantes/<PED>.<ext>` + `pedidos.comprobante_url` | texto "solo puedo leer texto y fotos" |

- **Nunca silencio:** si el conversador falla, el cliente recibe `ERROR_GENERICO`; si la descarga
  de un comprobante falla, `COMPROBANTE_ERROR`. Ambos quedan con `error` en `bot_turnos`.
- **Avisos de estado del pedido:** `POST /hooks/estado-pedido` (`src/http/hooks.ts`), autenticado
  con `x-webhook-token` = `HOOK_TOKEN`. Solo avisa si cambió `estado`. En el corte (Fase 8) el
  trigger `notificar-estado-pedido` se apunta aquí. Mejora: un cancelado sin motivo ya no dice "null".
- **Mensajes juntados en modo calificación (2026-10-02):** el buffer junta "5⏎5" o "2⏎llegó fría"
  en un texto, y la RPC exige que el mensaje entero sea la nota (BUG-051), así que contestaba "No
  entendí". Ahora, si el texto junto no es nota, el procesador lee las líneas en orden: la primera
  que sea nota (`notaFeedback`, la misma limpieza que la RPC) califica; con nota baja lo que sigue
  es el comentario; con nota alta lo que no sea otra nota ("5⏎quiero otra pizza") sigue al bot en el
  mismo turno. El intercambio queda en el historial, así el bot sabe de qué venía si el cliente
  sigue escribiendo.
- **Calificaciones:** `src/cron/feedback.ts` cada 15 min (RPC `solicitar_feedback_lote`, tandas de 5
  con 2 s de pausa). **Apagado por defecto** (`FEEDBACK_ACTIVO=false`) mientras n8n tenga su propio
  job; se enciende en el corte.
- **Paso a humano:** `repo.pasarAHumano()` pone `modo='humano'` y el trigger `trigger_contexto_handoff`
  copia el historial al chat de soporte. Lo dispara la política de la Fase 4 (y el Agente Soporte).

### La decisión (Fase 4) — `src/decision/`, `src/guardia/`, `src/llm/`

Un turno de texto en modo `bot` pasa por `crearConversadorDecision` (`decision/conversador.ts`):

```
1. Lee de la BD el estado real: vista estado_pedido + tabla conversaciones (quién lleva el hilo
   y qué preguntó el bot por última vez, en `pendiente`)
2. CLASIFICA (LLM, JSON estricto con zod)            → decision/clasificador.ts, clasificacion.ts
   intención (17), confirma si/no/na, productos, tipo_pedido, barrio (tal cual, con errata),
   dirección, pago, fecha/hora/personas, pide_humano, frustración. No decide nada.
3. DECIDE (código puro, sin LLM ni efectos)           → decision/politica.ts
   handler (menu · pedidos · soporte · reservas · humano) + acciones críticas
4. EJECUTA las acciones antes de redactar            → decision/ejecutor.ts
   handoff · guardar_datos · verificar_cobertura · vaciar_carrito · crear_pedido
5. REDACTA el handler (Fase 5; hoy `redactorProvisional`, que solo dice qué entendió)
6. GUARDIA de salida; si falla, regenera 1 vez; si vuelve a fallar, TEXTO_SEGURO → guardia/guardia.ts
7. Guarda en conversaciones el handler y la pregunta que quedó abierta
```

**Reglas de la política** (tabla completa de casos en `test/unit/politica.test.ts`). Porta el
orquestador de n8n publicado (versión `1d7f7d87`) **más** los parches de BUG-061/062 que nunca
corrieron (BUG-063), con una diferencia de fondo: el orquestador no sabía qué había preguntado el
agente; aquí `ultima_pregunta` está en la BD, así que un "dale" se interpreta sin adivinar.

1. `pide_humano` → handoff en código, gane a todo.
   1b. **Fuera de tema** (2026-10-07): si el clasificador marca `fuera_de_tema` (programar, tareas,
   traducir, consejos…) y el mensaje no trae ningún producto ni dato del pedido o la reserva, sale el
   texto fijo `T.FUERA_DE_TEMA` **sin pasar por ningún agente**, y la conversación (handler y pregunta
   abierta) queda como estaba. Excepción: una respuesta corta a una pregunta del bot ("no, así está
   bien") sigue su camino aunque el clasificador arrastre el tema ajeno del historial. Si viene
   mezclado con un pedido, el pedido se atiende y el agente declina lo ajeno en una frase (línea
   `ALCANCE` de `handlers/comun.ts`, que va en el contexto de los cuatro agentes).
2. Respuesta a la última pregunta: **`crear_pedido` solo si** la pregunta fue el resumen, el
   cliente dijo sí sin cambiar nada, y la BD dice `paso_flujo=resumen` con `faltantes=[]`
   (la RPC lo vuelve a exigir: `SIN_RESUMEN`). "Dale" a "¿te agrego una hawaiana?" = Menú agrega
   ese producto. "Sí" a "¿quisiste decir Niquía?" = cobertura con el sugerido. "Sí" a "¿te
   conecto con alguien del equipo?" = handoff.
3. Frustración 2 → handoff. Una queja normal va a Soporte.
4. Datos: solo se guarda lo que el cliente **afirma** ("¿hacen domicilios?" no guarda nada). Si el
   bot espera un dato (pregunta registrada o el primer `faltante`) y el mensaje es una respuesta
   suelta, **es ese dato** aunque el clasificador no lo reconozca (BUG-062: "pardo"), salvo que ya
   sea otro dato ("por transferencia" no es un barrio). Un barrio suelto sin "?" tras "¿en qué
   barrio?" es respuesta aunque el clasificador lo lea como pregunta de cobertura (visto con
   gpt-5.1: "niqia" se consultaba pero no se guardaba y el bot volvía a preguntar el barrio).
   Todo barrio pasa por `consultar_cobertura` en código (BUG-061).
5. Productos → Menú (arma el carrito, como en n8n), aunque haya datos pendientes.
6. Un dato con carrito → Pedidos; un barrio sin carrito → Soporte; lo demás sin carrito → Menú.
   **Nunca Pedidos sin carrito.**
7. Sin intención clara: sigue quien llevaba el hilo.

Los tres invariantes críticos (crear pedido, crear reserva, nunca Pedidos sin carrito) se prueban
además con un **barrido** de todas las combinaciones intención × confirma × pregunta × estado.

**Cobertura en el ejecutor:** con una sola sugerencia se consulta la sugerencia y, si está cubierta,
se responde con el dato real sin preguntar ("niqia" → Niquía). Se guarda el nombre **canónico** con
su tarifa y `cobertura_ok`; nunca el texto crudo (con `niqia` guardado, el trigger cobraba la
tarifa base). Sin cobertura no se guarda nada y queda abierta la pregunta `sugerir_barrio` (o
`dato_pedido: barrio` si hay varias sugerencias).

**Pedido creado:** la confirmación es un texto fijo (`T.pedidoCreado`) con `pedido_id` y
`total` tal como los devolvió `crear_orden_desde_carrito`. El LLM no la redacta.

**Guardia** (`guardia/guardia.ts`, contra los hechos de ESTE turno): ningún monto que no haya
salido de una herramienta; sin cobertura, ningún tiempo de entrega; pedido creado → id y total
exactos; no decir "tu pedido quedó confirmado" si no se creó; no citar un `PED-` ajeno; no
mencionar internos (sistema, base de datos, herramientas, n8n…). Desde la Fase 6 también:
**productos inventados** (`producto_inventado`: una lista de marcas y sabores famosos que no están
en la carta — Stella, Heineken, Postobón, cuatro quesos… — solo pasan si una herramienta los
devolvió en el turno o si el cliente los nombró) y **negar sin buscar** (`niega_sin_consultar`:
Menú no puede decir "no lo tenemos / no me aparece" sin haber llamado `consultar_menu`).
Desde 2026-10-07, **código en la respuesta** (`fuera_de_tema`: bloques ```, `print(`, `def f(`,
`import x`…): red de seguridad por si un agente se pone a ayudar con algo ajeno al restaurante.

**LLM:** interfaz `LLM` (`llm/llm.ts`) con `LLMOpenAI` (Structured Outputs, `OPENAI_MODEL`,
por defecto `gpt-5.1`) y `FakeLLM` para pruebas. Si el clasificador falla, el turno sigue con
una clasificación vacía ("otro" → sigue el hilo) y el error queda en `bot_turnos.clasificacion`.

### Los agentes (Fase 5) — `src/handlers/`, `src/herramientas/`

Cada handler es un `Redactor`: recibe lo que decidió la política y lo que hicieron las acciones, y
devuelve el texto y **la pregunta que dejó abierta** (se guarda en `conversaciones`). Usa
`LLM.conHerramientas` (varias rondas de herramientas y cierre en JSON estricto). Si la guardia
rechaza el texto, se reescribe **sin volver a correr herramientas que cambien algo**
(`handlers/comun.ts · reescritura`): si no, un reintento agregaría el producto dos veces.

**Menú** (`handlers/menu.ts`, ✅ 2026-09-30). Portado del prompt de n8n `1d7f7d87` (la versión
corregida de BUG-063). Herramientas (`herramientas/menu.ts`): `consultar_menu` (buscar_menu con
disponibles y agotados; los agotados van sin precio), `agregar_al_carrito`, `agregar_mitad_y_mitad`,
`cotizar_mitad_y_mitad`, `quitar_del_carrito`. **Ningún argumento lleva precio**: lo pone la RPC.
El bloque 🛒 (líneas numeradas, masa + tamaño, subtotal) lo arma el código (`handlers/formato.ts`)
y cierra con "¿Quieres agregar algo más?" (pregunta `algo_mas`). La masa se lee de `menu`
porque la línea del carrito solo guarda el tamaño y hay hawaiana tradicional y estofada.
Lecciones de las primeras corridas con gpt-5.1, ya convertidas en reglas y pruebas: "y una coca
cola" a "¿algo más?" venía como `confirma:no` (la política ahora deja que gane el producto);
al revés, "No así está bien" llegó con una intención extra `quitar_producto` inventada y el pedido
se quedó en Menú sin pedir los datos (2026-10-06): un `quitar_producto` que viene solo como extra
cuenta como cambio únicamente si el texto pide quitar algo (`pideQuitar` en `politica.ts`);
un "entonces una mitad y mitad" llegó a **borrar** la hawaiana del carrito (regla: nunca quitar
sin pedido explícito); "no me aparece en nuestro sistema" pasaba la guardia (ahora bloquea
"sistema"); precios sin "$" ("51.500") ahora también los revisa la guardia.
Con el menú real (Fase 6): el modelo **adivinó un `producto_id`** (PROD-011 para "premium
hawaiana", porque en el carrito veía PROD-010) y luego dijo que no existía. Ahora las herramientas
de carrito y de mitad y mitad rechazan (`PRODUCTO_SIN_CONSULTAR`, sin tocar la BD) cualquier id que
no haya devuelto `consultar_menu` en el turno o que no esté ya en el carrito. Y si la guardia
rechaza un texto antes de que el carrito cambie, la reescritura **sí** puede volver a consultar el
menú (consultar no tiene efectos); tras un cambio de carrito sigue sin herramientas.
Otros arreglos de la Fase 6: si el cliente pide a domicilio desde un barrio **sin cobertura**
("una hawaiana a domicilio, estoy en Itagüí"), Menú arma el carrito y el código agrega debajo el
"no te llegamos… ¿lo recoges?" con su pregunta (antes no se decía nada); el "¿Quieres agregar algo
más?" que el modelo escribía por su cuenta se quita (`quitarAlgoMas`) porque lo pone el código y
salía dos veces; con una coincidencia casi exacta (≥ 0.9) `consultar_menu` descarta lo que quedó
por debajo de 0.5 (`recortarRuido`: "pan de ajo" traía 9 pastas en 0.49); y Menú nunca dice que
"por aquí no se hacen reservas" (pasó con "quiero una pizza y también reservar mesa"): lo frena el
prompt y la guardia (`niega_servicio`). **La masa que nombró el cliente no se cambia:** si dijo
una sola masa, las herramientas rechazan (`MASA_NO_PEDIDA`) un producto de la otra; si en una mitad
y mitad nombró las dos, es `MASA_DISTINTA` desde el código (a "mitad hawaiana tradicional y mitad
pepperoni estofada" el modelo había agregado las dos en tradicional, sin avisar).

**Pedidos** (`handlers/pedidos.ts`, ✅ 2026-09-30). Portado del prompt de n8n `1d7f7d87`, pero
casi todo lo que allí era regla en texto es código, y el LLM **no tiene herramientas**:

- **Qué preguntar** lo dice `faltantes` (vista `estado_pedido`): una pregunta por mensaje, con
  textos fijos (`P` en `pedidos.ts`). Guardar datos y consultar cobertura ya lo hizo la política
  antes de llegar aquí; si hay un barrio guardado sin cobertura confirmada, la política la agrega
  (`completarCobertura`).
- **Datos registrados:** con barrio registrado pregunta "¿Sigues por el barrio X?" (pregunta
  `sugerir_barrio`: el "sí" pasa por cobertura; "no, estoy en Y" consulta Y); con dirección
  registrada, "¿Te lo enviamos a …?" (pregunta nueva `usar_direccion`). Cada uno se ofrece una
  sola vez: tras un "no" se pregunta abierto.
- **Sin cobertura** (con o sin sugerencias) se contesta ya, falte lo que falte, y se ofrece
  recoger (pregunta nueva `ofrecer_recoger`; "dale" → `tipo_pedido=recoger`). Sin esto, pasar a un
  barrio sin domicilio *después* del resumen volvía a mostrar el resumen con el barrio viejo.
- **Dirección vaga** (sin ningún número: "cerca al parque") no se guarda y se pide con calle y número.
- **Resumen** (`formato.ts · bloqueResumen`, los 4 casos domicilio/recoger × efectivo/transferencia):
  ítems, subtotal, domicilio y total salen de la BD; el código marca `paso_flujo=resumen` antes de
  enviarlo y deja la pregunta `confirmar_pedido`. "No" al resumen → "¿Qué te gustaría cambiar?".
- **El LLM** solo escribe una frase de enlace encima ("¡Perfecto!", o la respuesta a algo que el
  cliente preguntó de paso). Las oraciones con "?" se quitan (`sinPreguntas`): la única pregunta
  del mensaje es la del código. Pasa por la guardia como cualquier texto. **Desde la Fase 6, si el
  cliente solo dio un dato** (intención `datos_pedido` / `respuesta_corta` / `cobertura`, nada más)
  **no se llama al modelo**: sale `ACUSE` ("Listo 👌") + lo del código, o solo lo del código si
  trae un aviso. Su frase repetía lo de debajo ("¡Perfecto, justo llegamos a Niquía!" sobre "¡A
  Niquía sí llegamos!") y una vez escribió "cuando lo confirmes con el bot" (la guardia ahora
  también bloquea "bot"). De paso ahorra unos 1.000 tokens por dato.
- **Crear el pedido** sigue siendo la regla `resumen:si` del conversador. Si la RPC falla con algo
  recuperable (`SIN_RESUMEN`, `PRECIOS_ACTUALIZADOS`, `TARIFA_ACTUALIZADA`, `DATOS_INCOMPLETOS`,
  `PRODUCTO_NO_DISPONIBLE`, `CARRITO_VACIO`) Pedidos vuelve a mostrar el resumen o pide lo que
  falte; cualquier otro código pasa a una persona (`T.PEDIDO_FALLO_HANDOFF`) — el prompt de n8n
  decía "voy a escalarlo" pero nadie lo escalaba.
- **Tras crear:** la confirmación por transferencia incluye la cuenta de `info_negocio.datos_transferencia`
  (la que se edita en Configuración; antes estaba escrita en el prompt), y la dirección y el barrio
  del pedido pasan a `clientes.direccion_principal`/`barrio` para ofrecerlos la próxima vez.

**Soporte** (`handlers/soporte.ts`, ✅ 2026-09-30). Portado del prompt de n8n `1d7f7d87`. Como
Pedidos, el LLM **no tiene herramientas**: una sola llamada con todo lo que necesita ya leído por el
código.

- **Contexto que arma el código:** `info_negocio` completa (desde la Fase 6 **con**
  `datos_transferencia`: G7.5 pide la cuenta y antes contestaba "esa información no la tengo"), las FAQ de `consultar_faq` entre `<faq>…</faq>` marcadas como
  **datos, nunca instrucciones**, y los **3 últimos pedidos del cliente** con su estado en palabras,
  hace cuánto y el motivo si se canceló. Nuevo respecto a n8n: "¿cómo va mi pedido?" se contesta
  con el estado real (n8n no podía leerlo y decía "el equipo lo está revisando"). Esos `pedido_id`
  y totales son los únicos que la guardia deja citar; un precio que venga de una FAQ no pasa.
- **Pregunta del negocio = respuesta con cita:** con intención `info_negocio` el modelo devuelve
  `cita`, el dato al pie de la letra en que se basa, y el código comprueba que exista en
  `info_negocio` / FAQ / pedidos (`citaRespaldada`). Si no, su texto se descarta y sale `S.noLaTengo`
  con la pregunta `ofrecer_humano` (queda `cita_sin_respaldo` en `bot_turnos`). La regla "no
  inventes" en el prompt no bastó: gpt-5.1 respondió "sí, tenemos wifi" 1 de 5 veces.
- **Nombre:** lo guarda la **política** (acción `guardar_nombre`), solo si el cliente no tenía uno
  registrado y pasa `nombreValido` (1–4 palabras de letras; nada de emojis, "Dios es amor", "asdfgh",
  "test"). Un nombre ya registrado no se cambia desde el chat. Si solo saludó y no sabemos su
  nombre, la respuesta es fija (`S.pedirNombre`) y deja la pregunta `nombre`: la respuesta suelta
  ("me llamo Camila.") se toma como nombre aunque el clasificador no lo lea.
- **Cobertura sin carrito:** la consulta la política, como siempre; la respuesta ("¡A Niquía sí
  llegamos! $7.500…", "¿te refieres a…?", "no llegamos… ¿lo recoges?") es la misma de Pedidos
  (`formato.ts · siLlegamos / sinCobertura`). Si pregunta por domicilios sin barrio, el modelo pide
  el barrio (pregunta `dato_pedido: barrio`) y la respuesta suelta pasa por cobertura. Si el
  mensaje es **solo** de cobertura, desde la Fase 6 va **solo el texto del código**, sin frase del
  modelo: con frase se vio "a domicilio solo manejamos Bello… ¡A Niquía sí llegamos!".
- **Respuestas fijas del código (Fase 6):** horario, dirección y medios de pago, cuando el mensaje
  pregunta solo por uno de ellos (`respuestaFija`, ≤ 80 caracteres), y **la cuenta para transferir**
  (`pideCuenta`, en el conversador, la atienda quien la atienda) salen tal cual de `info_negocio`,
  sin modelo. Con el modelo, 1 de 5 veces "¿a qué hora abren?" salía "esa información no la tengo"
  y "¿me pasas los datos?" salía "te van a compartir los datos en un momento".
- **Citas compuestas:** la cita puede juntar dos datos con `;` (los dos horarios) o traer el nombre
  del campo ("horario_semana: …"); antes eso no
  se reconocía y a "¿a qué hora abren?" contestaba "esa información no la tengo".
- **Escalar:** el modelo no pasa a nadie: devuelve `escalar` (`reclamo_grave` — pedido equivocado,
  cobro mal, comida mala, >1 h de espera — o `pedido_registrado` — cambiar o cancelar un pedido ya
  hecho) y el **código** ejecuta `pasarAHumano` y manda `T.HANDOFF`. Si ofrece "¿quieres que te
  conecte con alguien del equipo?" deja la pregunta `ofrecer_humano`, y el "sí" lo convierte la
  política en handoff (regla `ofrecer_humano:si`), sin pasar por el modelo.
- `actualizar_cliente` para la dirección **no se portó**: tras cada domicilio la dirección y el
  barrio pasan solos a `clientes` y en el siguiente pedido se ofrecen ("¿te lo enviamos a …?").

**Reservas** (`handlers/reservas.ts` + piezas puras en `decision/reserva.ts`, 2026-09-30). Portado
del prompt de n8n `1d7f7d87`; el LLM **no tiene herramientas** y solo escribe la frase de enlace.

- **Borrador en la BD:** lo que el cliente va diciendo se guarda en `conversaciones.reserva`
  (`personas`, `fecha`, `hora`, `motivo`, `verificado`). Un desvío ("mándame la carta") no lo borra;
  se descarta a las 6 h sin movimiento.
- **Una pregunta por mensaje** (`faltaReserva`): personas → día → hora → **disponibilidad** →
  ocasión → resumen. La disponibilidad (`consultar_disponibilidad_reserva`) la consulta el código
  en cuanto hay día, hora y personas; sus errores (`FECHA_PASADA`, `FUERA_DE_HORARIO`, `MUY_LEJOS`,
  `POCA_ANTICIPACION`) se dicen con el `message` de la BD y se vuelve a pedir ese dato. `verificado`
  guarda para qué día/hora/personas dio cupo: cambiar cualquiera obliga a consultar de nuevo.
- **"A las 7" = 19:00** (`normalizarHora`: de 1 a 9 se suman 12; se reserva de 12:00 a 21:30).
- **La ocasión** se empareja en código contra `motivos_reserva` (`emparejarMotivo`: "cumple" ~
  "Cumpleaños", "propuesta" ~ "Declaración / propuesta"); nada está escrito a mano, así que un
  motivo nuevo en Configuración funciona solo. "No / normal / ninguna" solo cuenta como respuesta a
  esa pregunta. El costo sale de la tabla, es por reserva y se paga en el local.
- **Crear:** solo con "sí" al resumen (`confirmar_reserva`) **y** el borrador completo con cupo
  verificado (`borradorListo`); lo crea el ejecutor con `crear_reserva_bot` y la confirmación es un
  texto fijo (`T.reservaCreada`) con lo que devolvió la RPC. "Sí, pero a las 8" es un cambio (no
  crea: consulta y resume de nuevo). Si la franja se ocupó entre el resumen y el "sí" (`SIN_CUPO`),
  se pide otra hora. Más de 12 personas → se ofrece el equipo (pregunta `ofrecer_humano`).
- **Consultar / cancelar:** `reservas_del_cliente`; con varias, "¿cuál?" (pregunta `elegir_reserva`,
  vale "la 2" o el día); cancelar siempre pide confirmación (pregunta `cancelar_reserva`) y lo hace
  el ejecutor con `cancelar_reserva_bot`, que no cancela una ajena (`RESERVA_NO_ENCONTRADA`).
- **Fase 6 (G9):** las reglas de reserva (`REGLAS_RESERVA`: 1–12 personas, máx. 14 días, 5 h el
  mismo día, horarios) van en el contexto del modelo (contestó "claro que puedes reservar para
  dentro de 3 meses"); consultar, cancelar y los rechazos de la BD salen sin frase del modelo
  (`plan.fijo`); "olvídalo" con un borrador y sin reservas suelta el borrador; nombrar un `RES-`
  que no es suyo responde "no encontré esa reserva" sin mostrar nada ajeno. En la política, el
  "sí" a "¿te conecto con alguien?" solo cuenta si el mensaje no trae otra intención concreta
  (`RESPONDE_OFERTA`: "cancela la reserva RES-001" llegó con `confirma: si` y terminó en handoff).

**Arreglado de paso:** `repo-supabase` filtraba las preguntas guardadas con una lista escrita a mano
que no tenía `nombre` ni `ofrecer_humano`: en producción el "sí" a "¿te conecto con alguien?" se
habría perdido. Ahora es un `Record` exhaustivo por tipo (una pregunta nueva que falte no compila).

`src/bot.ts` es el **único punto de ensamblado**: lo usan `index.ts` (producción), el
simulador y las pruebas, así que el simulador ejercita exactamente el código de producción
cambiando solo lo externo (WhatsApp, y en fases siguientes BD y LLM).

Diferencias deliberadas con n8n ya resueltas en la Fase 1:

| n8n | Servidor |
|---|---|
| Sin verificación de firma de Meta | Firma HMAC obligatoria |
| Audio/ubicación/stickers se descartaban en silencio (edge-case 19) | Se contestan con un texto amable |
| Dos ejecuciones del mismo cliente podían correr en paralelo | Turnos en serie por teléfono |
| Buffer en tabla + Wait + cron de limpieza (BUG-053) | Buffer en memoria por teléfono |

## Simulador y escenarios

Los escenarios reemplazan a `qa/guiones-bot.md` de forma automatizada. Formato:

```yaml
nombre: Cobertura con errata
critico: true            # invariante de negocio: debe pasar en TODAS las corridas
telefono: "573000000901" # rango de prueba 5730000009xx (nunca un número real)
pasos:
  - envia: ["hola", "¿llegan a Niquía?"]   # varios seguidos = un turno
    debe:
      contiene: ["7.500"]
      no_contiene: ["sin problema"]
      coincide: "30.*45"   # regex, sin distinguir mayúsculas
      respuestas: 1        # número exacto de mensajes del bot
  - envia_boton: Confirmar
  - envia_imagen: { id: img-1 }
  - envia_tipo: audio
```

El esquema es **estricto**: una clave con errata hace fallar la carga en vez de "pasar" sin
verificar nada. Umbral: crítico = 100% de las corridas; normal = ≥ 90%.

Con `bot: decision` el escenario usa el clasificador real (necesita `OPENAI_API_KEY`; sin ella se
salta) y cada paso puede verificar la decisión del último turno:

```yaml
    debe:
      turno: { handler: pedidos, regla: "resumen:si", acciones: [crear_pedido], sin_acciones: [pasar_a_humano] }
```

**Fase 6 (2026-10-02)** agregó lo que hacía falta para pasar los guiones de `qa/guiones-bot.md`:

```yaml
datos: real              # menú, cobertura, info_negocio y FAQ REALES de Supabase (solo lectura)
cliente_registrado: true # el cliente ya existe con nombre_cliente (no se le pide el nombre)
pasos:
  - pide_calificacion: { pedido_id: PED-101 }   # pedido entregado + corre el job de calificaciones
  - envia: '5'
    debe:
      turno: { handler: feedback, accion: positiva }
      bd:                                      # la fila, no lo que el bot dijo
        modo: bot
        feedback: [{ pedido_id: PED-101, nota: 5 }]   # lista completa y en orden
        feedback_pendiente: false
        carrito: [Hawaiana]                    # nombres por línea, exacto ([] = vacío)
        carrito_solo: [Hawaiana, Pepperoni]    # ninguna línea fuera de esta lista (G1)
        carrito_total: 37500
        soporte_contiene: ['¿hola?']           # llegó al chat de Soporte
```

`datos: real` (`sim/datos-reales.ts`) solo llama tablas y funciones `STABLE` (`buscar_menu`,
`precio_producto`, `cotizar_mitad_y_mitad`, `consultar_cobertura`, `consultar_faq`): carrito,
pedidos, clientes y reservas siguen en memoria, así que la BD no se ensucia. Las reservas se quedan
en el catálogo del simulador porque su cupo cuenta reservas reales.

`npm run sim -- <filtro> --veces 1 --ver` imprime la conversación completa con las herramientas
que corrió cada turno (🔧) y los tokens gastados por paso y por corrida.

**Costo por turno:** cada llamada a OpenAI se anota en una "caja" por turno (`llm.ts ·
medirConsumo`, con `AsyncLocalStorage`), así que `bot_turnos.costo` guarda el total y el detalle
del clasificador, el agente (cada vuelta de herramientas) y la reescritura; antes solo guardaba el
clasificador.
También anota `tokens_cache` (lo que OpenAI sirvió de su caché de prefijos). Medido el 2026-10-02
con gpt-5.1: un turno de Menú con productos son ~9.000 tokens de entrada (clasificador + 3 vueltas
de Menú), pero **~92% viene del caché**; con salida de ~230 tokens, sale del orden de **US$0,004 por
turno** y ~US$0,015 un pedido completo. La salida pesa más que la entrada, así que recortar el
prompt de Menú movería poco; no se hizo.

## Variables de entorno

Ver `server/.env.example`. Obligatorias: `WA_VERIFY_TOKEN`, `WA_APP_SECRET` y, con
`WA_MODO=graph`, `WA_ACCESS_TOKEN` + `WA_PHONE_NUMBER_ID`. `WA_MODO=fake` no envía nada
(desarrollo). El proceso no arranca si falta algo (validación con zod en `src/config.ts`).
`OPENAI_API_KEY` es opcional: sin ella el bot arranca en modo eco (lo avisa en el log).
`HOOK_TOKEN` vacío = avisos de estado apagados (antes un `HOOK_TOKEN=` vacío impedía arrancar).
`DASHBOARD_ORIGENES`: orígenes del dashboard para `/api/wa` (CORS), separados por coma.

## Pendiente por fase

- **Fase 1 (esta):** ✅ probado contra WhatsApp real el 2026-09-29 con el número de pruebas de
  Plateo (322 681 7466, sin clientes reales), apuntando el webhook de Meta a un túnel
  `npx cloudflared tunnel --url http://localhost:3000`. Mientras el webhook apunta al servidor,
  n8n no recibe mensajes de ese número; volver = restaurar la URL de n8n en Meta. Si Meta dice
  "no se pudo validar", el log `verificación de Meta rechazada` indica si el token coincidió
  (registra solo su largo, nunca el valor). Falta: construir la imagen de Docker.
- **Fase 2:** ✅ RPCs y tablas aplicadas en la BD el 2026-09-29 (`docs/database.md` §RPC del
  servidor Node; QA 11 y 12 verdes). El servidor ya las usa: dedupe en capas (memoria →
  `wa_eventos`; si la BD falla se procesa igual para no perder mensajes) y un registro por turno
  en `bot_turnos` (clase `Turno` en `src/log/turnos.ts`: entrada, decisión, herramientas con
  resultado y duración, salida). Sin `SUPABASE_URL`/`SUPABASE_SECRET_KEY` arranca en modo
  desarrollo (memoria + log). Pruebas de integración en `test/integracion/` (se saltan sin claves).
- **Fase 3:** ✅ núcleo determinista (2026-09-29): modos, soporte, calificaciones, comprobantes,
  avisos de estado, historial. 86 pruebas (79 unitarias + 7 de integración contra Supabase real).
- **Fase 4:** ✅ (2026-09-30): clasificador, política (47 casos + barridos de invariantes),
  ejecutor, guardia, conversador. 172 pruebas (161 unitarias + 11 de integración) y
  `f4-decision-critica.yaml` (crítico) 5/5 con OpenAI real (`gpt-5.1`).
- **Fase 5:** ✅ (2026-09-30): los cuatro agentes, 312 pruebas (17 de integración contra Supabase).
  Con OpenAI real (`gpt-5.1`), tras el último cambio de política: los 9 escenarios `bot: decision`
  1/1, y los 5 críticos (`f4-decision-critica`, `f5-menu-preguntar-no-es-pedir`,
  `f5-pedidos-domicilio`, `f5-reservas-nueva`, `f5-soporte-reclamo`) + `f5-soporte-info` 5/5.
  `f5-reservas-cambios`, `f5-pedidos-casos-borde` y `f5-menu-armar-carrito` solo 1/1 tras el último
  cambio (antes 5/5 los dos últimos). **Falta** la primera prueba de Reservas en WhatsApp real: ver
  que la fecha que resuelve el clasificador ("el sábado") sea la correcta en hora Colombia.
  Regla de costo: iterar con `--veces 1` sobre los escenarios afectados; ×5 solo para cerrar.
- **Fase 6:** ✅ (2026-10-02): los guiones G1–G11 de `qa/guiones-bot.md` pasaron a 10 escenarios
  `f6-*` (mapa en la cabecera de ese archivo), varios contra los **datos reales** en solo lectura
  (`datos: real`). Los 19 escenarios con IA 5/5 con `gpt-5.1` el 2026-10-02 (G5 y G7 tras sus
  arreglos; tras la regla de masa y las respuestas fijas, los de Menú/Pedidos se repitieron 1/1).
  351 pruebas unitarias. Leer las conversaciones (`--ver`) destapó lo que el ×5 no veía:
  productos inventados (Stella), un `producto_id` adivinado, la masa cambiada en una mitad y
  mitad, "por aquí no se hacen reservas", la cobertura de Itagüí sin avisar, frases del modelo que
  contradecían el texto del código, y el horario o la cuenta negados 1 de 5 veces. Todo quedó en
  código (herramientas, guardia, respuestas fijas) con su prueba. Costo medido por escenario en la
  salida del simulador; `bot_turnos.costo` ahora guarda todo el turno.
  **Sigue pendiente** la prueba de Reservas por WhatsApp real (f5-6).
- **Fase 7:** ✅ código listo (2026-10-02), **se enciende en el corte**. `POST /api/wa`
  (`src/http/wa.ts`) recibe los envíos del dashboard con el JWT de la sesión: Supabase Auth valida
  el token (`auth.getUser`, nunca se lee del JWT a mano) y el rol sale de `perfiles` (activo).
  Texto libre solo admin; plantillas admin y mesero; tope de 30 envíos por minuto y usuario; el
  error de Meta vuelve tal cual al operador (502). CORS solo para `DASHBOARD_ORIGENES`. El dashboard
  (`src/lib/whatsapp.js`) usa el proxy si existe `VITE_WA_PROXY_URL`; si no, el envío directo de
  siempre. Verificado de punta a punta contra Supabase real con un usuario temporal (borrado al
  terminar) y WhatsApp en modo falso: domiciliario 403, mesero plantilla 200 / texto 403, admin
  texto 200, inactivo 401; y con proxy y sin token, el token no aparece en `dist/`. **En el
  corte:** `DASHBOARD_ORIGENES` en el VPS, `VITE_WA_PROXY_URL` en Vercel, borrar
  `VITE_WA_ACCESS_TOKEN` de Vercel y **rotar** el token en Meta (Clavo); después se puede quitar
  el camino directo de `whatsapp.js`.
- **Fase 8:** ✅ corte hecho el 2026-10-05 (ver arriba y `despliegue.md`). Pendiente: Vercel (`VITE_WA_PROXY_URL`, borrar `VITE_WA_ACCESS_TOKEN`, rotar el token en Meta), pruebas manuales, dump de Supabase.
