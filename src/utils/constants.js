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

export const RESOLVE_MESSAGE = 'Conversación resuelta. El cliente vuelve al bot.'
export const RESOLVE_WA_TEXT = '¡Listo! Tu consulta ha sido resuelta. Si necesitas algo más, escríbeme y con gusto te ayudo 🍕'
