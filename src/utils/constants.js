export const COLUMNS = [
  {
    key: 'pendiente',
    title: 'Por aprobar',
    emoji: '⏳',
    cls: 'amber',
    color: 'var(--amber)',
    colorDim: 'var(--amber-dim)',
    colorBorder: 'var(--amber-border)',
  },
  {
    key: 'en_cocina',
    title: 'En cocina',
    emoji: '👨‍🍳',
    cls: 'purple',
    color: 'var(--purple)',
    colorDim: 'var(--purple-dim)',
    colorBorder: 'var(--purple-border)',
  },
  {
    key: ['en_camino', 'recoger'],
    title: 'En camino / Recoger',
    emoji: '🛵',
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
  Transferencia: { icon: '🏦', cls: 'blue',  color: 'var(--blue)'  },
  Efectivo:      { icon: '💵', cls: 'green', color: 'var(--green)' },
}

export const CLIENT_MODES = [
  { value: 'bot',                label: '🤖 Bot',                cls: 'bot'      },
  { value: 'humano',             label: '💬 Humano',             cls: 'humano'   },
  { value: 'esperando_feedback', label: '⏳ Esperando feedback', cls: 'feedback' },
]

export const RESERVATION_STATES = [
  { value: 'pendiente',  label: '⏳ Pendiente',  short: 'Pendiente',  cls: 'amber' },
  { value: 'confirmada', label: '✓ Confirmada', short: 'Confirmada', cls: 'green' },
  { value: 'cancelada',  label: '✕ Cancelada',  short: 'Cancelada',  cls: 'red'   },
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

export const RESOLVE_MESSAGE = 'Conversación resuelta. El cliente vuelve al bot.'
export const RESOLVE_WA_TEXT = '¡Listo! Tu consulta ha sido resuelta. Si necesitas algo más, escríbeme y con gusto te ayudo 🍕'
