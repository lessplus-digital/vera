# Dashboard Admin — React + Vite

## Stack del frontend

- **React** (sin framework, SPA)
- **Vite** (build tool)
- **Supabase JS Client** (datos + realtime)
- **WhatsApp Cloud API** (envío directo desde soporte)
- **Sin router** — navegación por tabs internas

## Estructura de archivos

```
src/
├── App.jsx                          ← Shell principal: tabs + monta páginas
├── main.jsx                         ← Entry point (monta App, importa CSS)
│
├── styles/
│   └── index.css                    ← Tokens CSS, base, animaciones, clases de layout
│                                       Separado por secciones con comentarios ══
│
├── pages/
│   └── DashboardPage.jsx            ← Vista Kanban: renderiza las 3 columnas
│
├── components/
│   ├── layout/
│   │   └── Header.jsx               ← Header sticky + TabButton + Stat
│   ├── orders/
│   │   ├── Column.jsx               ← Columna Kanban con header y lista de cards
│   │   ├── OrderCard.jsx            ← Card de pedido: datos, comprobante, modals
│   │   ├── OrderActions.jsx         ← Botones de acción según estado del pedido
│   │   ├── EditOrderModal.jsx       ← Modal para editar items, cantidades, notas
│   │   └── RejectModal.jsx          ← Modal con motivos de rechazo predeterminados
│   └── support/
│       └── SupportPanel.jsx         ← Chat WhatsApp: sidebar + burbuja + lightbox
│
├── hooks/
│   ├── useOrders.js                 ← Fetch pedidos, realtime, stats del día, newIds
│   ├── useSupportCount.js           ← Badge de conversaciones activas (modo=humano)
│   └── useTheme.js                  ← Toggle dark/light con persistencia localStorage
│
├── utils/
│   ├── constants.js                 ← COLUMNS, ESTADO_PAGO_LABEL, METODO_LABEL
│   ├── formatters.js                ← timeAgoShort(), formatPrice()
│   └── audio.js                     ← playNotification() (Web Audio API)
│
└── lib/
    └── supabase.js                  ← Inicialización del cliente Supabase
```

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

## Hooks — responsabilidades

| Hook | Qué hace | Devuelve |
|---|---|---|
| `useOrders` | Fetch pedidos del día, realtime, detecta nuevos, calcula stats | `orders, loading, newIds, stats, lastUpdate, fetchOrders` |
| `useSupportCount` | Cuenta clientes con `modo=humano`, realtime | `number` |
| `useTheme` | Toggle dark/light, persiste en localStorage, aplica `data-theme` | `{ theme, toggleTheme }` |

## Variables de entorno

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Hardcodeadas en `components/support/SupportPanel.jsx`** (pendiente mover a .env):
- `WA_ACCESS_TOKEN`
- `WA_PHONE_NUMBER_ID`
- `WA_API_VERSION`

## Realtime subscriptions

| Canal | Tabla | Evento | Manejado por |
|---|---|---|---|
| `pedidos-changes` | pedidos | * | `useOrders` → refetch |
| `clientes-modo-changes` | clientes | * | `useSupportCount` → recount |
| `soporte-messages-rt` | mensajes_soporte | INSERT | `SupportPanel` → append msg |
| `soporte-clientes-rt` | clientes | UPDATE | `SupportPanel` → refetch convos |

## Tema

- Dark/Light toggle vía `useTheme` (persistido en `localStorage`)
- CSS variables en `:root` (dark) y `[data-theme="light"]` en `styles/index.css`
- Fuentes: DM Sans + DM Mono (Google Fonts)

## Notas de implementación

- Los pedidos se filtran desde las 5:00 UTC (medianoche Colombia) para mostrar solo los del día
- `OrderCard` detecta comprobante de Transferencia pendiente y muestra aviso
- `EditOrderModal` calcula el recargo de domicilio como diferencia entre `total` e items — no lo modifica, solo lo preserva
- `EditOrderModal` usa el RPC `editar_pedido` (no update directo) para recalcular totales vía trigger
- Las imágenes en `SupportPanel` usan `loading="lazy"` + fallback visual si fallan
