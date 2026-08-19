# Dashboard Admin — React + Vite

## Stack del frontend

- **React** (sin framework, SPA)
- **Vite** (build tool)
- **Supabase JS Client** (datos + realtime)
- **Recharts** (gráficas de la tab Estadísticas)
- **react-big-calendar + date-fns** (calendario de la tab Reservas, locale es)
- **WhatsApp Cloud API** (envío directo vía `src/lib/whatsapp.js`, Meta Graph API)
- **Supabase Auth** (login email+password, sesión persistida)
- **Estilos:** `index.css` (tokens/base) + un `.less` por feature (auth, orders, support, statistics, clients, reservations, menu, settings, history, reviews, deliveries), importados en `main.jsx`
- **Responsive:** `useMediaQuery` — el Sidebar colapsa a solo-iconos ≤1024px y a cajón (drawer) ≤768px
- **Sin router** — navegación por tabs internas vía estado `activeTab`; la app se separa en gate de auth (`App`) + shell autenticado (`DashboardShell`, dentro de `App.jsx`). La navegación es un **Sidebar** colapsable, no el Header
- **Roles** — `admin` / `mesero` / `domiciliario`. La UI se adapta (ver §0), pero **la frontera es la RLS de Supabase**, no React

## Estructura de archivos

```
src/
├── App.jsx                       ← Gate de auth (splash / LoginPage / DashboardShell). DashboardShell
│                                    vive aquí dentro: Sidebar + Header + la tab activa (activeTab)
├── main.jsx                      ← Entry: AuthProvider + imports de estilos (index.css + *.less)
│
├── components/
│   ├── Icon.jsx                  ← Set de iconos SVG (name → path)
│   ├── Avatar.jsx                ← Foto de perfil con fallback a la inicial
│   ├── ProfileModal.jsx          ← "Mi perfil" (nombre, teléfono, foto) — para TODOS los roles
│   ├── Toast.jsx                 ← Toast global del DS (con useToast; patrón .toast en index.css)
│   ├── SortHeader.jsx            ← Encabezado de columna ordenable (patrón .sortable en index.css)
│   └── layout/
│       ├── Sidebar.jsx           ← Navegación principal: colapsable + drawer móvil + badge soporte + toggle tema
│       └── Header.jsx            ← Barra superior: stats del día + hamburguesa (móvil)
│
├── pages/
│   ├── auth/LoginPage.jsx        ← Login email+password (Supabase Auth)
│   ├── dashboard/                ← Kanban de pedidos
│   │   ├── DashboardPage · Column · OrderCard · OrderActions · AssignCourier
│   │   └── CreateOrderModal · EditOrderModal · RejectModal
│   ├── deliveries/               ← DeliveriesPage + DeliveryHistory (rol domiciliario)
│   ├── support/                  ← Chat de soporte
│   │   └── SupportPanel · ConversationItem · ChatBubble · ImageLightbox
│   ├── statistics/               ← StatisticsPage + KPIs + ~10 componentes Recharts
│   ├── history/                  ← HistoryPage + OrderDetailModal (pedidos por rango)
│   ├── clients/                  ← ClientsPage + ClientModal + WelcomeModal
│   ├── reservations/             ← ReservationsPage + ReservationModal + ReservationDetail
│   ├── menu/                     ← MenuPage + ProductModal (disponibilidad del catálogo)
│   ├── reviews/                  ← ReviewsPage + SatisfactionSummary + ReviewCard + ReplyModal + Stars + sentiment.js
│   └── settings/                 ← SettingsPage (shell de 5 sub-vistas) + BusinessInfoSection
│                                    (info_negocio) + DeliveryZonesSection + ZoneModal
│                                    (zonas_entrega + barrios)
│                                    + FaqSection + FaqModal + faqLint.js (faq)
│                                    + QuickRepliesSection + QuickReplyModal (respuestas_rapidas)
│                                    + UsersSection (perfiles)
│
├── hooks/
│   ├── useAuth.jsx               ← AuthProvider + useAuth (sesión + PERFIL/ROL, signIn/signOut)
│   ├── useOrders.js              ← Pedidos del día + realtime + newIds + stats
│   ├── useStatistics.js          ← Filtros + fetch por rango + agregados
│   ├── useSupportCount.js        ← Badge de conversaciones (modo=humano)
│   ├── useSupportConversations.js← Conversaciones + mensajes del panel de soporte
│   ├── useClients.js             ← Clientes + realtime UPDATE + saveClient
│   ├── useReservations.js        ← Reservas + realtime * + create/deleteReservation
│   ├── useReservationReasons.js  ← `motivos_reserva` activos (ocasión + costo), solo lectura
│   ├── useMenu.js                ← Catálogo `menu` + realtime * + setDisponible (optimista)
│   ├── useReviews.js             ← `feedback` + clientes/pedidos embebidos + realtime * (canal feedback-rt)
│   ├── useBusinessInfo.js        ← `info_negocio` clave/valor + saveInfo (sin realtime, adrede)
│   ├── useDeliveryZones.js       ← `zonas_entrega` + `barrios` CRUD + barrios sin zona · useBarrioOptions
│   ├── useFaq.js                 ← `faq` CRUD + toggle activa (optimista) + reordenar (sin realtime)
│   ├── useRespuestasRapidas.js   ← `respuestas_rapidas` CRUD + toggle + reordenar (sin realtime)
│   ├── useDomiciliarios.js       ← Domiciliarios activos + asignarDomiciliario (solo admin)
│   ├── useUsuarios.js            ← RPC listar_usuarios + cambiar rol / activar (solo admin)
│   ├── useDeliveryHistory.js     ← Entregas pasadas de un domiciliario (período + paginado)
│   ├── useOrderHistory.js        ← Pedidos server-side (rango+filtros+orden+página) + realtime *
│   ├── useTheme.js               ← Toggle dark/light (localStorage)
│   ├── useToast.js               ← Estado + timer del toast global (con components/Toast.jsx)
│   └── useMediaQuery.js          ← Media queries (sidebar colapsado / móvil)
│
├── utils/
│   ├── constants.js              ← COLUMNS, METODO_LABEL, ESTADO_PAGO_LABEL, CLIENT_MODES, RESERVATION_*, MOTIVO_DEFECTO, CATEGORY_LABELS/categoryLabel, ORDER_STATES
│   ├── formatters.js             ← timeAgoShort, timeAgo, formatPrice, formatPriceShort, formatPhone
│   ├── quickReplies.js           ← Marcador {nombre} de las respuestas rápidas: aplicarNombre, usaNombre
│   ├── permisos.js               ← Mapa rol→tabs/capacidades (UI). La frontera real es la RLS
│   ├── exportHistory.js          ← Export del historial: CSV (BOM) + Excel con formato (exceljs lazy)
│   ├── dateRanges.js             ← parseDb + rangos con día de negocio Colombia (UTC-5)
│   ├── statsAggregations.js      ← Agregaciones puras de Estadísticas
│   └── audio.js                  ← playNotification + playDeleted (Web Audio)
│
├── lib/
│   ├── supabase.js               ← Cliente Supabase (throws si faltan las VITE_SUPABASE_*)
│   ├── avatares.js               ← Subida al bucket `avatares` + validación + limpieza
│   └── whatsapp.js               ← sendWhatsAppMessage (texto) + sendWhatsAppTemplate (plantillas, fuera de 24h)
│
└── styles/
    ├── index.css                 ← Tokens CSS, base, animaciones, layout, tema
    └── {auth,orders,support,statistics,clients,reservations,menu,settings,history,reviews,deliveries}.less
```

## Layout y navegación

`DashboardShell` (dentro de `App.jsx`) arma `Sidebar` + `Header` + la tab activa:

- **`Sidebar`** — nav principal **filtrada por rol** (§0; `NAV_ITEMS`: Pedidos / Soporte / Estadísticas / Historial /
  Clientes / Reservas / Menú / Reseñas / Configuración), badge de soporte, toggle de tema en el pie. `collapsed` (solo iconos) en tablet
  (≤1024px) y `mobile-open` (cajón con backdrop) en móvil (≤768px), vía `useMediaQuery`.
- **`Header`** — muestra `stats` del día y `lastUpdate`; en móvil enseña la hamburguesa que
  abre el cajón. Ya **no** contiene los tabs (migraron al Sidebar).
- El tema (`useTheme`) vive en `App` para aplicar también en el login.

## Tabs principales

### 0. Autenticación y roles

**Archivos:** `src/App.jsx` (gate) · `src/hooks/useAuth.jsx` · `src/utils/permisos.js` ·
`src/components/layout/Sidebar.jsx`

`App` es un gate de tres pasos: splash mientras cargan **sesión y perfil**, `LoginPage` si no hay
sesión, y pantalla **"sin acceso"** si hay sesión pero no rol utilizable (cuenta desactivada, o
recién creada en Supabase y todavía sin rol asignado). Solo entonces monta `DashboardShell`.

**El rol vive en `AuthProvider`, no en `DashboardShell`.** Es la excepción declarada a la regla de
CLAUDE.md ("los hooks de datos van en el shell"): el rol no es dato de dominio, decide **qué
pantallas existen**, así que tiene que estar resuelto antes de montar el shell. El motivo de la
regla se respeta igual — el efecto no consulta nada mientras no haya sesión.

- Se lee de `perfiles` en cada arranque. **Nunca de localStorage ni del JWT:** aunque la RLS no se
  dejaría engañar por un valor manipulado, la UI mostraría pantallas que luego llegan vacías
- Realtime sobre la **propia** fila de `perfiles`: si un admin te degrada o te desactiva, se
  aplica sin recargar. Sin esto la UI seguiría intacta con todas las consultas llegando vacías
- `perfil.activo === false` ⇒ `rol = null`, igual que `mi_rol()` en la BD

**`utils/permisos.js` — conveniencia, no seguridad.** Mapea rol → tabs visibles y capacidades
(`asignarDomiciliario`, `editarPedido`, `marcarEntregado`…). Existe para no mostrarle a un mesero
una tab Soporte que la BD le devuelve vacía y parece rota. **La frontera es la RLS** (ver
`../database/schema.md` §Modelo de permisos): el JWT viaja en cada llamada REST y de realtime, así
que lo que un rol no debe ver se corta en Postgres, lo diga o no este archivo.

> Al tocarlo: cada entrada debe corresponder a una política real. Aflojar aquí sin aflojar la RLS
> da una pantalla que llega vacía; aflojar la RLS sin actualizar aquí abre un agujero de verdad.

El sidebar **oculta** lo que el rol no tiene en vez de deshabilitarlo (una opción deshabilitada
invita a pedir el permiso; una ausente no forma parte del trabajo del rol) y muestra el rol activo
donde antes decía "Admin" fijo. `DashboardShell` comprueba el permiso **al renderizar cada tab**,
no solo al pintar el sidebar, y reencamina si el rol cambia en vivo y la tab abierta deja de
existir.

**Alcance por rol hoy:** admin todas las tabs · mesero pedidos, historial, clientes, reservas y
menú · domiciliario solo pedidos, donde ve **su propia pantalla** (§2b), no el kanban.

### 1. Pedidos (Kanban)

**Vista:** 3 columnas — Por aprobar, En cocina, En camino / Recoger
**Datos:** `useOrders` hook — fetch + suscripción realtime a tabla `pedidos`
**Notificaciones:** Audio (`playNotification`) + animación `new-order` 8s cuando llega pedido nuevo

**Cada OrderCard muestra:**
- Número de pedido (truncado a 8 chars)
- Teléfono, tipo (domicilio/recoger), método de pago
- Items con precio unitario (`detalle_pedidos`); las pizzas **mitad y mitad** llevan el
  distintivo `.mm-tag` (`½+½`) y muestran además la **masa**, que solo vive en `mitades[0].variante`
- Total, notas del cliente
- Estado del comprobante (transferencia pendiente / botón ver)
- Botones de acción según estado (`OrderActions`)

**Acciones disponibles por estado:**
| Estado | Acciones |
|---|---|
| `pendiente` | Aprobar → en_cocina, Rechazar (con motivo), Editar items |
| `en_cocina` | Marcar listo → en_camino (domicilio) o recoger (pickup) |
| `en_camino` | Marcar entregado |
| `recoger` | Marcar entregado |

**Crear pedido manual (`CreateOrderModal`):**
- Botón compacto "+ Crear" junto al label de la columna "Por aprobar" (no desplaza las cards)
- Selecciona cliente de la tabla `clientes` (búsqueda por nombre o teléfono); la dirección se prellena con `direccion_principal`
- Tipo (domicilio/recoger), método de pago (`'Efectivo'`/`'Transferencia'` — capitalizado, como espera `METODO_LABEL`), items del menú (misma UX que `EditOrderModal`) y notas
- Insert directo: `pedidos` (`estado: 'pendiente'`, `total: 0`) → `detalle_pedidos` (ids `DET-M<uuid>-N`); el trigger calcula el total. Si fallan los items, borra el pedido (rollback best-effort)
- Lee el total final de la BD y notifica al cliente por WhatsApp con el resumen; si WA falla, el pedido queda creado y se muestra advertencia en el modal

#### 1b. El kanban según el rol (2026-08-12)

El kanban lo ven **admin y mesero**. El domiciliario recibe otra pantalla en la misma tab (§2b).

- **`AssignCourier`** — selector de domiciliario dentro de la tarjeta, en pedidos a domicilio.
  Solo lo monta `OrderCard` si `puede(rol, 'asignarDomiciliario')`. Escribir `domiciliario_id`
  **es** lo que hace aparecer el pedido en la pantalla del repartidor: la política RLS filtra por
  esa columna, así que asignar y "dar acceso" son el mismo acto
- **La lista de domiciliarios se carga una vez en `DashboardPage`** y baja a las tarjetas. Si cada
  `OrderCard` la pidiera, serían N consultas idénticas en el rush
- **`OrderActions` lee el rol del contexto**, no por props: son cuatro niveles (App → DashboardPage
  → Column → OrderCard) y solo lo necesitan las hojas
- **La entrega va SIEMPRE por el RPC `marcar_entregado`**, para todos los roles. Para el
  domiciliario es obligatorio (no tiene política de UPDATE); para admin y mesero se usa igual para
  no tener dos caminos que puedan divergir. De paso desapareció el `fecha_entrega` que el JS
  mandaba a mano: lo pone `trigger_fecha_entrega`, y era la misma verdad escrita dos veces

> **Ocultar un botón no es un permiso.** Todo lo de arriba lo respalda la BD: aprobar y cancelar
> son UPDATE (el domiciliario no tiene esa política), y **asignar está limitado a admin por
> `trigger_validar_asignacion`, no por RLS** — el mesero necesita UPDATE sobre `pedidos` para el
> flujo de cocina, y una política no puede limitar una sola columna. Sin ese trigger podía
> reasignar el reparto por API aunque la UI no se lo ofreciera (se encontró probándolo).

### 2. Soporte (Chat)

**Vista:** Sidebar de conversaciones activas + panel de chat
**Condición:** Solo muestra clientes donde `modo = 'humano'`
**Datos:** Realtime en `mensajes_soporte` + `clientes`

**Funcionalidad:**
- Ver historial de mensajes con el cliente
- Enviar mensaje directo por WhatsApp API
- Ver imágenes en lightbox
- Resolver conversación → cambia `modo` a `'bot'` + notifica al cliente
- Badge en el tab muestra cantidad de conversaciones activas (`useSupportCount`)
- **Respuestas rápidas** (2026-08-12): chips sobre el input con el texto enlatado de
  `respuestas_rapidas` (`useRespuestasRapidas`, solo lectura aquí)

**Respuestas rápidas — un clic ESCRIBE, nunca envía.** El chip inserta el texto en el textarea
**en la posición del cursor** y el operador lo revisa, lo completa y presiona Enviar. Enviar de
golpe se descartó a propósito: un clic accidental sale a WhatsApp sin vuelta atrás. Detalles:
- El marcador `{nombre}` se resuelve al insertar, con `aplicarNombre()` de
  `src/utils/quickReplies.js` y el nombre de `conversaciones_soporte` (ver §8c)
- Si ya había texto escrito, se separa con un espacio en vez de pegar las palabras
- Solo se pintan las `activa`; sin respuestas configuradas la barra **no se renderiza** (y su
  `border-top` desaparece con ella — de ahí la regla `.quick-replies + .input-area`)
- Con muchas respuestas la fila hace **scroll lateral**, no crece hacia arriba comiéndose el
  historial
- El alto del textarea lo ajusta **un solo `useEffect` sobre `inputText`**, no cada handler:
  asignar `value` por código no dispara `onInput`, y medir `scrollHeight` antes de que React
  pinte da el alto viejo (la caja no se encogía al enviar)

**Contexto al recibir una escalada (2026-08-10):** al pasar un cliente a `modo='humano'`, el
trigger `trigger_contexto_handoff` vuelca la conversación reciente con el bot a
`mensajes_soporte` y deja una nota de sistema. El operador abre la conversación y **ya ve el
problema que el cliente explicó** en vez de una pantalla vacía. Los 4 valores de `origen`
que renderiza `ChatBubble` (mapa `ROLES`):

| `origen` | Lado | Etiqueta | Aspecto |
|---|---|---|---|
| `admin` | derecha | Tú | `--blue-dim`, es lo que escribió el operador |
| `cliente` | izquierda | Cliente | `--bg-card`, burbuja normal |
| `bot` | izquierda | Bot | `--bg-inset` + borde **punteado** y texto atenuado — es contexto pasado recuperado del historial, no algo que responder. Sin color nuevo, a propósito |
| `sistema` | centrado | — | Píldora gris (`.bubble-system`): escalada y resolución |

Un `origen` desconocido cae en `cliente` (fallback del mapa), no rompe el render.

### 2b. Mis entregas (rol domiciliario)

**Vista:** dos sub-vistas — **Activas** (resumen de la ronda + tarjetas) e **Historial**
**Datos:** `useOrders` para las activas · `useDeliveryHistory` para el historial
**Archivos:** `src/pages/deliveries/DeliveriesPage.jsx` + `DeliveryHistory.jsx` +
`src/hooks/useDeliveryHistory.js` + `src/styles/deliveries.less`

Ocupa la tab Pedidos cuando el rol es `domiciliario` (el sidebar la renombra a **Mis entregas**).
Las cuatro columnas del kanban son flujo de cocina, no su trabajo: él necesita a dónde va, cuánto
cobra y un botón.

**No filtra por `domiciliario_id` en JS, a propósito:** `useOrders` ya llega filtrado por la
política `pedidos_select`. Si esta pantalla mostrara de más, el fallo estaría en la RLS, no aquí.

- Resumen: entregas en camino, en preparación y **cuánto efectivo lleva por cobrar** — lo que va a
  tener en el bolsillo al terminar la ronda
- Tarjeta pensada para un móvil en la calle: la **dirección** es el elemento más grande, el
  teléfono es un `tel:` (un toque, no copiar y pegar), y el cobro se resalta en ámbar **solo si es
  efectivo**, que es el único dato que si se lee mal cuesta dinero
- **Confirmación en dos pasos** para entregar, y el texto pregunta por el monto cuando es efectivo
  (*"¿Recibiste $48.000 en efectivo?"*): el botón vive en un bolsillo, en una moto, y marcar
  entregado no tiene deshacer
- El Header le oculta las stats del día: `useOrders` le llega filtrado, así que "Pedidos hoy" e
  "Ingresos" serían sus propios números con una etiqueta que sugiere las del restaurante

**Historial de entregas (`DeliveryHistory`).** Un solo componente para **dos** pantallas: el
repartidor viendo lo suyo en la sub-vista Historial, y el admin abriéndolo desde Configuración →
Usuarios (botón *Ver entregas*, solo en filas de rol domiciliario). La diferencia la hace el prop
`domiciliarioId`; **no hay ni una comprobación de rol en el componente** porque `pedidos_select` ya
decide qué filas existen para quien mira — si un domiciliario pasara el id de otro vería una lista
vacía, no un error.

- Período **Hoy / 7 días / 30 días / Todo** con `getRange` de `dateRanges.js` (día de negocio
  Colombia, UTC-5). `todo` no pasa por `getRange`: es la ausencia de filtro
- Filtra y ordena por **`fecha_entrega`** (timestamptz), no por `fecha_pedido` (timestamp sin tz
  con valor UTC): lo que se mide es cuándo se entregó
- **El resumen viene del RPC `resumen_entregas`, no de sumar la lista**: está paginada de 20 en 20
  y sumar lo cargado daría una cifra que crece al hacer scroll
- Un `useRef` de nº de petición descarta respuestas que llegan tarde, para que al cambiar rápido de
  período una consulta vieja no pise a la actual
- La variante `compacto` es la del modal del admin, donde hay menos ancho

### 3. Estadísticas (Recharts)

**Vista:** KPIs + gráficas analíticas con filtros de periodo
**Datos:** `useStatistics` hook — fetch por rango de fechas (sin realtime), agregación en el cliente
**Archivos:** `src/pages/statistics/` + `src/utils/statsAggregations.js` + `src/utils/dateRanges.js` + `src/styles/statistics.less`

**Componentes:**
| Componente | Qué muestra |
|---|---|
| `PeriodSelector` | Presets (Hoy / 7d / 30d / 90d / Este mes / Personalizado) + granularidad Día/Semana/Mes |
| `KpiCards` | Pedidos, ingresos, ticket promedio (con Δ% vs periodo anterior), tasa de cancelación, calificación |
| `SalesChart` | ComposedChart: barras de pedidos + línea de ingresos por bucket |
| `TopClients` | Top 10 clientes históricos, toggle por pedidos / por gasto |
| `ProductsRanking` | Más/menos pedidos con filtro por categoría del menú |
| `HourlyHeatmap` | Heatmap 7×24 (día × hora Colombia) con intensidad amber |
| `CategoryRevenue` | Donut de ingresos por categoría (top 5 + "otras") |
| `DeliveryStats` | Tiempo promedio de entrega (total / domicilio / recoger) + distribución |
| `RiskClients` | Clientes recurrentes (3+ pedidos) sin pedir hace 30+ días; botón **Promo** → `PromoModal` envía la plantilla `reactivacion_cliente` (Marketing, cupón editable). Están fuera de 24h → siempre plantilla |
| `CancellationStats` | Tasa + motivos de cancelación, calificación promedio de `feedback` |
| `ChartTheme` | Tooltip custom + props de ejes/grid tematizados con CSS vars (dark/light) |

**Criterios de negocio:**
- Ingresos/KPIs/gráficas excluyen pedidos `cancelado` (mismo criterio que las stats del header)
- Cancelados se muestran aparte como tasa con motivos (`motivo_rechazo`)
- Hora/día se calculan en hora Colombia (UTC-5): fecha desplazada -5h y leída con `getUTC*()`
- `fecha_pedido` llega sin timezone (columna `timestamp` con valor UTC): `parseDb()` en `dateRanges.js` le fuerza `Z` para que JS no lo interprete como hora local
- Tiempo de entrega: solo pedidos entregados con `fecha_entrega` válida (0 < duración ≤ 3h); el Kanban escribe `fecha_entrega` al marcar entregado desde 2026-06-09
- **Clientes fieles se agregan desde `pedidos` (histórico completo)**, NO desde `clientes.total_pedidos`/`gasto_total` — esos contadores no se mantienen en la BD (verificado: están en 0 aunque hay pedidos). `clientes` solo aporta el nombre.

### 4. Clientes (CRUD)

**Vista:** Tabla de todos los clientes con toolbar de búsqueda y orden
**Datos:** `useClients` hook — fetch completo de `clientes` + realtime UPDATE
**Archivos:** `src/pages/clients/` + `src/hooks/useClients.js` + `src/styles/clients.less`

**Funcionalidad:**
- Buscar por nombre o teléfono (un solo input; el teléfono matchea solo dígitos)
- Ordenar por columna clickeando el encabezado: Nombre (A→Z default), Modo (orden de `CLIENT_MODES`) y Registrado (más reciente primero al primer click); misma columna re-clickeada invierte el orden, desempate estable por nombre. El botón A→Z de la toolbar equivale a clickear Nombre
- Crear cliente nuevo y editar existentes (`ClientModal`: nombre, teléfono, dirección, modo)
- Botón **Saludar** por fila → `WelcomeModal` envía la plantilla `bienvenida_cliente` (Marketing, un solo param: el primer nombre). Es la única forma de abrir conversación con un cliente creado a mano que nunca le escribió al bot — sin ventana de 24h abierta, el texto libre no se entrega. Comparte estilos con `PromoModal` (`.promo-modal, .welcome-modal` en `statistics.less`)
- Eliminar cliente desde `ClientModal`: el click en `.btn danger` muestra una franja de confirmación dentro del footer (tokens red) que advierte que el borrado es **en cascada** — se eliminan también sus `pedidos` (→ `detalle_pedidos`), `reservas` y `feedback` (FKs `ON DELETE CASCADE` desde 2026-07-22, ver `docs/database/schema.md`) y que altera las estadísticas históricas. Al confirmar: toast success + sonido `playDeleted`. `mensajes_soporte` no se borra (sin FK)
- Crear/guardar también confirman con toast success (el modal cierra en silencio si no)
- Teléfono se sanitiza a solo dígitos en el input; valida mínimo 7 dígitos
- Duplicado de teléfono (constraint UNIQUE, error 23505) se muestra como mensaje amigable
- Modo editable con select (`CLIENT_MODES` en constants.js): 🤖 bot / 💬 humano / ⏳ esperando_feedback — default `bot` al crear
- Al insertar, el dashboard envía `fecha_registro` (NOT NULL sin default en la BD)
- El teléfono linkea a wa.me

### 5. Reservas (Calendario)

**Vista:** Calendario react-big-calendar con vistas Día / Semana / Mes, tematizado con las CSS vars del dashboard (dark/light)
**Datos:** `useReservations` hook — fetch completo de `reservas` + realtime `*` (el bot también crea reservas). `useReservationReasons` trae el catálogo de ocasiones
**Archivos:** `src/pages/reservations/` + `src/hooks/useReservations.js` + `src/hooks/useReservationReasons.js` + `src/styles/reservations.less`

**Funcionalidad:**
- Toolbar custom (`CalToolbar`): Hoy / ‹ › / label del periodo / leyenda de estados / switch de vista / botón "+ Nueva reserva"
- Crear reserva manual (`ReservationModal`): el cliente **se elige de la tabla `clientes`** con buscador por nombre/teléfono (reutiliza `useClients`) — **el cliente debe existir para reservar** (se crea en la tab Clientes). El dropdown solo aparece al escribir (escala a cientos de clientes): muestra máx. 8 resultados + "+N más — sigue escribiendo". Luego fecha, hora, personas, estado, **ocasión** y notas. Click/arrastre en un slot del calendario prellena fecha y hora (en Mes solo fecha)
- Click en una reserva abre `ReservationDetail` (datos completos + link wa.me) con eliminación en dos pasos (confirmación inline)
- **Siempre se notifica al cliente por WhatsApp** al crear y al eliminar (best-effort: si WA falla, la operación queda hecha y el toast lo advierte). Ambas van por **plantilla aprobada**, no por texto libre: fuera de la ventana de 24h Meta acepta el texto libre con 200 pero **no lo entrega** (edge-case #16), y una reserva creada a mano es justo el caso de un cliente que nunca le escribió al bot
  - **Crear** (`notifyCreated`) → `recordatorio_reserva` (params: nombre, fecha legible, hora, personas)
  - **Eliminar** (`notifyDeleted`) → `cancelacion_reserva` (params: nombre, fecha legible, hora) — Utility, desde 2026-07-29
- Feedback con el toast global del DS (`useToast` + `<Toast>`; antes era un toast propio de esta página)
- Eventos coloreados por `estado` (`RESERVATION_STATES`): pendiente=amber, confirmada=green, cancelada=red tachada
- Duración visual del evento: `RESERVATION_DURATION_MIN` (90 min) — la BD solo guarda `hora` de inicio
- `reserva_id` lo genera la **BD** (`generar_reserva_id()` como default): el hook no lo envía, para evitar colisiones, y lee la fila de vuelta con `.select().single()`. `origen: 'dashboard'`
- `cliente_id`, `nombre_cliente` y `telefono` salen del cliente seleccionado (desnormalizados en `reservas`); valida que la fecha/hora no haya pasado

**Ocasión / motivo de la reserva (2026-08-10):**
- El selector se llena desde `motivos_reserva` (hook `useReservationReasons`, solo `activo=true`,
  ordenado por `orden`) — la **misma tabla** que lee el bot. No hay lista de motivos ni precios
  hardcodeados en el front: la única clave que el código conoce por nombre es `MOTIVO_DEFECTO`
  (`'sin_ocasion'`), en `constants.js`
- `createReservation` manda **solo la clave**; `costo_motivo` lo escribe el trigger
  `trigger_costo_motivo` en la BD, así que el precio nunca depende del frontend
- `ReservationDetail` muestra el nombre visible desde el catálogo pero **el costo desde la reserva**
  (`costo_motivo` es la foto del precio al crearla; el catálogo pudo cambiar después)
- En el calendario, las reservas con montaje (costo > 0) llevan **🎉** en el título: son las que la
  sala tiene que preparar antes, y así se ven sin abrir el detalle
- ⚠️ La plantilla `recordatorio_reserva` tiene 4 params fijos, así que **la confirmación por
  WhatsApp del dashboard no incluye la ocasión ni su costo**. Requiere aprobar una plantilla nueva
  en Meta — anotado en el backlog. El bot sí lo dice, porque su respuesta es texto libre dentro de
  la ventana de 24h
- Vistas de tiempo limitadas a 10:00–23:30, scroll inicial a las 17:00

### 6. Menú (Disponibilidad del catálogo)

**Vista:** Tabla de todos los productos de la tabla `menu` con toolbar de búsqueda y filtros
**Datos:** `useMenu` hook — fetch completo de `menu` + realtime `*` (canal `menu-rt`)
**Archivos:** `src/pages/menu/` + `src/hooks/useMenu.js` + `src/styles/menu.less`

**Propósito:** la tab **NO crea, edita ni elimina productos** — solo cambia `menu.disponible`
(true/false). Es lo que el bot consume: `buscar_menu`/`buscar_menu_categoria` filtran con
`solo_disponibles=true`, así que marcar un producto como agotado lo saca del menú de WhatsApp
al instante (y de `MenuPicker` en los modales de pedido, que también filtra `disponible=true`).

**Funcionalidad:**
- Buscar por nombre, descripción, categoría o `producto_id` (un solo input)
- Filtros: categoría (dropdown dinámico con `CATEGORY_LABELS` de `constants.js`, movidas ahí
  desde `MenuPicker`) y estado (Todos / Disponibles / Agotados); contador con "N agotados" en rojo
- Ordenar por columna (`<SortHeader>` compartido): Producto, Categoría (default, A→Z por label),
  Precio (mínimo entre tamaños) y Estado (asc = agotados primero); desempate estable por nombre
- Columnas: Producto (+variante si no es Estándar) · Categoría · Precio ("Desde $X" si hay
  varios tamaños, vía `getProductOptions` de `MenuPicker`) · Descripción (ellipsis + title) ·
  Estado (**switch** `.switch` + badge verde/rojo `stock-label`) · botón "Ver"
- El switch aplica un **update optimista** (`setDisponible`): la UI responde al instante y se
  revierte con toast `error` si la BD falla; éxito confirma con toast `success`
- "Ver" abre `ProductModal` (solo lectura): bloque de disponibilidad (mismo switch), precios
  por tamaño y descripción completa. El producto se deriva de la lista por id, así que el
  realtime mantiene el modal fresco
- Paginación client-side (`.table-pagination`, mismo patrón que Clientes)
- Responsive: se ocultan descripción (≤980px), precio (≤680px) y categoría (≤500px)

### 7. Historial (pedidos por rango)

**Vista:** Tabla de pedidos de un rango de fechas con detalle completo por pedido
**Datos:** `useOrderHistory` hook — **100% server-side** (paginación `range()` + `count:
exact`, filtros y orden como parámetros de la query) + realtime `*` (canal
`pedidos-historial-rt`, los pedidos de hoy cambian de estado)
**Archivos:** `src/pages/history/` + `src/hooks/useOrderHistory.js` + `src/styles/history.less`

**Propósito:** control exacto de todo lo pedido — qué se completó, cuándo, en cuánto tiempo y
con qué detalle. Las acciones operativas del día viven en el kanban; el historial solo permite
**corregir pedidos colgados** en un estado intermedio (ver abajo). A diferencia de
Clientes/Menú (datasets chicos en memoria), el historial crece sin límite: **nunca se baja
más de una página** a memoria.

**Funcionalidad:**
- Periodo con los mismos presets Colombia-aware de Estadísticas (`PRESETS`/`getRange` de
  `dateRanges.js`): Hoy / 7d / 30d / 90d / Este mes / Personalizado (dos date inputs)
- Filtros **server-side**: estado (`ORDER_STATES` en constants.js), tipo (domicilio/recoger)
  y búsqueda con debounce 300ms por # de pedido (`ilike`), teléfono (dígitos) y nombre de
  cliente (paso previo: `clientes.nombre ilike` → `cliente_id in (...)`, porque el nombre
  vive en otra tabla). El término se sanea (`,()%`) para no romper la sintaxis del `or()`
- Línea de resumen sobre **todo el conjunto filtrado** (no solo la página) vía RPC
  `historial_resumen` (mismos filtros; ingresos excluyen cancelados, criterio del header)
- Orden server-side (`<SortHeader>`): Fecha (default, más reciente primero) y Total, con
  desempate por fecha. Estado no es ordenable (el orden alfabético del servidor no sigue el
  ciclo de vida; el filtro de estado cubre ese caso); paginación `.table-pagination` sobre
  `totalCount`, con clamp de página si el total se achica en vivo (PGRST103)
- Columnas: #Pedido · Fecha (dd MMM · h:mm, hora Colombia vía `timeZone: America/Bogota`) ·
  Cliente (nombre + teléfono) · Tipo · Total · Estado (badge `state-badge` por ciclo de vida:
  amber/purple/blue/green/red) · "Ver"
- **Exportar** (botón secondary con menú en la toolbar): baja **todo el conjunto filtrado**
  (no solo la página; cap 10.000 con aviso) vía `fetchAllFiltered` (reusa los mismos
  filtros server-side) y genera con `src/utils/exportHistory.js`: **CSV** plano (coma,
  BOM UTF-8 para que Excel respete tildes, fechas `YYYY-MM-DD HH:mm` hora Colombia,
  productos aplanados "2× Pizza (Mediana) | …") o **Excel** con formato (título, periodo,
  línea de resumen, encabezado naranja de marca, filas alternadas, total como moneda,
  estados coloreados, autofiltro, panel congelado). `exceljs` se carga con **dynamic
  import** → chunk aparte (~940KB) que solo se descarga al exportar
- **Corrección de estado desde `OrderDetailModal`** (para pedidos que quedaron en
  pendiente/en_cocina/en_camino/recoger y no se movieron a tiempo): "Marcar entregado"
  (primary) y "Cancelar pedido" (danger, motivo obligatorio). Confirmación inline en el
  footer (patrón de ClientModal) que **advierte la notificación automática**: el trigger de
  BD `notificar-estado-pedido` dispara el webhook de n8n en cada UPDATE de `pedidos` → el
  cliente SIEMPRE recibe el WhatsApp del nuevo estado (y el motivo se interpola en el
  mensaje de cancelación — por eso es obligatorio). `fecha_entrega` NO se escribe desde el
  cliente: la fija el trigger `set_fecha_entrega`. Estados finales (entregado/cancelado) no
  muestran acciones. Cancelar replica la semántica del kanban (`estado_pago: 'rechazado'` +
  `motivo_rechazo`). Éxito → toast; el modal queda abierto mostrando el estado nuevo
- `OrderDetailModal` (detalle): cliente con link wa.me, tipo, método de pago (+ badge de
  `estado_pago` si es Transferencia), dirección de entrega, repartidor, fecha de entrega con
  duración en minutos (criterio ≤3h), link al comprobante, items con cantidad/variante/notas
  por línea, recargo de domicilio (diferencia total − items), total, notas del cliente y
  motivo de cancelación (bloque rojo)
- Responsive: se ocultan tipo (≤940px), total (≤720px) y fecha (≤540px)

### 8. Configuración (info del negocio + zonas + FAQ + respuestas rápidas)

**Vista:** cinco sub-vistas en un control segmentado (`.settings-segmented`) — **Información del
negocio**, **Zonas de domicilio**, **Preguntas frecuentes**, **Respuestas rápidas** y **Usuarios**
**Datos:** `useBusinessInfo` (`info_negocio`) · `useDeliveryZones` (`zonas_entrega` + `barrios`) ·
`useFaq` (`faq`) · `useRespuestasRapidas` (`respuestas_rapidas`)
**Archivos:** `src/pages/settings/` (`SettingsPage` shell + `BusinessInfoSection` +
`DeliveryZonesSection` + `ZoneModal` + `FaqSection` + `FaqModal` + `faqLint.js` +
`QuickRepliesSection` + `QuickReplyModal`) + `src/hooks/useBusinessInfo.js` +
`src/hooks/useDeliveryZones.js` + `src/hooks/useFaq.js` + `src/hooks/useRespuestasRapidas.js` +
`src/utils/quickReplies.js` + `src/styles/settings.less`

**Propósito de la tab:** todo lo que el restaurante administra **sin depender de nosotros**. Para
el restaurante las cinco sub-vistas son la misma tarea (administrar lo suyo),
y por eso van juntas en vez de en tabs del sidebar. La otra razón es de diseño: cada
sub-vista tiene **su** único botón `primary` (Guardar cambios / Nueva zona / Nueva pregunta /
Nueva respuesta), que es precisamente lo que impide meterlas en una sola pantalla (DS §3).

**8b. Zonas de domicilio** (2026-08-18) es la única sub-vista que mueve **dinero**: su tarifa
entra en `pedidos.total` vía trigger. Por eso salió de "Información del negocio", donde vivía
como dos campos de texto (`zona_delivery` / `costo_delivery`) que el bot solo podía recitar;
ahí quedó un puntero (`.settings-nota`) hacia acá.

- Una card por zona con su tarifa, tiempo estimado y los barrios como chips; el input de
  "Agregar barrio…" es un `<form>` por zona (submit icon-only, para no competir con el único
  `primary` de la pantalla).
- **La clave del barrio no se calcula en JS**: se manda solo `nombre` y la deriva
  `trigger_normalizar_barrio`. Es la clave con la que la BD hace match contra lo que escribe el
  cliente por WhatsApp, así que normalizarla en dos capas sería la forma segura de que se
  desincronicen.
- **"Barrios sin zona"**: bloque ámbar con los barrios que llegaron por WhatsApp y no están en
  el catálogo (`pedidos` con `zona IS NULL`), agrupados en JS porque PostgREST no expone
  `GROUP BY`. Un `<select>` + Asignar los crea directamente en la zona elegida. Es la lista de
  trabajo pendiente del admin, y sale gratis de haber guardado el texto crudo del cliente.
- La **zona base** se pinta aparte al final, con borde punteado y sin switch: la BD impide
  borrarla o desactivarla (`proteger_zona_base`), así que la UI ni lo ofrece.

> **Ojo con la asimetría:** 8a y 8b alimentan al **bot** (el prompt las lee vía tools). 8c **no** —
> es texto que envía una persona desde el chat de soporte. Es la razón por la que las respuestas
> rápidas no pasan por `faqLint`.

`SettingsPage` es solo el shell: mantiene la sub-vista activa y el único `<Toast>` de la tab, que
pasa a las secciones como `showToast`.

#### 8a. Información del negocio

**Propósito:** editar los **valores** de `info_negocio` — la tabla que el bot lee completa vía
la tool `info_local` (Agente Soporte) para responder horarios, dirección, pagos, zonas, etc.
Lo que se guarda aquí es literalmente lo que el bot dicta por WhatsApp. No se crean ni
eliminan claves desde la UI (la estructura la define la BD; ver `docs/database/schema.md`).

**Funcionalidad:**
- Registro de campos (`SECTIONS` en `BusinessInfoSection`): orden, agrupación, label, help,
  placeholder y si es multilínea (textarea: descripción, datos de transferencia, política de
  cancelación). Claves de la BD que no estén en el registro caen en una card **"Otros"** con
  render genérico — nada queda invisible
- Borrador local (`draft`) contra valores originales: contador de "N cambios sin guardar",
  botón **Descartar** (ghost) y **Guardar cambios** (primary, deshabilitado sin cambios)
- `saveInfo(changes)` actualiza **solo** las claves que cambiaron (un UPDATE por clave) y
  refetchea; toast success/error
- **Sin realtime, adrede:** es un formulario — un evento entrante pisaría lo que el admin
  está escribiendo. Si dos admins editan a la vez, gana el último guardado
- Campos con el patrón global `.field`; cards planas en **dos stacks balanceados** (DS §7):
  izquierda Identidad + Contacto (+ "Otros"), derecha Horarios + Operación; la última card
  de cada stack crece (`flex: 1`) para cerrar parejo abajo. 1 columna en ≤880px

#### 8b. Preguntas frecuentes (CRUD, 2026-08-11)

**Propósito:** el restaurante administra sus propias FAQ (parqueadero, mascotas, eventos,
opciones vegetarianas…) y el Agente Soporte las consulta con la tool `consultar_faq` en vez de
tenerlas escritas a mano en el prompt. Ver `docs/bot/ai-agents.md` §Agente Soporte.

**Funcionalidad:**
- Lista ordenable con flechas ↑↓, switch `activa` por fila (update optimista, igual que la
  disponibilidad del menú) y `FaqModal` para crear/editar/eliminar (confirmación **inline** en el
  pie del modal, como `ClientModal` — nunca `window.confirm`)
- `moveFaq` **renumera `orden` a 0..n-1** en vez de intercambiar dos valores: tras varios borrados
  la BD tiene órdenes repetidos o con huecos, y sólo renumerar deja la lista consistente
- Estado vacío que sugiere **preguntas** de ejemplo, nunca respuestas: una respuesta sembrada sería
  una afirmación inventada del negocio que el bot le diría a un cliente real
- **Sin realtime** (mismo criterio que `useBusinessInfo`): el único escritor es este dashboard y
  las mutaciones ya refrescan; un evento entrante mientras el admin reordena sólo daría saltos

**`faqLint.js` — guardas de contenido.** Las FAQ son texto libre que entra al contexto del agente,
así que pueden chocar con las reglas globales del bot (no mencionar internos, precios exactos desde
la BD). Dos capas que conviene no confundir:
- **Bloquea** sólo lo que los CHECK de la tabla también rechazan (longitudes), para que el admin
  vea un mensaje claro en vez de un error crudo de Postgres
- **Avisa sin bloquear** ante precios escritos a mano, jerga interna o texto con forma de
  instrucción; el botón pasa a *"Guardar de todos modos"*. Es ayuda de redacción para el error
  honesto del dueño del restaurante — **la barrera real es el prompt del Agente Soporte**, que
  trata las FAQ como dato y nunca como instrucción

#### 8c. Respuestas rápidas (CRUD, 2026-08-12)

**Propósito:** los mensajes que el operador repite todo el día al atender por chat ("ya salió tu
domicilio", "confírmame la dirección"). Se guardan en `respuestas_rapidas` y aparecen como chips
sobre el input de la tab **Soporte**. Ver §3 (Soporte) para el lado consumidor.

**Funcionalidad:**
- Misma anatomía que 8b —lista ordenable ↑↓, switch `activa` optimista, modal con confirmación
  de borrado inline— pero con clases `rr-*` propias en `settings.less`: son dos features distintas
  y los selectores se repiten a propósito para que tocar una pantalla no mueva la otra
- `QuickReplyModal` trae un botón **`{nombre}`** que inserta el marcador **en la posición del
  cursor** (no al final: casi siempre va en mitad del saludo) y un **preview en forma de burbuja**
  con el texto ya resuelto usando un nombre de ejemplo
- Valida **sólo longitudes y atajo duplicado** — lo mismo que rechazan los CHECK y el índice único
  de la tabla. **No hay `faqLint` aquí**: este texto no entra al contexto de ningún agente
- El `atajo` es único (índice sobre `lower(btrim(atajo))`): dos chips con la misma etiqueta serían
  indistinguibles en el chat
- Estado vacío que sugiere **nombres** de ejemplo, nunca mensajes — mismo criterio que 8b

**`src/utils/quickReplies.js` — el marcador `{nombre}`.** Deliberadamente hay **uno solo**: cada
marcador extra es un dato que puede faltar al enviar y dejar un `{algo}` crudo delante del cliente,
y el nombre es el único que el chat siempre tiene a mano. `aplicarNombre()` usa el **primer**
nombre ("Juan Pablo" → "Juan": el nombre completo suena a formulario) y, si no hay nombre
registrado, **borra el marcador junto con la coma que lo sigue** en vez de dejarlo crudo o
sustituirlo por "cliente" — "Hola {nombre}, tu pedido…" → "Hola, tu pedido…".

#### 8d. Usuarios (2026-08-12)

**Propósito:** repartir permisos. Es la única sub-vista que no configura texto que sale al
cliente; va aquí porque para el restaurante la tab es "lo que administro yo", y de hecho solo
existe para el admin — ni la RLS de `perfiles` ni `listar_usuarios()` le devuelven nada a nadie más.

- La lista viene del **RPC `listar_usuarios()`**, no de un `select` a `perfiles`: el email vive en
  `auth.users`, que PostgREST no expone. La alternativa era denormalizarlo y que se desincronizara
- Por fila: rol (`select`), acceso (switch) y **último acceso** — para detectar cuentas dormidas
- **No hay botón "Crear usuario"**, y la pantalla explica por qué: el alta exige la admin API con
  `service_role`, que no puede viajar en el bundle (mismo motivo que el token de WhatsApp). Las
  cuentas se crean en Supabase y aparecen aquí al instante como `domiciliario` — el rol de menor
  alcance — vía `trigger_crear_perfil`
- **Editarse a uno mismo está bloqueado en la UI**, no en la BD: el trigger solo impide quedarse
  *sin* admin, así que con dos admins uno podría degradarse y perder el acceso de golpe
- Los errores de los triggers (`sin ningún administrador`, `Solo un administrador`) se traducen a
  frases en `useUsuarios`; la frontera sigue siendo la BD

#### 8e. Mi perfil (todos los roles)

**Archivos:** `src/components/ProfileModal.jsx` · `src/components/Avatar.jsx` ·
`src/lib/avatares.js` · `useAuth().actualizarPerfil`

Se abre desde el **menú de la barra superior**, no desde una sub-vista de Configuración: el
domiciliario no tiene esa tab y también necesita poner su nombre y su foto. El menú superior es el
único punto que todos los roles comparten.

- Edita **nombre, teléfono y foto**. El rol se muestra pero no se edita — es de 8d, y
  `trigger_proteger_perfil` lo rechazaría igual. `actualizarPerfil` tampoco acepta `rol`/`activo`
  aunque se los pasen: dejar la puerta abierta invitaría a usarla desde otro punto
- **Vista previa local antes de subir** (`URL.createObjectURL`): subir primero haría esperar al
  usuario para saber si eligió la foto correcta
- El avatar anterior se borra **después** de que el perfil apunta al nuevo, y es best-effort: si
  falla queda un archivo huérfano, que es mejor que quedarse sin foto porque el borrado se adelantó
- `Avatar` cae a la inicial del nombre con `onError`. No es decorativo: el bucket es público y una
  URL puede quedar rota, y sin eso quedaría el icono de imagen partida en la barra superior

### 9. Reseñas (satisfacción + recuperación)

**Vista:** Panel de satisfacción arriba (promedio, distribución 5→1, tarjetas pastel de sentimiento) + feed de tarjetas de reseña
**Datos:** `useReviews` hook — fetch de `feedback` con `clientes(nombre,telefono)` y `pedidos(total,tipo_pedido)` embebidos + realtime `*` (canal `feedback-rt`)
**Archivos:** `src/pages/reviews/` + `src/hooks/useReviews.js` + `src/styles/reviews.less`

**Propósito (doble):** la tabla `feedback` la escribe el bot (workflow n8n **Sub — Feedback Pendiente**):
tras un pedido entregado pide nota 1–5 y **solo si es ≤3 pide comentario** (las de 4–5 se invitan
a dejar reseña en Google, nodo `¿Nota > 3?`). Por eso los comentarios que llegan son casi siempre
negativos/neutros → esta tab **no es un muro de elogios, es la cola de clientes a recuperar**.
Dos trabajos: (1) **pulso** — promedio, distribución y sentimiento sobre todas las notas; (2)
**recuperación** — cada reseña con su CTA "Responder por WhatsApp" (`wa.me` con texto prellenado
según el tono).

**Funcionalidad:**
- `SatisfactionSummary`: nota promedio grande + `Stars`, distribución de barras 5→1 en **tono pastel**
  (verde 5-4 / ámbar 3 / rojo 2-1, vía `color-mix` con la superficie), **tarjetas pastel de
  sentimiento** (positivas/neutras/negativas con fondo `-dim`, conteo y %), y "≈N invitadas a Google"
  (las de nota ≥4). Todo agregado en cliente. Rediseñado a pastel (2026-07-23) por feedback del usuario
  (el termómetro segmentado anterior se veía genérico)
- Feed en grid de `ReviewCard`: avatar con inicial, nombre, `Stars`, "hace X" (tooltip con fecha
  Colombia), **teléfono visible** (`formatPhone`), badge de sentimiento, comentario (o nota sin
  comentario), pedido enlazado con total. Borde izquierdo de color por sentimiento. **Solo las
  negativas/neutras traen botón Responder** (abre `ReplyModal`); las **positivas** muestran "Invitado
  a Google" (el bot ya las manda a la reseña pública, no se contactan desde aquí)
- **Las positivas nunca muestran comentario:** el bot solo pide comentario para nota ≤3 (las ≥4 van a
  Google sin comentario — verificado en n8n `Sub — Feedback Pendiente`). La tarjeta de una positiva
  omite el cuerpo del comentario y deja solo el label "Invitado a Google". (Datos viejos de prueba con
  comentario en positivas se limpiaron en BD el 2026-07-23.)
- **Estado resuelta:** al contactar al cliente se marca `feedback.resuelta_at` (`marcarResuelta`); la
  tarjeta pasa a **"Resuelta"** (check verde, atenuada) y **ya no se puede volver a responder**
- **Orden por prioridad:** el feed ordena **negativas → neutras → positivas** y, dentro de cada grupo,
  **pendientes antes que resueltas** (sort estable → conserva fecha desc en empates). Los chips de
  filtro también arrancan con **Negativas** primero, "Todas" al final. Objetivo: que el operador vea
  y resuelva primero los casos negativos
- **`ReplyModal`** — contactar por una reseña negativa/neutra, con un flujo **a la fija**: envía
  **siempre la plantilla aprobada `seguimiento_review`** (`sendWhatsAppTemplate`, params nombre +
  pedido_id) — **no texto libre**. Razón: fuera de la ventana de 24h la Cloud API **acepta** el texto
  libre (responde 200) pero **no lo entrega** (el fallo llega async por webhook) → daba "enviado" en
  falso; la plantilla es la única vía confiable (y falla sincrónicamente si algo está mal). Muestra
  una **vista previa** del mensaje y, al enviar, hace **handoff automático** (`modo=humano`) para que
  la respuesta del cliente caiga en Soporte. Sin teléfono → no se puede contactar. (Ya no hay textarea,
  ni botón de ticket manual, ni `wa.me`: se simplificó por feedback del usuario.)
- Filtros: segmented por sentimiento (Todas/Positivas/Neutras/Negativas con conteos), búsqueda
  (cliente/comentario/pedido) y chip "Con comentario". Todo client-side (volumen acotado)
- **Feed por lotes ("Mostrar más", `BATCH = 24`)** en vez de paginación numerada: encaja con el
  grid de cards y el resumen sigue agregando sobre TODO el conjunto. `visible` se resetea al cambiar
  cualquier filtro. `useReviews` cachea hasta 2000 filas; superado eso, migrar a server-side (Historial)
- `sentiment.js`: `sentimentOf(nota)` (≥4 pos, 3 neu, ≤2 neg) + `SENTIMENT_META`, compartido por
  summary, card y page
- `Stars`: 5 estrellas, las llenas con `fill: currentColor` (el estilo inline gana al `fill="none"`
  del `<svg>` de Icon). Reutilizable
- Empty state con explicación del flujo cuando no hay reseñas

## Hooks — responsabilidades

| Hook | Qué hace | Devuelve |
|---|---|---|
| `useAuth` | `AuthProvider` (en `main.jsx`) + `useAuth`: sesión Supabase, `signIn`/`signOut` | `session, loading, signIn, signOut` |
| `useOrders` | Fetch pedidos del día, realtime, detecta nuevos, calcula stats | `orders, loading, newIds, stats, lastUpdate, fetchOrders` |
| `useSupportCount` | Cuenta clientes con `modo=humano`, realtime | `number` |
| `useSupportConversations` | Conversaciones activas + mensajes del panel de soporte | `conversations, messages, …` |
| `useMediaQuery` | Evalúa una media query (sidebar colapsado / móvil) | `boolean` |
| `useStatistics` | Filtros de periodo, fetch pedidos/feedback/menu del rango + periodo anterior, agregados memoizados | `loading, error, aggregates, clients, categorias, range, filters, setters` |
| `useClients` | Fetch todos los clientes, realtime UPDATE, crear/editar vía `saveClient`, eliminar vía `deleteClient` | `clients, loading, error, saveClient, deleteClient` |
| `useReservations` | Fetch todas las reservas, realtime `*`, crear (con lookup de cliente por teléfono) y eliminar | `reservations, loading, error, createReservation, deleteReservation` |
| `useMenu` | Fetch todo el catálogo `menu`, realtime `*`, cambia `disponible` con update optimista (rollback si falla) | `products, loading, error, setDisponible` |
| `useReviews` | Fetch `feedback` con `clientes`/`pedidos` embebidos, realtime `*`, normaliza a filas planas; handoff a Soporte (`modo=humano`) | `reviews, loading, error, refetch, handoffToSupport` |
| `useBusinessInfo` | Fetch `info_negocio`, guarda solo claves cambiadas (sin realtime — es un formulario) | `info, loading, error, saveInfo` |
| `useFaq` | CRUD de `faq` + `setActiva` optimista + `moveFaq` (renumera `orden` a 0..n-1); traduce los CHECK de la tabla a mensajes legibles | `faqs, loading, error, createFaq, updateFaq, deleteFaq, setActiva, moveFaq, refetch` |
| `useDeliveryZones` | CRUD de `zonas_entrega` + `barrios` (zonas con sus barrios embebidos) y la lista de **barrios sin zona** deducida de `pedidos` con `zona IS NULL`. Sin realtime (mismo criterio que `useFaq`). Traduce a texto los errores de `proteger_zona_base` y de la FK de barrios | `zonas, sinClasificar, loading, error, createZona, updateZona, deleteZona, setZonaActiva, addBarrio, moveBarrio, deleteBarrio, refetch` |
| `useBarrioOptions` | *(mismo archivo)* Catálogo plano de barrios activos + `tarifaBase`, para los formularios que **crean** pedidos. Solo lectura. Expone la tarifa base para poder previsualizar el mismo número que va a cobrar la BD, en vez de re-quemar un 5000 en el front | `barrios, tarifaBase, loading` |
| `useDeliveryHistory` | Entregas pasadas de un domiciliario: período (`getRange`), paginado de 20 y resumen vía RPC `resumen_entregas`. Sin comprobación de rol — la RLS decide qué filas existen | `entregas, resumen, loading, cargandoMas, hayMas, error, cargarMas, refetch` |
| `useUsuarios` | Lista de usuarios vía RPC `listar_usuarios` (admin-only) + `cambiarRol` / `setActivo` / `actualizarDatos` sobre `perfiles`; traduce los errores de los triggers | `usuarios, loading, error, cambiarRol, setActivo, actualizarDatos, refetch` |
| `useDomiciliarios` | Domiciliarios activos para el selector de asignación + `asignarDomiciliario(pedidoId, id)`. Solo devuelve filas para un admin (`perfiles_select` limita al resto a su propia fila); traduce los errores del trigger a texto legible | `domiciliarios, loading, refetch` |
| `useRespuestasRapidas` | CRUD de `respuestas_rapidas` + `setActiva` optimista + `moveRespuesta` (misma renumeración); traduce CHECK e índice único a mensajes legibles. Lo usan **dos** pantallas: Configuración (CRUD) y Soporte (solo lectura) | `respuestas, loading, error, createRespuesta, updateRespuesta, deleteRespuesta, setActiva, moveRespuesta, refetch` |
| `useOrderHistory` | Página de pedidos server-side (rango + filtros + orden + paginación como parámetros; resumen vía RPC `historial_resumen`), realtime `*`, correcciones de estado, export del conjunto filtrado | `orders, totalCount, summary, loading, error, range, marcarEntregado, cancelarPedido, fetchAllFiltered` |
| `useTheme` | Toggle dark/light, persiste en localStorage, aplica `data-theme` | `{ theme, toggleTheme }` |

## Variables de entorno (`.env.local`, git-ignored — todas `VITE_`)

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WA_PHONE_NUMBER_ID=...
VITE_WA_ACCESS_TOKEN=...          # ⚠️ viaja en el bundle del cliente (riesgo diferido)
VITE_WA_API_VERSION=v25.0         # opcional (default v25.0)
```

`src/lib/supabase.js` lanza al arrancar si faltan las `VITE_SUPABASE_*`. El envío de WhatsApp
vive en `src/lib/whatsapp.js` (`sendWhatsAppMessage` texto + `sendWhatsAppTemplate` plantillas
aprobadas para escribir fuera de la ventana de 24h; nombres/idiomas en `WA_TEMPLATES` de
constants.js) — ya **no** hardcodeado en

> **Plantillas aprobadas en Meta (verificado 2026-07-29 leyendo el WABA por Graph API).** `name` y
> `lang` deben calcar los de Meta o la Cloud API responde **132001**; el conteo de params, o responde
> **132000**. Idioma de las seis: **`es`** (en Meta figuran como "Spanish"; `es_CO` aparecería como
> "Spanish (COL)").
>
> | Plantilla | Categoría | Params | Consumida por |
> |---|---|---|---|
> | `seguimiento_review` | Utility | nombre, pedido_id | `ReplyModal` (Reseñas) |
> | `reactivacion_cliente` | Marketing | nombre, cupón | `PromoModal` (Estadísticas) |
> | `recordatorio_reserva` | Marketing | nombre, fecha, hora, personas | `ReservationsPage.notifyCreated` |
> | `cancelacion_reserva` | Utility | nombre, fecha, hora | `ReservationsPage.notifyDeleted` |
> | `bienvenida_cliente` | Marketing | nombre | `WelcomeModal` (Clientes) |
> | `resumen_pedido` | Utility | nombre, pedido_id, items, total, entrega | `CreateOrderModal` |
> | `hello_world` | Utility | — | — (default de Meta, en inglés; sin uso) |
>
> Desde 2026-07-29 **ningún envío del dashboard usa texto libre**: los tres huecos (cancelación de
> reserva, primer contacto, resumen de pedido manual) ya tienen plantilla. `sendWhatsAppMessage`
> sigue existiendo y lo usa **solo** `SupportPanel`, donde la ventana de 24h está abierta por
> definición (el cliente acaba de escribir).
>
> **Los params no admiten saltos de línea, tabs ni 4+ espacios seguidos** — Meta rechaza el envío.
> Por eso el resumen de `CreateOrderModal` manda los items en UNA línea separados por comas, en vez
> de las viñetas que tenía el texto libre.
>
> El WABA ID es **`1476425047271965`** (`GET /{waba_id}/message_templates` lista nombre, idioma,
> estado y cuerpo). Ojo: **no** es el `phone_number_id` (`1026022853935447`), ni el App ID, ni el ID
> del portafolio de negocio — se confunden fácil. Sale en la URL de WhatsApp Manager (`?waba_id=`).
>
> Las **vistas previa** de `ReplyModal`, `PromoModal` y `WelcomeModal` son copia **verbatim** del
> cuerpo aprobado; si se edita la plantilla en Meta hay que editarlas aquí también, o el operador
> promete algo distinto de lo que recibe el cliente (ya pasó: la preview decía 20% de descuento y la
> plantilla da **10%**).
`SupportPanel`. Gotcha: `VITE_WA_ACCESS_TOKEN` se empaqueta en el cliente (ver `CLAUDE.md`).

## Realtime subscriptions

| Canal | Tabla | Evento | Manejado por |
|---|---|---|---|
| `pedidos-changes` | pedidos | * | `useOrders` → refetch |
| `clientes-modo-changes` | clientes | * | `useSupportCount` → recount |
| `soporte-messages-rt` | mensajes_soporte | INSERT | `SupportPanel` → append msg |
| `soporte-clientes-rt` | clientes | UPDATE | `SupportPanel` → refetch convos |
| `clientes-page-rt` | clientes | UPDATE | `useClients` → refetch lista |
| `reservas-rt` | reservas | * | `useReservations` → refetch lista |
| `menu-rt` | menu | * | `useMenu` → refetch catálogo |
| `pedidos-historial-rt` | pedidos | * | `useOrderHistory` → refetch rango |
| `feedback-rt` | feedback | * | `useReviews` → refetch reseñas |

## Tema

- Dark/Light toggle vía `useTheme` (persistido en `localStorage`)
- CSS variables en `:root` (dark) y `[data-theme="light"]` en `styles/index.css`
- Fuentes: Plus Jakarta Sans + JetBrains Mono (Google Fonts)

## Notas de implementación

- Los pedidos se filtran desde las 5:00 UTC (medianoche Colombia) para mostrar solo los del día
- `OrderCard` detecta comprobante de Transferencia pendiente y muestra aviso
- `EditOrderModal` calcula el recargo de domicilio como diferencia entre `total` e items — no lo modifica, solo lo preserva
- `EditOrderModal` usa el RPC `editar_pedido` (no update directo) para recalcular totales vía trigger
- **Pizza mitad y mitad (2026-08-10):** `MenuPicker` tiene dos modos (`Producto` / `Mitad y mitad`).
  En el segundo se eligen las dos mitades (la lista de la segunda se filtra a la **misma masa** que
  la primera) y luego el tamaño, entre los que existen en **ambas**, sin `porcion`. El precio que se
  muestra por tamaño es local (el máximo de las dos), pero al confirmar se llama la RPC
  `cotizar_mitad_y_mitad` — **la misma que usa el bot** — y se emite lo que devuelve la BD: el JS del
  dashboard nunca fija el precio. El item emitido lleva `mitades`, que `CreateOrderModal` inserta en
  `detalle_pedidos.mitades` y `EditOrderModal` reenvía por `editar_pedido` (si no, editar un pedido
  borraría de qué era cada mitad). Los hooks `useOrders` y `useOrderHistory` seleccionan la columna
  `mitades`, y `OrderCard` / `OrderDetailModal` la pintan con `.mm-tag`. Las reglas del negocio
  (misma masa, sin porción, solo pizza salada, cobra la más cara) las decide la RPC, no este código
  — ver [`../database/schema.md`](../database/schema.md) y [`../bot/ai-agents.md`](../bot/ai-agents.md)
- Las imágenes en `SupportPanel` usan `loading="lazy"` + fallback visual si fallan
