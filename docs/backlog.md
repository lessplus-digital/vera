# Backlog — features y mejoras pendientes

> Lo que **queremos construir**. Los bugs van en [`bug-tracker.md`](bug-tracker.md); lo hecho, en
> [`changelog.md`](changelog.md). Al completar un ítem: **quítalo de aquí** y registra la decisión
> en el changelog.

**Esfuerzo:** `[S]` cabe en una sesión · `[M]` varios días · `[L]` semanas o rediseño.
**Estado verificado el 2026-09-21** contra la BD viva y el código — las líneas marcadas ✅ ya se
comprobaron ese día, no son suposiciones heredadas.

---

## Si vas a coger algo hoy

Ordenado por *valor recibido ÷ esfuerzo*, no por importancia teórica.

| # | Ítem | Capa | Esfuerzo | Bloqueo |
|---|---|---|---|---|
| 1 | [Borrar los datos de prueba de roles](#datos-de-prueba-de-roles-en-producción) | BD | `[S]` | ninguno — es SQL ya escrito |
| 2 | [Kanban: columna de cerrados + navegación por día](#kanban-cuarta-columna-de-cerrados--navegación-por-día-s-m) | Dashboard | `[S-M]` | ninguno — **es la otra mitad del fix de BUG-052** |
| 2b | [`useOrders`: mostrar el error en el UI](#dashboard) | Dashboard | `[S]` | ninguno |
| 3 | [Precios reales de `motivos_reserva`](#reservas) | BD | `[S]` | **necesita los 6 precios del cliente** |
| 4 | [Resumen diario por WhatsApp al dueño](#features-nuevas) | Bot | `[S]` | ninguno — solo n8n |
| 5 | [Modo TV para cocina (KDS)](#features-nuevas) | Dashboard | `[S-M]` | ninguno — alto valor en demos |
| 6 | [Una sola tool de escritura del carrito](#bot) | Bot | `[M]` | ninguno — reduce superficie de error |
| 7 | [Revalidar `disponible` al cerrar el pedido](#bot) | Bot + BD | `[M]` | ninguno — hoy entra un pedido con agotados |
| 8 | [Migrar pedidos/reservas/soporte al design system](#dashboard) | Dashboard | `[M]` | ninguno |
| 9 | [Proxy para los envíos de WhatsApp](#seguridad) | Cross | `[M]` | ninguno — **es el único secreto expuesto** |
| 10 | [Editar una reserva ya creada](#reservas) | Dashboard | `[M]` | ninguno |

**Bloqueados por algo externo** (no los cojas sin resolver antes el bloqueo): plantilla de
WhatsApp con el costo del montaje (aprobación de Meta) · rol mesero / salón y venta en mostrador
(PLATEO-52 + CHECK de `tipo_pedido`) · POS (faltan 3 datos del local) · facturación DIAN
(descartada).

---

## Seguridad

Un solo ítem, y es el riesgo diferido más antiguo del sistema.

- **Proxy para los envíos de WhatsApp** `[M]` — `VITE_WA_ACCESS_TOKEN` viaja en el bundle del
  dashboard (y además quedó en el historial de versiones de n8n). El fix real: enrutar los sends
  del dashboard por n8n o por una edge function, y **rotar el token** (actualizar la credencial de
  n8n + `.env.local`). Mientras tanto es **el único secreto expuesto conocido del sistema**.

## Housekeeping

### Datos de prueba de roles en producción

`[S]` · Sembrados el **2026-08-12** para validar los tres roles en el navegador. Se dejaron a
propósito hasta terminar las pruebas; **siguen ahí**.

✅ **Verificado el 2026-09-21** — la cifra de pedidos asignados subió de 61 a 67 desde que se
escribió esta entrada:

| Qué | Cuánto | Identificador |
|---|---|---|
| Usuarios de Auth + su perfil | 3 | `mesero.prueba@vera.test` · `domi.prueba@vera.test` · `domi2.prueba@vera.test` |
| Pedidos ficticios | 4 | `PED-234`…`PED-237` (`notas = 'PRUEBA ROLES — borrar'`) |
| Cliente ficticio | 1 | `ZZ Cliente Prueba Roles` (`573000000099`) |
| Pedidos con `domiciliario_id` puesto | **67** | pedidos reales/sembrados a los que se asignó repartidor para poblar el historial |

⚠️ **Los 4 pedidos ficticios cuentan en las estadísticas de su día** mientras existan.

⚠️ El teléfono `573000000099` es falso **a propósito**: marcar entregado dispara
`notificar-estado-pedido`, que hace POST a n8n y este le escribe por WhatsApp al número del
pedido. Con un cliente real le llegaría un mensaje sobre un pedido que nunca hizo. **No reasignes
esos pedidos a un cliente real para probar.**

```sql
-- el primer UPDATE deshace la asignación de los 67 históricos
update public.pedidos set domiciliario_id = null where domiciliario_id is not null;
delete from auth.users where email like '%.prueba@vera.test';
delete from public.pedidos where notas = 'PRUEBA ROLES — borrar';
delete from public.clientes where telefono = '573000000099';
```

Si para entonces se hubieran subido fotos de perfil, además
`delete from storage.objects where bucket_id='avatares';` **y** borrar los archivos desde el panel
de Supabase: quitar solo la fila deja el objeto colgado en S3 (misma trampa que el blob de abajo).

### Blobs y columnas muertas

- **Borrar `comprobantes/PED-109.jpg` de Storage** `[S]` — huérfano del bug del `.first()` (una
  copia del comprobante de `PED-223` guardada con el nombre equivocado). Desde el fix de BUG-028
  **no hay ninguna referencia en la BD** (`PED-109.comprobante_url` es `NULL`), así que es
  inofensivo. **No se puede borrar por SQL**: quitar la fila de `storage.objects` dejaría el
  archivo colgado en S3. Hazlo desde el panel de Supabase (Storage → comprobantes) o con la
  Storage API usando `service_role`.
- **Re-pinnear los `pinData` viejos de n8n** `[S]` · *cosmético* — `Sub — Crear Reserva` y
  `Sub — Cancelar Reserva` conservan pins con las keys viejas (`cliente_id `/`telefono ` con
  espacio al final) y `Sub — Consultar_menu` los query params del `ilike`. Solo afecta a las
  pruebas manuales en el editor de n8n: el flujo real no los usa. Re-pinnear al abrirlos.
  *(Estaba en el bug-tracker; no es un defecto del sistema, así que vive aquí.)*
- **Limpiar `pedidos.repartidor`** `[S]` — columna muerta sustituida por `domiciliario_id`.
  ✅ **Verificado el 2026-09-21:** la columna existe y está **NULL en los 117 pedidos**. Se lee en
  **dos** sitios (la entrada vieja decía uno): el `select` de `useOrderHistory.js:20` y el render
  de `OrderDetailModal.jsx:133`. Eliminarla exige tocar ambos.
- **Avatares huérfanos en Storage** `[S]` — al cambiar de foto se borra la anterior en
  best-effort; si ese borrado falla queda el archivo suelto (se prefirió eso a arriesgar que un
  usuario se quede sin foto). Si el bucket crece, un barrido que compare `storage.objects` contra
  `perfiles.avatar_url` lo limpia.

## Bot

- **Una sola tool de escritura del carrito** `[M]` — desde BUG-032 (2026-08-21) `crear_carrito` es
  un upsert (`Prefer: resolution=merge-duplicates`), así que hace **exactamente lo mismo** que
  `actualizar_carrito`: ambas mandan `items` y `total` completos y la PK es el teléfono. La
  decisión *«¿creo o actualizo?»* que el Agente Menú todavía tiene que tomar ya no significa nada
  — y es justo donde vivía el bug. Fundirlas borra esa bifurcación del prompt y reduce la
  superficie de error del agente. No se hizo con el fix porque es un cambio de comportamiento, no
  un header: merece su propia pasada y su propia prueba.
- **Revalidar `disponible` al cerrar el pedido** `[M]` — desde el fix del 2026-07-28 el bot no
  ofrece ni agrega productos agotados, pero un item puede agotarse **mientras** ya está en el
  carrito (el admin lo marca desde la pestaña Menú entre que el cliente arma el pedido y lo
  confirma). `crear_orden_completa` no revisa `menu.disponible` al insertar, así que ese pedido
  entra igual y **el problema aparece en cocina**. Fix: validar en el sub `Crear_orden_completa` y
  devolver `{ ok: false, error: 'agotado', items: [...] }` para que el Agente Pedidos avise y
  devuelva al cliente al Agente Menú a sustituir.
- **Reja dura de cobertura en la BD** `[M]` — tras BUG-033 (2026-08-25) el bot ya no promete
  domicilios fuera de Bello, pero **la garantía vive en los prompts**: si un agente futuro vuelve
  a torcerse, `trigger_tarifa_domicilio` acepta el pedido igual y le cobra la tarifa base. La reja
  dura sería **rechazar** en la BD un `pedidos` de `tipo_pedido='domicilio'` cuyo barrio no
  resuelve — solo en el camino del bot (`auth.uid() IS NULL`), nunca en el del dashboard, donde un
  admin sí necesita escribir un barrio que aún no está en el catálogo.
  **Por qué no se hizo con el fix:** el riesgo se invierte — una errata que el matcher no alcance
  dejaría de ser un cobro raro y pasaría a ser **una venta perdida en seco**. Medido el
  2026-08-25: de 89 domicilios históricos, 88 tienen `zona IS NULL`, pero todos son anteriores a
  las zonas (2026-08-18) y ni siquiera guardaron `barrio`; el único posterior (PED-240, La
  Milagrosa) resolvió bien.
  🔴 **Ya hay evidencia, y cambia el cálculo (2026-09-22, BUG-061).** No es que el matcher falle:
  es que **hay dos matchers y no emparejan igual**. `consultar_cobertura` resuelve de forma difusa
  y devuelve `sugerencias`; **`resolver_barrio` —la que usa `trigger_tarifa_domicilio`— solo
  resuelve el nombre canónico**. En G3, el bot guardó en el carrito el texto crudo del cliente
  (`niqia`), que la segunda no resuelve: de convertirse en pedido, el trigger habría aplicado
  `tarifa_base()` = $5.000 en vez de los $7.500 de Niquía. O sea que **la fuga que este ítem temía
  ya existe, y por el lado contrario al que se vigilaba**: no un rechazo en seco, sino un cobro
  silenciosamente barato. Antes de la reja dura, lo barato y urgente es **unificar los dos
  matchers** (o guardar siempre el nombre canónico que devolvió la tool).
- **Probar los 4 taps de botón en real** `[S]` — el enrutado de taps de plantilla se hizo el
  2026-07-29 (nodo `Normalizar tap`) y se verificó contra el payload de una ejecución real y los
  labels de Graph API, **pero nadie ha tapeado un botón desde WhatsApp desde entonces**. Es
  verificación pendiente, no desarrollo.
- **Bloqueo de reservas duplicadas** — ❌ **decidido que NO** (2026-07-23, BUG-008). Una misma
  persona puede reservar dos veces el mismo día (almuerzo y cena) y el agente lo maneja
  conversacionalmente. Si algún día se quiere: extender `trigger_validar_cupo` o hacer una query
  previa al INSERT en `Sub — Crear Reserva`. *Aquí solo para que nadie lo vuelva a proponer.*

## Reservas

- **Precios reales de `motivos_reserva`** `[S]` — ✅ **verificado el 2026-09-21: 6 motivos activos,
  con los precios placeholder sembrados el 2026-08-10.** Hay que cambiarlos por los reales. Es un
  `UPDATE` a mano hasta que exista la pantalla de abajo. **Bloquea el guion G9 de la Capa B.**
- **Ocasiones editables desde la tab Configuración** `[M]` — que `motivos_reserva` (nombre, costo,
  activo) se edite desde el dashboard en vez de por SQL.
- **Editar una reserva ya creada** `[M]` — hoy `ReservationDetail` solo permite eliminar. Con los
  motivos, cambiar la ocasión obliga a borrar y recrear, **lo que dispara dos WhatsApps al
  cliente**. El trigger `trigger_costo_motivo` ya soporta el UPDATE.
- **Plantilla de WhatsApp con el costo del montaje** `[M]` · 🔒 **bloqueado por Meta** — la
  confirmación que manda el **dashboard** usa `recordatorio_reserva` (4 params: nombre, fecha,
  hora, personas), así que **no incluye la ocasión ni su costo**: el cliente recibe la
  confirmación sin ver los $80.000 del cumpleaños. El bot sí se lo dice, porque su respuesta es
  texto libre dentro de la ventana de 24 h. Fix: crear y **aprobar en WhatsApp Manager** una
  plantilla de 6 params (+ ocasión, + costo) y agregarla a `WA_TEMPLATES`. No se resuelve desde el
  código.
- **Recordatorio del día previo (cron en n8n)** `[M]` — la plantilla `recordatorio_reserva` ya se
  usa como **confirmación al crear** (2026-07-28); falta el cron diario que busque las reservas de
  mañana (pendiente/confirmada) y envíe la plantilla. Reduce no-shows. Los taps `Confirmar` /
  `Cancelar` **ya están enrutados** (2026-07-29) y el Agente Reservas ya tiene
  `consultar_reservas_cliente` y `cancelar_reserva`: **lo único que falta aquí es el cron.**

## Dashboard

### Kanban: cuarta columna de cerrados + navegación por día `[S-M]`

**No es cosmético: es la otra mitad del fix de BUG-052.** Desde el 2026-09-22 el job de expiración
ya no cancela los pedidos con comprobante — se quedan vivos en `pendiente` a propósito, para que
los atienda una persona. Pero el kanban solo muestra **el día actual** y **cuatro estados activos**
(`useOrders.js:19` y `:51`), así que mañana ese pedido pagado desaparece de la vista igual que
antes. El fix de BD se sostiene sobre esta pieza; hasta que exista, el riesgo de BUG-052 está
mitigado a medias.

Pedido explícitamente por Juan el 2026-09-22, en estos términos: poder ver *"los pedidos entregados,
los que ya no tienen nada para hacer por nuestro lado"*, y poder *"devolverme a los pedidos de ayer,
de antier… como si fuese un calendario"*.

**1 · Cuarta columna "Cerrados"** (`entregado` + `cancelado`), debajo de las tres actuales.

- `COLUMNS` (`src/utils/constants.js:1`) **ya admite `key` como array** — lo usa la tercera columna
  (`['en_camino','recoger']`) y lo resuelve `getColumnOrders` en
  `src/pages/dashboard/DashboardPage.jsx:32`. Es una entrada más, no un caso nuevo.
- La rejilla `.kanban` (`src/styles/orders.less:55`) está fijada a `repeat(3, 1fr)`, con saltos a 2
  y 1 columna por breakpoint. La cuarta va **debajo y a lo ancho**, no como cuarta columna estrecha:
  es una lista de consulta, no una bandeja de trabajo.
- **Un pedido cancelado con `comprobante_url` tiene que cantarse en la tarjeta.** Es dinero recibido
  por un pedido que no existe: es exactamente el caso que nadie vio durante tres semanas con
  PED-240 y PED-242 ($130.500).

**2 · Navegación por día.** Controles `‹ ›` + "Hoy" en la cabecera del kanban.

- El cambio es pequeño porque **`colombiaDayStart(date)` (`src/utils/dateRanges.js`) ya acepta una
  fecha**: se guarda el día elegido en estado, se consulta el rango `[inicio, inicio+1d)` y se
  amplía el `.in('estado', …)` de `useOrders` para incluir `entregado`/`cancelado`.
- **Dos cuidados que no son obvios:**
  - El **realtime y el sonido de pedido nuevo solo deben actuar cuando el día elegido es hoy.**
    `useOrders` diffea contra un `knownIds` ref para detectar llegadas; navegando al pasado, todo
    un día "llega" de golpe y sonaría como si hubieran entrado 20 pedidos.
  - Las `stats` de cabecera se calculan con el mismo `today` (`useOrders.js:86`) y deben seguir al
    día elegido, o la cabecera dirá una cosa y el tablero otra.

**3 · Actualizar `docs/dashboard/components.md`** en el mismo commit — el hook de Stop bloquea si
`src/` cambia sin `docs/` — y respetar `docs/dashboard/design-system.md` (un solo `.btn primary`
por pantalla; el de "Crear pedido" ya ocupa ese sitio).


- **`useOrders`: exponer el estado `error` en el UI** `[S]` — ✅ **verificado el 2026-09-21: sigue
  solo con `console.error`** (`useOrders.js:54` y `:89`). El spinner infinito ya se arregló en
  BUG-013, pero falta un banner o toast para que el admin se entere sin abrir la consola.
- **Migrar pedidos, reservas y soporte al design system** `[M]` — clientes y estadísticas ya lo
  usan (ver [`dashboard/design-system.md`](dashboard/design-system.md)). Faltan los modales y
  botones de `orders.less`, `reservations.less` y `support.less`: llevar los CTA a `.btn primary`
  (**uno por pantalla**), los formularios al patrón `.field` (helpers debajo del input) y purgar
  el `--font-mono` restante. ✅ **Verificado el 2026-09-21: `orders.less` tiene ~10 usos de
  `--font-mono` vivos.** Incluye `.quick-replies` / `.qr-chip`, escritos con px crudos para no
  desentonar con el resto de `support.less`: pasan a tokens (`--fs-caption`…) en la misma tanda.
  El lado de Configuración (`rr-*`) ya nace con tokens.
- **`SalesChart`: eliminar el eje dual** `[S]` — ✅ **verificado el 2026-09-21: sigue con
  `yAxisId="left"` + `yAxisId="right"`** (`SalesChart.jsx:21-22`). Pedidos (barras) e ingresos
  (línea) comparten gráfica con dos escalas Y; la buena práctica de dataviz es separarlos en dos
  charts o indexarlos a una base común.
- **Rol mesero: parte de salón** `[M]` · 🔒 **bloqueado por PLATEO-52** — hoy el mesero tiene
  pedidos, historial, clientes, reservas y menú (lectura); le faltan **mesas**, que exige ampliar
  el CHECK de `tipo_pedido`. Mismo riesgo cross-layer que «venta en mostrador» — ver
  [`dashboard/pos.md`](dashboard/pos.md).
- **Invitar usuarios desde la UI** `[M]` — hoy se crean a mano en Supabase porque la admin API
  exige `service_role`, que no puede ir en el bundle. Si se quiere en el dashboard: Edge Function
  o webhook en n8n, **nunca desde React**. La pantalla de Usuarios ya explica el flujo manual, así
  que esto es comodidad, no un bloqueo.

## POS — impresión de tickets y cajón

**Analizado el 2026-07-30, no priorizado, sin código.** El hardware ya está en el local (Epson
TM-T88 + cajón 3nStar CD350) y la clienta decidió **no** hacer facturación electrónica DIAN por
ahora, lo que elimina la parte difícil.

→ **El análisis completo está en [`dashboard/pos.md`](dashboard/pos.md)**: plan A/B de impresión,
enganche en el código, contenido de los dos tickets, y los adyacentes (arqueo de caja, venta en
mostrador, DIAN, operación offline).

Antes de empezar hay que confirmar **tres datos del local**: si la impresora está por USB o por
red, si el cajón ya está en el puerto DK, y qué PC hay.

## Features nuevas

> Priorización sugerida para vender el SaaS: **Resumen diario WA + Modo TV** (wow inmediato,
> esfuerzo bajo). **Métricas del bot** es la carta de ROI para nuevos clientes. **Campañas de
> reactivación** es la que genera ingresos directos al restaurante.

- **Resumen diario por WhatsApp al dueño** `[S — solo n8n]` — cron que al cierre (~23:00 Colombia)
  manda el pulso del día: nº de pedidos, ingresos, producto top, cancelados. Deja «sentir» el
  negocio sin abrir el dashboard. Reutiliza infra existente y la agregación es la misma lógica del
  RPC `historial_resumen`.
- **Modo TV para cocina (KDS)** `[S-M]` — botón «Modo pantalla» que abre el kanban a pantalla
  completa (sin sidebar, cards gigantes, cronómetro por pedido con color según demora, sonido
  fuerte) para una tablet o TV en cocina. **Alto valor en demos.**
- **Metas y racha del mes** 🏆 `[S]` — el dueño fija una meta mensual en Configuración
  (`info_negocio`); header y estadísticas muestran el progreso vs. meta y vs. el mes anterior.
  Gamificación barata que genera hábito de uso.
- **Insights automáticos** `[M]` — card en Estadísticas con 2-3 frases generadas **por reglas**
  sobre agregaciones que ya se calculan («los viernes vendes 40% más», «Pizza Hawaiana lleva 30
  días sin venderse», «5 clientes frecuentes no piden hace un mes» — esto último ya lo calcula
  `RiskClients`). Se siente como IA, es solo agregación.
- **Métricas del bot** 🤖 `[M]` — conversaciones atendidas solo por el bot vs. handoffs a humano,
  conversión chat→pedido, horas pico. **Demuestra el ROI del bot = carta de venta para los
  próximos clientes del SaaS.** Data: `n8n_chat_histories` + `mensajes_soporte` + `pedidos.origen`.
- **Campañas de reactivación en lote** `[M-L]` — el **envío individual ya está hecho**
  (2026-07-23): `RiskClients` manda la plantilla `reactivacion_cliente` con `PromoModal`. Falta el
  **masivo**: seleccionar un segmento (inactivos 30+ días) y enviar en lote — debe ir por **n8n**
  (límites de tier de Meta + no exponer el token). Requiere opt-in y cuidar la calidad del número.

## Marca y producto — Plateo

> **Plateo** es el software (el SaaS que vendemos a muchos restaurantes); **Vera** es solo el
> primer cliente. Hoy toda la UI dice «Vera Pizzería» y se pierde el concepto de producto. Hay que
> separar la **marca del producto** (Plateo, constante) de la **marca del cliente** (Vera, por
> tenant).

- **Branding Plateo en la plataforma** `[M]` — la regla mental: el operador (Vera) ve **su** marca
  en el contenido (logo, nombre del negocio desde `info_negocio`), mientras Plateo aparece como
  **el producto** en el chrome: login («Plateo · para Vera Pizzería»), footer «Powered by Plateo»,
  favicon y título de pestaña, pantalla de carga, emails y PDFs exportados. Requisito multi-tenant:
  el nombre del cliente sale **de datos**, nunca hardcodeado. Definir tokens de marca Plateo
  (color, logo) separados del tema por-cliente.
- **Landing / sitio de marketing** `[M-L]` — página pública que vende Plateo a nuevos restaurantes
  (bot + dashboard + reservas), con demo, precios y captura de leads. Frente comercial, distinto
  del dashboard operativo.
- **Programa de referidos** `[M]` — que un cliente refiera a otro restaurante y reciba un
  beneficio (descuento o mes gratis) cuando el referido se activa. Necesita código o link de
  referido por cliente, tracking referido→activación, y un sitio donde el cliente vea sus
  referidos. Encaja con el cobro tipo SaaS del control plane. **Palanca de crecimiento barata: los
  dueños de restaurante se conocen entre sí.**

## Visión SaaS

- **Multi-cliente por silo** — un proyecto Supabase + una instancia n8n por cliente (aislamiento
  físico, migraciones-como-código), y **una sola app React desplegada una vez** que resuelve el
  tenant por subdominio. El dominio real es **`plateo.cloud`**: sitio público en
  `www.plateo.cloud`, cada cliente en su subdominio con deploy aparte vía DNS (Vera en
  `vera.plateo.cloud`).
  > El `vera.lessplus.net` que aparece en el changelog del 2026-06-19 era un nombre tentativo que
  > **nunca existió en DNS**. No usarlo como referencia.
- **Control plane** con cobro tipo SaaS (Stripe) — futuro.
