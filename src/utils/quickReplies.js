// Marcadores admitidos en el texto de una respuesta rápida.
//
// Deliberadamente hay UNO solo. Cada marcador nuevo es un dato que puede faltar
// en tiempo de envío y dejar un "{algo}" crudo delante del cliente; el nombre es
// el único que el chat de soporte siempre tiene a mano (`conversaciones_soporte`
// lo trae en cada fila).
export const MARCADOR_NOMBRE = '{nombre}'

// Primer nombre: "Juan Pablo Clavijo" → "Juan". Un saludo enlatado suena a
// formulario cuando usa el nombre completo.
function primerNombre(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || ''
}

/**
 * Reemplaza {nombre} por el nombre del cliente.
 *
 * Sin nombre (cliente que aún no lo ha dado) el marcador NO se deja crudo ni se
 * cambia por un placeholder tipo "cliente": se borra junto con la coma o el
 * espacio que lo seguía, de modo que "Hola {nombre}, tu pedido…" quede en
 * "Hola, tu pedido…" en vez de "Hola , tu pedido…".
 */
export function aplicarNombre(texto, nombre) {
  const t = String(texto || '')
  const n = primerNombre(nombre)

  if (n) return t.replaceAll(MARCADOR_NOMBRE, n)

  return t
    .replace(/[ \t]*\{nombre\}[ \t]*(,[ \t]*)?/g, (_, coma) => (coma ? ', ' : ' '))
    .replace(/[ \t]{2,}/g, ' ')
    // "{nombre}, buenas" se quedaría con la coma colgando al inicio de la línea.
    .replace(/^[ \t]*,[ \t]*/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

// ¿El texto usa el marcador? Sirve para avisar en el editor y para pintar el
// preview con un nombre de ejemplo.
export function usaNombre(texto) {
  return String(texto || '').includes(MARCADOR_NOMBRE)
}
