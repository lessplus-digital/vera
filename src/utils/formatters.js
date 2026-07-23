export function timeAgoShort(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

// "hace 5 min / hace 2 h / hace 3 días / hace 2 sem / hace 1 mes".
// Recibe un Date ya parseado (ej. parseDb(fecha)) o un timestamp/string.
export function timeAgo(date) {
  const secs = (Date.now() - new Date(date).getTime()) / 1000
  if (secs < 60) return 'hace un momento'
  if (secs < 3600) { const m = Math.floor(secs / 60); return `hace ${m} min` }
  if (secs < 86400) { const h = Math.floor(secs / 3600); return `hace ${h} h` }
  const days = Math.floor(secs / 86400)
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`
  if (days < 30) { const w = Math.floor(days / 7); return `hace ${w} sem` }
  const months = Math.floor(days / 30)
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`
}

// Teléfono legible. Colombia: 57 + 10 dígitos → "+57 300 123 4567".
// Cualquier otro formato cae a "+<dígitos>" para no romper.
export function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 12 && d.startsWith('57')) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  return `+${d}`
}

export function formatPrice(amount) {
  return `$${Number(amount || 0).toLocaleString('es-CO')}`
}

// Versión abreviada para ejes de gráficas: $1,2M / $120k / $900
export function formatPriceShort(amount) {
  const n = Number(amount || 0)
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000).toLocaleString('es-CO')}k`
  return `$${n.toLocaleString('es-CO')}`
}
