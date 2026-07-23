# Dashboard Admin — React + Vite

## Stack del frontend

- **React** (sin framework, SPA)
- **Vite** (build tool)
- **Supabase JS Client** (datos + realtime)
- **Recharts** (gráficas de la tab Estadísticas)
- **react-big-calendar + date-fns** (calendario de la tab Reservas, locale es)
- **WhatsApp Cloud API** (envío directo vía `src/lib/whatsapp.js`, Meta Graph API)
- **Supabase Auth** (login email+password, sesión persistida)
- **Estilos:** `index.css` (tokens/base) + un `.less` por feature (auth, orders, support, statistics, clients, reservations), importados en `main.jsx`
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
│   ├── clients/                  ← ClientsPage + ClientModal
│   └── reservations/             ← ReservationsPage + ReservationModal + ReservationDetail
│
├── hooks/
│   ├── useAuth.jsx               ← AuthProvider + useAuth (sesión Supabase, signIn/signOut)
│   ├── useOrders.js              ← Pedidos del día + realtime + newIds + stats
│   ├── useStatistics.js          ← Filtros + fetch por rango + agregados
│   ├── useSupportCount.js        ← Badge de conversaciones (modo=humano)
│   ├── useSupportConversations.js← Conversaciones + mensajes del panel de soporte
│   ├── useClients.js             ← Clientes + realtime UPDATE + saveClient
│   ├── useReservations.js        ← Reservas + realtime * + create/deleteReservation
│   ├── useTheme.js               ← Toggle dark/light (localStorage)
│   └── useMediaQuery.js          ← Media queries (sidebar colapsado / móvil)
│
├── utils/
│   ├── constants.js              ← COLUMNS, METODO_LABEL, ESTADO_PAGO_LABEL, CLIENT_MODES, RESERVATION_*
│   ├── formatters.js             ← timeAgoShort, formatPrice, formatPriceShort
│   ├── dateRanges.js             ← parseDb + rangos con día de negocio Colombia (UTC-5)
│   ├── statsAggregations.js      ← Agregaciones puras de Estadísticas
│   └── audio.js                  ← playNotification (Web Audio)
│
├── lib/
│   ├── supabase.js               ← Cliente Supabase (throws si faltan las VITE_SUPABASE_*)
│   └── whatsapp.js               ← sendWhatsAppMessage (Meta Graph API, VITE_WA_*)
│
└── styles/
    ├── index.css                 ← Tokens CSS, base, animaciones, layout, tema
    └── {auth,orders,support,statistics,clients,reservations}.less
```

## Layout y navegación

`DashboardShell` (dentro de `App.jsx`) arma `Sidebar` + `Header` + la tab activa:

- **`Sidebar`** — nav principal (`NAV_ITEMS`: Pedidos / Soporte / Estadísticas / Clientes /
  Reservas), badge de soporte, toggle de tema en el pie. `collapsed` (solo iconos) en tablet
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
| `RiskClients` | Clientes recurrentes (3+ pedidos) sin pedir hace 30+ días, con link wa.me |
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
- Eliminar cliente desde `ClientModal` (`.btn danger` con confirmación en dos clicks). Sin cascade: si el cliente tiene `pedidos`/`reservas`/`feedback` (FK 23503), se muestra mensaje amigable y no se borra — el historial de ventas se preserva a propósito
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
- Toast propio (success/warn/error) abajo a la derecha, auto-dismiss 4.5s
- Eventos coloreados por `estado` (`RESERVATION_STATES`): pendiente=amber, confirmada=green, cancelada=red tachada
- Duración visual del evento: `RESERVATION_DURATION_MIN` (90 min) — la BD solo guarda `hora` de inicio
- `reserva_id` manual: `RSV-M<timestamp>` (M = manual, mismo patrón que `DET-M`); `origen: 'dashboard'`
- `cliente_id`, `nombre_cliente` y `telefono` salen del cliente seleccionado (desnormalizados en `reservas`); valida que la fecha/hora no haya pasado
- Vistas de tiempo limitadas a 10:00–23:30, scroll inicial a las 17:00

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
vive en `src/lib/whatsapp.js` (`sendWhatsAppMessage`, Meta Graph API) — ya **no** hardcodeado en
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
