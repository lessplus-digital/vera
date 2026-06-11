// Manejo de rangos de fecha con día de negocio Colombia (UTC-5).
// El día de negocio inicia a las 05:00 UTC (00:00 hora Colombia),
// mismo criterio que useOrders.js.

const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000

// fecha_pedido es columna `timestamp` (sin tz) con valor UTC: llega como
// '2026-05-23T17:11:42.365' y JS la parsearía como hora LOCAL del navegador.
// Se fuerza UTC añadiendo 'Z' cuando no trae offset.
export function parseDb(dateStr) {
  if (dateStr instanceof Date) return dateStr
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr)
  return new Date(hasTz ? dateStr : `${dateStr}Z`)
}

// Date desplazada -5h: leer con getUTC*() da hora/día Colombia
// sin depender del timezone del navegador.
export function toColombia(dateStr) {
  return new Date(parseDb(dateStr).getTime() - COLOMBIA_OFFSET_MS)
}

// Inicio del día de negocio (05:00 UTC) del día Colombia que contiene `date`.
export function colombiaDayStart(date = new Date()) {
  const shifted = new Date(date.getTime() - COLOMBIA_OFFSET_MS)
  const start = new Date(Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 5, 0, 0, 0
  ))
  return start
}

const DAY_MS = 24 * 3600 * 1000

export const PRESETS = [
  { key: 'hoy', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'custom', label: 'Personalizado' },
]

// => { from, to } en UTC; `to` es exclusivo (inicio del día siguiente).
// customFrom/customTo: strings 'YYYY-MM-DD' de los inputs date.
export function getRange(preset, customFrom, customTo) {
  const todayStart = colombiaDayStart()
  const tomorrow = new Date(todayStart.getTime() + DAY_MS)

  switch (preset) {
    case 'hoy':
      return { from: todayStart, to: tomorrow }
    case '7d':
      return { from: new Date(tomorrow.getTime() - 7 * DAY_MS), to: tomorrow }
    case '30d':
      return { from: new Date(tomorrow.getTime() - 30 * DAY_MS), to: tomorrow }
    case '90d':
      return { from: new Date(tomorrow.getTime() - 90 * DAY_MS), to: tomorrow }
    case 'mes': {
      const shifted = new Date(Date.now() - COLOMBIA_OFFSET_MS)
      const monthStart = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 5))
      return { from: monthStart, to: tomorrow }
    }
    case 'custom': {
      if (!customFrom || !customTo) return null
      // 'YYYY-MM-DD' interpretado como día Colombia → 05:00 UTC
      const from = new Date(`${customFrom}T05:00:00Z`)
      const to = new Date(new Date(`${customTo}T05:00:00Z`).getTime() + DAY_MS)
      if (from >= to) return null
      return { from, to }
    }
    default:
      return { from: new Date(tomorrow.getTime() - 7 * DAY_MS), to: tomorrow }
  }
}

// Periodo inmediatamente anterior con la misma duración.
export function getPreviousRange({ from, to }) {
  const span = to.getTime() - from.getTime()
  return { from: new Date(from.getTime() - span), to: from }
}
