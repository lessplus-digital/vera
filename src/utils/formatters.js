export function timeAgoShort(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

export function formatPrice(amount) {
  return `$${Number(amount || 0).toLocaleString('es-CO')}`
}
