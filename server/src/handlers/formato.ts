import type { Carrito, LineaCarrito } from '../bd/repo.js'
import { pesos } from '../guardia/guardia.js'

// Bloques de texto con dinero: los arma el código a partir de la BD, nunca el
// LLM. El modelo escribe la frase de alrededor; los números salen de aquí.

/** "Hawaiana Tradicional (Mediana)" — la masa va siempre: hay hawaiana tradicional y estofada. */
export function nombreLinea(l: LineaCarrito): string {
  const tam = l.variante && l.variante.toLowerCase() !== 'estándar' ? l.variante : null
  if (l.mitades?.length) return `${l.nombre} (${[l.masa, tam].filter(Boolean).join(', ')})`
  return `${l.nombre}${l.masa ? ` ${l.masa}` : ''}${tam ? ` (${tam})` : ''}`
}

export function bloqueCarrito(c: Carrito): string {
  const lineas = c.lineas.map(
    (l) => `${l.linea}. ${l.cantidad}x ${nombreLinea(l)} — ${pesos(l.subtotal)}${l.notas ? `\n    _${l.notas}_` : ''}`,
  )
  return `🛒 *Tu pedido:*\n${lineas.join('\n')}\n\n💰 *Subtotal: ${pesos(c.total)}*`
}

/** El carrito en texto plano para el contexto del LLM (con número de línea para quitar). */
export function carritoParaLLM(c: Carrito): string {
  if (!c.lineas.length) return '(vacío)'
  return (
    c.lineas.map((l) => `línea ${l.linea}: ${l.cantidad}x ${nombreLinea(l)} [${l.producto_id}] — ${pesos(l.subtotal)}${l.notas ? ` · nota: ${l.notas}` : ''}`).join('\n') +
    `\nsubtotal: ${pesos(c.total)}`
  )
}

/** Todos los montos que un carrito le permite citar al texto (para la guardia). */
export const montosDeCarrito = (c: Carrito) => [c.total, ...c.lineas.flatMap((l) => [l.subtotal, l.precio_unitario])]
