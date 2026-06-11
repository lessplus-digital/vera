export function timeAgoShort(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
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
