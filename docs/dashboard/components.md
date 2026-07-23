# Dashboard Admin — React + Vite

## Stack del frontend

- **React** (sin framework, SPA)
- **Vite** (build tool)
- **Supabase JS Client** (datos + realtime)
- **Recharts** (gráficas de la tab Estadísticas)
- **react-big-calendar + date-fns** (calendario de la tab Reservas, locale es)
- **WhatsApp Cloud API** (envío directo vía `src/lib/whatsapp.js`, Meta Graph API)
- **Supabase Auth** (login email+password, sesión persistida)
- **Estilos:** `index.css` (tokens/base) + un `.less` por feature (auth, orders, support, statistics, clients, reservations, menu), importados en `main.jsx`
- **Responsive:** `useMediaQuery` — el Sidebar colapsa a solo-iconos ≤1024px y a cajón (drawer) ≤768px
- **Sin router** — navegación por tabs internas vía estado `activeTab`; la app se separa en gate de auth (`App`) + shell autenticado (`DashboardShell`, dentro de `App.jsx`). La navegación es un **Sidebar** colapsable, no el Header

## Estructura de archivos

```
src/
├── App.jsx                       ← Gate de auth (splash / LoginPage / DashboardShell). DashboardShell
│                                    vive aquí dentro: Sidebar + Header + la tab activa (activeTab)
├── main.jsx                      ← Entry: AuthProvider + imports de estilos (index.css + *.less)
│
├── components/
│   ├── Icon.jsx                  ← Set de iconos SVG (name → path)
│   ├── Toast.jsx                 ← Toast global del DS (con useToast; patrón .toast en index.css)
│   ├── SortHeader.jsx            ← Encabezado de columna ordenable (patrón .sortable en index.css)
│   └── layout/
│       ├── Sidebar.jsx           ← Navegación principal: colapsable + drawer móvil + badge soporte + toggle tema
│       └── Header.jsx            ← Barra superior: stats del día + hamburguesa (móvil)
│
├── pages/
│   ├── auth/LoginPage.jsx        ← Login email+password (Supabase Auth)
│   ├── dashboard/                ← Kanban de pedidos
│   │   ├── DashboardPage · Column · OrderCard · OrderActions
│   │   └── CreateOrderModal · EditOrderModal · RejectModal
│   ├── support/                  ← Chat de soporte
│   │   └── SupportPanel · ConversationItem · ChatBubble · ImageLightbox
│   ├── statistics/               ← StatisticsPage + KPIs + ~10 componentes Recharts
│   ├── history/                  ← HistoryPage + OrderDetailModal (pedidos por rango)
│   ├── clients/                  ← ClientsPage + ClientModal
│   ├── reservations/             ← ReservationsPage + ReservationModal + ReservationDetail
│   ├── menu/                     ← MenuPage + ProductModal (disponibilidad del catálogo)
│   ├── reviews/                  ← ReviewsPage + SatisfactionSummary + ReviewCard + ReplyModal + Stars + sentiment.js
│   └── settings/                 ← SettingsPage (edita info_negocio — lo que responde el bot)
│
├── hooks/
│   ├── useAuth.jsx               ← AuthProvider + useAuth (sesión Supabase, signIn/signOut)
│   ├── useOrders.js              ← Pedidos del día + realtime + newIds + stats
│   ├── useStatistics.js          ← Filtros + fetch por rango + agregados
│   ├── useSupportCount.js        ← Badge de conversaciones (modo=humano)
│   ├── useSupportConversations.js← Conversaciones + mensajes del panel de soporte
│   ├── useClients.js             ← Clientes + realtime UPDATE + saveClient
│   ├── useReservations.js        ← Reservas + realtime * + create/deleteReservation
│   ├── useMenu.js                ← Catálogo `menu` + realtime * + setDisponible (optimista)
│   ├── useReviews.js             ← `feedback` + clientes/pedidos embebidos + realtime * (canal feedback-rt)
│   ├── useBusinessInfo.js        ← `info_negocio` clave/valor + saveInfo (sin realtime, adrede)
│   ├── useOrderHistory.js        ← Pedidos server-side (rango+filtros+orden+página) + realtime *
│   ├── useTheme.js               ← Toggle dark/light (localStorage)
│   ├── useToast.js               ← Estado + timer del toast global (con components/Toast.jsx)
│   └── useMediaQuery.js          ← Media queries (sidebar colapsado / móvil)
│
├── utils/
│   ├── constants.js              ← COLUMNS, METODO_LABEL, ESTADO_PAGO_LABEL, CLIENT_MODES, RESERVATION_*, CATEGORY_LABELS/categoryLabel, ORDER_STATES
│   ├── formatters.js             ← timeAgoShort, timeAgo, formatPrice, formatPriceShort, formatPhone
│   ├── exportHistory.js          ← Export del historial: CSV (BOM) + Excel con formato (exceljs lazy)
│   ├── dateRanges.js             ← parseDb + rangos con día de negocio Colombia (UTC-5)
│   ├── statsAggregations.js      ← Agregaciones puras de Estadísticas
│   └── audio.js                  ← playNotification + playDeleted (Web Audio)
│
├── lib/
│   ├── supabase.js               ← Cliente Supabase (throws si faltan las VITE_SUPABASE_*)
│   └── whatsapp.js               ← sendWhatsAppMessage (texto) + sendWhatsAppTemplate (plantillas, fuera de 24h)
│
└── styles/
    ├── index.css                 ← Tokens CSS, base, animaciones, layout, tema
    └── {auth,orders,support,statistics,clients,reservations,menu,settings,history}.less
```

## Layout y navegación

`DashboardShell` (dentro de `App.jsx`) arma `Sidebar` + `Header` + la tab activa:

- **`Sidebar`** — nav principal (`NAV_ITEMS`: Pedidos / Soporte / Estadísticas / Historial /
  Clientes / Reservas / Menú / Reseñas / Configuración), badge de soporte, toggle de tema en el pie. `collapsed` (solo iconos) en tablet
  (≤1024px) y `mobile-open` (cajón con backdrop) en móvil (≤768px), vía `useMediaQuery`.
- **`Header`** — muestra `stats` del día y `lastUpdate`; en móvil enseña la hamburguesa que
  abre el cajón. Ya **no** contiene los tabs (migraron al Sidebar).
- El tema (`useTheme`) vive en `App` para aplicar también en el login.

## Tabs principales

### 1. Pedidos (Kanban)

**Vista:** 3 columnas — Por aprobar, En cocina, En camino / Recoger
**Datos:** `useOrders` hook — fetch + suscripción realtime a tabla `pedidos`
**Notificaciones:** Audio (`playNotification`) + animación `new-order` 8s cuando llega pedido nuevo

**Cada OrderCard muestra:**
- Número de pedido (truncado a 8 chars)
- Teléfono, tipo (domicilio/recoger), método de pago
- Items con precio unitario (`detalle_pedidos`)
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
- Eliminar cliente desde `ClientModal`: el click en `.btn danger` muestra una franja de confirmación dentro del footer (tokens red) que advierte que el borrado es **en cascada** — se eliminan también sus `pedidos` (→ `detalle_pedidos`), `reservas` y `feedback` (FKs `ON DELETE CASCADE` desde 2026-07-22, ver `docs/database/schema.md`) y que altera las estadísticas históricas. Al confirmar: toast success + sonido `playDeleted`. `mensajes_soporte` no se borra (sin FK)
- Crear/guardar también confirman con toast success (el modal cierra en silencio si no)
- Teléfono se sanitiza a solo dígitos en el input; valida mínimo 7 dígitos
- Duplicado de teléfono (constraint UNIQUE, error 23505) se muestra como mensaje amigable
- Modo editable con select (`CLIENT_MODES` en constants.js): 🤖 bot / 💬 humano / ⏳ esperando_feedback — default `bot` al crear
- Al insertar, el dashboard envía `fecha_registro` (NOT NULL sin default en la BD)
- El teléfono linkea a wa.me

### 5. Reservas (Calendario)

**Vista:** Calendario react-big-calendar con vistas Día / Semana / Mes, tematizado con las CSS vars del dashboard (dark/light)
**Datos:** `useReservations` hook — fetch completo de `reservas` + realtime `*` (el bot también crea reservas)
**Archivos:** `src/pages/reservations/` + `src/hooks/useReservations.js` + `src/styles/reservations.less`

**Funcionalidad:**
- Toolbar custom (`CalToolbar`): Hoy / ‹ › / label del periodo / leyenda de estados / switch de vista / botón "+ Nueva reserva"
- Crear reserva manual (`ReservationModal`): el cliente **se elige de la tabla `clientes`** con buscador por nombre/teléfono (reutiliza `useClients`) — **el cliente debe existir para reservar** (se crea en la tab Clientes). El dropdown solo aparece al escribir (escala a cientos de clientes): muestra máx. 8 resultados + "+N más — sigue escribiendo". Luego fecha, hora, personas, estado y notas. Click/arrastre en un slot del calendario prellena fecha y hora (en Mes solo fecha)
- Click en una reserva abre `ReservationDetail` (datos completos + link wa.me) con eliminación en dos pasos (confirmación inline)
- **Siempre se notifica al cliente por WhatsApp** al crear y al eliminar (best-effort: si WA falla, la operación queda hecha y el toast lo advierte)
- Feedback con el toast global del DS (`useToast` + `<Toast>`; antes era un toast propio de esta página)
- Eventos coloreados por `estado` (`RESERVATION_STATES`): pendiente=amber, confirmada=green, cancelada=red tachada
- Duración visual del evento: `RESERVATION_DURATION_MIN` (90 min) — la BD solo guarda `hora` de inicio
- `reserva_id` manual: `RSV-M<timestamp>` (M = manual, mismo patrón que `DET-M`); `origen: 'dashboard'`
- `cliente_id`, `nombre_cliente` y `telefono` salen del cliente seleccionado (desnormalizados en `reservas`); valida que la fecha/hora no haya pasado
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

### 8. Configuración (info del negocio)

**Vista:** Formulario agrupado en cards por categoría (Identidad / Contacto y ubicación /
Horarios / Operación y domicilios)
**Datos:** `useBusinessInfo` hook — fetch completo de `info_negocio` (clave/valor/categoria)
**Archivos:** `src/pages/settings/` + `src/hooks/useBusinessInfo.js` + `src/styles/settings.less`

**Propósito:** editar los **valores** de `info_negocio` — la tabla que el bot lee completa vía
la tool `info_local` (Agente Soporte) para responder horarios, dirección, pagos, zonas, etc.
Lo que se guarda aquí es literalmente lo que el bot dicta por WhatsApp. No se crean ni
eliminan claves desde la UI (la estructura la define la BD; ver `docs/database/schema.md`).

**Funcionalidad:**
- Registro de campos (`SECTIONS` en `SettingsPage`): orden, agrupación, label, help,
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
  **siempre la plantilla aprobada `seguimiento_resena`** (`sendWhatsAppTemplate`, params nombre +
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
- Las imágenes en `SupportPanel` usan `loading="lazy"` + fallback visual si fallan
