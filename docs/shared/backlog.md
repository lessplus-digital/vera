# Backlog — Features y mejoras pendientes

> Qué queremos construir o mejorar — **no son bugs** (esos van en
> [`bug-tracker.md`](bug-tracker.md)). Al completar un ítem: quítalo de aquí y registra la
> decisión/el cambio en [`changelog.md`](changelog.md).

## Seguridad (riesgo diferido consciente)

- **Proxy para envíos de WhatsApp** — `VITE_WA_ACCESS_TOKEN` viaja en el bundle del dashboard
  (y además quedó en el historial de versiones de n8n). El fix real: enrutar los sends del
  dashboard por n8n o una edge function, y **rotar el token** (actualizar credencial n8n +
  `.env.local`). Mientras tanto es el único secreto expuesto conocido del sistema.

## Bot

- **Revalidar `disponible` al cerrar el pedido** — desde el fix del 2026-07-28 el bot ya no
  ofrece ni agrega productos agotados, pero un item puede agotarse **mientras** ya está en el
  carrito (el admin lo marca desde la pestaña Menú entre que el cliente arma el pedido y lo
  confirma). `crear_orden_completa` no revisa `menu.disponible` al insertar, así que ese pedido
  entra igual y el problema aparece en cocina. Fix: validar disponibilidad en el sub
  `Crear_orden_completa` y devolver `{ ok: false, error: 'agotado', items: [...] }` para que el
  Agente Pedidos avise y devuelva al cliente al Agente Menú a sustituir el item.

## Housekeeping

- **Datos de prueba de roles en la BD de PRODUCCIÓN** `[S]` — sembrados el **2026-08-12** para
  validar los tres roles en el navegador. **Se dejan a propósito** hasta terminar las pruebas
  exhaustivas; bórralos cuando ya no hagan falta.

  | Qué | Cuánto | Identificador |
  |---|---|---|
  | Usuarios de Auth + su perfil | 3 | `mesero.prueba@vera.test` · `domi.prueba@vera.test` · `domi2.prueba@vera.test` |
  | Pedidos ficticios de hoy | 4 | `PED-234`…`PED-237` (`notas = 'PRUEBA ROLES — borrar'`) |
  | Cliente ficticio | 1 | `ZZ Cliente Prueba Roles` (`573000000099`) |
  | Pedidos históricos con `domiciliario_id` puesto | 61 | pedidos **reales/sembrados** a los que se asignó repartidor para poblar el historial |

  ⚠️ **Los 4 pedidos ficticios cuentan en las estadísticas del día** mientras existan.

  El teléfono `573000000099` es falso **a propósito**: marcar entregado dispara
  `notificar-estado-pedido`, que hace POST a n8n y este le escribe por WhatsApp al número del
  pedido. Con un cliente real le llegaría un mensaje sobre un pedido que nunca hizo. **No
  reasignes esos pedidos a un cliente real para probar.**

  Limpieza (el primer UPDATE deshace la asignación de los 61 históricos):

  ```sql
  update public.pedidos set domiciliario_id = null where domiciliario_id is not null;
  delete from auth.users where email like '%.prueba@vera.test';
  delete from public.pedidos where notas = 'PRUEBA ROLES — borrar';
  delete from public.clientes where telefono = '573000000099';
  ```

  Si para entonces se hubieran subido fotos de perfil, además:
  `delete from storage.objects where bucket_id='avatares';` y borrar los archivos desde el panel
  de Supabase (quitar solo la fila deja el objeto colgado en S3 — misma trampa que el blob de
  `comprobantes` de abajo).

- **Borrar `comprobantes/PED-109.jpg` de Storage** — blob huérfano que dejó el bug del `.first()`
  (era una copia del comprobante de `PED-223` guardada con el nombre equivocado). Desde el fix de
  BUG-028 **ya no hay ninguna referencia en la BD** (`PED-109.comprobante_url` es `NULL`), así que
  es inofensivo. No se puede borrar por SQL: quitar la fila de `storage.objects` dejaría el archivo
  real colgado en S3. Hay que hacerlo desde el dashboard de Supabase (Storage → comprobantes) o con
  la Storage API usando la `service_role`.

## Reservas

- **Plantilla de WhatsApp con el costo del montaje** — la confirmación que manda el **dashboard**
  usa `recordatorio_reserva` (Meta, 4 params: nombre, fecha, hora, personas), así que **no incluye
  la ocasión ni su costo**: el cliente recibe la confirmación sin ver los $80.000 del cumpleaños.
  El bot sí se lo dice, porque su respuesta es texto libre dentro de la ventana de 24h. Fix: crear
  y aprobar en WhatsApp Manager una plantilla de 6 params (+ ocasión, + costo) y agregarla a
  `WA_TEMPLATES`. No se puede resolver desde el código: hay que aprobarla en Meta primero.
- **Editar una reserva ya creada** — hoy `ReservationDetail` solo permite eliminar. Con los
  motivos, cambiar la ocasión de una reserva existente obliga a borrarla y recrearla (lo que
  dispara dos WhatsApps al cliente). El trigger `trigger_costo_motivo` ya soporta el UPDATE.
- **Ocasiones editables desde la tab Configuración** — `motivos_reserva` (nombre, costo, activo)
  se cambia hoy con un `UPDATE` a mano. Los precios sembrados el 2026-08-10 son **placeholder**.

## Dashboard

- **`useOrders`: exponer estado `error` en el UI** — hoy un fallo de fetch solo hace
  `console.error` (el spinner infinito ya se arregló en BUG-013); falta un banner/toast para
  que el admin se entere sin abrir la consola.
- **Design system: migrar pedidos, reservas y soporte** — clientes y estadísticas ya usan el
  sistema (ver `docs/dashboard/design-system.md`); faltan los modales/botones de
  `orders.less`, `reservations.less` y `support.less`: llevar CTAs a `.btn primary` (1 por
  pantalla), formularios al patrón `.field` (helpers debajo), y purgar `--font-mono` restante.
  Incluye `.quick-replies` / `.qr-chip` (2026-08-12): se escribió con px crudos para no
  desentonar con el resto de `support.less`, y debe pasar a tokens (`--fs-caption`, etc.) en la
  misma tanda. El lado de Configuración (`rr-*`) ya nace con tokens.
- **`SalesChart`: eliminar el eje dual** — pedidos (barras) + ingresos (línea) comparten
  gráfica con dos escalas Y; la buena práctica de dataviz es separarlos en dos charts o
  indexarlos a una base común.

## POS — impresión de tickets + cajón de dinero (análisis 2026-07-30)

> **Objetivo comercial:** reemplazar el POS + programa de facturación que la clienta ya usa
> hoy. **Decisión del cliente (2026-07-30): sin facturación electrónica DIAN por ahora** — se
> imprimen comprobantes internos, no documentos fiscales. Eso elimina la única parte
> realmente difícil del problema. **Analizado, no priorizado: no se ha escrito código.**

- **Impresión de factura del cliente + orden del domiciliario** `[S-M]` — dos formatos
  térmicos disparados desde el kanban. El **hardware ya existe en el local** (no hay que
  comprar nada):
  - Impresora **Epson serie TM-T88** (probablemente IV o V). Papel de 80mm → **~72mm útiles**:
    ese es el ancho contra el que hay que diseñar.
  - Cajón **3nStar CD350, 24V, RJ11**. Es un periférico *tonto*: no se conecta al PC, se
    enchufa al puerto **DK** de la impresora y esta lo abre con un pulso de 24V. Voltaje
    compatible con la serie TM-T88. **Nunca se le habla al cajón, se le habla a la impresora.**
  - **Plan A (recomendado):** `window.print()` + CSS `@media print` con `@page` a 72mm, y
    Chrome lanzado con `--kiosk-printing` para que no salga el diálogo (exige la térmica como
    impresora **predeterminada** del PC). El **cajón y el corte de papel no requieren código**:
    el driver de Epson (*Advanced Printer Driver*, APD) trae la pestaña **Peripherals** con
    apertura de cajón antes/después de imprimir, y corta el papel al cerrar el documento.
    Cero instalación en el PC del cliente → es el único camino que respeta la visión
    multi-tenant ("una sola app React desplegada una vez", ver sección SaaS abajo).
  - **Plan B (solo si el driver no trae la opción de cajón):** ESC/POS crudo por WebUSB /
    Web Serial, o un agente local (QZ Tray). Menos arriesgado de lo habitual porque Epson
    **inventó** ESC/POS y su implementación es la de referencia, pero en Windows suele exigir
    cambiar el driver por uno genérico y añade fricción de despliegue por cliente.
  - **Enganche en el código:** `OrderActions.jsx` (cambios de estado) y `CreateOrderModal.jsx`.
    La data ya está disponible sin queries nuevas — `useOrders` trae `detalle_pedidos`
    embebido. Los textos del negocio (nombre, dirección, teléfono) **se leen de `info_negocio`
    vía `useBusinessInfo`, nunca hardcodeados**: requisito del modelo multi-tenant.
  - **Contenido acordado** — *Factura cliente:* datos del negocio, nº de pedido, fecha, items
    con cantidad y precio unitario, recargo de domicilio si aplica, total, método de pago y
    nota "comprobante interno — no válido como factura". *Orden del domiciliario:* letra
    grande y sin adornos — nº de pedido, nombre y teléfono del cliente, dirección completa,
    items, total a cobrar y **método de pago destacado** (que se vea de un vistazo si hay que
    recibir efectivo o si ya pagó por transferencia).
  - **Info del local pendiente de confirmar antes de empezar:** (1) ¿impresora por **USB o por
    red**? — si es de red aparece la vía `ePOS-Print` propia de Epson, pero choca con
    contenido mixto (dashboard HTTPS → impresora HTTP en LAN), así que USB es notablemente
    más simple; (2) ¿el cajón ya está enchufado al puerto DK?; (3) qué PC y si tiene Chrome.
  - **Riesgos asumidos:** los márgenes en 80mm por navegador son quisquillosos — hay que
    contar con **2-3 rondas de ajuste contra impresiones físicas reales**, porque sin acceso
    al hardware no se puede validar el resultado. **No desconectar el POS actual hasta probar
    un día completo de operación real.**

**Adyacentes analizados el 2026-07-30, fuera de alcance de esta tarea:**

- **Caja / arqueo de turno** `[M]` — tablas nuevas `turnos_caja` (apertura, base, cierre,
  conteo declarado vs. esperado) y `movimientos_caja` (gastos, retiros, propinas). El esperado
  en efectivo se agrega desde `pedidos`. **Tres trampas del esquema:** `fecha_pedido` es
  `timestamp` sin zona con valor UTC (usar `parseDb()`), el día de negocio arranca 05:00 UTC,
  y `pedidos.total` **ya incluye el domicilio** — si no se separan, el arqueo cuadra mal cuando
  el domicilio lo cobra el repartidor. ✅ **Esta última dejó de ser una trampa el 2026-08-18:**
  el envío vive en `pedidos.costo_domicilio` y ya no hay que despejarlo restando; el efectivo
  de producto es `total − costo_domicilio`. Ojo: **ya no es una constante**, varía por zona.
- **Venta en mostrador** `[M — cross-layer, riesgo]` — `CreateOrderModal` ya es el 80%, pero
  faltan dos cosas: el cliente es obligatorio (en mostrador nadie da el teléfono → cliente
  genérico o `cliente_id` nullable, **verificar si hoy lo es**) y `tipo_pedido` tiene un CHECK
  de `domicilio`/`recoger`. Ampliarlo a `mesa`/`mostrador` **toca la BD compartida y los
  prompts del bot** — es el único punto donde el POS puede romper la capa 1.
- **Facturación electrónica DIAN** `[L — legal]` — descartada por ahora. Si algún día se
  necesita: **integrar un proveedor autorizado por API desde n8n**, jamás implementar la firma
  XML/UBL ni el CUFE en casa, y jamás desde el navegador (mismo motivo que el token de
  WhatsApp de la sección Seguridad: las credenciales no pueden viajar en el bundle).
- **Operación offline** `[L]` — un POS de verdad debe cobrar sin internet; hoy todo depende de
  Supabase en vivo. Si se cae la conexión en el rush no hay kanban, ni comanda, ni cobro.
  Exige cola local + sincronización: es un rediseño, no una feature.

## Features nuevas (ideas 2026-07-23)

> Priorización sugerida: el top para vender el SaaS es Resumen diario WA + Tab Reseñas +
> Modo TV (wow inmediato, esfuerzo bajo). Métricas del bot es la carta de ROI para nuevos
> clientes. Campaña de reactivación es la que genera ingresos directos al restaurante.

- **Resumen diario por WhatsApp al dueño** `[S — solo n8n]` — cron en n8n que al cierre
  (~23:00 Colombia) envía al dueño un mensaje con el pulso del día: nº de pedidos, ingresos,
  producto top, cancelados. Deja "sentir" el negocio sin abrir el dashboard. Reutiliza la
  infra existente (n8n + WA); la agregación es la misma lógica del RPC `historial_resumen`.
- ~~**Tab Reseñas 💬**~~ ✅ **Hecho (2026-07-23)** — implementada con doble propósito (pulso de
  satisfacción + cola de recuperación con "Responder por WhatsApp"). Ver `changelog.md` y
  `docs/dashboard/components.md` §9.
- **Métricas del bot 🤖** `[M]` — conversaciones atendidas solo por el bot vs. handoffs a
  humano, tasa de conversión chat→pedido, horas pico de chat. Demuestra el ROI del bot =
  carta de venta para los próximos clientes del SaaS. Data: `n8n_chat_histories` +
  `mensajes_soporte` + `pedidos.origen`.
- **Modo TV para cocina (KDS)** `[S-M]` — botón "Modo pantalla" que abre el kanban
  fullscreen (sin sidebar, cards gigantes, cronómetro por pedido con color según demora,
  sonido fuerte) para poner en una tablet/TV en cocina. Alto valor en demos.
- **Metas y racha del mes 🏆** `[S]` — el dueño fija una meta mensual de ventas en
  Configuración (`info_negocio`); header/estadísticas muestran barra de progreso vs. meta y
  vs. el mes anterior. Gamificación barata que genera hábito de uso.
- **Insights automáticos** `[M]` — card en Estadísticas con 2-3 frases generadas por reglas
  sobre agregaciones que ya se calculan (ej. "los viernes vendes 40% más", "Pizza Hawaiana
  lleva 30 días sin venderse", "5 clientes frecuentes no piden hace un mes" — esto último ya
  lo calcula `RiskClients`). Se siente como IA, es solo agregación.
- **Campañas de reactivación** `[M-L]` — el **envío individual ya está hecho** (2026-07-23):
  `RiskClients` en Estadísticas manda la plantilla `reactivacion_cliente` con `PromoModal`. Falta
  el **masivo/bulk**: seleccionar un segmento (inactivos 30+ días) y enviar en lote — debe ir por
  **n8n** (límites de tier de Meta + no exponer el token en el navegador). Requiere opt-in y cuidar
  la calidad del número.
- **Recordatorio de reserva por WhatsApp (n8n)** `[M]` — la plantilla `recordatorio_reserva` ya se usa
  en el dashboard como **confirmación al crear** (2026-07-28); falta el **cron en n8n** para el
  recordatorio del **día previo**: diario busca reservas de mañana (estado pendiente/confirmada) → envía la
  plantilla (nombre/fecha/hora/personas desde `reservas`). Reduce no-shows. Decisión 2026-07-23: se
  hace en una pasada aparte. **Los taps `Confirmar` / `Cancelar` ya están enrutados**
  (2026-07-29): `Normalizar tap` los reescribe a "Confirmar/Cancelar mi reserva" y el
  ORQUESTADOR los manda al AGENTE RESERVAS, que ya tiene `consultar_reservas_cliente` y
  `cancelar_reserva`. Lo que falta aquí es **solo el cron**.
- ~~**Enrutar taps de botón de plantillas en el bot (n8n)**~~ ✅ **Hecho (2026-07-29)** — nodo
  `Normalizar tap` + tercera salida del Switch inicial. Ver `changelog.md` y
  `docs/bot/n8n-workflow.md`. **Pendiente: probar los 4 taps en real** — el fix se verificó
  contra el payload de una ejecución real y contra los labels que devuelve Graph API, pero
  todavía no se ha tapeado ningún botón desde WhatsApp después del cambio.
- ~~**Roles de usuario**~~ ✅ **Etapa 1 hecha (2026-08-12)** — `perfiles` + RLS por rol
  (`admin`/`mesero`/`domiciliario`), verificada con suplantación por API. Ver `changelog.md`
  y `docs/database/schema.md` §Modelo de permisos. **Falta:**
  - ~~**Etapa 2**~~ ✅ **hecha (2026-08-12)** — `AssignCourier` en el kanban, `DeliveriesPage`
    para el repartidor y entrega por RPC. Incluyó cerrar un hueco: el mesero podía asignar
    domiciliarios por API porque la RLS no limita columnas.
  - ~~**Etapa 3**~~ ✅ **hecha (2026-08-12)** — bucket `avatares` con políticas por carpeta,
    "Mi perfil" en el menú superior (todos los roles) y Configuración → Usuarios para asignar
    rol y activar/desactivar.
  - **Rol mesero: parte de salón** — bloqueado por PLATEO-52. Hoy el mesero tiene pedidos,
    historial, clientes, reservas y menú (lectura); le falta mesas, que exige ampliar el CHECK
    de `tipo_pedido` — ver "Venta en mostrador" arriba, mismo riesgo cross-layer.
  - **Limpiar `pedidos.repartidor`** `[S]` — columna muerta (NULL en los 105 pedidos) que
    quedó sustituida por `domiciliario_id`. Solo la lee `OrderDetailModal`; eliminarla exige
    tocar esa lectura.
  - **Invitar usuarios desde la UI** `[M]` — hoy se crean a mano en Supabase porque la admin
    API exige `service_role`, que no puede ir en el bundle. Si se quiere en el dashboard: Edge
    Function o webhook en n8n, nunca desde React. La pantalla de Usuarios ya explica el flujo
    manual, así que esto es comodidad, no un bloqueo.
  - **Avatares huérfanos en Storage** `[S]` — al cambiar de foto se borra la anterior en
    best-effort; si ese borrado falla queda el archivo suelto (se prefirió eso a arriesgar que
    un usuario se quede sin foto). Si el bucket crece, un barrido que compare
    `storage.objects` contra `perfiles.avatar_url` lo limpia.

## Bot

- **Bloqueo de reservas duplicadas (opcional)** — decisión 2026-07-23 (BUG-008): NO se bloquean
  en BD; una misma persona puede reservar dos veces el mismo día (ej. almuerzo y cena) y el
  agente lo maneja conversacionalmente. Si algún día se quiere bloquear: extender
  `trigger_validar_cupo` o query previa al INSERT en `Sub — Crear Reserva`.

## Marca y marketing — Plateo (el producto)

> **Plateo** es el software (el SaaS que vendemos a muchos restaurantes); **Vera** es solo
> el primer cliente/instancia. Hoy toda la UI dice "Vera Pizzería" y se pierde el concepto de
> producto. Hay que separar la **marca del producto** (Plateo, constante en todos los clientes)
> de la **marca del cliente** (Vera, por tenant). Ver también la visión SaaS abajo.

- **Branding Plateo en la plataforma** `[M]` — introducir la identidad de Plateo sin borrar
  la del cliente. La regla mental: el operador (Vera) ve **su** marca en el contenido (logo,
  nombre del negocio desde `info_negocio`), mientras que Plateo aparece como **el producto**
  en el chrome/marca de agua: login ("Plateo · para Vera Pizzería"), footer/"Powered by
  Plateo", favicon/título de pestaña, pantalla de carga, emails/PDFs exportados. Requisito
  para el modelo multi-tenant: el nombre del cliente debe salir de datos (`info_negocio`,
  que ya tiene el nombre del negocio), nunca hardcodeado — así la misma app sirve a cualquier
  cliente. Definir tokens de marca Plateo (color, logo) separados del tema por-cliente.
- **Landing / sitio de marketing de Plateo** `[M-L]` — página pública que vende Plateo a
  nuevos restaurantes (bot WhatsApp + dashboard + reservas...), con demo, precios y captura
  de leads. Es el frente comercial del SaaS, distinto del dashboard operativo.
- **Programa de referidos** `[M]` — que un cliente de Plateo (ej. Vera) refiera a otro
  restaurante y reciba un beneficio (descuento en su mensualidad / mes gratis) cuando el
  referido se activa. Necesita: código o link de referido por cliente, tracking de referido→
  activación, y un lugar donde el cliente vea sus referidos y su recompensa (sección en el
  dashboard o en el control plane). Encaja de forma natural con el cobro tipo SaaS (Stripe)
  del control plane de abajo. Palanca de crecimiento de bajo costo: los propios dueños de
  restaurante se conocen entre sí.

## SaaS (visión — ver changelog 2026-06-19)

- **Multi-cliente por silo:** un proyecto Supabase + una instancia n8n por cliente
  (aislamiento físico, migraciones-como-código), una sola app React desplegada una vez que
  resuelve el tenant por subdominio. **El dominio real es `plateo.cloud`** (sitio público
  `www.plateo.cloud`; cada cliente en su subdominio con deploy aparte vía DNS — Vera está en
  `vera.plateo.cloud`). El `vera.lessplus.net` que figuraba aquí y en el changelog del 2026-06-19
  era un nombre tentativo que **nunca existió en DNS** — no usarlo como referencia.
- **Control plane** con cobro tipo SaaS (Stripe) — futuro.
