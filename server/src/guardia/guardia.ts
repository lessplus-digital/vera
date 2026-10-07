// Guardia de salida: lo último que ve un texto redactado por el LLM antes de
// llegar al cliente. No juzga el tono; comprueba que el texto no contradiga lo
// que devolvieron las herramientas en ESTE turno. Nace de BUG-061: con
// `cubierto:false` y la tarifa en null, el modelo cantó "$7.500, 30 a 45
// minutos" sacados de la memoria de la conversación.
//
// Si el texto viola una regla se regenera UNA vez diciéndole al modelo qué
// falló; si vuelve a fallar, sale un texto seguro fijo y queda en el log.

/** Lo que el turno sabe con certeza, porque lo devolvió una herramienta o la BD. */
export type Hechos = {
  /** Todo monto de dinero que devolvió una herramienta (precios, subtotales, tarifas, totales). */
  montos: number[]
  /** Resultado de consultar_cobertura, si se consultó en este turno. */
  cobertura?: { cubierto: boolean }
  /** Pedido creado en este turno por el código (crear_orden_desde_carrito). */
  pedidoCreado?: { pedido_id: string; total: number }
  /** Ids de pedido que el cliente puede ver citados (los suyos, leídos de la BD). */
  pedidosConocidos?: string[]
  /** Nombres de productos que devolvió el menú o que están en el carrito en este turno. */
  productos?: string[]
  /** Lo que escribió el cliente: puede nombrar algo que no tenemos ("¿tienen Heineken?") y el bot contestarle. */
  textoCliente?: string
  /** Solo el agente de Menú lo pone: false = respondió sin llamar consultar_menu en este turno. */
  consultoMenu?: boolean
}

export type Violacion =
  | { regla: 'internos'; detalle: string }
  | { regla: 'monto_desconocido'; detalle: string }
  | { regla: 'tiempo_sin_cobertura'; detalle: string }
  | { regla: 'pedido_sin_id_o_total'; detalle: string }
  | { regla: 'pedido_inventado'; detalle: string }
  | { regla: 'producto_inventado'; detalle: string }
  | { regla: 'niega_sin_consultar'; detalle: string }
  | { regla: 'niega_servicio'; detalle: string }
  | { regla: 'fuera_de_tema'; detalle: string }

export const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')}`

// El bot nunca habla de sus tripas (regla global de docs/bot/ai-agents.md).
const INTERNOS =
  /\b(n8n|supabase|base de datos|herramientas?|tools?|json|rpc|api|sistema|prompt|backend|servidor|bot|chatbot)\b/i

// "$7.500", "$ 7500", "7.500 pesos", "7 mil", "$7,500", y "51.500" sin signo: un número
// con punto de miles en esta conversación es plata (visto con gpt-5.1 el 2026-09-30).
const MONTO = /\$\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:pesos|cop)\b|\b\d+(?:[.,]\d+)?\s?mil\b|\b\d{1,3}(?:\.\d{3})+\b/gi

export function leerMonto(token: string): number | null {
  const t = token.toLowerCase()
  const esMil = /mil\b/.test(t)
  const num = t.replace(/[^\d.,]/g, '')
  if (!num) return null
  let n: number
  if (esMil) {
    n = Number(num.replace(',', '.')) * 1000 // "7,5 mil" / "7.5 mil"
  } else {
    // En Colombia el punto y la coma separan miles; los pesos no llevan centavos en el menú.
    n = Number(num.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, ''))
  }
  return Number.isFinite(n) ? n : null
}

// "30 a 45 minutos", "40 min", "una hora", "media hora"
const TIEMPO = /\b\d+\s?(?:a|-|y)?\s?\d*\s?(?:minutos?|mins?)\b|\b(?:una|media|1)\s?hora\b/i

const PEDIDO_ID = /\bPED-\d+\b/gi
const DICE_CREADO =
  /\b(?:tu\s+)?pedido\s+(?:qued[óo]|fue|est[áa]|ha sido|ya est[áa])?\s*(?:creado|registrado|confirmado|realizado)\b/i

// Productos famosos que el modelo nombra de memoria al "dar ejemplos" (G1.5, 2026-10-02:
// a "quiero una chelita" ofreció Stella y Michelob, que no están en la carta). Solo
// pasan si una herramienta los devolvió en este turno —así, si el restaurante los
// agrega a la carta, dejan de bloquearse solos— o si el cliente los nombró.
const PRODUCTOS_AJENOS = [
  'stella', 'michelob', 'heineken', 'budweiser', 'poker', 'costena', 'costenita', "redd's", 'miller', 'coors',
  'peroni', 'bbc', 'tecate', 'pepsi', 'postobon', '7up', 'seven up', 'fanta',
  'pony malta', 'gatorade', 'red bull', 'napolitana', 'cuatro quesos', 'cuatro estaciones', 'marinera', 'bbq',
  'barbacoa', 'diavola', 'capricciosa', 'prosciutto', 'calabresa', 'quattro formaggi',
]
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const AJENOS = PRODUCTOS_AJENOS.map((p) => ({ p, re: new RegExp(`(?<![\\p{L}\\d])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'u') }))

// "no lo tenemos", "no encontré…", "no está en la carta": decir que algo NO existe
// exige haberlo buscado (G1.6, 2026-10-02: "papata mexicana" → "no la encontré" sin buscar).
const NIEGA =
  /(?<!\p{L})no\s+(?:l[oa]s?\s+|me\s+)?(?:encontr[ée]|tenemos|manejamos|vendemos|ofrecemos|aparecen?)(?!\p{L})|(?<!\p{L})no\s+(?:est[áa]n?|aparecen?)\s+en\s+(?:la\s+carta|el\s+men[uú]|nuestr[oa]\s+(?:men[uú]|carta))/iu

// Este WhatsApp hace pedidos, reservas, info del local y quejas. Ningún agente puede
// mandar al cliente a "otra línea" (2026-10-02: Menú contestó "por aquí solo manejo
// pedidos; para reservar comunícate a la línea de reservas").
const NIEGA_SERVICIO =
  /(?:no|solo)\s+(?:manejo|manejamos|hago|hacemos|tomo|tomamos|puedo|podemos|atiendo|atendemos)\b[^.!?\n]{0,40}\breserv|comun[ií]cate[^.!?\n]{0,50}\b(?:l[ií]nea|canal|tel[eé]fono|n[uú]mero|reserv)|(?:l[ií]nea|canal)\s+de\s+reservas/iu

// Un mensaje de la pizzería nunca trae código. Red de seguridad de la regla
// fuera_de_tema (2026-10-07: Soporte mandó una matriz en Python).
const CODIGO = /```|\bdef\s+\w+\s*\(|\bprint\s*\(|\bconsole\.log\b|\brange\s*\(|^\s*(?:import|from)\s+\w+\s|\bfunction\s+\w+\s*\(|\bSELECT\b[^\n]*\bFROM\b|<\/?(?:div|html|script)\b/im

const citaConocido = (texto: string, ids: string[]) =>
  (texto.match(PEDIDO_ID) ?? []).some((id) => ids.some((k) => k.toUpperCase() === id.toUpperCase()))

export function revisar(texto: string, h: Hechos): Violacion[] {
  const v: Violacion[] = []

  const interno = texto.match(INTERNOS)
  if (interno) v.push({ regla: 'internos', detalle: `menciona "${interno[0]}"` })

  const conocidos = new Set(h.montos.map((m) => Math.round(m)))
  if (h.pedidoCreado) conocidos.add(Math.round(h.pedidoCreado.total))
  for (const token of texto.match(MONTO) ?? []) {
    const n = leerMonto(token)
    if (n != null && n > 0 && !conocidos.has(n)) {
      v.push({ regla: 'monto_desconocido', detalle: `"${token.trim()}" no salió de ninguna consulta de este turno` })
    }
  }

  if (h.cobertura && !h.cobertura.cubierto) {
    const t = texto.match(TIEMPO)
    if (t) v.push({ regla: 'tiempo_sin_cobertura', detalle: `promete un tiempo ("${t[0]}") a un barrio sin cobertura` })
  }

  if (h.pedidoCreado) {
    const { pedido_id, total } = h.pedidoCreado
    if (!texto.includes(pedido_id) || !texto.includes(pesos(total))) {
      v.push({ regla: 'pedido_sin_id_o_total', detalle: `debe decir ${pedido_id} y ${pesos(total)}` })
    }
  } else if (DICE_CREADO.test(texto) && !citaConocido(texto, h.pedidosConocidos ?? [])) {
    // Hablar de un pedido existente ("tu pedido PED-12 está confirmado") sí se permite.
    v.push({ regla: 'pedido_inventado', detalle: 'dice que el pedido quedó creado, pero en este turno no se creó ninguno' })
  }

  const ids = new Set([...(h.pedidosConocidos ?? []), ...(h.pedidoCreado ? [h.pedidoCreado.pedido_id] : [])].map((s) => s.toUpperCase()))
  for (const id of texto.match(PEDIDO_ID) ?? []) {
    if (!ids.has(id.toUpperCase())) v.push({ regla: 'pedido_inventado', detalle: `cita ${id}, que no es un pedido suyo` })
  }

  if (h.consultoMenu === false) {
    const n = texto.match(NIEGA)
    if (n) v.push({ regla: 'niega_sin_consultar', detalle: `dice "${n[0]}" sin haber buscado en el menú en este turno: llama consultar_menu antes de decir que no lo tenemos` })
  }

  const ns = texto.match(NIEGA_SERVICIO)
  if (ns) v.push({ regla: 'niega_servicio', detalle: `dice "${ns[0]}": por este mismo chat se hacen pedidos y reservas; nunca lo mandes a otra línea` })

  const cod = texto.match(CODIGO)
  if (cod) v.push({ regla: 'fuera_de_tema', detalle: `trae código ("${cod[0].trim()}"): solo atiendes temas de Vera Pizzería; no ayudes con nada ajeno` })

  const t = normalizar(texto)
  const permitido = normalizar([...(h.productos ?? []), h.textoCliente ?? ''].join('\n'))
  for (const { p, re } of AJENOS) {
    if (re.test(t) && !re.test(permitido)) {
      v.push({ regla: 'producto_inventado', detalle: `nombra "${p}", que no salió del menú en este turno: solo se ofrecen productos que devolvió consultar_menu` })
    }
  }

  return v
}

export type ResultadoGuardia = {
  texto: string
  /** 0 = pasó a la primera, 1 = pasó al regenerar, 2 = salió el texto seguro. */
  intentos_fallidos: number
  violaciones: Violacion[]
}

/**
 * Redacta, revisa y, si hace falta, regenera una vez. `redactar` recibe las
 * violaciones del intento anterior para corregirse (vacío en el primero).
 */
export async function conGuardia(
  redactar: (violacionesPrevias: Violacion[]) => Promise<string>,
  hechos: Hechos,
  textoSeguro: string,
): Promise<ResultadoGuardia> {
  const primero = await redactar([])
  const v1 = revisar(primero, hechos)
  if (!v1.length) return { texto: primero, intentos_fallidos: 0, violaciones: [] }

  const segundo = await redactar(v1)
  const v2 = revisar(segundo, hechos)
  if (!v2.length) return { texto: segundo, intentos_fallidos: 1, violaciones: v1 }

  return { texto: textoSeguro, intentos_fallidos: 2, violaciones: [...v1, ...v2] }
}
