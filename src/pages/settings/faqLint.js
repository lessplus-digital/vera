// Guardas del contenido de las FAQ.
//
// Una FAQ editable por el restaurante entra al contexto del Agente Soporte, así
// que es una vía por la que texto libre puede chocar con las reglas globales del
// bot (`docs/bot/ai-agents.md` §Reglas globales): nunca mencionar internos y
// nunca dar precios que no salgan de la BD.
//
// La defensa es en dos capas y conviene no confundirlas:
//   · ESTA capa es una alerta de redacción — atrapa el error honesto del dueño
//     del restaurante ("el domicilio cuesta $5.000" escrito a mano) y le explica
//     por qué es mala idea. NO es una barrera de seguridad: avisa, no bloquea.
//   · La capa que de verdad sostiene la regla es el prompt del Agente Soporte,
//     que trata el contenido de las FAQ como DATO y nunca como instrucción.
//
// Bloquear de verdad solo tiene sentido en lo que la BD también rechaza
// (longitudes), para que el admin vea un mensaje claro en vez de un error crudo
// de Postgres.

export const LIMITES = { pregunta: 200, respuesta: 600 }
const MINIMO = 3

// Compara sin tildes ni mayúsculas — el mismo criterio que `normalizar_texto()`
// en la BD, para que la UI y el RPC "lean" el texto igual.
const normalizar = txt =>
  String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// ── Precios ──
// El precio exacto sale de `menu` vía `consultar_menu`. Escribirlo en una FAQ
// crea una segunda fuente de verdad que envejece sola: el día que suba el
// precio, el bot sigue citando el viejo.
const PATRONES_PRECIO = [
  /\$\s*\d/,                    // $20.000
  /\b\d{1,3}(?:\.\d{3})+\b/,    // 20.000
  /\b\d+\s*(?:mil|lucas|k)\b/,  // 20 mil
  /\b(?:precio|precios|cuesta|cuestan|tarifa|tarifas|cobramos|recargo)\b/,
]

// ── Internos ──
// Regla global 1: el bot nunca menciona "el sistema", "herramientas", ni nada
// técnico. Si la FAQ lo dice, el bot lo repite.
const PATRONES_INTERNOS = [
  /\b(?:el sistema|la plataforma|base de datos|herramienta|herramientas)\b/,
  /\b(?:n8n|supabase|openai|chatgpt|api|webhook|prompt)\b/,
  /\b(?:soy un bot|soy un asistente|inteligencia artificial|automatizad)/,
]

// ── Instrucciones al agente ──
// Una FAQ describe el negocio; no le da órdenes al bot. Texto con forma de
// instrucción es la vía por la que una FAQ intentaría reescribir su
// comportamiento (a propósito o sin querer).
const PATRONES_INSTRUCCION = [
  /\b(?:ignora|ignorar|olvida|olvidar)\b/,
  /\b(?:a partir de ahora|desde ahora|de ahora en adelante)\b/,
  /\b(?:actua como|comportate como|haz de cuenta|finge)\b/,
  /\b(?:tus reglas|tus instrucciones|nuevas reglas|nuevas instrucciones)\b/,
  /\b(?:no respondas|no menciones|no digas|responde siempre|di siempre)\b/,
  /\b(?:system|assistant|instruccion|instrucciones)\b/,
]

const alguno = (patrones, texto) => patrones.some(p => p.test(texto))

/**
 * Valida una FAQ antes de guardarla.
 * @returns {{ errores: string[], avisos: {tipo: string, mensaje: string}[] }}
 *   `errores` impide guardar (lo mismo que rechazan los CHECK de la tabla).
 *   `avisos` no impide guardar: cambia el botón a "Guardar de todos modos".
 */
export function validarFaq({ pregunta, respuesta }) {
  const errores = []
  const avisos = []

  const p = String(pregunta || '').trim()
  const r = String(respuesta || '').trim()

  if (p.length < MINIMO) {
    errores.push('Escribe la pregunta como la haría un cliente.')
  } else if (p.length > LIMITES.pregunta) {
    errores.push(`La pregunta no puede pasar de ${LIMITES.pregunta} caracteres.`)
  }

  if (r.length < MINIMO) {
    errores.push('Escribe la respuesta que debe dar el bot.')
  } else if (r.length > LIMITES.respuesta) {
    errores.push(`La respuesta no puede pasar de ${LIMITES.respuesta} caracteres.`)
  }

  // Los avisos se calculan sobre pregunta + respuesta juntas.
  const texto = normalizar(`${p} ${r}`)

  if (alguno(PATRONES_PRECIO, texto)) {
    avisos.push({
      tipo: 'precio',
      mensaje:
        'Parece que hay un precio escrito a mano. El bot toma los precios exactos del menú, ' +
        'así que este quedaría desactualizado el día que cambie. Mejor remite al menú.',
    })
  }

  if (alguno(PATRONES_INTERNOS, texto)) {
    avisos.push({
      tipo: 'internos',
      mensaje:
        'Menciona algo técnico (el sistema, una herramienta, el bot). El bot habla como una ' +
        'persona del restaurante y nunca nombra cómo funciona por dentro.',
    })
  }

  if (alguno(PATRONES_INSTRUCCION, texto)) {
    avisos.push({
      tipo: 'instruccion',
      mensaje:
        'El texto parece darle órdenes al bot en vez de describir el negocio. Las preguntas ' +
        'frecuentes son información, no instrucciones: el bot las lee como un dato más.',
    })
  }

  return { errores, avisos }
}
