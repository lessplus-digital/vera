# Vera Pizzería — Dashboard Admin · Instrucciones Copilot

## Idioma
- Responde siempre en **español** en el chat, independientemente del idioma en que se haga la pregunta.
- Los nombres de variables, funciones y código siguen siendo en inglés o tal como estén definidos en el proyecto.

## Stack
- React 18 + Vite (JSX, componentes funcionales y hooks — sin componentes de clase)
- Supabase JS v2 para auth, realtime y acceso a base de datos
- Variables CSS personalizadas — **sin Tailwind, sin shadcn, sin CSS modules, sin styled-components**
- `date-fns` para todo el manejo de fechas (locale `es`)
- Deploy: VPS con Nginx

## Reglas de estilos
- Todos los estilos van **inline** mediante la prop `style` usando variables CSS de `index.css`.
- Nunca agregar clases para layout o tema — solo `style={{ ... }}` con `var(--token)`.
- Tokens disponibles: `--bg-base`, `--bg-surface`, `--bg-card`, `--bg-card-hover`, `--border`, `--border-hover`, `--amber`, `--amber-dim`, `--amber-border`, `--purple`, `--purple-dim`, `--purple-border`, `--green`, `--green-dim`, `--green-border`, `--red`, `--red-dim`, `--red-border`, `--blue`, `--blue-dim`, `--blue-border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--font-sans`, `--font-mono`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--shadow-card`, `--shadow-glow-amber`.
- Tipografía: texto de UI usa `var(--font-sans)` (DM Sans); IDs, códigos y números usan `var(--font-mono)` (DM Mono).

## Convenciones Supabase
- El cliente es un singleton exportado desde `src/lib/supabase.js` — nunca instanciar uno nuevo.
- Siempre desestructurar `{ data, error }` y manejar el error explícitamente antes de usar `data`.
- Usar el patrón `fetchOrders()` existente (refetch completo en cada evento realtime — sin parcheo manual del estado).
- Nombre del canal realtime: `'pedidos-changes'`, tabla: `pedidos`.

## Fecha / zona horaria
- Zona horaria del negocio: Colombia (UTC-5).
- "Inicio del día" siempre es: `const today = new Date(); today.setUTCHours(5, 0, 0, 0)`.
- Pasar `today.toISOString()` a `.gte('fecha_pedido', ...)` — nunca usar medianoche local.
- Formatear fechas para mostrar con `date-fns` y `{ locale: es }`.

## Esquema de base de datos

### pedidos
| Columna | Tipo | Valores |
|---|---|---|
| `pedido_id` | text PK | formato `PED-001` |
| `telefono` | text | |
| `tipo_pedido` | text | `'Domicilio'` \| `'Recoger'` |
| `direccion_entrega` | text | |
| `metodo_pago` | text | `'Transferencia'` \| `'Efectivo'` |
| `total` | numeric | |
| `estado` | text | `'pendiente'` \| `'en_cocina'` \| `'en_camino'` \| `'recoger'` \| `'entregado'` \| `'cancelado'` |
| `estado_pago` | text | `'Pendiente'` \| `'confirmado'` \| `'rechazado'` |
| `comprobante_url` | text | nullable |
| `notas` | text | |
| `fecha_pedido` | timestamptz | |

### detalle_pedidos
| Columna | Tipo | Notas |
|---|---|---|
| `detalle_id` | text PK | formato `DET-001` |
| `pedido_id` | text FK | → pedidos |
| `nombre_producto` | text | |
| `variante` | text | tamaño o `'Estándar'` |
| `cantidad` | int4 | |
| `precio_unitario` | numeric | |
| `subtotal` | numeric | columna generada |

### menu
| Columna | Tipo | Notas |
|---|---|---|
| `producto_id` | text PK | formato `PROD-001` |
| `nombre` | text | |
| `categoria` | text | `'entrada'`\|`'pizza_tradicional'`\|`'pizza_especial'`\|`'pizza_premium'`\|`'pizza_premium_especial'`\|`'pizza_dulce'`\|`'canelones'`\|`'lasana'`\|`'pasta'`\|`'calzone'`\|`'maicito'`\|`'arepa'`\|`'patata'`\|`'hamburguesa'`\|`'bebida'`\|`'cerveza'`\|`'vino'`\|`'adicion'` |
| `variante` | text | `'Tradicional'` \| `'Estofada'` \| null |
| `precio` | numeric | null si el producto tiene tamaños |
| `disponible` | bool | |
| `tamaño` | text | JSON string ej. `{"porcion":10500,"pequena":23500,...}` \| null |

### clientes
`cliente_id` (PK `CLI-001`), `telefono` (UNIQUE), `nombre`, `direccion`, `modo` (`'bot'`\|`'humano'`)

### n8n_chat_histories
`id` (serial), `session_id` (= teléfono del cliente), `message` (jsonb), `created_at`

### pending_messages
`id` (uuid), `telefono`, `mensaje`, `created_at`

## Máquina de estados del pedido
```
Pendiente → en_cocina → en_camino → entregado   (tipo_pedido = 'Domicilio')
Pendiente → en_cocina → recoger   → entregado   (tipo_pedido = 'Recoger')
Pendiente → cancelado                            (rechazado)
```

## Lógica de columnas del dashboard
| Columna | Filtro | Acciones |
|---|---|---|
| Por aprobar | `estado = 'pendiente'` | Aprobar → `{ estado: 'en_cocina', estado_pago: 'confirmado' }` · Rechazar → `{ estado: 'cancelado', estado_pago: 'rechazado' }` |
| En cocina | `estado = 'en_cocina'` | Domicilio → `en_camino` · Recoger → `recoger` |
| En camino / Recoger | `estado IN ('en_camino','recoger')` | → `entregado` |

## Semántica de colores
- Amber (`--amber`): pendiente / requiere aprobación
- Purple (`--purple`): en cocina
- Green (`--green`): en camino / entregado / pago confirmado
- Red (`--red`): cancelado / rechazado / error
- Blue (`--blue`): info / pedidos para recoger

## Convenciones de código
- Solo componentes funcionales; estado con `useState`, efectos con `useEffect`, callbacks memorizados con `useCallback`.
- Nunca mutar el estado directamente — siempre usar el setter.
- Las llamadas a Supabase siempre dentro de funciones `async`; `setLoading(true/false)` alrededor de cada llamada.
- Formatear moneda con `Number(value).toLocaleString('es-CO')`.
- Los IDs se muestran truncados: `String(order.pedido_id).slice(0, 8)`.
- No agregar `console.log` ni `console.error` en código nuevo salvo que se esté depurando activamente.
- No introducir nuevas dependencias npm sin que se solicite explícitamente.


## Roadmap MVP pendiente
1. [ ] Fix realtime — ejecutar ALTER publication en Supabase
2. [ ] Fix filtro fecha Colombia en fetchOrders
3. [ ] Workflow n8n notificaciones al cliente (cambios de estado)
4. [ ] Human handoff (columna `modo` en clientes)
5. [ ] Subida de comprobante de pago por WhatsApp