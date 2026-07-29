export const COLUMNS = [
  {
    key: 'pendiente',
    title: 'Por aprobar',
    icon: 'clock',
    cls: 'amber',
    color: 'var(--amber)',
    colorDim: 'var(--amber-dim)',
    colorBorder: 'var(--amber-border)',
  },
  {
    key: 'en_cocina',
    title: 'En cocina',
    icon: 'chef',
    cls: 'purple',
    color: 'var(--purple)',
    colorDim: 'var(--purple-dim)',
    colorBorder: 'var(--purple-border)',
  },
  {
    key: ['en_camino', 'recoger'],
    title: 'En camino / Recoger',
    icon: 'scooter',
    cls: 'green',
    color: 'var(--green)',
    colorDim: 'var(--green-dim)',
    colorBorder: 'var(--green-border)',
  },
]

export const ESTADO_PAGO_LABEL = {
  pendiente:  { label: 'Pago pendiente',  cls: 'amber', color: 'var(--amber)', bg: 'var(--amber-dim)' },
  confirmado: { label: 'Pago confirmado', cls: 'green', color: 'var(--green)', bg: 'var(--green-dim)' },
  rechazado:  { label: 'Pago rechazado',  cls: 'red',   color: 'var(--red)',   bg: 'var(--red-dim)'   },
}

export const METODO_LABEL = {
  Transferencia: { icon: 'bank', cls: 'blue',  color: 'var(--blue)'  },
  Efectivo:      { icon: 'cash', cls: 'green', color: 'var(--green)' },
}

export const CLIENT_MODES = [
  { value: 'bot',                label: 'Bot',                icon: 'bot',   cls: 'bot'      },
  { value: 'humano',             label: 'Humano',             icon: 'users', cls: 'humano'   },
  { value: 'esperando_feedback', label: 'Esperando feedback', icon: 'clock', cls: 'feedback' },
]

// Etiquetas de las categorías del menú (tabla `menu`). Compartidas por
// MenuPicker (modales de pedido) y la tab Menú. Las claves están verificadas
// contra los valores REALES de `menu.categoria` (MCP, 2026-07-22) — el mapa
// original traía singulares (`entrada`, `pasta`…) que nunca matchearon la BD.
export const CATEGORY_LABELS = {
  entradas: '🥗 Entradas',
  pizza_tradicional: '🍕 Pizza Tradicional',
  pizza_especial: '🍕 Pizza Especial',
  pizza_premium: '🍕 Pizza Premium',
  pizza_premium_especial: '🍕 Pizza Premium Especial',
  pizza_dulce: '🍕 Pizza Dulce',
  calzone: '🥟 Calzone',
  canelones: '🍝 Canelones',
  lasañas: '🍝 Lasañas',
  pastas: '🍝 Pastas',
  maicito: '🌽 Maicito',
  arepas: '🥞 Arepas', // 🫓 (flatbread, Unicode 13) no renderiza en Windows 10
  patata: '🥔 Patata',
  hamburguesa: '🍔 Hamburguesa',
  menu_completo: '🍽️ Menú Completo',
  bebida: '🥤 Bebida',
  cerveza: '🍺 Cerveza',
  vino: '🍷 Vino',
  adicion: '➕ Adición',
}

// Label de categoría con fallback: si aparece una categoría nueva que aún no está
// en el mapa, se humaniza el slug con un icono genérico ("salsa_extra" → "🍴 Salsa extra")
// en vez de mostrar el slug crudo sin emoji.
export function categoryLabel(cat) {
  if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat]
  const txt = String(cat || '').replace(/_/g, ' ')
  return `🍴 ${txt.charAt(0).toUpperCase()}${txt.slice(1)}`
}

// Estados del ciclo de vida de un pedido (check de `pedidos.estado`) con su badge.
// Colores alineados al kanban (pendiente=amber, en_cocina=purple); en_camino/recoger
// usan blue (en tránsito) y entregado/cancelado los tokens de estado green/red.
export const ORDER_STATES = {
  pendiente: { label: 'Pendiente',     cls: 'amber'  },
  en_cocina: { label: 'En cocina',     cls: 'purple' },
  en_camino: { label: 'En camino',     cls: 'blue'   },
  recoger:   { label: 'Para recoger',  cls: 'blue'   },
  entregado: { label: 'Entregado',     cls: 'green'  },
  cancelado: { label: 'Cancelado',     cls: 'red'    },
}

export const RESERVATION_STATES = [
  { value: 'pendiente',  label: 'Pendiente',  short: 'Pendiente',  cls: 'amber' },
  { value: 'confirmada', label: 'Confirmada', short: 'Confirmada', cls: 'green' },
  { value: 'cancelada',  label: 'Cancelada',  short: 'Cancelada',  cls: 'red'   },
]

// Duración visual de una reserva en el calendario (minutos)
export const RESERVATION_DURATION_MIN = 90

export const SUPPORT_TABLES = {
  conversations: 'conversaciones_soporte',
  messages:      'mensajes_soporte',
  clients:       'clientes',
}

export const SUPPORT_CHANNELS = {
  messages: 'soporte-messages-rt',
  clients:  'soporte-clientes-rt',
}

// Plantillas de mensaje aprobadas en Meta (WhatsApp Manager). Única fuente de
// verdad de nombre + idioma; se envían con sendWhatsAppTemplate (type: template)
// para escribir FUERA de la ventana de servicio de 24h. El orden de variables
// del body está documentado en cada línea (debe coincidir con la plantilla).
// OJO: `name` y `lang` deben ser IDÉNTICOS a los de WhatsApp Manager o Meta
// responde 132001 (template does not exist). El idioma de las 3 es "Spanish"
// (`es`), NO `es_CO` — un es_CO aparecería en Meta como "Spanish (COL)".
// Plantillas aprobadas en Meta. `name` y `lang` deben calcar los de WhatsApp Manager
// carácter por carácter: si no, la Cloud API responde 132001 (template does not exist)
// y si no calza el nº de params, 132000. Verificado 2026-07-29 leyendo el WABA por Graph
// API (`GET /{waba_id}/message_templates`) — las 7 plantillas están APPROVED.
//
// Los valores de params NO pueden llevar saltos de línea, tabs ni 4+ espacios seguidos:
// Meta rechaza el envío. Las listas van en una sola línea separadas por comas.
export const WA_TEMPLATES = {
  // Utility · {{1}} nombre · {{2}} pedido_id
  seguimientoResena:   { name: 'seguimiento_review',   lang: 'es' },
  // Marketing · {{1}} nombre · {{2}} cupón
  reactivacionCliente: { name: 'reactivacion_cliente', lang: 'es' },
  // Marketing · {{1}} nombre · {{2}} fecha · {{3}} hora · {{4}} personas
  recordatorioReserva: { name: 'recordatorio_reserva', lang: 'es' },
  // Utility · {{1}} nombre · {{2}} fecha · {{3}} hora
  cancelacionReserva:  { name: 'cancelacion_reserva',  lang: 'es' },
  // Marketing · {{1}} nombre
  bienvenidaCliente:   { name: 'bienvenida_cliente',   lang: 'es' },
  // Utility · {{1}} nombre · {{2}} pedido_id · {{3}} items · {{4}} total · {{5}} entrega
  resumenPedido:       { name: 'resumen_pedido',       lang: 'es' },
}

export const RESOLVE_MESSAGE = 'Conversación resuelta. El cliente vuelve al bot.'
export const RESOLVE_WA_TEXT = '¡Listo! Tu consulta ha sido resuelta. Si necesitas algo más, escríbeme y con gusto te ayudo 🍕'
