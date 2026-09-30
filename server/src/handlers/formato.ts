import type { Carrito, Cobertura, LineaCarrito } from '../bd/repo.js'
import type { UltimaPregunta } from '../decision/contexto.js'
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

export type DatosResumen = {
  nombre: string | null
  carrito: Carrito
  tipo_pedido: 'domicilio' | 'recoger'
  costo_domicilio: number | null
  direccion_entrega: string | null
  barrio: string | null
  metodo_pago: 'Efectivo' | 'Transferencia'
}

/**
 * El resumen que el cliente confirma (PASO 3 del prompt de n8n, los cuatro casos
 * domicilio/recoger × efectivo/transferencia). Lo arma el código: el total es
 * subtotal + domicilio tal como están en la BD; el LLM no suma nada.
 */
export function bloqueResumen(r: DatosResumen): string {
  const lineas = r.carrito.lineas.map(
    (l) => `🛒 ${l.cantidad}x ${nombreLinea(l)} — ${pesos(l.subtotal)}${l.notas ? `\n    _${l.notas}_` : ''}`,
  )
  const dom = r.tipo_pedido === 'domicilio'
  const costo = dom ? (r.costo_domicilio ?? 0) : 0
  const cuentas = dom
    ? [
        `💰 Subtotal: ${pesos(r.carrito.total)}`,
        `🛵 Domicilio: ${pesos(costo)}`,
        `💰 *Total a pagar: ${pesos(r.carrito.total + costo)}*`,
        `📍 Envío a: ${[r.direccion_entrega, r.barrio].filter(Boolean).join(', ')}`,
      ]
    : [`💰 *Total: ${pesos(r.carrito.total)}*`, '🏃 Recoger en el local']
  const saludo = r.nombre ? `Perfecto ${r.nombre}, tu pedido queda así:` : 'Perfecto, tu pedido queda así:'
  return [saludo, lineas.join('\n'), [...cuentas, `💳 ${r.metodo_pago}`].join('\n'), PREGUNTA_CONFIRMAR].join('\n\n')
}

export const PREGUNTA_CONFIRMAR = '¿Te lo confirmo así?'

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

// ── Cobertura ──────────────────────────────────────────────────────────────
// La misma respuesta en Pedidos y en Soporte: la tarifa y el tiempo salen de
// consultar_cobertura, y sin cobertura no hay tarifa ni tiempo (BUG-033/061).

export const siLlegamos = (c: Cobertura) =>
  `¡A ${c.barrio} sí llegamos! 🛵 El domicilio cuesta ${pesos(c.costo_domicilio ?? 0)}${c.tiempo_estimado ? ` y tarda ${c.tiempo_estimado}` : ''}.`

export const noLlegamos = (barrio: string) =>
  `Uy, hasta ${barrio} no te llegamos 😔 Solo hacemos domicilios dentro de Bello. Si te queda fácil, te lo dejamos listo para recoger en el local, ¿te sirve?`

/** Sin cobertura: qué decir y qué queda preguntado (una sugerencia, dos, o ninguna → recoger). */
export function sinCobertura(c: Cobertura): { texto: string; pregunta: UltimaPregunta } {
  const [a, b] = c.sugerencias
  if (a && b) return { texto: `No encontré "${c.barrio}" 🤔 ¿Te refieres a ${a} o a ${b}?`, pregunta: { tipo: 'dato_pedido', dato: 'barrio' } }
  if (a) return { texto: `¿Te refieres al barrio ${a}?`, pregunta: { tipo: 'sugerir_barrio', barrio: a } }
  return { texto: noLlegamos(c.barrio), pregunta: { tipo: 'ofrecer_recoger' } }
}
