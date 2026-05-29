# Dashboard Admin — React + Vite

## Stack del frontend

- **React** (sin framework, SPA)
- **Vite** (build tool)
- **Supabase JS Client** (datos + realtime)
- **WhatsApp Cloud API** (envío directo desde soporte)
- **Sin router** — navegación por tabs internas

## Estructura de componentes

```
src/
├── App.jsx              ← Layout principal, tabs, Kanban de pedidos
├── main.jsx             ← Entry point
├── supabaseClient.js    ← Configuración del cliente Supabase
└── components/
    ├── OrderCard.jsx    ← Tarjeta individual de pedido (con acciones)
    ├── EditOrderModal.jsx   ← Modal para editar items de un pedido
    ├── RejectModal.jsx      ← Modal con motivos predeterminados de rechazo
    └── SupportPanel.jsx     ← Panel de soporte (chat con clientes)
```

## Tabs principales

### 1. Pedidos (Kanban)

**Vista:** 3 columnas — Pendientes, En cocina, En camino / Recoger
**Realtime:** Suscripción a `pedidos` (INSERT, UPDATE, DELETE)
**Notificaciones:** Audio + badge pulsante cuando llega pedido nuevo

**Cada OrderCard muestra:**
- Número de pedido (truncado)
- Teléfono, tipo (domicilio/recoger), método de pago
- Items con precio unitario
- Total
- Notas del cliente
- Estado del comprobante (si pago por transferencia)
- Botones de acción según estado

**Acciones disponibles por estado:**
| Estado | Acciones |
|---|---|
| `pendiente` | Aceptar → en_cocina, Rechazar (con motivo), Editar items |
| `en_cocina` | Marcar listo → en_camino/recoger |
| `en_camino` | Marcar entregado |
| `recoger` | Marcar entregado |

### 2. Soporte (Chat)

**Vista:** Sidebar de conversaciones activas + panel de chat
**Condición:** Solo muestra clientes donde `modo = 'humano'`
**Realtime:** Suscripción a `mensajes_soporte` + `clientes`

**Funcionalidad:**
- Ver historial de mensajes con el cliente
- Enviar mensaje directo por WhatsApp API
- Resolver conversación → cambia `modo` a `'bot'` + notifica al cliente
- Badge en el tab muestra cantidad de conversaciones activas

## Variables de entorno del frontend

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Hardcodeadas en SupportPanel.jsx** (pendiente mover a .env):
- `WA_ACCESS_TOKEN`
- `WA_PHONE_NUMBER_ID`
- `WA_API_VERSION`

## Tema

- Dark/Light toggle (persistido en localStorage)
- CSS variables definidas en `:root` y `[data-theme="dark"]`
- Fuentes: DM Sans + DM Mono (Google Fonts)

## Realtime subscriptions

| Canal | Tabla | Evento | Efecto |
|---|---|---|---|
| `pedidos-changes` | pedidos | * | Refetch de pedidos del día |
| `clientes-modo-changes` | clientes | UPDATE | Actualizar badge soporte |
| `soporte-mensajes-rt` | mensajes_soporte | INSERT | Agregar mensaje al chat |
| `soporte-clientes-rt` | clientes | UPDATE | Refetch conversaciones |
