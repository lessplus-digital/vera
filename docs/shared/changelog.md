# Changelog — Decisiones y Cambios

> Registra decisiones arquitectónicas y **bugs resueltos** (condensados por tema), no cada
> commit. Agrega al inicio (más reciente arriba). El detalle completo de cada bug (verificación,
> comandos, notas) vive en el git history de `bug-tracker.md` y en los docs de capa.

## Formato

```
### YYYY-MM-DD — Título
**Contexto:** Por qué se tomó la decisión
**Decisión:** Qué se decidió
**Impacto:** Qué archivos/componentes cambiaron
```

---
### 2026-09-01 (tarde) — Lo que salió de las pruebas en producción (BUG-037 y dos ajustes)

**Contexto:** dos conversaciones reales por WhatsApp contra el flujo nuevo. El bug original murió
—*"hola, para pedir una pizza a domicilio"* llegó al cierre sin que nadie repreguntara el tipo de
entrega, y una de las pruebas registró el pedido `PED-242` de punta a punta— pero salieron tres
cosas que la BD sola no podía atrapar.

**1. El orquestador quedó ciego (regresión del propio cambio de la mañana).** Darle `sessionKey`
propio lo sacó del ruido, pero también de las respuestas de los agentes, que es de donde salían
sus reglas de desambiguación. *"La milagrosa"*, respondiendo a *"¿en qué barrio estás?"*, se fue a
**menu** como *"posible producto sin contexto claro"*; *"así está bien"* con el carrito lleno,
igual, y la conversación **se quedó trabada sin que nadie pidiera los datos de entrega**. Se
arregló sin revertir: un nodo `Leer estado` consulta `estado_pedido` **antes** de clasificar, y las
reglas pasaron a decidir con `n_items` + `faltantes` en vez de con heurísticas sobre el historial.
Detalle en [`edge-cases.md#30`](edge-cases.md).

**2. BUG-037 — el Agente Menú improvisaba fuera de su alcance.** Pedía dirección y barrio, y llegó
a ofrecer *"¿efectivo o **tarjeta**?"* — **tarjeta no es un método de pago del negocio**. Su prompt
no menciona "pago" ni una sola vez: sin guardarraíl, el modelo no se calla, rellena. Se le puso un
**límite duro de alcance** (no pregunta tipo de entrega, barrio, dirección, método de pago ni con
cuánto paga; si el cliente los da, no los procesa) y tres prohibiciones nuevas, incluida la de
**anunciar lo que hará el siguiente agente** — ese *"ahora un compañero te va a pedir los datos"*
era justo lo que dejaba al cliente esperando un mensaje que nunca llega, porque el flujo avanza
cuando el cliente escribe, no solo.

**3. Un mensaje con varios datos de golpe.** *"cra 58C N23A 04, cabañítas, en efectivo"* capturó
barrio y método de pago, pero **volvió a pedir la dirección**: `direccion_entrega` no estaba en el
esquema de señales. Se agregó, con una lista blanca que **exige un dígito** (una dirección real
lleva número) para que una vaguedad como *"por ahí cerca al parque"* no entre como dirección
válida — verificado con 9 casos, incluido que un barrio suelto no se cuele. Y el Agente Pedidos
lleva ahora una regla de respaldo: **lee el mensaje del turno antes de preguntar**, porque
`faltantes` describe lo que había guardado, no lo que el cliente acaba de escribir.

**Impacto:** en n8n, nodos nuevos `Leer estado` y `Contexto orquestador`; prompts de `ORQUESTADOR`,
`AGENTE MENÚ` y `AGENTE PEDIDOS`; `Parse Orquestador` y `Guardar senales`.

**Resultado de la verificación final (3ª prueba, tel. …8122, pedido `PED-244`).** El flujo completo
corrió sin una sola repregunta:

| Turno del cliente | Qué hizo el bot |
|---|---|
| *"hola. para pedir un domicilio por favor"* | capturó `tipo_pedido: domicilio` y pasó a armar el carrito |
| *"dame 2 patatas mexicanas…"* | armó el carrito y cerró con *"¿Deseas agregar algo más o procedemos?"* — **sin** pedir datos de entrega (BUG-037 corregido) |
| *"asi está bien"* | → **pedidos** y preguntó el barrio. **No** repreguntó si era domicilio (el caso que trababa la conversación) |
| *"carrera 58CN23A 04 cabañas"* | capturó la dirección, cotizó Cabañas a $6.000 y saltó al pago. **No** volvió a pedir la dirección |
| *"efectivo"* | resumen correcto: $98.300 + $6.000 = **$104.300** |
| *"si asi está bien"* | creó `PED-244` — total en BD $104.300, `costo_domicilio` 6.000, barrio Cabañas. Exacto |

Los tres puntos de arriba quedan **verificados en producción**. El único defecto que sobrevive es
que el mensaje de cierre dice *"Tu número de pedido es #**no disponible en este momento**"*:
`Sub — Crear_orden_completa` nunca devolvió `pedido_id`, un desajuste **preexistente** entre ese
subworkflow y el PASO 5 del prompt, que ahora quedó a la vista. Registrado como **BUG-038** con el
fix y su trampa (no devolver el `total` de esa fila: en ese punto todavía no incluye el domicilio).

Los dos prompts largos se verificaron con un diff línea a línea contra la versión
anterior para descartar pérdidas al reescribirlos completos (la única diferencia incidental fue
una tilde que faltaba en `conocelas`).

---
### 2026-09-01 — El estado del pedido sale de la memoria del chat y pasa a la BD (BUG-035/036)

**Contexto:** el bot repreguntaba datos que el cliente ya había dado. Caso reportado: *"hola,
para pedir una pizza a domicilio"* → se arma el carrito → *"¿es para domicilio o lo recoges?"*.

**Diagnóstico — tres causas, no una.** (1) El prompt del Agente Pedidos se **contradecía**:
abría con *"no preguntes lo que ya sabes"* y diez líneas después ordenaba **`a) SIEMPRE
PREGUNTA Tipo de pedido`**; ganaba la orden más enfática. (2) El dato **ya no estaba en la
ventana**: las 5 memorias compartían `sessionKey = telefono`, así que por turno caían el
mensaje del cliente **duplicado** (lo escribían la cadena del orquestador y la del agente), el
JSON de clasificación como mensaje `ai`, y cada `tool_call` con su resultado — **~6 filas por
turno medidas sobre una sesión real**, o sea 3-5 turnos útiles con `k=10`. (3) **No existía
estado estructurado**: `tipo_pedido`, `barrio`, `direccion_entrega` y `metodo_pago` vivían solo
como texto en el historial, así que al caerse de la ventana se perdían. Los ítems sobrevivían
porque estaban en `carritos` — la jugada que ya funcionaba nunca se había aplicado al resto.

**Decisión — mover el estado a la BD, no alargar la ventana.** `carritos` gana las columnas
del flujo; la vista `estado_pedido` las expone junto a **`faltantes`**, la lista de lo que aún
falta preguntar, **calculada por la BD**; y `guardar_datos_pedido()` las escribe con semántica
COALESCE. El PASO 2 del prompt pasa a *"pregunta solo lo que venga en `faltantes`"*. Un trigger
sostiene las invariantes que el prompt no puede garantizar:
pasar a `recoger` limpia barrio/dirección/envío, y cambiar de barrio sin recotizar invalida la
tarifa anterior para que no se cobre la del barrio viejo.

**El saludo también cuenta.** Como el dato suele darse cuando todavía atiende Soporte o Menú,
el ORQUESTADOR pasa a emitir `senales` (`tipo_pedido`/`metodo_pago`/`barrio`) **solo cuando el
cliente los afirma**, con ejemplos explícitos de qué NO es señal (*"¿hacen domicilios?"*,
*"no, domicilio no"*). Se descartó hacerlo con regex en un Code node: un regex no distingue una
pregunta de una decisión y habría creado un bug peor —asumir el tipo de pedido—; el orquestador
ya lee cada mensaje y entiende la negación. `Parse Orquestador` filtra esas señales contra una
lista blanca antes de que toquen la BD.

**Descartado en el camino:** atar el gate PASO 3 → PASO 4 a `paso_flujo = 'resumen'` en la BD.
Sonaba coherente con el resto del cambio, pero metía un fallo duro —si el agente olvida marcar el
paso, el pedido no se puede crear **nunca**— para blindar algo que no estaba roto: ese gate solo
necesita recordar **un** turno, que sobra incluso con la ventana corta. Se revirtió antes de
publicar; `paso_flujo` se queda como campo informativo.

**De paso:** la memoria del orquestador pasa a `sessionKey = orq:<telefono>`, lo que duplica la
ventana útil de los agentes; `registrar_contexto_handoff()` se actualizó para leer las dos
sesiones, porque el contexto de escalada dependía justamente de que el orquestador escribiera
el turno del cliente antes de `solicitar_handoff`.

**Impacto:** migraciones `carritos_estado_flujo_pedido_columnas`,
`carritos_trigger_normalizar_estado`, `estado_pedido_vista_y_rpc`,
`handoff_contexto_lee_sesion_orquestador`, `guardar_datos_pedido_no_crea_fila_vacia`; en n8n
(**draft, pendiente de publicar**) los nodos `leer_carrito1`, `AGENTE PEDIDOS`, `ORQUESTADOR`,
`Parse Orquestador`, `Postgres Chat Memory` y los nuevos `guardar_datos_pedido`,
`Guardar senales` y `Contexto + estado`; `docs/database/schema.md`, `docs/bot/ai-agents.md`,
`docs/shared/bug-tracker.md`.

---
### 2026-09-01 — Usuarios sale de Configuración a tab propia, con contraseñas y foto

**Contexto:** gestionar usuarios era la sub-vista 8d de **Configuración**, junto a la información
del negocio, las zonas, las FAQ y las respuestas rápidas. Las otras cuatro editan **texto que el
bot recita**; esta reparte accesos. Escondida detrás de un sub-selector, la operación más delicada
del panel era la más difícil de encontrar. Además le faltaban dos cosas que el restaurante pedía a
mano por Supabase: **cambiar la contraseña** de alguien y **ponerle foto**.

**Decisión — tab propia (`usuarios`, solo admin), y el reparto de acciones dentro:** la FILA lleva
lo que se cambia de un golpe y en frío (rol, acceso); los MODALES lo que hay que escribir y
confirmar (identidad, contraseña). Así cada modal conserva su único botón primary (DS §3) y la
lista no tiene ninguno.

**La foto no necesitó nada nuevo en la BD.** Verificado en `pg_policies`: las tres políticas de
`storage.objects` sobre el bucket `avatares` ya llevaban `... OR es_admin()` desde que se creó
(2026-08-12), y `perfiles_update` ya aceptaba `es_admin()` sobre cualquier fila. El comentario de
`src/lib/avatares.js` decía que la política solo comparaba contra `auth.uid()` — **drift**,
corregido junto con `docs/database/schema.md` §Storage.

**La contraseña sí, y es la parte interesante.** Ponerle la contraseña a otra cuenta exige la Admin
API con `service_role`, que no puede viajar en el bundle (mismo motivo que el token de WhatsApp y
que el alta de usuarios). El camino barato —`resetPasswordForEmail`— **se descartó con datos**: de
los 5 usuarios, **3 tienen un email interno inventado** (un mesero y los dos domiciliarios), sin
bandeja donde recibir el enlace. Se creó la Edge Function **`admin-password`** con dos barreras:
`verify_jwt` en el gateway, y dentro la función llama a `mi_rol()` **con el token de quien llama**
— no lee el rol del JWT, donde no viaja y donde el cliente no es de fiar. El `service_role` se usa
solo para el `updateUserById` final.

**Alcance por rol:** la tab es solo del admin, así que "Mi perfil" (menú superior, el único punto
que todos comparten) gana **"Cambiar mi contraseña"** para el mesero y el domiciliario. Es el mismo
`PasswordModal`, con `auth.updateUser` en vez de la Edge Function — ese camino sí lo permite la
clave publicable. Abre su propio modal y no es un campo del formulario: se aplica al instante, sin
pasar por "Guardar", y con un campo ahí escribirla y salir con "Cancelar" haría creer que quedó
cambiada.

**Sigue sin haber botón "Crear usuario"** — el alta sigue exigiendo la admin API y la pantalla lo
explica. Se movió, no se resolvió.

**Impacto:** nuevos `supabase/config.toml` + `supabase/functions/admin-password/index.ts`,
`src/pages/users/` (`UsersPage` + `UserModal`), `src/components/PasswordModal.jsx`,
`src/lib/passwords.js`, `src/styles/users.less`; eliminado `src/pages/settings/UsersSection.jsx`
y su bloque `.us-*` de `settings.less`; tocados `useUsuarios`, `ProfileModal`, `Icon` (`shield`,
`key`, `eye`, `eye-off`), `Sidebar`, `Header`, `App`, `permisos.js`, `formatters.js`
(`nombreDeUsuario`), `avatares.js`, `SettingsPage`, `.gitignore`, `README.md`,
`docs/dashboard/components.md` y `docs/database/schema.md`.

**Despliegue:** la función **no** se despliega con `npm run build`. Requiere
`npx supabase login` → `npx supabase link --project-ref lwigogymjoyyzwiyewgi` →
`npx supabase functions deploy admin-password`. Hasta entonces, el botón de contraseña de la tab
Usuarios responde con error; el resto de la pantalla funciona.

---
### 2026-08-25 — El bot prometía domicilio a otros municipios (BUG-033)

**Contexto:** «¿Tienes servicio en Envigado?» → *«Sí Juan, sí te llegamos a Envigado 🙌 El domicilio
te queda en $5.000 y el tiempo estimado de entrega es de 30 a 45 minutos.»* Igual con Sabaneta y
con Apartadó, que ni siquiera es del Valle de Aburrá. Vera solo reparte en Bello.

**Diagnóstico:** la herramienta nunca se equivocó — `consultar_cobertura('envigado')` devolvía
`cubierto:false` desde el primer día, y el matcher tiene **cero falsos positivos** sobre 12
municipios de fuera. Lo que mentía era el prompt, y a propósito: la decisión (c) del 2026-08-18
le ordenaba al agente ignorar el `false` y cobrar la tarifa base *«mientras el restaurante termina
de cargar sus barrios»*. Esa premisa venció cuando se cargaron los 58 barrios de Bello, y nadie
volvió al párrafo.

**Decisión — arreglarlo en dos capas, no en una.** La herramienta deja de dar munición: con
`cubierto:false` la RPC devuelve `costo_domicilio` y `tiempo_estimado` en **NULL a propósito**, más
`mensaje` (qué hacer) y `sugerencias` (hasta 3 barrios con `similarity ≥ 0.40`, para erratas como
`niqia` → Niquía; el umbral es alto para que `sabaneta` **no** sugiera `Sabanalarga`). Y los cuatro
textos de n8n dejan de contradecirla: `cubierto=false` significa sin domicilio, con la alternativa
de recoger en el local. Dos capas porque una sola no basta: si mañana el prompt se tuerce otra vez,
ya no hay número que cantar.

**De paso:** el barrio `centro` no existía en el catálogo. Quien decía «estoy en el centro» caía en
el no-match, y el bug lo tapaba cobrándole la tarifa base — que por casualidad es la misma tarifa
de la zona Centro. Agregado a la zona Centro ($5.000).

**Impacto:** migraciones `bug033_cobertura_no_promete_fuera_de_bello` y
`bug033_cobertura_sugerencias_umbral`; nodos `consultar_cobertura`, `consultar_cobertura1`,
`AGENTE PEDIDOS` y `AGENTE SOPORTE` en n8n (publicados y releídos del workflow);
`docs/database/schema.md`, `docs/bot/agent-prompts.md`, `docs/bot/ai-agents.md`,
`edge-cases.md` §27, `backlog.md`.

**Verificado:** 10 municipios de fuera (Envigado, Sabaneta, Apartadó, Medellín, Itagüí, Copacabana,
Rionegro, La Estrella, Caldas, Bogotá) → `cubierto:false` sin tarifa; variantes de Bello (`la mila`,
`trebol`, `zamorra`, `provincia`, `pachely`, `centro`, `el centro`, `centro de bello`) → cubiertas
con su zona correcta; `niqia` → sugiere Niquía. Falta la prueba por WhatsApp (en observación).

---

### 2026-08-25 — El MCP nativo de n8n destraba las escrituras (BUG-030 degradado)

**Contexto:** desde el 2026-08-18, **toda** escritura por API sobre `Pizzeria Vera` rebotaba con
`request/body/settings must NOT have additional properties`: el `PUT` de la API pública v1 reenvía
`settings`, y ahí viajan `binaryMode`, `timeSavedMode` y `callerPolicy`, que su esquema no admite.
Cuatro vías de arreglo probadas y descartadas con evidencia. Consecuencia: cada cambio del bot se
hacía a mano en el editor, con el riesgo de transcripción que eso trae — un error de copiado en el
PASO 5 llegó a cobrar el domicilio dos veces.

**Decisión:** configurar el **MCP nativo de n8n** (`n8n-native`, `/mcp-server/http`) junto al
`n8n-mcp` de la comunidad, que se queda para lecturas y docs de nodos. El nativo escribe por el
SDK de n8n con operaciones granulares (`updateNodeParameters`, `setNodeParameter`,
`setNodeSettings`) y no toca el endpoint que rebotaba. Trae además historial de versiones y
`restore_workflow_version`, o sea que una edición mala se revierte.

**Impacto:** `.mcp.json` (git-ignored, con el token) y `.mcp.json.example`. BUG-030 pasa de 🔴 Alta
a 🟢 Baja: el bug sigue existiendo en la vía `n8n-mcp` (npx), pero dejó de bloquear. Las 4 ediciones
de BUG-033 fueron los primeros cambios aplicados por API desde que existe el bug.

---

### 2026-08-21 — Un carrito abandonado bloqueaba al cliente para siempre (BUG-032)

**Contexto:** a un cliente con una fila vieja en `carritos`, el bot le anunciaba *"te dejo agregada
1 Vera Pizza estofada familiar"* y el producto nunca entraba; al confirmar, el Agente Pedidos
respondía correctamente *"No tienes un pedido armado todavía"* y el cliente quedaba en bucle.

**Diagnóstico:** `crear_carrito` era un `POST` plano contra `/rest/v1/carritos` y la tabla tiene
`PRIMARY KEY (telefono)`. Con la fila ya existente, PostgREST devolvía conflicto y el nodo quedaba
en `status: error` **dentro de una ejecución que terminaba en `success`** — invisible en la lista de
ejecuciones. Y el Agente Menú no miraba el resultado de la tool, así que el fallo era
indistinguible de un éxito para el cliente. El sub-workflow solo borra el carrito cuando el pedido
se crea con éxito, así que cualquier conversación abandonada dejaba la fila.

**Tercer hallazgo, el que no estaba en el reporte:** el "job opcional que borre carritos sin
actividad en 24h" **ya existía** (`limpiar_carritos_abandonados()`, pg_cron `0 8 * * *`, en
`succeeded` desde hacía semanas) y estaba roto. `carritos.updated_at` tenía `DEFAULT now()`, que
solo aplica al INSERT: sin trigger, y con el `PATCH` de `actualizar_carrito` mandando solo `items` y
`total`, el valor era la fecha de **creación** congelada. El `WHERE updated_at < now() - interval
'24 hours'` decía "creado hace más de 24h", no "sin actividad en 24h".

**Decisión — tres capas:**
1. **n8n `crear_carrito`:** header `Prefer` → `resolution=merge-duplicates,return=representation`.
   El POST pasa a ser upsert sobre la PK y deja de fallar. Method sigue en `POST`.
2. **n8n Agente Menú:** bloque nuevo *"NUNCA ANUNCIES UN CARRITO QUE LA TOOL NO CONFIRMÓ"* + una
   línea en `PROHIBIDO`. Misma regla que ya tenía el Agente Pedidos para `crear_orden_completa`.
3. **BD:** migración `bug032_carritos_touch_updated_at` — trigger `trg_carritos_touch_updated_at`
   BEFORE UPDATE, para que la ventana de 24h mida lo que dice medir.

Los dos cambios de n8n se aplicaron **a mano en el editor**: BUG-030 sigue bloqueando la API
(recomprobado con un `patchNodeField` de un solo header, mismo
`request/body/settings must NOT have additional properties`).

**Verificación:** síntoma reproducido en BD (segundo INSERT plano sobre la misma PK →
`unique_violation`; el mismo INSERT como upsert `on conflict` → OK). Trigger comprobado en dos
transacciones separadas (`now()` es fijo dentro de una): `updated_at` pasó de `17:08:35` a
`17:08:38`. Los dos cambios de n8n releídos de la **versión publicada** del workflow
(`activeVersionId f729a914`), no del editor. Fila de prueba borrada; `carritos` en 0 filas.
Falta la prueba con tráfico real → queda en "En observación".

**Impacto:** `docs/bot/agent-prompts.md` (Agente Menú re-extraído verbatim), `docs/bot/ai-agents.md`,
`docs/database/schema.md` (tabla `carritos` + triggers), `docs/shared/edge-cases.md` (#26).
**Sin cambios en el dashboard.** Queda en el backlog fundir `crear_carrito` y `actualizar_carrito`
en una sola tool, que con el upsert ya hacen lo mismo.

### 2026-08-19 — Pedido fantasma: una confirmación mal enrutada y un carrito vacío que no frenó

**Contexto:** primera prueba real de las zonas por WhatsApp. Una conversación (CLI-038) fluyó bien;
la otra (CLI-039) llevó al cliente por barrio, dirección, costo de envío y método de pago para una
pizza **que nunca entró al carrito**, y solo al cuarto mensaje respondió "No tienes un pedido
armado todavía".

**Diagnóstico (ejecuciones 12702, 12706, 12708, 12712, 12714, 12716 + `carritos`):** la
confirmación *"Si confirmo"* respondía a una pregunta del **Agente Menú**, pero el Orquestador la
mandó a **pedidos** porque `"sí confirmo"` estaba en su lista literal de frases. Sin ese paso por
menú, nadie llamó `actualizar_carrito`. El carrito quedó con `items: []` (lo había creado
`crear_carrito`), y el Agente Pedidos —que distingue "no existe" de "existe vacío"— siguió el flujo
sacando el producto de la **memoria de conversación**. En dos de las cuatro ejecuciones ni llamó
`leer_carrito1`.

**Decisión:** dos prompts reescritos y aplicados a mano (BUG-030). Orquestador: una confirmación se
clasifica por **a qué pregunta responde**, hablar de un producto no es un carrito armado, y cambiar
la dirección con un pedido en curso es "pedidos" (se verificó que rebotaba a "soporte" y volvía).
Agente Pedidos: `items: []` **es** carrito vacío, `leer_carrito1` en cada turno, y prohibido deducir
los items de la conversación.

**Lo que NO falló:** `consultar_cobertura` se llamó y respondió bien — el $5.000 salió de la tool
(dedujo "la Milagrosa" de la dirección registrada → zona Centro), no fue inventado. Las zonas no
estaban implicadas.

**Validado en vivo el mismo día (ejecución 12734):** con el carrito en `items: []`, el Agente
Pedidos respondió *"ahora mismo no tienes un pedido armado en el sistema"* en vez de inventarse el
producto y seguir pidiendo barrio y método de pago. La guarda del PASO 1 funciona.

**Sin probar todavía:** el fix de ruteo del Orquestador (la confirmación de producto que debe
volver a "menu"). En la conversación de prueba no hubo paso de confirmación de producto, así que
esa rama no se ejercitó.

**Pendiente:** sigue sin registrarse ningún pedido nuevo, así que la comprobación de total
anunciado vs `pedidos.total` con una zona distinta de $5.000 continúa sin hacerse — ahora
bloqueada por BUG-032. Ver edge-cases §25.

---

### 2026-08-19 — Bello cargado: 5 zonas, 58 barrios, y el bot cobrando por zona de verdad

**Contexto:** las zonas existían pero la tabla estaba vacía salvo la tarifa base, así que
`consultar_cobertura` devolvía `cubierto:false` + $5.000 para todo. La función estaba viva pero
dormida.

**Decisión:** cinco tarifas por distancia real al local (Barrio La Mesa, junto al Parque de Bello):
Centro $5.000 (10 barrios) · Bello cercano $6.000 (12) · Niquía y oriente $7.500 (10) · Ladera y
norte alto $9.000 (13) · Corregimientos y veredas $10.000 (12). El precio vive en la **zona**, no
en el barrio: subir tarifas son 5 ediciones, no 57.

**Verificado:** `consultar_cobertura` resuelve tildes, mayúsculas, el prefijo "barrio " y
abreviaturas ("sta ana" → Santa Ana, "NIQUÍA" → Niquía) contra los 57 barrios reales. Lo no
mapeado (Envigado, "poblaod") cae en tarifa base sin rechazar el pedido, como se diseñó.

**Falso positivo detectado y resuelto:** la regla de subcadena de `resolver_barrio` hacía que un cliente
que respondiera solo **"Bello"** matcheara **"Puerto Bello"** y se le cobraran $7.500. Se agregó
`Bello` como barrio de Centro: el match exacto le gana a la subcadena, así que ahora cae en $5.000
y "Puerto Bello" sigue en $7.500 (verificado). Total: 58 barrios.

**De paso — pegado masivo de barrios:** el input de cada zona agregaba **uno a la vez**, con un
round-trip por barrio. Ahora acepta una lista separada por coma en un solo `upsert`
(`addBarrio` → `addBarrios` en `useDeliveryZones.js`), reporta `"3 agregados · 1 ya estaba"` y no
mueve en silencio un barrio que ya viva en otra zona.

**Impacto:** datos (`zonas_entrega`, `barrios`) + `useDeliveryZones.js`, `DeliveryZonesSection.jsx`
y `settings.less`. Sin cambios de esquema.

---

### 2026-08-18 — Zonas de domicilio con tarifa por barrio

**Contexto:** el costo del domicilio era la constante `costo_domicilio NUMERIC := 5000` escondida
dentro de `actualizar_total_pedido()`, y las "zonas" eran dos strings sueltos de `info_negocio`
(`zona_delivery`, `costo_delivery`) que el bot solo podía recitar. Verificado antes de tocar nada:
`costo_delivery` estaba **vacío**, así que el bot nunca tuvo de dónde sacar el precio del envío —
lo recitaba desde el prompt, donde `$5.000` aparecía quemado en 6 sitios.

**Decisión (a) — el costo baja a una columna.** `pedidos.costo_domicilio` (+ `barrio` y `zona`).
El total deja de ser una caja negra: se puede desglosar, exportar y cuadrar el arqueo sin
despejarlo restando. `editar_pedido` y `EditOrderModal` dejan de inferir el recargo como
`total − suma de ítems`, un despeje que con tarifa variable daba un número distinto por zona.

**Decisión (b) — el catálogo son dos tablas, no una.** `zonas_entrega` (la tarifa) + `barrios`
(cuelgan de una zona), calcado de `motivos_reserva` + `reservas.costo_motivo`: el precio lo copia
un trigger (`trigger_tarifa_domicilio`), nunca quien inserta, y lo que queda en el pedido es una
foto. Cambiar una tarifa no reescribe pedidos viejos.

**Decisión (c) — un barrio sin mapear NO rechaza el pedido.** Cae en la zona `es_base` (sembrada
en $5.000, exactamente lo que se cobraba antes) y `pedidos.zona` queda NULL. Esto también hace que
el despliegue sea seguro en cualquier orden: mientras el bot todavía no mande el barrio, todo se
comporta igual que ayer. La zona base está protegida contra borrado y desactivación porque sin
ella ese caso cobraría **$0**. Los barrios no mapeados afloran en Configuración → Zonas como
"Barrios sin zona", con cuántos pedidos llegaron de cada uno.

**Decisión (d) — `barrio` va desnormalizado en `pedidos`** (texto, sin FK), como
`detalle_pedidos.nombre_producto`: el domiciliario tiene que poder leerlo aunque el admin después
renombre, reasigne o borre el barrio. La FK va en `zona`, que es lo que sirve para agrupar.

**Backfill:** los 82 domicilios históricos con recargo exacto de $5.000 quedaron con
`costo_domicilio = 5000`; `total` no se tocó, así que **ningún total cambió un peso**. Verificado
con 9 escenarios en una transacción revertida (match sucio, cambio de zona, errata, barrio sin
mapear, override manual, paso a recoger, borrado de ítem, y un pedido histórico sin ítems).

**Impacto:** BD — 5 migraciones (`zonas_entrega_y_barrios`, `pedidos_barrio_y_costo_domicilio`,
`tarifa_domicilio_variable_en_totales`, `rpc_consultar_cobertura`,
`retirar_zona_y_costo_delivery_de_info_negocio`). Dashboard — `useDeliveryZones` (+
`useBarrioOptions`), `DeliveryZonesSection`, `ZoneModal`, y cambios en `SettingsPage`,
`BusinessInfoSection`, `CreateOrderModal`, `EditOrderModal`, `OrderCard`, `OrderDetailModal`,
`ClientModal`, `useClients`, `useOrders`, `useOrderHistory`, `useDeliveryHistory`,
`exportHistory`. Bot — `Sub — Crear_orden_completa` acepta y propaga `barrio`.

**Cerrado el 2026-08-19 — el bot ya cobra por zona.** El workflow principal se editó **a mano en
n8n** (BUG-030 sigue bloqueando la API, así que no hubo alternativa): se crearon
`consultar_cobertura` (→ Agente Pedidos) y `consultar_cobertura1` (→ Agente Soporte), ambos
`HTTP Request Tool` contra `/rpc/consultar_cobertura`; el prompt del Agente Pedidos ahora pide el
barrio y usa el `costo_domicilio` devuelto; el de Soporte dejó de prometer zonas vía `info_local`.
Verificado leyendo el workflow real por MCP (103 nodos, tools colgadas por `ai_tool` del agente
correcto). Prompts sincronizados en [`agent-prompts.md`](../bot/agent-prompts.md).
También quedó cableado el opcional que faltaba: `Edit Fields` pasa `barrio`, `Parse Orquestador` lo
expone como `barrio_registrado` y el Agente Pedidos lo confirma (*"¿Sigues por el barrio …?"*) en
vez de repreguntarlo, igual que ya hacía con `direccion_registrada`.

**De paso:** arreglado un bug latente en `actualizar_total_pedido()` — usaba `NEW.pedido_id`, que
en un `DELETE` es NULL, así que **borrar un ítem nunca recalculaba el total**. Ver edge-cases §22.

---

### 2026-08-12 — Historial de entregas del domiciliario

**Contexto:** el repartidor solo veía sus entregas activas — `useOrders` trae el día de negocio
actual y estados vivos, así que lo entregado desaparecía de su pantalla. No tenía forma de ver lo
que había hecho, ni el admin de evaluarlo.

**Decisión (a) — un componente, dos entradas:** `DeliveryHistory` lo usa el repartidor en su
sub-vista Historial y el admin desde Configuración → Usuarios. La diferencia es el prop
`domiciliarioId`. **El componente no comprueba rol**, y es correcto: `pedidos_select` ya decide qué
filas existen para quien mira. Si un domiciliario pasara el id de otro, vería una lista vacía.

**Decisión (b) — `resumen_entregas` es SECURITY INVOKER**, al revés que el resto de RPC de este
esquema. Al heredar la RLS de `pedidos`, la autorización sale gratis: no hace falta un chequeo de
rol propio porque las filas ajenas sencillamente no existen para quien pregunta. Verificado — el
repartidor pidiendo el resumen de otro recibe ceros, no un error.

**Decisión (c) — el resumen no se calcula en el cliente:** la lista está paginada de 20 en 20 y
sumar solo lo cargado daría un total que crece al hacer scroll. Por eso el agregado va por RPC
sobre todo el período.

**Detalle:** se filtra y ordena por **`fecha_entrega`** (timestamptz), no por `fecha_pedido`
(timestamp sin tz con valor UTC) — lo que se mide aquí es cuándo se entregó, no cuándo se pidió.
Y un `useRef` de nº de petición descarta respuestas tardías, para que cambiar rápido de período no
deje pintada una consulta vieja.

**Impacto:** migración `historial_entregas_resumen` · `src/hooks/useDeliveryHistory.js` ·
`src/pages/deliveries/DeliveryHistory.jsx` · `DeliveriesPage` (segmentado Activas/Historial, con
las activas extraídas a `VistaActivas`) · `UsersSection` (botón *Ver entregas* + modal) ·
`deliveries.less`, `settings.less`.

---

### 2026-08-12 — Usuarios, roles y perfiles · Etapa 3: perfiles y gestión de usuarios

**Contexto:** con las etapas 1 y 2 los roles ya funcionaban, pero el rol solo se cambiaba con un
`UPDATE` a mano sobre `perfiles` y nadie podía poner su nombre ni su foto.

**Decisión (a) — bucket `avatares` propio, no reutilizar `comprobantes`:** ese tiene una política
de INSERT para `anon` (la usa el bot al guardar comprobantes de transferencia) y meter ahí los
avatares les habría dado esa misma puerta. Público en lectura, como `comprobantes`: es la foto de
un empleado y las URLs firmadas obligarían a renovarlas en cada render. **La ruta es el permiso**
(`<usuario_id>/<timestamp>.<ext>`; las políticas comparan `foldername(name)[1]` con `auth.uid()`),
y el tamaño y el tipo los valida el **servidor** vía `file_size_limit` / `allowed_mime_types` — el
formulario valida lo mismo, pero eso es cortesía.

**Decisión (b) — "Mi perfil" en el menú superior, no en Configuración:** el domiciliario no tiene
esa tab y también necesita nombre y foto. El menú de la barra superior es el único punto que los
tres roles comparten.

**Decisión (c) — la lista de usuarios va por RPC:** el email vive en `auth.users`, que PostgREST no
expone ni debe. Se descartó denormalizarlo en `perfiles` —un duplicado que se desincroniza el día
que alguien cambie de correo— a favor de `listar_usuarios()`, `SECURITY DEFINER` y admin-only.

**Decisión (d) — sin botón "Crear usuario", y explicado en pantalla:** el alta exige la admin API
con `service_role`, que no puede viajar en el bundle. Las cuentas se crean en Supabase y aparecen
al instante como `domiciliario` (rol de menor alcance) vía `trigger_crear_perfil`; el panel solo
reparte permisos. La pantalla lo dice en vez de dejar al admin buscando el botón.

**Detalle que no es obvio:** editarse el rol a uno mismo se bloquea en la **UI**, no en la BD. El
trigger solo impide quedarse *sin* admin, así que con dos admins uno podía degradarse y perder el
acceso de golpe sin aviso.

**Verificación** (suplantación por API, igual que las etapas anteriores): un domiciliario recibe
42501 al llamar `listar_usuarios()`, edita su propio perfil (1 fila) pero el de otro afecta 0;
sube a su carpeta del bucket pero a la de otro y a `comprobantes` recibe 42501; el admin lista,
cambia rol y desactiva, y degradar o borrar al **último admin activo** rebota con 23514.

**Impacto:** migraciones `roles_etapa3_bucket_avatares` y `roles_etapa3_listar_usuarios` ·
`src/lib/avatares.js` · `src/components/Avatar.jsx` + `ProfileModal.jsx` · `src/hooks/useUsuarios.js`
· `useAuth().actualizarPerfil` · `src/pages/settings/UsersSection.jsx` + `SettingsPage` (4ª
sub-vista) · `Header` (Mi perfil + avatar real) · `settings.less`, `index.css` (`.admin-avatar`
sustituida por `.avatar`, compartida).

---

### 2026-08-12 — Usuarios, roles y perfiles · Etapa 2: asignación y entregas

**Contexto:** con la Etapa 1 la BD ya distinguía los tres roles, pero la UI seguía siendo la de un
solo admin: no había forma de asignar un domicilio, y un domiciliario veía el kanban con botones
que la RLS le rechazaba en silencio.

**Decisión (a) — el domiciliario no opera un kanban:** las cuatro columnas son flujo de cocina.
`DeliveriesPage` lo sustituye en la misma tab: una columna, la **dirección** como elemento más
grande, el teléfono como `tel:` y el cobro resaltado **solo si es efectivo** — el único dato que si
se lee mal cuesta dinero. Entregar pide confirmación en dos pasos, y cuando es efectivo el texto
pregunta por el monto ("¿Recibiste $48.000 en efectivo?"): el botón vive en un bolsillo, en una
moto, y marcar entregado no tiene deshacer.

**Decisión (b) — la entrega va por RPC para TODOS los roles:** para el domiciliario es obligatorio
(no tiene política de UPDATE). Para admin y mesero, que sí podrían hacerlo directo, se usa igual
para no mantener dos caminos que puedan divergir. De paso desapareció el `fecha_entrega` que el JS
mandaba a mano: lo pone `trigger_fecha_entrega`, y era la misma verdad escrita dos veces.

**Hallazgo — el mesero podía asignar domiciliarios.** La UI se lo ocultaba, pero el mesero
necesita `UPDATE` sobre `pedidos` para el flujo de cocina y **las políticas RLS no limitan por
columna**: un `PATCH /rest/v1/pedidos {"domiciliario_id": "..."}` le reasignaba el reparto.
Verificado antes de arreglarlo (afectaba 1 fila). Se cerró extendiendo
`trigger_validar_asignacion` para exigir `es_admin()` cuando la asignación cambia — con la guarda
de no estorbar al mesero moviendo estados de un pedido ya asignado, comprobado que sigue pudiendo.
Es la tercera vez que aparece el mismo patrón (`perfiles.rol`, `pedidos` del domiciliario,
ahora esto), así que quedó como tabla propia en `schema.md`: **cuando la regla es "esta COLUMNA
solo la toca este rol", la frontera es un trigger, no una política.**

**Impacto:** migración `roles_etapa2_asignacion_solo_admin` · `src/hooks/useDomiciliarios.js` ·
`src/pages/dashboard/AssignCourier.jsx` · `src/pages/deliveries/DeliveriesPage.jsx` +
`src/styles/deliveries.less` · `OrderCard`/`OrderActions`/`Column`/`DashboardPage` (rol desde el
contexto, entrega por RPC) · `useOrders` (`domiciliario_id` + `clientes(nombre)` embebido) ·
`Header`/`Sidebar` (etiquetas y stats por rol; el menú de usuario ahora muestra el nombre de
`perfiles` y el rol real en vez de "Vera Pizzería" fijo) · `orders.less`.

---

### 2026-08-12 — Usuarios, roles y perfiles · Etapa 1: el cimiento de seguridad

**Contexto:** el restaurante necesita varios empleados sobre el mismo dashboard con alcances
distintos (admin / mesero / domiciliario). El punto de partida era peor de lo que parecía: las 16
tablas tenían **una sola política**, `auth_full_access` = `to authenticated using(true)`. No había
nada que extender — cualquier sesión podía todo. Y como el JWT viaja en cada llamada REST y de
realtime, filtrar el kanban en React habría sido decorado: un domiciliario pidiendo
`GET /rest/v1/pedidos?select=*` se leía el restaurante entero.

**Decisión (a) — sin `restaurante_id`:** la tarjeta pedía "tabla de usuarios **por restaurante**",
pero el modelo multi-tenant acordado (2026-06-19) es **un proyecto Supabase por cliente**. La
tenencia ya está resuelta por aislamiento físico; añadir la columna habría contradicho la
arquitectura. `perfiles` es 1:1 con `auth.users` de ESTE proyecto.

**Decisión (b) — el rol se lee de la BD, no del JWT:** `public.mi_rol()` (`STABLE SECURITY
DEFINER`) es la fuente única para políticas y para la UI. Se evaluó meterlo en el JWT con un
custom access token hook (más rápido, evita el lookup); se descartó porque se configura fuera de
SQL y no se puede versionar como migración. `SECURITY DEFINER` no es opcional: leer `perfiles`
desde las políticas *de* `perfiles` da recursión infinita. Devuelve NULL sin sesión, sin perfil o
inactivo — **el modelo falla cerrado**.

**Decisión (c) — la entrega va por RPC, no por política de UPDATE:** es el punto que más
fácilmente se hace mal. **RLS filtra FILAS, no COLUMNAS.** Un `for update using (domiciliario_id =
auth.uid())` habría dejado al domiciliario mandar `total = 0` o `estado_pago = 'confirmado'` en su
propia fila, con la política autorizándolo porque efectivamente es suya. Por eso el domiciliario
**no tiene política de UPDATE** sobre `pedidos` y su única escritura es `marcar_entregado()`.
El mismo razonamiento en `perfiles`: `trigger_proteger_perfil` impide que un usuario se suba el
`rol` en el mismo UPDATE con el que edita su nombre.

**Hallazgo — `editar_pedido` era un agujero abierto:** es `SECURITY DEFINER`, así que **salta
RLS**, y no tenía ningún chequeo de autorización. Cualquier usuario autenticado podía reescribir
los ítems de cualquier pedido llamándola por REST, y ninguna política lo habría impedido. Se le
añadió el guard de rol y el `set search_path = public` que le faltaba. Lección general anotada en
`schema.md`: **una función `DEFINER` no está protegida por la RLS; tiene que autorizar sola.**

**Verificación:** no se dio por buena la teoría. Se crearon usuarios reales de prueba y se
suplantaron por API (`set local role authenticated` + `request.jwt.claims`) sobre los 105 pedidos
reales: el domiciliario ve 2 de 105 pedidos, 2 de 33 clientes y 3 de 196 líneas; 0 en soporte,
reseñas y reservas; su `UPDATE` sobre su propio pedido afecta **0 filas**; la escalada a admin,
`editar_pedido` y marcar una entrega ajena devuelven **42501**; marcar la suya funciona y el
trigger pone `fecha_entrega`. El admin no perdió nada. Tabla completa en `schema.md`.

**Impacto:** migraciones `roles_etapa1_perfiles_y_helpers`, `roles_etapa1_rpc_marcar_entregado`,
`roles_etapa1_rls_por_rol` · `src/utils/permisos.js` (mapa rol→tabs/capacidades, explícitamente
subordinado a la RLS) · `src/hooks/useAuth.jsx` (carga el perfil + realtime del propio rol) ·
`src/App.jsx` (espera al perfil, pantalla "sin acceso", gate por tab) ·
`src/components/layout/Sidebar.jsx` (navegación filtrada + rol visible).

**Pendiente (etapas 2 y 3):** UI de asignación pedido→domiciliario y acciones del kanban por rol;
perfil con foto (bucket + políticas de Storage); CRUD de usuarios en Configuración. El rol
**mesero** queda definido y operativo sobre pedidos, pero su parte de salón depende de PLATEO-52,
que hoy no existe (`tipo_pedido` sigue con CHECK `domicilio|recoger`).

---

### 2026-08-12 — Respuestas rápidas en el chat de soporte

**Contexto:** atendiendo un handoff el operador teclea los mismos cuatro o cinco mensajes todo el
día ("ya salió tu domicilio", "confírmame la dirección"). En hora pico eso es tiempo perdido y
erratas. No estaba en el backlog; sale de la operación.

**Decisión (a) — en la BD, no en `constants.js`:** tabla `respuestas_rapidas` (migración
`crear_respuestas_rapidas`) administrada desde **Configuración → Respuestas rápidas**, tercera
sub-vista junto a Información del negocio y Preguntas frecuentes. Hardcodear el array habría sido
más rápido, pero cambiar un texto exigiría redeploy y rompería el mismo modelo multi-tenant que
motivó `info_negocio` y `faq`. La tabla calca a `faq` (`RR-###`, CHECK de longitud, trigger de
normalización, RLS `auth_full_access`) y añade un **índice único sobre `lower(btrim(atajo))`**:
dos chips con la misma etiqueta serían indistinguibles en el chat.

**Decisión (b) — el chip ESCRIBE, no envía:** un clic inserta el texto en el input, en la posición
del cursor, y el operador lo revisa y presiona Enviar. Enviar de golpe era más veloz pero un clic
accidental sale a WhatsApp sin vuelta atrás, y `sendMessage` ya es best-effort contra la Graph API.

**Decisión (c) — un solo marcador, `{nombre}`:** cada marcador extra es un dato que puede faltar al
enviar y dejar un `{algo}` crudo delante del cliente. `aplicarNombre()`
(`src/utils/quickReplies.js`) usa el **primer** nombre y, cuando el cliente no tiene nombre
registrado, **borra el marcador junto con la coma que lo sigue** — "Hola {nombre}, tu pedido…"
queda "Hola, tu pedido…", no "Hola , tu pedido…" ni "Hola cliente,".

**Decisión (d) — sin `faqLint` aquí, a propósito:** es la primera de las tablas editables que **no
lee el bot**. El texto lo envía una persona que además puede editarlo antes de mandarlo, así que
nunca entra al contexto de un agente y las guardas anti-inyección de `faq` no aplican. Queda
anotado en `schema.md`: si algún día el bot llegara a leerla, ese razonamiento se cae y hay que
ponerle el lint.

**Impacto:** migración `crear_respuestas_rapidas` · `src/hooks/useRespuestasRapidas.js` ·
`src/utils/quickReplies.js` · `src/pages/settings/QuickRepliesSection.jsx` + `QuickReplyModal.jsx`
· `SettingsPage.jsx` (3 sub-vistas) · `src/pages/support/SupportPanel.jsx` (chips + `autoResize`
unificado en un `useEffect`: el textarea no se encogía al enviar porque se medía `scrollHeight`
antes de que React pintara) · `settings.less` (bloque `rr-*`) · `support.less` (`.quick-replies`)
· docs de schema y componentes.

---

### 2026-08-11 — FAQ configurable + contexto dinámico del Agente Soporte

**Contexto:** demasiada verdad del negocio vivía escrita a mano en el prompt del Agente Soporte en
n8n. Mientras el cliente sea solo Vera eso no duele; con el segundo cliente de Plateo obliga a
reescribir el prompt a mano por cada restaurante — exactamente lo que rompe el modelo multi-tenant.
Es la misma jugada que ya se hizo con `info_negocio` (tab Configuración) y `motivos_reserva`: la
verdad del negocio vive en la BD, el prompt queda genérico.

**Decisión (a) — tabla `faq` + CRUD propio:** migración `faq_configurable`. `faq_id` (`FAQ-###`),
`pregunta`, `respuesta`, `activa`, `orden`, con CHECK de longitud (200/600) y el trigger
`trigger_normalizar_faq` (pregunta a una línea, respuesta sin CR/tabuladores, `updated_at`).
Normalizar **en la BD y no solo en el formulario** es a propósito: la frontera es la tabla, así un
`UPDATE` manual tampoco mete texto sucio. La tabla nace **vacía**: sembrar respuestas de ejemplo
habría sido inventar afirmaciones del negocio que el bot le diría a clientes reales.

**Decisión (b) — el RPC no filtra, solo reordena:** `consultar_faq(p_filtro, p_limite=40)`
devuelve **todas** las FAQ activas y usa `p_filtro` únicamente para ordenarlas por parecido. Se
descartó copiar el enfoque de `buscar_menu` (filtrar por umbral de trigrama) tras medirlo contra
datos de prueba: en el menú el cliente nombra el producto casi literal, pero una FAQ se pregunta
parafraseada — *"¿puedo llevar mi perro?"* contra *"¿Aceptan mascotas?"* da **0.045** de
similitud, así que un umbral habría escondido justo la FAQ correcta. El emparejamiento semántico
lo hace el LLM; la BD solo le entrega el conjunto acotado (tope duro de 40 filas).

**Decisión (c) — dónde va el blindaje:** las FAQ son texto libre del restaurante que entra al
contexto del agente, así que son una vía para chocar con las reglas globales (no mencionar
internos, precios exactos desde la BD). Se separó en dos capas que no hay que confundir: el
**prompt** es la barrera real (trata las FAQ como dato, ignora lo que parezca instrucción, no cita
precios de una FAQ), y el **lint del dashboard** (`faqLint.js`) es solo ayuda de redacción —
detecta precios, jerga interna y texto con forma de instrucción, y **avisa sin bloquear**
(el botón pasa a "Guardar de todos modos"). Bloquear de verdad se dejó únicamente para lo que la
BD también rechaza (longitudes), para no pelear con el dueño del restaurante por un falso positivo.

**Impacto:**
- **BD:** migración `faq_configurable` — tabla `faq` + `faq_seq`, RLS `auth_full_access`,
  `normalizar_faq()` + trigger, `consultar_faq()`. Verificado en vivo: trigger normaliza, los 3
  CHECK rebotan lo inválido, el RPC ordena bien.
- **Dashboard:** `useFaq.js`, `FaqSection.jsx`, `FaqModal.jsx`, `faqLint.js` nuevos;
  `SettingsPage.jsx` pasa a shell con **sub-vistas** (`.settings-segmented`) y el formulario
  existente sale a `BusinessInfoSection.jsx`. Sub-vistas y no una tab nueva del sidebar porque son
  la misma tarea y así cada una conserva su único botón `primary` (DS §3).
- **Bot:** ✅ **aplicado** (workflow `Pizzeria Vera`, `8LI3J7PLi35zf4EJ`, 100 → 101 nodos): nodo
  `consultar_faq` (`httpRequestTool` v4.4 contra `/rpc/consultar_faq`, credencial `Supabase
  account` por referencia) colgado del `AGENTE SOPORTE` por `ai_tool`, y `systemMessage`
  reemplazado por el bloque de `agent-prompts.md#agente-soporte`. Con esto las dos mitades de la
  FAQ configurable quedan cerradas: lo que el restaurante escribe, el bot lo lee.

  **Nota de método — se aplicó por la REST API, no por el MCP de n8n** (tampoco estaba levantado
  esta vez). Dos cosas que hay que saber si se repite la vía:
  - El `PUT /workflows/{id}` exige `settings`, pero su schema es `additionalProperties: false` y
    **rechaza** `binaryMode`, `availableInMCP` y `timeSavedMode`, que sí existen en el workflow
    vivo. Hay que quitarlas del payload; verificado después del update que n8n **las conserva**
    (hace merge, no las pisa) — pero el `400` inicial parece un error del nodo y no lo es.
  - El parámetro que ve el LLM se llama `filtro` (`$fromAI('filtro', …)` → body `p_filtro`),
    siguiendo la convención de `armar_mitad_y_mitad`. El prompt decía `p_filtro`; se corrigió a
    `filtro` en `agent-prompts.md` **y** en lo que quedó cargado, para que el nombre que el
    prompt menciona sea el que el agente realmente tiene.

---

### 2026-08-10 — BUG-028 resuelto: pedidos zombis en estados intermedios

**Contexto:** 11 pedidos llevaban semanas en `pendiente` (el más viejo de hace 72 días). Son la
munición que activó el bug del `.first()` (`edge-cases.md#18`): cualquier consulta que busque "el
pedido pendiente del cliente" recibía N filas en vez de 1.
**Hallazgo al verificar:** eran **15, no 11** — el tracker solo había contado los `pendiente`.
Faltaban 3 en `en_camino` (23-jul) y 1 en `en_cocina` del 17-may, **85 días** colgado.
**Hallazgo que cambió el plan:** `pedidos` tiene un trigger **AFTER UPDATE**
(`notificar-estado-pedido`) que postea a un webhook de n8n, y ese webhook manda WhatsApp cuando
cambia el estado. Cancelar los 15 "a secas" habría disparado mensajes *"❌ Tu pedido fue
cancelado"* por pedidos de hasta 72 días. Se comprobó además que los 15 son **datos de prueba**:
los teléfonos son los del desarrollador (`5731132…`, `5731848…`) o sintéticos (`573000000001`,
`1234354353`) — ningún cliente real.
**Decisión (a) — limpieza silenciosa:** se cancelaron los 15 con `ALTER TABLE … DISABLE TRIGGER`
**dentro de la transacción** de la migración, así que no salió ni una notificación. Se cancelan y
no se borran, para no alterar los agregados históricos de Estadísticas. `estado_pago` se deja como
estaba: `'pendiente'` en un pedido cancelado es la verdad (nunca se cobró); forzarlo a `'rechazado'`
inventaría un rechazo que ningún operador hizo.
**Decisión (b) — expiración por día de negocio:** `expirar_pedidos_pendientes()` + job de pg_cron
`expirar-pedidos-pendientes` (`0 16 * * *`). Se descartó la regla "por N horas" a propósito:
`pendiente` es la columna *"Por aprobar"* del kanban, así que un pedido legítimo puede pasar horas
ahí en una noche cargada y una regla por horas cancelaría pedidos reales que el operador todavía
iba a aprobar. El corte por día **nunca toca el turno en curso**. Tampoco toca `en_cocina` ni
`en_camino`: esos ya los aceptó la cocina y lo más probable es que se entregaran sin marcarse —
cancelarlos automáticamente sería mentir; los cierra el operador desde Historial.
**Por qué a las 16:00 UTC (11:00 Colombia) y no a medianoche:** el corte ya pasó, pero la
notificación le llega al cliente a una hora decente. El pedido viejo no estorba mientras tanto
porque el kanban solo muestra los del día actual. La notificación queda **activa** a propósito: un
cliente cuyo pedido nunca se procesó merece enterarse, y el `motivo_rechazo` está redactado para
encajar en la plantilla de n8n (*"Tu pedido fue cancelado, no alcanzamos a procesarlo antes del
cierre del día."*).
**Verificación:** tras la limpieza, `pedidos` queda en 81 `entregado` + 24 `cancelado` y **cero**
en estados intermedios. `net._http_response` y `net.http_request_queue` en **0** → ni un webhook
encolado, la limpieza fue realmente silenciosa. El trigger volvió a `tgenabled='O'`. La función de
expiración se probó en transacción con `ROLLBACK` sobre las tres fronteras: un pedido de 2h antes
del inicio del día se cancela; uno de las **00:05 de hoy** y uno de *ahora* sobreviven.
**Pendiente:** el job aún no ha corrido en producción → queda en "En observación" del tracker.
**Impacto:** Supabase — migraciones `bug028_limpiar_pedidos_colgados` y
`bug028_expirar_pedidos_pendientes`. Docs — `database/schema.md` (función nueva + tabla de jobs de
pg_cron, que no estaba documentada), `shared/bug-tracker.md`, `shared/backlog.md`. **Sin cambios en
el dashboard ni en n8n.**
**Cabo suelto menor:** queda el blob huérfano `comprobantes/PED-109.jpg` en Storage. Ya no tiene
referencia en la BD (`comprobante_url` es `NULL`), así que es inofensivo; borrarlo por SQL solo
quitaría la fila de metadatos y dejaría el archivo colgado en S3 → pasa a housekeeping del backlog.

---

### 2026-08-10 — La escalada a humano llegaba al dashboard sin contexto

**Contexto:** Un cliente escribía *"tengo un problema con el pedido, necesito hablar con un
humano"*, el bot escalaba correctamente… y la conversación aparecía **vacía** en la tab Soporte.
El operador tenía que volver a preguntar el problema que el cliente acababa de explicar, justo
cuando ya venía molesto.
**Causa:** el `Router de modo` lee `clientes.modo` **al entrar** el mensaje. El mensaje que dispara
el handoff entra todavía como `bot`, se procesa por la ruta de agentes, y es el Agente Soporte
quien a mitad de camino llama `solicitar_handoff`. El nodo que escribe en `mensajes_soporte` está
en la **otra** rama del router, así que solo capturaba los mensajes **siguientes**: el único que
importaba era precisamente el que nunca se guardaba.
**Decisión:** no reconstruirlo en n8n, sino recuperarlo de donde ya estaba — `n8n_chat_histories`,
la memoria de los agentes. RPC **`registrar_contexto_handoff`** + trigger
**`trigger_contexto_handoff`** sobre `clientes` (AFTER UPDATE OF `modo`, WHEN pasa a `'humano'`).
Se puso **en la BD y no en el workflow** a propósito: así cubre cualquier vía de escalada —la tool
del bot, el dashboard, un UPDATE manual— en vez de solo la que uno se acuerde de cablear, y no
mete latencia en la ruta de respuesta del bot.
**Por qué funciona (no es obvio):** el turno del cliente ya está en la memoria cuando el trigger
dispara, porque el **ORQUESTADOR** corre primero y guarda al cerrar su cadena, antes de que el
Agente Soporte arranque. Con un solo agente el backfill llegaría vacío.
**Ruido que hubo que filtrar:** la memoria es **una sola sesión por teléfono para todos los
agentes**, así que el mismo mensaje se guarda una vez por cadena que corre (se deduplican
consecutivos, no todas las repeticiones); el ORQUESTADOR guarda su clasificación
(`{"agente":"soporte",...}`) como mensaje `ai` normal; y los `content` no siempre son texto
(array vacío en llamadas a tools, filas `type:'tool'` con el resultado crudo).
**Orden de la conversación:** varios turnos comparten `created_at` porque se escriben juntos al
cerrar la cadena. Como el chat ordena por esa columna, con empates la respuesta del bot podía
pintarse **antes** de la pregunta del cliente (pasó en la primera prueba). Se desempata con
microsegundos según el `id` de la memoria, que sí es secuencial.
**`origen = 'bot'`:** valor nuevo en el check de `mensajes_soporte`. `ChatBubble` pasa a un mapa
`ROLES` (con fallback a `cliente` para un origen desconocido) y lo pinta del lado del cliente pero
**hundido** —`--bg-inset` + borde punteado + texto atenuado— porque es contexto pasado, no algo que
el operador tenga que contestar. Sin color nuevo, a propósito.
**Verificación:** probado en transacción con `ROLLBACK` simulando una conversación real con todo su
ruido (clasificación del orquestador, turnos duplicados por la memoria compartida, `content` array,
fila `tool`). Resultado: 5 mensajes limpios en el orden correcto + la nota de sistema, y el mensaje
que disparó el handoff presente. Re-escalar tras resolver **no duplica** (suma solo la nota nueva),
gracias al corte por el último `mensajes_soporte`. `npm run build` limpio.
**Falta probar con un handoff real por WhatsApp.**
**Impacto:** Supabase — migraciones `handoff_contexto_origen_bot`, `registrar_contexto_handoff`,
`trigger_contexto_handoff`, `registrar_contexto_handoff_orden_estricto`. Dashboard —
`ChatBubble.jsx`, `support.less`. **Ningún cambio en n8n.** Docs — `database/schema.md`,
`architecture.md`, `bot/ai-agents.md`, `dashboard/components.md`, `shared/edge-cases.md#21`.

---

### 2026-08-10 — Motivo (ocasión) de la reserva y su costo de montaje

**Contexto:** El local monta decoración para cumpleaños, aniversarios, declaraciones, grados y
eventos empresariales, y eso tiene un costo. Nada de eso se preguntaba: el bot creaba la reserva
con fecha/hora/personas y el montaje se acordaba por fuera, así que el precio quedaba a criterio de
quien atendiera y la sala se enteraba tarde de que había que preparar algo.
**Decisión:** tabla **`motivos_reserva`** (`clave`, `nombre`, `descripcion`, `costo`, `activo`,
`orden`) como **fuente única** para las dos capas: el bot la lee con la tool nueva
`consultar_motivos_reserva` y el dashboard con el hook `useReservationReasons`. En `reservas` se
agregan `motivo` (FK) y `costo_motivo`. La alternativa —lista hardcodeada en `constants.js` + la
misma lista escrita a mano en el prompt de n8n— se descartó: son dos copias que se desincronizan
solas (ya nos pasó con los prompts) y cada cambio de precio sería un deploy.
**El costo lo escribe un trigger, no quien inserta.** `trigger_costo_motivo` (BEFORE INSERT OR
UPDATE OF `motivo`) copia el precio desde `motivos_reserva`. Ni el LLM ni el JS del dashboard
mandan `costo_motivo`: solo la clave. Misma convención que el total de `pedidos`. Lo que queda en
la reserva es una **foto**: cambiar el precio del motivo no altera reservas ya creadas.
**Modelo de cobro (decidido con el cliente):** tarifa **fija por reserva**, no por persona, y
**solo se informa y se guarda** — no genera pedido ni cobro automático, se paga en el local. Eso
mantiene el cambio fuera de la lógica de pedidos y de las estadísticas de ventas.
**Flujo del bot:** la ocasión se pregunta **después** de confirmar disponibilidad (no tiene sentido
ofrecer decoración para un horario lleno) y el costo se anuncia **antes** de pedir la confirmación,
igual que el recargo de domicilio en el Agente Pedidos.
**Precios sembrados (PLACEHOLDER, a criterio del operador):** `sin_ocasion` $0, `cumpleanos`
$80.000, `aniversario` $120.000, `declaracion` $150.000, `grado` $90.000, `empresarial` $200.000.
Las 15 reservas preexistentes quedaron en `sin_ocasion`.
**Verificación:** trigger probado en transacción con `ROLLBACK` sobre 4 casos — insert mandando un
costo falso de `999` (lo ignora y pone $120.000), cambio a `sin_ocasion` ($0), cambio a
`declaracion` ($150.000) y un UPDATE que no toca `motivo` (deja el costo quieto).
`n8n_validate_workflow`: 0 errores en los dos workflows. `npm run build` limpio.
**Falta probar con una reserva real por WhatsApp y una manual desde el dashboard.**
**Impacto:** Supabase — migraciones `motivos_reserva_tabla_y_costo` y `trigger_costo_motivo_reserva`.
n8n — `Pizzeria Vera` (tool nueva `consultar_motivos_reserva`, prompt de `AGENTE RESERVAS`,
descripción e inputs de `crear_reserva`) y `Sub — Crear Reserva` (los 4 nodos). Dashboard —
`useReservationReasons` (nuevo), `useReservations`, `ReservationModal`, `ReservationDetail`,
`ReservationsPage`, `constants.js` (`MOTIVO_DEFECTO`), `reservations.less`. Docs — `database/schema.md`,
`bot/ai-agents.md`, `bot/agent-prompts.md`, `bot/subworkflows.md`, `dashboard/components.md`,
`shared/backlog.md`, `shared/bug-tracker.md`.

**Limitación conocida:** la plantilla `recordatorio_reserva` de Meta tiene 4 params fijos, así que
la confirmación por WhatsApp **del dashboard** no menciona la ocasión ni su costo. Requiere aprobar
una plantilla nueva en WhatsApp Manager — al backlog. El bot sí lo dice (texto libre dentro de la
ventana de 24h).

**Hallazgos de paso:** (1) **BUG-029** — el bot nunca pudo guardar `notas` en una reserva: el Code
node del sub lee `input.notas` pero `notas` no está declarado como input ni lo manda el main.
Registrado, no arreglado (amplía la firma de la tool y el prompt: es otra feature). (2) Drift en
`dashboard/components.md`: decía que la cancelación va por texto libre "porque no hay plantilla
aprobada" (usa `cancelacion_reserva` desde 2026-07-29) y que el `reserva_id` manual lo genera el
front como `RSV-M<timestamp>` (lo genera la BD con `generar_reserva_id()`). Ambos corregidos.

---

### 2026-08-10 — Pizza mitad y mitad (bot + BD + dashboard)

**Contexto:** El negocio vende pizzas con dos sabores, pero el sistema no las modelaba. El bot no
tenía forma de cotizarlas y en el dashboard había que fingirlas con una pizza normal + una nota,
así que el precio quedaba a criterio de quien tomara el pedido.
**Decisión de modelado:** una mitad y mitad es **UNA sola línea** de `detalle_pedidos`, no dos ni
un producto nuevo del menú: `producto_id` = la mitad **más cara** (fija el precio y mantiene la FK
válida), `nombre_producto` = `"Mitad X / Mitad Y"`, `variante` = el tamaño, `precio_unitario` = el
precio de la más cara, y una columna nueva **`mitades jsonb`** con las dos mitades
(`{producto_id, nombre, variante, precio}` ×2). Al ser una línea normal, el trigger del total, el
historial, el export y las estadísticas siguen funcionando **sin tocarse**. La alternativa —
producto de menú por cada combinación— habría hecho explotar el menú (36 pizzas saladas × 2 masas
→ cientos de filas) y la de dos líneas a mitad de precio habría roto la regla de cobro.
**Regla de cobro:** se cobra **la mitad más cara** del tamaño pedido. Se decide en la RPC
`cotizar_mitad_y_mitad`, que es la **única** fuente: la llaman tanto el bot (tool
`armar_mitad_y_mitad`) como el dashboard (`MenuPicker`). Ni el LLM ni el JS del frontend calculan
ese precio. Restricciones que valida: misma **masa** (`menu.variante`), tamaño
`pequena/mediana/grande/familiar` (la **porción no se parte**), solo las 4 categorías de pizza
salada (las dulces no), ambas disponibles y sabores distintos. Cruzar categorías **sí** se puede
(media tradicional + media premium → cobra la premium).
**Defensa en profundidad:** `Sub — Crear_orden_completa` **recalcula** el precio de toda línea con
`mitades` contra el menú real antes de insertar, así que un `precio_unitario` inventado por el LLM
nunca llega a la BD. Es la segunda barrera después de la RPC.
**Efecto colateral corregido:** `editar_pedido` borra y reinserta las líneas copiando solo 6
campos, así que editar un pedido desde el dashboard **perdía `notas_item`** (ya pasaba antes, sin
que nadie lo notara) y habría perdido `mitades`, dejando una línea que cobra el precio de una
pizza cara sin decir de qué era la otra mitad. Ahora arrastra ambos.
**Verificación:** RPC probada contra los 8 casos (ok tradicional/estofada, masa distinta, porción,
dulce, tilde en "pequeña", mitades iguales, producto inexistente). Ciclo completo probado en
transacción con `ROLLBACK`: insert → trigger (`57.000` + `5.000` domicilio = `62.000`) →
`editar_pedido` a cantidad 2 (`114.000` + `5.000` = `119.000`) con `mitades` y `notas_item`
intactos. `n8n_validate_workflow`: 0 errores en los dos workflows; `mode:'active'` confirma el
nodo `armar_mitad_y_mitad` y los prompts en el grafo **publicado**. `npm run build` limpio.
**Falta probar con un pedido real por WhatsApp y con un pedido manual desde el dashboard.**
**Impacto:** Supabase — migraciones `mitad_y_mitad_columna_y_cotizador`, `mitad_y_mitad_rpc_cotizar`,
`editar_pedido_arrastra_mitades_y_notas_item`. n8n — `Pizzeria Vera` (nodo nuevo
`armar_mitad_y_mitad`, prompts de `AGENTE MENÚ` y `AGENTE PEDIDOS`, descripción de
`crear_orden_completa`) y `Sub — Crear_orden_completa` (3 Code nodes + el select del HTTP de menú).
Dashboard — `MenuPicker`, `CreateOrderModal`, `EditOrderModal`, `OrderCard`, `OrderDetailModal`,
`useOrders`, `useOrderHistory`, `index.css` (`.mm-tag`), `orders.less`. Docs — `database/schema.md`,
`bot/ai-agents.md`, `bot/agent-prompts.md`, `bot/subworkflows.md`, `dashboard/components.md`,
`dashboard/design-system.md`.

**Drift heredado detectado en la misma pasada:** al releer los prompts vivos apareció que las
reglas de BUG-010 (*"modificar/cancelar un pedido YA REGISTRADO" → soporte → handoff*) estaban en
n8n desde 2026-07-22 pero **nunca se copiaron a `agent-prompts.md`**, que se declara verbatim.
Ya están sincronizadas (ORQUESTADOR y AGENTE SOPORTE).

---

### 2026-07-29 — El AGENTE PEDIDOS creaba el pedido sin esperar la confirmación del cliente

**Contexto:** Dos pedidos seguidos salieron mal. En `PED-223` el bot preguntó *"¿Pagas en efectivo o
por transferencia?"* y **en el mismo turno** ya había creado el pedido con `metodo_pago =
'Transferencia'`. En `PED-224` ni siquiera preguntó: el cliente mandó la dirección y el bot respondió
con el resumen y creó el pedido con `'Efectivo'`, un valor que nadie dijo nunca.
**Causa (verificada vía MCP, ejecuciones `10127`/`10128` y `10149`/`10150`):** el `systemMessage` de
`AGENTE PEDIDOS` **había perdido el PASO 4**: la numeración saltaba de PASO 3 a PASO 5. El PASO 3 decía
*"Cuando tengas tipo_pedido + metodo_pago + dirección, **crea el pedido** … **y muestra el resumen**"*,
es decir, crear y resumir en el **mismo turno** — el agente nunca tenía un turno donde parar y esperar.
La sección 4 seguía exigiendo `✓ El cliente confirmó explícitamente`, un check que el flujo no le daba
forma de cumplir. Ante la contradicción, el modelo rellenaba el hueco: inventaba `metodo_pago`.
Las plantillas del resumen (CASO A–D) lo empujaban más, porque cada una fija una línea de pago y
cierra con *"Lo mando a cocina 🍕"* — una afirmación, no una pregunta.
**Decisión:** restaurar el gate de confirmación en el prompt. PASO 3 pasa a ser *"RESUMEN Y
CONFIRMACIÓN (NO crea el pedido)"* y las cuatro plantillas cierran con *"¿Te lo confirmo así?"*;
vuelve el **PASO 4 — CREAR EL PEDIDO**, que solo dispara `crear_orden_completa` tras un "sí"/"dale"/
"confirmo". Se añaden dos reglas duras: **"nunca preguntes y crees en el mismo mensaje"** y
**"prohibido asumir `metodo_pago` — 'Efectivo' no es el valor por defecto"**, más
*"un dato que escribiste TÚ en el resumen no cuenta como confirmado por el cliente"*. Los datos
bancarios se mueven del resumen al PASO 5 (después de que el pedido existe), si no el mensaje pedía
comprobante de un pedido todavía no creado. La misma regla se duplica en el `toolDescription` de
`crear_orden_completa`, que es lo que el modelo lee al decidir la llamada.
**Verificación:** `n8n_get_workflow mode:'active'` confirma PASO 4 y la nueva descripción de la tool en
el grafo **publicado** (`activeVersionId` regenerado 22:07:47), no solo en el draft.
`n8n_validate_workflow`: 0 errores. **Falta probar con un pedido real por WhatsApp.**
**Impacto:** n8n `Pizzeria Vera` (nodos `AGENTE PEDIDOS`, `crear_orden_completa`),
`docs/bot/ai-agents.md` (§3), `docs/shared/edge-cases.md#20`. Ningún archivo del dashboard cambió.
Datos: `PED-223` acabó bien (el cliente sí transfirió, comprobante subido, `en_cocina`);
**`PED-224` sigue `pendiente` con un `metodo_pago = 'Efectivo'` que el cliente nunca eligió** —
confirmarlo con el cliente antes de despacharlo.

---

### 2026-07-29 — El comprobante se guardaba en el pedido equivocado (no era bug del dashboard)

**Contexto:** Un comprobante subido por WhatsApp aparecía en Storage pero el dashboard seguía mostrando
*"Esperando comprobante de transferencia"*. La sospecha inicial fue el dashboard, y debuggear n8n
reforzaba esa idea: **la ejecución estaba en verde, todos los nodos `success`**.
**Causa (verificada vía MCP, ejecución `10134`):** `Buscar pedido activo` filtraba solo por `telefono`
+ `estado = 'pendiente'` y devolvió **2 filas** — `PED-109` (1-jul, **Efectivo**, viejo sin cerrar) y
`PED-223` (el real, Transferencia). `Preparar Upload` hacía `.first()`; sin `ORDER BY` Postgres no
garantiza orden y ganó el viejo. El archivo se subió como `PED-109.jpg` y `comprobante_url` se escribió
en `PED-109`. El dashboard estaba **leyendo bien**: `PED-223.comprobante_url` era `null`, y
`OrderCard.jsx:122` hace exactamente lo que debe con ese dato. Alcance: solo 3 de 46 pedidos por
Transferencia tenían `comprobante_url`.
**Decisión:** el fix va en n8n, no en el dashboard. `Buscar pedido activo` añade `metodo_pago =
'Transferencia'` y `estado_pago = 'pendiente'`; `Preparar Upload` deja de usar `.first()` y ordena por
`fecha_pedido` desc descartando los que ya tienen comprobante (el nodo Supabase **no ofrece
sort/limit** — 0 de 27 propiedades — así que el orden se decide en JS); `Update a row` pasa a
referenciar `$('Preparar Upload').first().json.pedidoId` en vez del `.item` del IF, que con varios
items podía resolver a otra fila.
**Verificación:** `n8n_get_workflow mode:'active'` confirma que los 3 cambios están en el grafo
**publicado** (`activeVersionId` regenerado 21:55), no solo en el draft. Repolítica de datos: el archivo
se copió a `comprobantes/PED-223.jpg` (99.553 bytes, idénticos; HTTP 200 público), `PED-223` quedó
apuntando ahí y `PED-109.comprobante_url` volvió a `null`.
**Impacto:** n8n `Pizzeria Vera` (nodos `Buscar pedido activo`, `Preparar Upload`, `Update a row`),
datos de `pedidos` (`PED-109`, `PED-223`), Storage (`comprobantes/PED-223.jpg`),
`docs/shared/edge-cases.md#18`, `docs/shared/bug-tracker.md` (BUG-028 nuevo, data debt residual).
Ningún archivo del dashboard cambió.

---

### 2026-07-29 — Los taps de Quick Reply caían en el vacío: el Switch inicial no los conocía

**Contexto:** La promo (`reactivacion_cliente`) llegaba bien, pero al tapear **"Quiero pedir"** el bot
no hacía absolutamente nada. Causa raíz verificada vía MCP en el `Switch` inicial del workflow
`Pizzeria Vera` (8LI3J7PLi35zf4EJ): tenía **solo 2 reglas** — existe `messages[0].text.body` (texto) y
`type` contiene `image` — y **ningún fallback**, así que todo lo demás se descartaba en silencio. Un
tap de Quick Reply de plantilla llega como `messages[0].type = 'button'` con
`button: { text, payload }` y **no trae `text.body`**, así que no matcheaba ninguna regla. No era el
LLM ni el orquestador: el mensaje nunca entraba al flujo.
**Decisión:** Tercera salida en el `Switch` (`type` ∈ `button` | `interactive`) → nuevo Code node
**`Normalizar tap`** → `Extraer datos del mensaje`. El nodo inyecta el texto del botón en
`messages[0].text.body` y reenvía el payload, así que **el resto del flujo de texto sirve sin
cambios**. Se hizo así, y no con una rama paralela, porque `No > Crear Cliente` referencia
`$('Extraer datos del mensaje').item.json.telefono` — una rama que no pasara por ese nodo rompería
la creación de clientes nuevos. Cambio **aditivo**: el camino de texto no se tocó.
**Desambiguación:** `Normalizar tap` además reescribe `Confirmar` → "Confirmar mi reserva" y
`Cancelar` → "Cancelar mi reserva". Sin eso, `Confirmar` suelto cae en la regla de **pedidos** del
ORQUESTADOR (que lista `"confírmalo"`) o en el fallback a soporte, porque la plantilla la manda el
**dashboard** y el historial de chat no tiene contexto de reserva. `Quiero pedir` y `No, gracias`
pasan tal cual (ya rutean a menu y soporte). El remapeo aplica **solo a taps**, no a texto escrito.
**Verificación:** los labels salieron de Graph API, no de los docs —
`GET /1476425047271965/message_templates?fields=components` → solo 2 de las 7 plantillas tienen
botones: `reactivacion_cliente` (`Quiero pedir` / `No, gracias`) y `recordatorio_reserva`
(`Confirmar` / `Cancelar`). **Drift corregido:** el backlog hablaba de un botón `Sí, les cuento` que
**no existe en ninguna plantilla**. El shape del payload y la tolerancia del JSON crudo de
`Extraer datos del mensaje` se confirmaron contra la ejecución real 10132.
**Pendiente:** **no se ha tapeado ningún botón en real después del cambio** — la verificación
demuestra que el cableado y los labels calzan, no que el tap llegue hasta el agente.
**Impacto:** n8n workflow `Pizzeria Vera` (nodo `Normalizar tap` nuevo + 3ª regla del `Switch` + 2
conexiones), `docs/bot/n8n-workflow.md`, `docs/shared/backlog.md`, `docs/shared/edge-cases.md`.

---

### 2026-07-29 — Se cierran los 3 huecos de texto libre: el dashboard ya solo manda plantillas

**Contexto:** Meta aprobó las plantillas que faltaban. Hasta hoy tres envíos del dashboard iban por
**texto libre**, que la Cloud API acepta con 200 pero **no entrega** si el cliente no escribió en las
últimas 24h (lección de `edge-cases.md#16`): cancelación de reserva, resumen de pedido manual y —el
peor— el primer contacto con un cliente creado a mano, que simplemente no existía como función.
**Decisión:** Se cablearon las tres nuevas plantillas, todas `es` y APPROVED:
`cancelacion_reserva` (Utility, 3 params) en `ReservationsPage.notifyDeleted`; `resumen_pedido`
(Utility, 5 params) en `CreateOrderModal`; y `bienvenida_cliente` (Marketing, 1 param) en un
**`WelcomeModal` nuevo**, que se abre desde el botón *Saludar* de cada fila de la tab Clientes.
`sendWhatsAppMessage` (texto libre) queda usado **solo** por `SupportPanel`, donde la ventana de 24h
está abierta por definición. Al pasar el resumen de pedido a plantilla hubo que aplanar la lista de
items a **una sola línea separada por comas**: Meta rechaza params con saltos de línea, tabs o 4+
espacios seguidos, así que las viñetas del texto libre no eran portables.
**Verificación (sin enviar nada):** el token del dashboard **sí** tiene hoy scope
`whatsapp_business_management` (`debug_token`), así que esta vez la fuente de verdad fue Graph API y
no un screenshot: `GET /{waba_id}/message_templates` sobre el WABA **`1476425047271965`** devuelve las
7 plantillas con nombre, idioma, estado y cuerpo. Se cruzó el nº de `{{n}}` de cada cuerpo contra los
params que manda cada call site: **los 6 alineados** (nombre, idioma, APPROVED y conteo) → sin 132001
ni 132000 por desalineación. `npm run build` limpio.
**Nota sobre el WABA ID:** cuesta encontrarlo y se confunde con otros tres IDs de Meta — el del
número (`1026022853935447`), el de la app (`1309095691054858`) y el del portafolio de negocio
(`196002027842701`), ninguno de los cuales tiene edge `message_templates`. Sale literal en la URL de
WhatsApp Manager (`?waba_id=`). Queda anotado en `components.md`.
**Impacto:** `utils/constants.js` (`WA_TEMPLATES`: 3 entradas nuevas), `pages/clients/WelcomeModal.jsx`
(nuevo), `pages/clients/ClientsPage.jsx`, `pages/reservations/ReservationsPage.jsx`,
`pages/dashboard/CreateOrderModal.jsx`, `styles/statistics.less` (el bloque `.promo-modal` pasa a
compartirse con `.welcome-modal`), `docs/dashboard/components.md`, `docs/shared/backlog.md`.
**Pendiente:** falta el **envío real de prueba** end-to-end; la verificación anterior demuestra que
los metadatos calzan, no que Meta entregue. Y sigue abierto el cron de `recordatorio_reserva` en n8n
y el enrutado de los taps de Quick Reply (ver backlog).

---

### 2026-07-28 — Producto agotado: el bot decía "no lo manejamos" en vez de "hoy se agotó"

**Contexto:** La pestaña **Menú** del dashboard permite marcar un producto como agotado
(`menu.disponible = false`). Probando contra el bot real, al preguntar por un producto agotado
respondía que **no lo manejan** — falso y dañino comercialmente: sí está en la carta, solo que
hoy no hay. Causa raíz en `Sub — Consultar_menu`: el nodo *Construir filtros* llamaba al RPC
`buscar_menu` con `solo_disponibles: true`, así que el agotado **desaparecía** del resultado y
para el LLM era indistinguible de un producto inexistente. Verificado vía MCP: `buscar_menu('pizza m&m', 0.2, 30, true)`
devuelve 30 pizzas pero **nunca** la M&M (agotada); con `false` aparece con `similitud 1.00`.
**Decisión:** El RPC ahora se llama con `solo_disponibles: false` y es el Code node del sub quien
**parte el resultado en dos**: `productos_por_categoria` (solo disponibles — lo único ofrecible y
agregable al carrito) y `agotados` (existen en la carta, hoy no hay), más un `mensaje` que instruye
al LLM. Se prefirió partir en el sub y no en el prompt para que el agente **no pueda** meter un
agotado al carrito por accidente: simplemente no está en la lista de la que construye items. En el
prompt del Agente Menú se añadió la sección *"AGOTADO no es lo mismo que NO LO MANEJAMOS"* (decir
"sí lo tenemos, hoy se agotó" + ofrecer alternativa de la misma categoría; nunca listarlo ni
agregarlo; no prometer cuándo vuelve) y se actualizó la descripción de la tool `consultar_menu`.
Ahora `encontrados = 0` **con** `agotados` vacío es el único caso de "no está en la carta".
**Impacto:** n8n `Sub — Consultar_menu` (`r9BbkGSCNJcJ2P6t`, nodos *Construir filtros* y *Code in
JavaScript1*), n8n `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`, nodos *consultar_menu* y *AGENTE MENÚ*),
`docs/bot/subworkflows.md`, `docs/bot/ai-agents.md`, `docs/bot/agent-prompts.md`,
`docs/shared/edge-cases.md`. Sin cambios en el dashboard ni en la BD.
**Verificación:** `n8n_get_workflow` en modo `active` sobre el sub confirma que la **versión
publicada** (no el draft) ya trae el `solo_disponibles: false` y el split. Agotados en el catálogo
al momento del fix: Arepa Rellena Carne (PROD-087), Pizza M&M (PROD-062), Jarra de Sangría (PROD-129).
**Pendiente relacionado:** un producto puede agotarse **mientras** está en el carrito;
`crear_orden_completa` no revalida `disponible` al cerrar el pedido → ver backlog.

---

### 2026-07-28 — El menú oficial se sirve desde el dashboard; el bot deja de mandar a Google

**Contexto:** El prompt del **Agente Menú** en n8n tenía `## Link Menu: www.google.com` — un
placeholder de plantilla que nunca se reemplazó. Cuando `consultar_menu` no encontraba un producto,
el bot invitaba al cliente a "ver el menú" en **google.com**. En paralelo, `info_negocio.link_menu`
(que el Agente Soporte lee vía `info_local`) estaba **vacía**, así que la única otra fuente de
verdad tampoco servía. No había ningún menú publicado en ninguna parte.
**Decisión:** El PDF oficial (`menu_vera.pdf`, 52 páginas) se versiona en **`public/`** del
dashboard, así que Vite lo copia tal cual a `dist/` y queda servido como estático en
`https://vera.plateo.cloud/menu_vera.pdf`. Esa URL es ahora el **único** link de menú, y se escribió
en los **dos** sitios que la consumen: el prompt del Agente Menú (sección reescrita: cuándo enviarlo,
cómo presentarlo, y que **no** reemplaza a `consultar_menu` para precios/disponibilidad) y la fila
`link_menu` de `info_negocio`. Servirlo desde `public/` en vez de Drive evita depender de permisos de
terceros y hace que el link viaje con el deploy.
**Verificación:** vía MCP — `n8n_get_workflow` en modo `active` confirma que la **versión publicada**
del workflow `Pizzeria Vera` ya trae la URL nueva (no quedó en draft), y el `UPDATE ... RETURNING`
sobre `info_negocio` devuelve el valor. Se revisaron además los prompts de Orquestador, Pedidos,
Soporte y Reservas: **no contienen otros links**. El link de reseña de Google en
`Sub — Feedback Pendiente` **es correcto** (Google Maps real), pero se abrió **BUG-027** por los
`\n` escapados de ese subworkflow.
**Nota de dominio:** el sistema vive en **`plateo.cloud`** — sitio público `www.plateo.cloud` y un
subdominio por cliente con deploy aparte vía DNS; Vera es **`vera.plateo.cloud`**. El
`vera.lessplus.net` que aparecía en el backlog y en el changelog del 2026-06-19 era un nombre
tentativo que **nunca existió en DNS** (`nslookup` → NXDOMAIN); se apuntó ahí por error y se corrigió
en el mismo día. Comprobado que el PDF ya se sirve: `GET https://vera.plateo.cloud/menu_vera.pdf` →
**200 · `application/pdf` · 5.262.411 bytes** (idéntico al archivo del repo).
**Impacto:** `public/menu_vera.pdf` (nuevo), n8n `Pizzeria Vera` (nodo `AGENTE MENÚ`), BD
`info_negocio.link_menu`, `docs/bot/agent-prompts.md`, `docs/bot/ai-agents.md`,
`docs/database/schema.md`, `docs/shared/bug-tracker.md`, `docs/shared/backlog.md`.

---

### 2026-07-28 — Fix: ninguna plantilla de WhatsApp podía enviarse (nombre + idioma erróneos)

**Contexto:** Al verificar `WA_TEMPLATES` contra WhatsApp Manager (screenshot del operador) salieron
dos desalineaciones que hacían fallar **todos** los envíos de plantilla con **132001** (template does
not exist): el nombre real es **`seguimiento_review`**, no `seguimiento_resena`, y el idioma de las
tres es **`es`** ("Spanish" en Meta), no `es_CO` (que figuraría como "Spanish (COL)"). Nunca se había
detectado porque los contadores de Meta muestran **0 mensajes enviados** en las 4 plantillas — el
camino jamás se ejerció en real.
**Decisión:** `WA_TEMPLATES` es la única fuente de verdad y debe calcar Meta carácter por carácter;
se documentó la tabla verificada (nombre, categoría, params, consumidor) en `components.md` junto a
los códigos de error que produce cada tipo de desalineación (132001 nombre/idioma, 132000 params).
También se corrigió la categoría de `recordatorio_reserva`: es **Marketing**, no Utility.
**Verificación:** el token del dashboard **no** permite leer las plantillas por Graph API (es de
`whatsapp_business_messaging`; `me/assigned_whatsapp_business_accounts` devuelve vacío), así que la
fuente fue la UI de WhatsApp Manager. Para automatizar esto haría falta un token con
`whatsapp_business_management` + el WABA ID.
**Impacto:** `utils/constants.js` (`WA_TEMPLATES`), `pages/reviews/ReplyModal.jsx` (comentarios),
`docs/dashboard/components.md`.

---

### 2026-07-28 — Reservas: la confirmación pasa a plantilla; previews verbatim

**Contexto:** Con los cuerpos reales a la vista (pegados por el operador desde WhatsApp Manager)
salieron dos desalineaciones más. (1) La confirmación de reserva se mandaba por **texto libre**, que
no se entrega si el cliente nunca le escribió al bot — justo el caso de un cliente creado a mano en
el dashboard. (2) La preview de `PromoModal` prometía **20%** de descuento y el cupón por defecto era
`VUELVE20`, pero la plantilla aprobada da **10%**: el operador prometía el doble de lo que recibía el
cliente.
**Decisión:** `ReservationsPage` separa las dos notificaciones según haya plantilla o no —
`notifyCreated` usa la plantilla `recordatorio_reserva` (nombre, fecha legible, hora, personas) y
`notifyDeleted` sigue en texto libre porque **no hay plantilla de cancelación**, con un toast que ya
no afirma que el cliente fue notificado. Las previews de los modales se fijan como copia **verbatim**
del cuerpo aprobado (`PromoModal` a 10% + cupón `VUELVE10`); `ReplyModal` ya coincidía.
**Nota (decisión 2026-07-28):** el cuerpo de `recordatorio_reserva` dice "para {{4}} personas", así
que una reserva de 1 persona lee "para 1 personas". Se **deja así a propósito**: arreglarlo exige
editar la plantilla en Meta y pasar por re-aprobación, y el operador no lo considera prioritario. No
volver a proponerlo como pendiente.
**Impacto:** `pages/reservations/ReservationsPage.jsx`, `pages/statistics/PromoModal.jsx`,
`docs/dashboard/components.md`, `docs/shared/backlog.md`.

---

### 2026-07-23 — Reseñas: estado "resuelta" + orden por prioridad (negativas primero)

**Contexto:** Tras contactar a un cliente por una reseña, no había forma de saber que ya se atendió —
se podía responder de nuevo. Y el feed no priorizaba lo accionable.
**Decisión:** (1) Nueva columna `feedback.resuelta_at` (migración `feedback_add_resuelta_at`): al
enviar el seguimiento desde `ReplyModal` se marca resuelta (`marcarResuelta`); la tarjeta muestra
**"Resuelta"** (check verde, atenuada) y desaparece el botón Responder — no se puede volver a
responder. (2) El feed ordena **negativas → neutras → positivas** y, dentro de cada grupo,
**pendientes antes que resueltas** (sort estable conserva fecha desc). Los chips de filtro también
arrancan con **Negativas** y dejan "Todas" al final. `feedback` ya tenía `auth_full_access` (ALL) para
`authenticated`, así que el UPDATE desde el dashboard no necesitó política nueva.
**Impacto:** `hooks/useReviews.js` (`resueltaAt` + `marcarResuelta`), `pages/reviews/ReviewCard.jsx`
(badge + sin botón), `ReplyModal.jsx` (marca al enviar), `ReviewsPage.jsx` (reorden chips + sort),
`styles/reviews.less`, `docs/database/schema.md`.

---

### 2026-07-23 — Plantillas de WhatsApp: escribir fuera de la ventana de 24h

**Contexto:** El dashboard solo mandaba texto libre (`type: text`), que Meta **solo entrega dentro de
la ventana de servicio de 24h** desde el último mensaje del cliente. Fuera de ella (reseñas viejas,
clientes inactivos) el envío falla con **131047**. La única vía es una **plantilla aprobada**
(`type: template`).
**Decisión:** El operador creó 3 plantillas en Meta (`seguimiento_resena` Utility ·
`reactivacion_cliente` Marketing · `recordatorio_reserva` Utility). Nuevo `sendWhatsAppTemplate` en
`lib/whatsapp.js`; nombres/idiomas centralizados en `WA_TEMPLATES` (constants.js). Flujo por caso:
- **Reseñas** (`ReplyModal`): texto libre best-effort → si falla con 131047, se revela la plantilla
  `seguimiento_resena`; al enviarla se hace **handoff automático** (`modo=humano`) para que la
  respuesta caiga en Soporte.
- **Clientes inactivos** (`RiskClients` en Estadísticas): botón **Promo** → `PromoModal` envía
  `reactivacion_cliente` con cupón editable (siempre fuera de 24h → siempre plantilla). Envío
  individual; el masivo/bulk queda para n8n (límites de tier + token).
- **No se tocó n8n:** el handoff aprovecha el enrutado a Soporte existente; en reactivación, la
  respuesta ("Quiero pedir") la atiende el bot en modo bot.
**Pendiente (elegido para después):** `recordatorio_reserva` requiere un **cron nuevo en n8n**
(diario → reservas de mañana → enviar → manejar Confirmar/Cancelar). Ver backlog.
**Impacto:** `lib/whatsapp.js` (`sendWhatsAppTemplate`), `utils/constants.js` (`WA_TEMPLATES`),
`pages/reviews/ReplyModal.jsx`, `pages/statistics/PromoModal.jsx` + `RiskClients.jsx`,
`styles/statistics.less`, `styles/reviews.less`.
**Corrección (misma fecha):** el primer diseño de reseñas intentaba texto libre y solo mostraba la
plantilla si fallaba con 131047. Pero **la Cloud API acepta (200) el texto libre fuera de la ventana
y no lo entrega** (el fallo llega async por webhook) → daba "enviado" en falso. Se simplificó el
`ReplyModal`: **siempre plantilla** `seguimiento_resena` + handoff automático, con vista previa; sin
textarea/`wa.me`/ticket manual. El botón Responder queda **solo en negativas/neutras**; las positivas
muestran "Invitado a Google" (el bot las manda a la reseña pública). Además se corrigió el **link de
Google** en el bot (n8n `Sub — Feedback Pendiente`, nodo "Invitar reseña Google": era
`www.lessplusdigital.com`, ahora el Google Maps real de La Vera Pizzería).

---

### 2026-07-23 — Nueva tab Reseñas: satisfacción + recuperación de clientes

**Contexto:** La tabla `feedback` solo se usaba para el promedio en Estadísticas. Analizando el
flujo del bot (workflow n8n **Sub — Feedback Pendiente**, verificado vía MCP) se ve que hace
*review gating*: tras un pedido entregado pide nota 1–5 y **solo si es ≤3 pide comentario**; las de
4–5 se invitan a dejar reseña en Google (nodo `¿Nota > 3?`). Es decir, los comentarios que llegan a
la BD son casi siempre negativos/neutros → `feedback` es en la práctica la cola de clientes a
recuperar, no un muro de elogios.
**Decisión:** Tab **Reseñas** (Sidebar, entre Menú y Configuración) con doble propósito: (1) un
panel de satisfacción (promedio + `Stars`, distribución 5→1, termómetro de sentimiento verde/ámbar/
rojo, "≈N invitadas a Google") y (2) un feed de tarjetas con CTA **Responder por WhatsApp** (`wa.me`
+ `?text=` prellenado según el tono, sin hardcodear el nombre del negocio). Filtros por sentimiento
(con conteos), búsqueda y chip "con comentario"; todo client-side (volumen acotado, subconjunto de
pedidos que calificaron). `sentimentOf` (≥4 pos / 3 neu / ≤2 neg) alineado con la lógica del bot.
Fiel al design system: superficies planas, tokens de estado, una tipografía, `.tnum`; sin glass ni
degradados. `feedback` añadida a la publicación realtime (migración
`feedback_add_to_realtime_publication`) para que las reseñas nuevas aparezcan sin recargar.
**Impacto:** `src/pages/reviews/` (ReviewsPage, SatisfactionSummary, ReviewCard, Stars, sentiment.js),
`src/hooks/useReviews.js`, `src/styles/reviews.less`, `timeAgo` en `utils/formatters.js`, wiring en
`App.jsx` / `Sidebar.jsx` (icono `star`) / `Header.jsx` / `main.jsx`.
**Iteración (misma fecha): respuesta + handoff desde un modal.** El feed pagina por lotes
("Mostrar más", `BATCH = 24`; el resumen sigue sobre el total). Cada tarjeta muestra el **teléfono**
del cliente (`formatPhone`) y un botón **Responder** que abre `ReplyModal` — el hub de acción de la
reseña: textarea con texto sugerido por tono, **Enviar** por WhatsApp (best-effort vía
`sendWhatsAppMessage`) y **Abrir ticket de soporte** (handoff `clientes.modo = 'humano'` → tab Soporte,
reversible). El envío **respeta la ventana de 24h de Meta**: el texto libre solo se entrega si el
cliente escribió en las últimas 24h; fuera de ella la Graph API falla (131047), el modal lo explica y
queda **Abrir en WhatsApp** (`wa.me`) para escribir manualmente (no hay plantillas HSM configuradas).
El panel de satisfacción se rediseñó a **pastel** (barras `color-mix`, tarjetas de sentimiento con
fondo `-dim`) por feedback visual. Fix responsive del segmented de filtros en móvil (≤560px).

---

### 2026-07-23 — Nueva tab Historial: control exacto de todos los pedidos

**Contexto:** El kanban solo muestra el día en curso y Estadísticas agrega — no había forma
de revisar pedido por pedido qué pasó (cuándo entró, cuándo se entregó, con qué items,
por qué se canceló).
**Decisión:** Tab **Historial** (Sidebar, entre Estadísticas y Clientes), solo lectura.
Reutiliza los presets Colombia-aware de `dateRanges.js` (Hoy/7d/30d/90d/mes/custom) y trae
`pedidos` + `detalle_pedidos` + `clientes(nombre)` por rango (cap 5000 con warning), realtime
sobre `pedidos` para los estados del día. Filtros por estado/tipo/búsqueda, resumen de lo
visible (entregados/cancelados/ingresos sin cancelados), orden por Fecha/Total/Estado y
paginación global. `OrderDetailModal`: cliente + wa.me, pago con `estado_pago`, dirección,
repartidor, entrega con duración (≤3h), comprobante, items con variante/notas, recargo de
domicilio derivado, motivo de cancelación. Nuevo `ORDER_STATES` en constants.js (badges del
ciclo de vida alineados al kanban).
**Iteración (misma fecha): 100% server-side.** El primer corte filtraba/ordenaba/paginaba
client-side con cap de 5000 por rango — el historial crece sin límite, así que ahora
paginación (`range()` + `count: exact`), filtros y orden viajan en la query; la búsqueda por
nombre resuelve `clientes.nombre ilike` → `cliente_id in (...)` y el resumen agrega sobre
todo el conjunto filtrado vía el RPC **`historial_resumen`** (SECURITY INVOKER, migración
`historial_resumen_rpc_e_indice_fecha`, que también creó `idx_pedidos_fecha_pedido`).
Búsqueda con debounce 300ms; Estado dejó de ser ordenable (el orden alfabético del servidor
no sigue el ciclo de vida; el filtro cubre ese caso). RPC verificado vía MCP con filtros
compuestos. Loaders para el round-trip: `.spinner`/`.loading-state` promovidos a patrón
global del DS (§8b) — carga inicial con spinner + texto, refetch con tabla atenuada y
spinner `sm` en overlay; los "Cargando…" de Menú/Clientes/Configuración migraron al mismo
patrón.
**Export CSV/Excel:** botón "Exportar" en la toolbar baja todo el conjunto filtrado (cap
10.000 con aviso) y genera CSV plano (BOM UTF-8, fechas hora Colombia, para CRM) o Excel
con formato vía `exceljs` — título/periodo/resumen, encabezado de marca, banding, moneda,
estados coloreados, autofiltro y panel congelado. `exceljs` va en chunk aparte (dynamic
import, ~940KB) que solo se descarga al exportar; nueva dependencia en `package.json`.
Archivos: `src/utils/exportHistory.js`, `fetchAllFiltered` en el hook (reusa los filtros
de la lista vía `applyFilters`/`buildSearchParts` compartidos).
**Corrección de estado desde el modal:** pedidos colgados en estado intermedio se pueden
marcar entregado o cancelado (motivo obligatorio) con confirmación inline. Verificado vía
MCP antes de implementar: el trigger `notificar-estado-pedido` (BD → webhook n8n) notifica
al cliente por WhatsApp en CADA cambio de estado (n8n filtra con estado≠estado_anterior y
arma el mensaje por estado, interpolando `motivo_rechazo` al cancelar) — la confirmación lo
advierte; y `fecha_entrega` la fija el trigger `set_fecha_entrega` (la escritura client-side
del kanban es redundante), así que el historial no la envía. Cancelar replica al kanban:
`estado_pago: 'rechazado'` + `motivo_rechazo`.
**Impacto:** `src/pages/history/{HistoryPage,OrderDetailModal}.jsx`,
`src/hooks/useOrderHistory.js`, `src/styles/history.less`, `src/utils/constants.js`,
`src/{App,main}.jsx`, `src/components/{Icon,layout/Sidebar,layout/Header}.jsx`,
`docs/dashboard/components.md`.

### 2026-07-23 — Nueva tab Configuración: edita `info_negocio` (lo que el bot responde)

**Contexto:** No existía forma de editar la info del negocio que el bot dicta por WhatsApp
(tool `info_local` = getAll de `info_negocio`). Al revisarla se encontró que **toda la tabla
era data de plantilla de otro negocio** ("La Pizzería Don Carlo", teléfonos +58, Banco
Venezuela) — el bot responde info falsa (BUG-026, abierto hasta que el operador llene la
data real). Además la estructura contemplaba varias sedes y solo hay una.
**Decisión:** Migración `info_negocio_single_sede_y_claves_dashboard`: `sede_1_direccion` →
`direccion` (contacto), `sede_1_nombre` eliminada, y claves nuevas `link_menu` (contacto) y
`costo_delivery` (operacion). Verificado vía MCP que la tool del bot es getAll sin claves
hardcodeadas y el prompt del Agente Soporte no menciona claves → reestructurar es seguro.
Nueva tab **Configuración** (Sidebar, al final): formulario en cards por categoría con
registro de campos (label/help/multilínea), borrador local con contador de cambios,
Descartar + Guardar (solo actualiza claves cambiadas), card "Otros" para claves fuera del
registro. **Sin realtime a propósito** (un evento entrante pisaría lo que se está escribiendo).
**Impacto:** BD (`info_negocio` reestructurada), `src/pages/settings/SettingsPage.jsx`,
`src/hooks/useBusinessInfo.js`, `src/styles/settings.less`, `src/{App,main}.jsx`,
`src/components/{Icon,layout/Sidebar,layout/Header}.jsx`, `docs/database/schema.md`,
`docs/dashboard/components.md`, `docs/shared/bug-tracker.md` (BUG-026).

### 2026-07-22 — Nueva tab Menú: disponibilidad del catálogo desde el dashboard

**Contexto:** Cuando un producto se agotaba no había forma de reflejarlo — el bot lo seguía
ofreciendo (`buscar_menu`/`buscar_menu_categoria` filtran con `solo_disponibles=true`, pero
`disponible` siempre era `true` porque nadie lo editaba).
**Decisión:** Nueva sección **Menú** (Sidebar, debajo de Reservas) que **solo** gestiona
`menu.disponible` — no crea/edita/elimina productos. Tabla con búsqueda (nombre/categoría/
descripción/ID), filtros por categoría y estado, orden por columnas y paginación; el toggle es
un **switch directo en la fila** (update optimista + toast) y un botón "Ver" abre un modal de
detalle (precios por tamaño vía `getProductOptions`, descripción completa) con el mismo switch.
**Además:** `menu` se agregó a la publicación realtime (migración
`menu_add_to_realtime_publication`); `CATEGORY_LABELS` se movió de `MenuPicker` a
`constants.js`; se promovieron a patrones globales del DS el switch (`.switch`), el encabezado
ordenable (`<SortHeader>` + `.sortable`) y la paginación de tablas (`.table-pagination`).
**Drift corregido en los labels de categoría:** 5 claves del mapa original de `MenuPicker`
nunca matchearon los valores reales de `menu.categoria` (verificado vía MCP): `entrada`→
`entradas`, `arepa`→`arepas`, `lasana`→`lasañas`, `pasta`→`pastas`, y `menu_completo` no
existía — esas categorías se veían como slug crudo sin emoji (también en los modales de
pedido). Se corrigieron las claves y se agregó `categoryLabel()` (`constants.js`): fallback
que humaniza slugs nuevos con icono genérico (`"salsa_extra"` → `"🍴 Salsa extra"`) en vez
de mostrarlos crudos.
**Impacto:** `src/pages/menu/{MenuPage,ProductModal}.jsx`, `src/hooks/useMenu.js`,
`src/components/SortHeader.jsx`, `src/styles/{menu.less,index.css,clients.less}`,
`src/pages/clients/ClientsPage.jsx`, `src/pages/dashboard/MenuPicker.jsx`,
`src/utils/constants.js`, `src/{App,main}.jsx`, `src/components/{Icon,layout/Sidebar,
layout/Header}.jsx`, BD (publicación realtime), `docs/dashboard/{components,design-system}.md`,
`docs/database/schema.md`.

### 2026-07-22 — Borrado de cliente en cascada + confirmación dentro del modal

**Contexto:** Eliminar un cliente desde `ClientModal` fallaba con 23503 (FKs `NO ACTION` desde
`pedidos`/`reservas`/`feedback`, decisión previa de preservar historial), y la confirmación de
dos clicks alargaba el botón y desbordaba el footer del modal.
**Decisión:** Migración `cascade_delete_cliente`: las 5 FKs (`pedidos`/`reservas`/`feedback` →
`clientes`; `detalle_pedidos`/`feedback` → `pedidos`) pasan a **ON DELETE CASCADE**. Borrar un
cliente arrastra todo su historial — **altera estadísticas históricas**, por eso el modal ahora
muestra una franja de confirmación plana (tokens red) dentro del footer que lo advierte
explícitamente antes de ejecutar. `mensajes_soporte` no se borra (no tiene FK, referencia por
`telefono`).
**Además (misma sesión):** el toast local de Reservas se promovió a patrón global del DS —
`.toast` en `index.css` + `useToast` + `<Toast>` (DS §8). Clientes ahora confirma con toast
al crear/guardar/eliminar; el borrado suena con `playDeleted` (nuevo en `utils/audio.js`,
descendente, distinto al de pedido nuevo).
**Impacto:** BD (5 FKs), `src/pages/clients/{ClientModal,ClientsPage}.jsx`,
`src/hooks/{useClients,useToast}.js`, `src/components/Toast.jsx`,
`src/pages/reservations/ReservationsPage.jsx` (migrada al toast global), `src/utils/audio.js`,
`src/styles/{index.css,clients.less,reservations.less}`, `docs/database/schema.md`,
`docs/dashboard/{components,design-system}.md`.

### 2026-07-22 — Kanban vacío de noche (BUG-025, cierra BUG-022) + drop de políticas public (BUG-024) ✅

**Contexto:** Un pedido real del bot (PED-117, 20:49 Colombia) no aparecía en el kanban.
Verificado vía MCP: el pedido estaba bien guardado en UTC y `pendiente`.
**Causa (BUG-025):** `useOrders` derivaba el día de negocio con `setUTCHours(5,0,0,0)` sobre
la fecha UTC actual → entre 00:00 y 05:00 UTC (19:00–24:00 Colombia) el umbral quedaba en el
FUTURO y el filtro `gte` vaciaba kanban y stats del header, justo en el rush nocturno.
**Fix:** usar el helper correcto que ya existía — `colombiaDayStart()` de `dateRanges.js`
(desplaza −5h antes de anclar). Estadísticas nunca falló porque ya lo usaba.
**BUG-022 (cerrado como no-bug):** el "desfase de 6–7 h" al crear pedido manual era ver el
valor UTC crudo en Supabase Studio (+5 vs Colombia); `CreateOrderModal` guarda
`new Date().toISOString()` correctamente, igual que el bot. El síntoma visible (card que no
aparece) era BUG-025.
**BUG-024:** migración `bug024_drop_public_policies_mensajes_soporte` aplicada — eliminadas
las políticas `public` de lectura/inserción; queda solo `auth_full_access` (verificado vía
pg_policies). El realtime del dashboard ahora depende del JWT en el socket (fix BUG-023).
**Impacto:** `src/hooks/useOrders.js`; BD (policies); tracker en cero abiertos.

### 2026-07-22 — DS v2.1: primary tinted amber, dropdowns propios, badge de soporte en realtime (BUG-023) ✅

**Contexto:** Iteración sobre el DS v2: el primary naranja sólido no convenció — se prefirió
el tinted amber de «Crear»/«Nueva reserva», reforzado y unificado. Los selects se veían como
HTML nativo. Y el badge de soporte del sidebar no se actualizaba en tiempo real.
**Decisión/Fix:**
- `.btn.primary` = tinted amber con fuerza (color-mix 16%/55%, texto amber, 700; hover 26%).
  Aplicado a «Nuevo cliente», «+ Crear» (kanban `sm`), «+ Nueva reserva» y confirmar de modales.
  Se eliminan los tokens `--accent-solid*`.
- Dropdowns: estilo global de `<select>` en `index.css` (appearance:none + chevron SVG +
  focus ring ámbar) y `color-scheme` por tema; overrides por página solo de tamaño.
- **BUG-023 (badge):** causa raíz — los eventos realtime de `clientes` (RLS solo
  `authenticated`) se filtran si el socket va con token anon; `mensajes_soporte` sí llegaba
  por su política `public` (→ eso destapó BUG-024, abierta en el tracker). Fix doble:
  `supabase.realtime.setAuth(jwt)` en `useAuth` + `useSupportCount` también refetchea con
  INSERTs de `mensajes_soporte`.
**Impacto:** `index.css`, `clients/statistics/reservations/orders.less`, `Column.jsx`,
`ReservationsPage.jsx`, `useAuth.jsx`, `useSupportCount.js`, `design-system.md`, DS en
claude.ai/design re-publicado.

### 2026-07-22 — Design system v2: superficies planas, jerarquía de botones, tipografía única

**Contexto:** Feedback de experto UX/UI: exceso de degradados ("se ve muy IA"), dos
tipografías mezcladas, CTA sin peso visual, helpers dentro de labels, huecos y exceso de
color en estadísticas. Se decidió estandarizar con un design system documentado.
**Decisión:** `docs/dashboard/design-system.md` es la fuente de verdad visual (regla anclada
en `CLAUDE.md`). Cards/modales planos (glass solo en sidebar/topbar); jerarquía `.btn`
(primary naranja sólido, 1 por pantalla); patrón `.field` con helpers debajo del input y
tag "Opcional" en la minoría; sans única con `tabular-nums` (mono deprecada); paleta de
charts `--chart-1..3` validada contra daltonismo (skill dataviz, 6 checks dark+light);
layout de stats con gaps/paddings unificados (16 / 16x18) y columnas stretch.
**Impacto:** `src/styles/index.css` (tokens v2 + `.btn` + `.field`), `clients.less`,
`statistics.less`, `ClientsPage/ClientModal`, `KpiCards`, `CancellationStats`,
`CategoryRevenue` (top 3 + otras), `SalesChart`, `DeliveryStats`, `ChartTheme`.
Pendiente en backlog: aplicar `.btn`/`.field` a pedidos, reservas y soporte.

### 2026-07-22 — Se elimina `infra/` (RLS como código) — el MCP es la fuente viva

**Contexto:** `infra/supabase/rls_reference.sql` fue la referencia del modelo RLS antes de tener
MCP de Supabase. Hoy RLS ya está aplicado en las 12 tablas (BUG-012) y el estado real se
verifica en vivo vía MCP; mantener el script versionado invitaba a drift.
**Decisión:** eliminar `infra/` del repo. El modelo de permisos vive en
`docs/database/schema.md` («Modelo de permisos», incluye cómo crear el primer admin). Replicar
el setup a nuevos clientes (modelo silo) se hará vía MCP `apply_migration`. También se limpió
`dist/` local (build, gitignored) y se decidió **mantener** `.env.example` y
`.mcp.json.example` como plantillas versionadas de la config secreta.
**Impacto:** `infra/` (eliminada); referencias actualizadas en `README.md`, `docs/README.md`,
`docs/database/schema.md`, `src/hooks/useAuth.jsx`; drift corregido en
`docs/bot/subworkflows.md` (BUG-003/006/007 ya resueltos, verificado vía MCP).

### 2026-07-23 — Reservas: cancelación cableada y subworkflows saneados (BUG-004/005/008/009) ✅

**Contexto:** Los 4 bugs abiertos restantes eran del flujo de reservas del bot. Se aplicaron
directamente en n8n vía MCP (updates atómicos, validados, verificados en la versión publicada).
**Qué se hizo:**
- **BUG-005:** tool `cancelar_reserva` cableada al AGENTE RESERVAS (el prompt ya la describía).
- **BUG-009:** input `telefono ` (espacio invisible) renombrado → el check "esta reserva no es
  tuya" funciona; endurecido a fail-closed; nueva compuerta If para que un fallo de validación
  no llegue al UPDATE y el agente reciba el error.
- **BUG-004:** key `cliente_id ` (espacio) renombrada en todo el camino (tool → trigger → INSERT).
- **BUG-008:** checks JS muertos de duplicado/cupo eliminados; el cupo lo protege el trigger de
  BD `trigger_validar_cupo`. **Decisión:** duplicados NO se bloquean en BD (se manejan
  conversacionalmente; ver backlog).
**Impacto:** n8n (`Pizzeria Vera`, `Sub — Crear Reserva`, `Sub — Cancelar Reserva`);
`docs/bot/subworkflows.md`, `ai-agents.md`, `n8n-workflow.md`; lección #12 en `edge-cases.md`
(keys con espacio invisible → checks fail-closed).

### 2026-07-22/23 — Hardening n8n + Supabase: credenciales, RLS total, keys nuevas (BUG-001..003, 006, 007, 010..012) ✅

**Contexto:** Auditoría de seguridad reveló secretos hardcodeados, tablas sin RLS, webhook sin
auth e instancia n8n 20 versiones atrás. Se resolvió todo el lote en dos días.
**Qué se hizo:**
- **BUG-003/007:** 13 nodos HTTP con secretos en texto plano migrados a credenciales n8n;
  rotación al sistema nuevo de API keys de Supabase (`sb_publishable_` en el dashboard,
  `sb_secret_` en n8n, legacy JWT deshabilitadas). El daño histórico de BUG-007: 8 pedidos
  sin líneas, irrecuperables.
- **BUG-012:** RLS habilitado en las 6 tablas que faltaban → **todas** las tablas con RLS.
- **BUG-011:** webhook Supabase→n8n autenticado con `x-webhook-token`; nodo huérfano y
  workflows archivados con secretos eliminados; instancia n8n actualizada.
- **BUG-006:** `consultar_menu` migrado al RPC `buscar_menu` (fuzzy), extendido primero a
  `categoria`/`descripcion` para no perder fidelidad vs. el `ilike` viejo.
- **BUG-001/002:** expresiones rotas en `Sub — Feedback Pendiente` (faltaba `=`; fuente
  confiable para `cliente_id` en ambas ramas).
- **BUG-010:** `Sub — Editar pedido` archivado como legacy (0 ejecuciones, sin caller);
  mitigación conversacional en prompts de Orquestador/Soporte.
**Impacto:** n8n (7 workflows de producción limpios), BD (migraciones `bug006_*`, `bug011_*`,
`bug012_*`), `.env.local` (key nueva); `CLAUDE.md`, `schema.md`, `feedback.md`,
`subworkflows.md`, `infra/supabase/README.md`; lección #11 en `edge-cases.md`.

### 2026-07-17 — Barrido de calidad del dashboard (BUG-013..021 + deuda técnica) ✅

**Contexto:** Bugs rescatados de reportes de code-review (jul-14/16), resueltos en la rama
`fix/BUG-013-useorders-error-handling`.
**Qué se hizo:**
- **Timezone (BUG-015/016/020/021):** todos los timestamps de BD pasan por `parseDb()`
  (OrderCard, SupportPanel, ConversationItem, ChatBubble, ClientsPage); la validación del
  `ReservationModal` usa offset fijo de Colombia (`-05:00`).
- **Robustez (BUG-013/014/017/018/019):** `useOrders` sin spinner infinito en error; realtime
  de `clientes` con `event:'*'` + tabla añadida a la publicación; errores de notas en
  `EditOrderModal` ya no se descartan; `alert()` reemplazado por banner inline en soporte;
  `reserva_id` lo genera la BD (`generar_reserva_id()`), no `Date.now()`.
- **Deuda técnica:** `<MenuPicker>` extraído (~172 líneas de duplicación menos), errores
  logueados en `useStatistics`, columnas explícitas en `useClients`, debounce (300 ms) en el
  realtime de `useOrders`.
**Impacto:** `src/hooks/*`, `src/pages/dashboard|reservations|support|clients/*`,
`MenuPicker.jsx` (nuevo). Verificado con `npm run build`.

### 2026-06-19 — Autenticación (Supabase Auth) + RLS · Paso 1 hacia SaaS multi-cliente

**Contexto:** Antes de salir a producción y empezar a vender el sistema a clientes (vera, somos, usb…) como SaaS, el dashboard usaba la `anon key` directa **sin login y sin RLS** — cualquiera con esa key (que es pública) podía leer toda la base. Decisión arquitectónica acordada: **un proyecto Supabase por cliente** (aislamiento físico, replicable con migraciones-como-código), una **sola app React** desplegada una vez que resuelve el tenant por subdominio (`vera.lessplus.net`), y cobro tipo SaaS con Stripe en un futuro "control plane". Este commit implementa el **paso 1: auth + RLS** sobre el proyecto actual (Vera).

**Decisión:**
- `AuthProvider` + `useAuth` (`src/hooks/useAuth.jsx`): expone `session`, `user`, `loading`, `signIn`, `signOut`. Usa `supabase.auth` (persistencia en localStorage + JWT automático en cada query/realtime) y `onAuthStateChange`.
- `App.jsx` ahora es un **gate**: `loading` → splash; sin sesión → `LoginPage`; con sesión → `DashboardShell` (extraído para que los hooks que consultan datos —`useOrders`, `useSupportCount`— solo corran autenticados). `useTheme` se mantiene en el top para que el tema aplique también en el login.
- `LoginPage` (`src/pages/auth/`, estilos `auth.less`): email+password, errores de Supabase traducidos al español, glassmorphism + toggle de tema.
- El `AdminMenu` del Header dejó de ser placeholder ("Sesión de invitado / Próximamente"): muestra el usuario real y **Cerrar sesión** (`signOut`). Icono `logout` añadido a `Icon.jsx`.
- **RLS como código** en `infra/supabase/rls_reference.sql` (idempotente): activa RLS en las 6 tablas y crea política `auth_full_access` = acceso total solo para rol `authenticated`. El bot/n8n sigue escribiendo con `service_role` (salta RLS). `infra/supabase/README.md` documenta cómo aplicarla, crear el primer admin y verificar.

**Modelo de seguridad:** `anon key` pública pero inútil sin sesión (RLS bloquea); `service_role` secreta solo en n8n; usuarios del panel creados manualmente (registro abierto OFF). Para multi-tenant pool (futuro, NO ahora) la política filtraría por `tenant_id` del JWT — comentado en el SQL.

**Impacto:** `src/hooks/useAuth.jsx` (nuevo), `src/pages/auth/LoginPage.jsx` (nuevo), `src/styles/auth.less` (nuevo), `infra/supabase/` (nuevo: migración RLS + README), `App.jsx` (refactor a gate + `DashboardShell`), `main.jsx` (`AuthProvider`, import `auth.less`), `Header.jsx` (`AdminMenu` real), `Icon.jsx` (icono `logout`), `index.css` (`.ad-danger`).

### 2026-06-10 — Nueva tab Reservas (calendario)

**Contexto:** La tabla `reservas` ya existe en Supabase (el bot tomará reservas por WhatsApp), pero el dashboard no tenía forma de visualizarlas ni de gestionarlas manualmente.

**Decisión:**
- Quinta tab `reservas` con **react-big-calendar** (localizado en español con el `date-fns` ya instalado) — vistas Día / Semana / Mes, toolbar custom y CSS sobreescrito por completo con las variables del tema dark/light (`reservations.less`)
- Crear reserva manual (`ReservationModal`) y eliminar existentes (`ReservationDetail`, confirmación en dos pasos). **Siempre se notifica al cliente por WhatsApp** en ambas operaciones (best-effort: si WA falla, la operación queda hecha y un toast lo advierte)
- `reserva_id` manual con prefijo `RSV-M<timestamp>`; `origen: 'dashboard'`
- **Para reservar, el cliente debe existir**: el modal usa un selector de clientes con búsqueda por nombre/teléfono (mismo patrón que `CreateOrderModal`, reutiliza `useClients`) en lugar de inputs libres — `cliente_id`, `nombre_cliente` y `telefono` salen del cliente seleccionado
- La BD solo guarda `hora` de inicio — el calendario dibuja bloques de 90 min (`RESERVATION_DURATION_MIN`)
- Estados: `pendiente`/`confirmada`/`cancelada` (`RESERVATION_STATES`), coloreados amber/green/red en el calendario
- Realtime `*` sobre `reservas` para reflejar las reservas que cree el bot

**Impacto:** `src/pages/reservations/` (ReservationsPage, ReservationModal, ReservationDetail), `useReservations.js`, `reservations.less`, `constants.js` (RESERVATION_STATES, RESERVATION_DURATION_MIN), tab nueva en `Header.jsx`/`App.jsx`/`main.jsx`, dependencia `react-big-calendar`. `DATABASE.md` y `DASHBOARD.md` actualizados.

### 2026-06-10 — Creación manual de pedidos desde el Kanban

**Contexto:** Todos los pedidos entraban únicamente por el bot de WhatsApp. Los administradores necesitaban registrar pedidos tomados por otros canales (teléfono, mostrador) sin perder el flujo normal de aprobación ni la notificación al cliente.

**Decisión:**
- Botón "+ Crear pedido manual" en la columna "Por aprobar" que abre `CreateOrderModal` (misma UX de selección de productos que `EditOrderModal`)
- El pedido se asocia a un cliente existente de la tabla `clientes` (búsqueda por nombre/teléfono); la dirección se prellena con `direccion_principal`
- Inserción **directa a Supabase** (sin RPC): primero `pedidos` con `total: 0` y `estado: 'pendiente'`, luego `detalle_pedidos` — el trigger `actualizar_total_pedido` calcula el total real (regla: el frontend nunca calcula el total). Si falla el insert de items, se borra el pedido (rollback best-effort)
- `detalle_id` con prefijo `DET-M` (manual) para distinguir de `DET-E` (edición)
- Tras crear, se lee el `total` final de la BD y se notifica al cliente por WhatsApp (`sendWhatsAppMessage`) con el resumen del pedido (items, total exacto, entrega y método de pago). Si WhatsApp falla, el pedido queda creado y el modal muestra una advertencia
- `metodo_pago` se guarda capitalizado (`'Efectivo'`/`'Transferencia'`) — es lo que la BD ya contiene y lo que `METODO_LABEL`/`OrderCard` esperan, aunque `DATABASE.md` decía minúsculas

**Impacto:** `CreateOrderModal.jsx` (nuevo), `Column.jsx` (prop `onCreate`), `DashboardPage.jsx` (estado del modal), `orders.less` (`.col-add-btn` + `.create-order-modal`). `DASHBOARD.md` actualizado.

### 2026-06-10 — Nueva tab Clientes (CRUD)

**Contexto:** Los administradores solo veían clientes indirectamente (Soporte muestra modo=humano, Estadísticas muestra top/riesgo). Se necesitaba un listado completo con búsqueda y la posibilidad de crear/corregir clientes manualmente (ej: nombres "Pendiente" o direcciones desactualizadas).

**Decisión:**
- Cuarta tab `clientes`: tabla completa de la tabla `clientes` con búsqueda por nombre o teléfono (un solo input), orden alfabético A↔Z y CRUD (crear + editar; sin eliminar — los pedidos referencian `cliente_id`)
- Insert/update **directo a Supabase** desde el dashboard (sin RPC) — campos editables: `nombre`, `telefono`, `direccion`. `modo` se muestra como badge de solo lectura (se gestiona desde Soporte)
- Teléfono se sanitiza a solo dígitos en el input; el duplicado (UNIQUE, error 23505) se traduce a mensaje amigable
- Realtime solo UPDATE (lo único publicado para `clientes`); tras crear/editar se refetchea manualmente

**Impacto:** `src/pages/clients/` (ClientsPage, ClientModal), `useClients.js`, `clients.less`, tab nueva en `Header.jsx`/`App.jsx`/`main.jsx`. `DASHBOARD.md` actualizado.

### 2026-06-09 — Estadísticas avanzadas + limpieza de columnas en clientes

**Contexto:** Segunda iteración de la tab Estadísticas: tiempo de entrega, ingresos por categoría, heatmap hora×día y clientes en riesgo. Al construirlas se encontraron dos problemas de datos.

**Decisión:**
- **`fecha_entrega` ahora la escribe el dashboard** (`OrderCard.updateEstado`) al marcar entregado — antes nadie la escribía de forma confiable y los datos históricos son incoherentes (hay entregas "antes" del pedido). `deliveryStats` descarta duraciones ≤0 o >3h.
- **Fix timezone:** `fecha_pedido` es columna `timestamp` sin tz con valor UTC; JS la parseaba como hora local, corriendo la distribución horaria. Nuevo `parseDb()` en `dateRanges.js` fuerza UTC.
- **Columnas eliminadas de `clientes`:** `total_pedidos`, `gasto_total`, `ultimo_pedido_fecha`, `ultimo_pedido_detalle` — nunca se escribían ni se leían. Los acumulados se calculan desde `pedidos`.
- Nuevas vistas: `DeliveryStats` (promedio + distribución, domicilio vs recoger), `CategoryRevenue` (donut top 5), heatmap 7×24 en `HourlyHeatmap` (reemplaza las dos gráficas de barras), `RiskClients` (recurrentes 3+ pedidos inactivos 30+ días, con link wa.me para reactivarlos).

**Impacto:** `OrderCard.jsx`, `dateRanges.js` (`parseDb`), `statsAggregations.js` (4 funciones nuevas, 2 eliminadas), `useStatistics.js`, 3 componentes nuevos + `HourlyHeatmap` reescrito, `statistics.less`. `DATABASE.md` y `DASHBOARD.md` actualizados. Verificado con Playwright headless contra datos reales sin errores de consola.

### 2026-06-09 — Nueva tab Estadísticas (Recharts)

**Contexto:** Los administradores necesitaban analizar el negocio: pedidos por periodo, ingresos, clientes fieles, productos más/menos pedidos por categoría, horas pico y cancelaciones.

**Decisión:**
- Tercera tab `estadisticas` en el dashboard con **Recharts** (se integra con las CSS vars del tema dark/light)
- Agregación **en el cliente** (sin RPCs ni vistas SQL): fetch de pedidos del rango + agregación JS pura en `statsAggregations.js`
- KPIs comparan contra el periodo inmediatamente anterior de la misma duración
- Ingresos/KPIs excluyen `estado='cancelado'` (mismo criterio que el header); cancelados se muestran aparte como tasa con motivos
- Hora/día en hora Colombia: fecha desplazada -5h leída con `getUTC*()`
- **Clientes fieles se agregan desde `pedidos`**, no desde `clientes.total_pedidos`/`gasto_total`: se verificó que esos contadores están en 0 en la BD aunque existen pedidos (no se mantienen)

**Impacto:** `src/pages/statistics/` (8 componentes), `useStatistics.js`, `dateRanges.js`, `statsAggregations.js`, `statistics.less`, tab nueva en `Header.jsx`/`App.jsx`, `formatPriceShort()` en formatters. Dependencia nueva: `recharts`. Verificado con Playwright headless contra datos reales (dark/light, presets, granularidades, filtro de categoría) sin errores de consola. `DASHBOARD.md` actualizado.

### 2026-06-09 — Refactor estructura del frontend (feature-based)

**Contexto:** `src/` era una carpeta plana con componentes gigantes. `App.jsx` tenía 379 líneas mezclando fetch, realtime, lógica de negocio y UI. `OrderCard.jsx` tenía el componente `Actions` incrustado. No había separación de responsabilidades.

**Decisión:** Reorganizar `src/` con carpetas por dominio:
- `hooks/` — lógica extraída de componentes (`useOrders`, `useSupportCount`, `useTheme`)
- `utils/` — constantes, formateadores y audio desacoplados
- `components/orders/` — todos los componentes de pedidos juntos
- `components/support/` — panel de soporte
- `components/layout/` — header
- `pages/` — vistas montadas en App (DashboardPage)
- `styles/` — CSS con secciones separadas por comentarios

**Impacto:** `App.jsx` pasó de 379 a 30 líneas. `Actions` extraído a `OrderActions.jsx`. `DASHBOARD.md` actualizado. Build verificado sin errores.

---

### 2025-XX-XX — Trigger para cálculo de totales

**Contexto:** El LLM pasaba `total: 0` en crear_pedido porque los items no existían aún.
**Decisión:** Mover el cálculo del total a un trigger de PostgreSQL que se ejecuta al insertar/modificar/eliminar filas en `detalle_pedidos`.
**Impacto:** `DATABASE.md` — trigger `actualizar_total_pedido`. El LLM ya no necesita calcular nada.

### 2025-XX-XX — Modo bot/humano en clientes

**Contexto:** Necesitábamos un mecanismo para que el cliente pudiera hablar con un humano real cuando el bot no puede resolver.
**Decisión:** Campo `modo` en tabla `clientes` (`'bot'` | `'humano'`). El workflow principal chequea el modo antes de pasar al agente. Si es `'humano'`, el mensaje va a `mensajes_soporte`.
**Impacto:** `DATABASE.md`, `N8N-WORKFLOWS.md`, `DASHBOARD.md` (nuevo panel de soporte).

### 2025-XX-XX — Subworkflow para consultar_menu

**Contexto:** La búsqueda de productos necesitaba lógica compleja (múltiples palabras, filtro post-proceso) que no cabe en un solo nodo.
**Decisión:** Extraer consultar_menu como subworkflow separado con Code nodes + HTTP Request.
**Impacto:** `N8N-WORKFLOWS.md` — sección de subworkflow.

### 2025-XX-XX — Estructura .claude/ para contexto del proyecto

**Contexto:** El proyecto tiene contexto distribuido (n8n, Supabase, React, OpenAI) que es difícil de mantener en un solo README.
**Decisión:** Crear estructura `.claude/` con archivos especializados por dominio.
**Impacto:** Este archivo + toda la estructura `.claude/`.
