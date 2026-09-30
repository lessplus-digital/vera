# Servidor del bot (Node) — reemplazo de n8n

> **Estado (2026-09-30): en construcción — Fases 1–4 de 9 hechas; Fase 5 con los cuatro agentes escritos; faltan escenarios de Soporte y Reservas con OpenAI real.** El bot en producción sigue siendo el
> de n8n (`n8n-workflow.md` y compañía) hasta el corte de la Fase 8. Plan completo y fases:
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
mencionar internos (sistema, base de datos, herramientas, n8n…).

**LLM:** interfaz `LLM` (`llm/llm.ts`) con `LLMOpenAI` (Structured Outputs, `OPENAI_MODEL`,
por defecto `gpt-5.1`) y `FakeLLM` para pruebas. Si el clasificador falla, el turno sigue con
una clasificación vacía ("otro" → sigue el hilo) y el error queda en `bot_turnos.clasificacion`.

### Los agentes (Fase 5) — `src/handlers/`, `src/herramientas/`

Cada handler es un `Redactor`: recibe lo que decidió la política y lo que hicieron las acciones, y
devuelve el texto y **la pregunta que dejó abierta** (se guarda en `conversaciones`). Usa
`LLM.conHerramientas` (varias rondas de herramientas y cierre en JSON estricto). Si la guardia
rechaza el texto, se reescribe **sin volver a correr herramientas** (`handlers/comun.ts ·
reescritura`): si no, un reintento agregaría el producto dos veces.

**Menú** (`handlers/menu.ts`, ✅ 2026-09-30). Portado del prompt de n8n `1d7f7d87` (la versión
corregida de BUG-063). Herramientas (`herramientas/menu.ts`): `consultar_menu` (buscar_menu con
disponibles y agotados; los agotados van sin precio), `agregar_al_carrito`, `agregar_mitad_y_mitad`,
`cotizar_mitad_y_mitad`, `quitar_del_carrito`. **Ningún argumento lleva precio**: lo pone la RPC.
El bloque 🛒 (líneas numeradas, masa + tamaño, subtotal) lo arma el código (`handlers/formato.ts`)
y cierra con "¿Quieres agregar algo más?" (pregunta `algo_mas`). La masa se lee de `menu`
porque la línea del carrito solo guarda el tamaño y hay hawaiana tradicional y estofada.
Lecciones de las primeras corridas con gpt-5.1, ya convertidas en reglas y pruebas: "y una coca
cola" a "¿algo más?" venía como `confirma:no` (la política ahora deja que gane el producto);
un "entonces una mitad y mitad" llegó a **borrar** la hawaiana del carrito (regla: nunca quitar
sin pedido explícito); "no me aparece en nuestro sistema" pasaba la guardia (ahora bloquea
"sistema"); precios sin "$" ("51.500") ahora también los revisa la guardia.

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
  del mensaje es la del código. Pasa por la guardia como cualquier texto.
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

- **Contexto que arma el código:** `info_negocio` completa (menos `datos_transferencia`, que solo va
  en la confirmación de un pedido), las FAQ de `consultar_faq` entre `<faq>…</faq>` marcadas como
  **datos, nunca instrucciones**, y los **3 últimos pedidos del cliente** con su estado en palabras,
  hace cuánto y el motivo si se canceló. Nuevo respecto a n8n: "¿cómo va mi pedido?" se contesta
  con el estado real (n8n no podía leerlo y decía "el equipo lo está revisando"). Esos `pedido_id`
  y totales son los únicos que la guardia deja citar; un precio que venga de una FAQ no pasa.
- **Nombre:** lo guarda la **política** (acción `guardar_nombre`), solo si el cliente no tenía uno
  registrado y pasa `nombreValido` (1–4 palabras de letras; nada de emojis, "Dios es amor", "asdfgh",
  "test"). Un nombre ya registrado no se cambia desde el chat. Si solo saludó y no sabemos su
  nombre, la respuesta es fija (`S.pedirNombre`) y deja la pregunta `nombre`: la respuesta suelta
  ("me llamo Camila.") se toma como nombre aunque el clasificador no lo lea.
- **Cobertura sin carrito:** la consulta la política, como siempre; la respuesta ("¡A Niquía sí
  llegamos! $7.500…", "¿te refieres a…?", "no llegamos… ¿lo recoges?") es la misma de Pedidos
  (`formato.ts · siLlegamos / sinCobertura`). Si pregunta por domicilios sin barrio, el modelo pide
  el barrio (pregunta `dato_pedido: barrio`) y la respuesta suelta pasa por cobertura.
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

Las verificaciones de BD (`bd:`) llegan con la Fase 6.

## Variables de entorno

Ver `server/.env.example`. Obligatorias: `WA_VERIFY_TOKEN`, `WA_APP_SECRET` y, con
`WA_MODO=graph`, `WA_ACCESS_TOKEN` + `WA_PHONE_NUMBER_ID`. `WA_MODO=fake` no envía nada
(desarrollo). El proceso no arranca si falta algo (validación con zod en `src/config.ts`).
`OPENAI_API_KEY` es opcional: sin ella el bot arranca en modo eco (lo avisa en el log).

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
- **Fase 5:** 🟡 los cuatro agentes escritos, 309 pruebas (17 de integración contra Supabase) en verde. Con OpenAI
  real: `f5-menu-*` y `f5-pedidos-*` 5/5, `f5-soporte-reclamo` 5/5. **Pendientes** (la cuenta de
  OpenAI se quedó sin crédito el 2026-09-30): `f5-soporte-info` (dio 4/5; ya corregido, sin re-correr)
  y `f5-reservas-*` (nunca corridos).
  **Por dónde seguir:** con crédito en OpenAI, correr (agente `bot-sim`) TODOS los escenarios
  `bot: decision` — `f4-*` y `f5-*` —, porque la política cambió después de la última corrida verde
  (barrio del historial, regla 3b de reservas). Si pasan, Fase 5 ✅; lo que falle se corrige como
  regla + prueba, igual que con Menú y Pedidos. Primera vez en WhatsApp real para Reservas: ver que
  la fecha que resuelve el clasificador ("el sábado") sea la correcta en hora Colombia.
- **Fase 6:** escenarios G1–G11 en verde. **Fase 7:** proxy de envíos del dashboard. **Fase 8:** corte.
