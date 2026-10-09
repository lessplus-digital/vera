import type { Clasificacion, Intencion } from './clasificacion.js'
import type { BorradorReserva, ContextoDecision, EstadoPedido, Faltante, Handler, UltimaPregunta } from './contexto.js'
import { borradorListo, cambiaLaReserva } from './reserva.js'

// POLÍTICA: el corazón de "la IA conversa, el código decide". Recibe lo que el
// clasificador leyó del mensaje + el estado real de la BD y devuelve, sin LLM y
// sin efectos, qué handler redacta la respuesta y qué acciones críticas ejecuta
// el código antes. Es una función pura: cada regla tiene su caso en
// test/unit/politica.test.ts, sacado del bug-tracker y de los edge-cases.
//
// Porta las reglas del ORQUESTADOR de n8n (versión publicada 1d7f7d87, más los
// parches de BUG-061/062 que nunca corrieron por BUG-063), con dos diferencias:
//  - el orquestador no sabía qué había preguntado el agente; aquí se sabe
//    (`ultima_pregunta`), así que un "dale" se interpreta sin adivinar;
//  - las acciones críticas (crear pedido, handoff, cobertura, reservas) las
//    ejecuta el código, no un agente que "debería" llamar a una herramienta.

export type Accion =
  | { tipo: 'pasar_a_humano'; motivo: 'lo_pidio' | 'frustracion' }
  | { tipo: 'crear_pedido' }
  /** `guardar`: el cliente AFIRMÓ el barrio (se guarda con su tarifa); false = solo preguntó. */
  | { tipo: 'verificar_cobertura'; barrio: string; guardar: boolean }
  | { tipo: 'guardar_datos'; datos: DatosPedido }
  | { tipo: 'vaciar_carrito' }
  /** Solo si el cliente no tenía nombre registrado y el que dio pasa `nombreValido`. */
  | { tipo: 'guardar_nombre'; nombre: string }
  | { tipo: 'crear_reserva' }
  | { tipo: 'cancelar_reserva'; reserva_id: string }

export type DatosPedido = {
  tipo_pedido?: 'domicilio' | 'recoger'
  direccion_entrega?: string
  metodo_pago?: 'Efectivo' | 'Transferencia'
}

export type Decision = {
  /** Quién redacta la respuesta. 'humano' = nadie: el turno termina con el aviso de handoff. */
  handler: Handler | 'humano'
  acciones: Accion[]
  /** Por qué, en una línea: va al log del turno (bot_turnos) y a las pruebas. */
  regla: string
  /** Contexto para el handler (p. ej. el producto que el cliente aceptó con un "dale"). */
  nota?: string
  /** Dirección que el cliente dio sin calle ni número ("cerca al parque"): NO se guardó. */
  direccion_vaga?: string
}

// El carrito lo arma Menú (tiene el catálogo); Pedidos recoge los datos y cierra.
/** Intenciones con las que un "sí" contesta "¿te conecto con alguien del equipo?". */
const RESPONDE_OFERTA = new Set<Intencion>(['respuesta_corta', 'otro', 'queja', 'saludo'])

const HANDLER_DE: Record<Intencion, Handler | null> = {
  saludo: 'soporte',
  ver_menu: 'menu',
  pregunta_producto: 'menu',
  agregar_producto: 'menu',
  quitar_producto: 'menu',
  ver_carrito: 'pedidos',
  datos_pedido: null, //      depende de si hay carrito
  cancelar_carrito: null, //  ídem: sin carrito, "ya no lo quiero" habla de un pedido registrado
  cobertura: null, //         ídem
  estado_pedido: 'soporte',
  reserva_nueva: 'reservas',
  reserva_consultar: 'reservas',
  reserva_cancelar: 'reservas',
  info_negocio: 'soporte',
  queja: 'soporte',
  respuesta_corta: null, //   depende de la última pregunta
  otro: null,
}

/** Intenciones que, a mitad de una reserva, son otro tema (el borrador se conserva). */
const OTRO_TEMA = new Set<Intencion>(['ver_menu', 'pregunta_producto', 'agregar_producto', 'quitar_producto', 'ver_carrito', 'cancelar_carrito', 'estado_pedido', 'info_negocio', 'queja', 'cobertura', 'saludo'])
/** "Somos 4" llega a veces como datos_pedido: solo es del pedido si trae un dato del pedido. */
const otroTema = (c: Clasificacion) =>
  OTRO_TEMA.has(c.intencion) || (c.intencion === 'datos_pedido' && !!(c.tipo_pedido || c.barrio || c.direccion || c.metodo_pago))

const hayCarrito = (e: EstadoPedido | null) => !!e && e.n_items > 0

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Un dato que el mensaje trae y que NO es el que ya está guardado. */
const distinto = (nuevo: string | null | undefined, guardado: string | null | undefined) => !!nuevo && norm(nuevo) !== norm(guardado)

/**
 * El cliente cambió algo del pedido en el mismo mensaje ("sí, pero sin cebolla").
 * Un dato que coincide con lo guardado no es un cambio: el clasificador suele
 * repetir el pago o el barrio del historial en un "sí, confírmalo" (visto con
 * gpt-5.1 el 2026-09-30: el pedido no se creaba).
 */
const cambiaElPedido = (c: Clasificacion, e: EstadoPedido | null, texto: string) =>
  c.productos.length > 0 ||
  c.intencion === 'quitar_producto' ||
  (c.intenciones_extra.includes('quitar_producto') && pideQuitar(texto)) ||
  distinto(c.tipo_pedido, e?.tipo_pedido) ||
  distinto(c.barrio, e?.barrio) ||
  distinto(c.direccion, e?.direccion_entrega) ||
  distinto(c.metodo_pago, e?.metodo_pago)

/**
 * Un `quitar_producto` que llega solo como intención EXTRA cuenta si el texto
 * pide quitar algo. "No así está bien" a "¿algo más?" llegó con
 * intenciones_extra: ['quitar_producto'], se tomó como cambio y el pedido
 * quedó en Menú sin avanzar (2026-10-06, 573184821317).
 */
const pideQuitar = (texto: string) =>
  /\b(quit|saca|sacar|sacal|elimin|borr|ya no|no quiero|menos|cambi)/.test(norm(texto))

/** El mensaje trae algo que el restaurante puede atender: un producto o un dato del pedido o la reserva. */
const traeAlgoDelRestaurante = (c: Clasificacion) =>
  c.productos.length > 0 || !!(c.tipo_pedido || c.barrio || c.direccion || c.metodo_pago || c.fecha || c.hora || c.personas)

type DatoPreguntable = Exclude<Faltante, 'carrito' | 'cobertura'>

/**
 * Qué dato está esperando el bot. Primero lo que se preguntó de verdad; si no
 * consta, lo primero que falta del pedido (la regla del orquestador de n8n: con
 * carrito y datos pendientes, un mensaje suelto responde a esa pregunta).
 */
function datoEsperado(ultima: UltimaPregunta | null, e: EstadoPedido | null): DatoPreguntable | null {
  if (ultima?.tipo === 'dato_pedido') return ultima.dato
  // "¿Sigues por Niquía?" / "¿lo recoges?" → "Prado" suelto es el barrio;
  // "¿te lo enviamos a Cra 50…?" → "calle 10 #5-20" suelto es la dirección.
  if (ultima?.tipo === 'sugerir_barrio' || ultima?.tipo === 'ofrecer_recoger') return 'barrio'
  if (ultima?.tipo === 'usar_direccion') return 'direccion_entrega'
  if (ultima || !hayCarrito(e)) return null
  const f = e!.faltantes.find((x) => x !== 'carrito')
  if (!f) return null
  // 'cobertura' con el barrio ya guardado no espera nada del cliente: la consulta el código.
  if (f === 'cobertura') return e!.barrio ? null : 'barrio'
  return f
}

/**
 * Un mensaje corto que no es otra cosa reconocible: candidato a ser la respuesta
 * literal a "¿en qué barrio?" / "¿cuál es la dirección?". El clasificador suele
 * leer "pardo" como `otro` o como pregunta de producto (BUG-062).
 */
function esRespuestaSuelta(texto: string, c: Clasificacion) {
  const t = texto.trim()
  const palabras = t.split(/\s+/).length
  if (!t || c.productos.length || c.pide_humano || c.confirma !== 'na' || palabras > 8) return false
  if (['otro', 'respuesta_corta', 'datos_pedido', 'cobertura'].includes(c.intencion)) return true
  return c.intencion === 'pregunta_producto' && palabras <= 3 && !t.includes('?')
}

/**
 * El barrio aparece en el texto, con erratas: "niqia" ~ "Niquía" (mismas 3
 * primeras letras en alguna palabra). Sirve para descartar un barrio que el
 * clasificador sacó del historial, no para validar la ortografía.
 */
export function mencionado(barrio: string, texto: string): boolean {
  const b = norm(barrio)
  const t = norm(texto)
  if (!b) return false
  if (t.includes(b)) return true
  const raiz = b.split(' ').find((w) => w.length >= 3)?.slice(0, 3)
  return !!raiz && t.split(/[^\p{L}\d]+/u).some((w) => w.startsWith(raiz))
}

/** Una dirección de entrega tiene que traer algún número (calle, casa, torre, apto). */
export const direccionUtil = (d: string) => /\d/.test(d)

export function decidir(c: Clasificacion, ctx: ContextoDecision): Decision {
  return conNombre(completarCobertura(decidirBase(c, ctx), ctx.estado), c, ctx)
}

// Lo que NO se registra como nombre (regla del Agente Soporte de n8n, ahora en
// código): emojis, frases religiosas o de saludo, texto de prueba.
const NO_ES_NOMBRE = new Set([
  'si', 'no', 'dale', 'ok', 'okay', 'listo', 'hola', 'buenas', 'gracias', 'pendiente', 'cliente', 'test', 'prueba',
  'asdf', 'asdfgh', 'qwerty', 'dios', 'amen', 'bendiciones', 'jesus', 'senor', 'amor', 'es', 'bendecido', 'yo',
])

/** Un nombre de persona plausible: 1–4 palabras de letras, sin emojis ni frases hechas. */
export function nombreValido(n: string | null | undefined): n is string {
  const t = (n ?? '').trim()
  if (t.length < 2 || t.length > 40 || !/^[\p{L}][\p{L}'’. -]*$/u.test(t)) return false
  const palabras = norm(t).split(' ')
  if (palabras.length > 4 || palabras.some((p) => NO_ES_NOMBRE.has(p.replace(/[.'’]/g, '')))) return false
  return palabras.every((p) => /[aeiouy]/.test(p)) // "sdfg", "xx"
}

const limpiarNombre = (t: string) =>
  t
    .trim()
    .replace(/^(soy|me llamo|mi nombre es|habla|con)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim()

/**
 * Guarda el nombre si el cliente no tenía uno: el que leyó el clasificador o,
 * tras "¿con quién tengo el gusto?", la respuesta suelta. Un nombre ya
 * registrado no se cambia desde el chat.
 */
function conNombre(d: Decision, c: Clasificacion, ctx: ContextoDecision): Decision {
  if (!ctx.sin_nombre || d.handler === 'humano') return d
  const pidioNombre = ctx.conversacion.ultima_pregunta?.tipo === 'nombre'
  const suelto = pidioNombre && c.confirma === 'na' && !c.productos.length ? limpiarNombre(ctx.texto) : null
  const nombre = [c.nombre_cliente?.trim(), suelto].find((n) => nombreValido(n))
  return nombre ? { ...d, acciones: [...d.acciones, { tipo: 'guardar_nombre', nombre }] } : d
}

/**
 * Pedidos con un barrio guardado pero sin cobertura confirmada (faltante
 * 'cobertura', p. ej. un carrito que viene de n8n): la consulta el código en
 * este turno. El handler nunca la calcula ni la recuerda (BUG-061).
 */
function completarCobertura(d: Decision, e: EstadoPedido | null): Decision {
  if (d.handler !== 'pedidos' || !e?.barrio || !e.faltantes.includes('cobertura')) return d
  const yaSeOcupa = d.acciones.some(
    (a) => a.tipo === 'verificar_cobertura' || a.tipo === 'crear_pedido' || (a.tipo === 'guardar_datos' && a.datos.tipo_pedido === 'recoger'),
  )
  if (yaSeOcupa) return d
  return { ...d, acciones: [...d.acciones, { tipo: 'verificar_cobertura', barrio: e.barrio, guardar: true }] }
}

function decidirBase(c: Clasificacion, ctx: ContextoDecision): Decision {
  const { estado } = ctx
  const ultima = ctx.conversacion.ultima_pregunta
  const carrito = hayCarrito(estado)

  // 1 · Pedir una persona gana a todo.
  if (c.pide_humano) {
    return { handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'lo_pidio' }], regla: 'pide_humano' }
  }

  // 1b · Algo ajeno al restaurante (programar, tareas, traducir…) sin nada del
  // restaurante en el mensaje: lo contesta un texto fijo, sin modelo, y la
  // conversación queda como estaba. Con el modelo, Soporte se puso a escribir
  // Python (2026-10-07, 573184821317). Si trae un pedido, sigue su camino y el
  // agente atiende solo esa parte (ALCANCE en handlers/comun.ts).
  // Un "no, así está bien" a una pregunta del bot es la respuesta, aunque el
  // clasificador arrastre el tema ajeno del historial (visto en el simulador).
  const respondeAlBot = !!ultima && c.confirma !== 'na' && c.intencion === 'respuesta_corta'
  if (c.fuera_de_tema && !traeAlgoDelRestaurante(c) && !respondeAlBot) {
    return { handler: 'soporte', acciones: [], regla: 'fuera_de_tema' }
  }

  // 2 · Respuesta a la última pregunta del bot. Va antes que la intención: un
  // "dale" no significa nada sin saber qué se preguntó.
  if (ultima && c.confirma !== 'na') {
    const r = responderPregunta(ultima, c, estado, ctx.conversacion.reserva ?? null, ctx.texto)
    if (r) return r
  }

  // 3 · Muy molesto: a una persona. (Una queja normal la atiende Soporte.)
  if (c.frustracion >= 2) {
    return { handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'frustracion' }], regla: 'frustracion_alta' }
  }

  // 3b · Una reserva en curso: la respuesta a su pregunta, o un cambio de día,
  // hora o personas, es de Reservas. Lo que sea de otro tema (el menú, un
  // pedido, el horario) va a su handler y el borrador queda guardado.
  if (c.intencion.startsWith('reserva_')) return { handler: 'reservas', acciones: [], regla: `intencion:${c.intencion}` }
  const enReserva = ultima?.tipo === 'dato_reserva' || ultima?.tipo === 'confirmar_reserva' || ultima?.tipo === 'elegir_reserva'
  const datoDeReserva = !!(c.fecha || c.hora || c.personas)
  if ((enReserva || (datoDeReserva && ctx.conversacion.handler === 'reservas')) && !c.productos.length && !otroTema(c)) {
    return { handler: 'reservas', acciones: [], regla: 'dato_reserva' }
  }

  // 4 · Datos del pedido que traiga el mensaje, sea cual sea la intención.
  // Solo se guarda lo que el cliente AFIRMA: "¿hacen domicilios?" o "¿llegan a
  // Prado?" son preguntas, no decisiones (regla crítica del orquestador de n8n).
  const pregunta = c.intencion === 'cobertura' || c.intencion === 'info_negocio'
  const datos: DatosPedido = {}
  if (!pregunta && c.tipo_pedido) datos.tipo_pedido = c.tipo_pedido
  if (c.metodo_pago && (!pregunta || carrito)) datos.metodo_pago = c.metodo_pago
  let direccion = (!pregunta && c.direccion?.trim()) || null
  // Solo el barrio que el cliente escribió EN ESTE mensaje: el clasificador a
  // veces lo trae del historial ("¿puedo celebrar allá?" → Niquía) y se volvía
  // a cantar la cobertura sin que nadie la preguntara (visto con gpt-5.1).
  let barrio = (c.barrio?.trim() && mencionado(c.barrio, ctx.texto) ? c.barrio.trim() : null) || null

  // BUG-062: si el bot espera un dato y el mensaje es una respuesta suelta, ES
  // ese dato, aunque el clasificador no lo haya reconocido ("pardo" → menú).
  const esperado = datoEsperado(ultima, estado)
  const suelta = esRespuestaSuelta(ctx.texto, c)
  // Tras "¿en qué barrio estás?", un "niqia" suelto a veces llega clasificado
  // como pregunta de cobertura: sin "?" es la respuesta, y se guarda. Si no, la
  // cobertura se consultaba, el barrio no quedaba y se volvía a preguntar.
  // Y si el "?" es de lo ajeno ("En La Milagrosa, ¿qué clima hace mañana?"), el
  // barrio también es la respuesta: el clasificador leyó todo como pregunta de
  // cobertura y se volvió a pedir el barrio (2026-10-09, 573184821317).
  const respondeBarrio =
    esperado === 'barrio' && ((suelta && !ctx.texto.includes('?')) || (!!barrio && c.fuera_de_tema))
  if (suelta) {
    // Salvo que ya sea OTRO dato: "por transferencia" no es un barrio.
    if (esperado === 'barrio' && !barrio && !c.direccion && !c.metodo_pago && !c.tipo_pedido) barrio = ctx.texto.trim()
    if (esperado === 'direccion_entrega' && !direccion) direccion = ctx.texto.trim()
  }
  // "Cerca al parque" no le sirve al domiciliario: no se guarda y se pide con calle y número.
  let direccion_vaga: string | undefined
  if (direccion && !direccionUtil(direccion)) {
    direccion_vaga = direccion
    direccion = null
  }
  if (direccion) datos.direccion_entrega = direccion

  const acciones: Accion[] = []
  if (Object.keys(datos).length) acciones.push({ tipo: 'guardar_datos', datos })
  // El barrio SIEMPRE pasa por cobertura en código (BUG-061): nunca se le deja al
  // LLM decidir si hay domicilio ni cuánto cuesta. "Para recoger" no la necesita.
  if (barrio && (datos.tipo_pedido ?? estado?.tipo_pedido) !== 'recoger') {
    acciones.push({ tipo: 'verificar_cobertura', barrio, guardar: !pregunta || respondeBarrio })
  }
  const traeDatos = acciones.length > 0
  const conDatos = (d: Omit<Decision, 'acciones'>): Decision => ({ ...d, acciones, ...(direccion_vaga ? { direccion_vaga } : {}) })

  // 5 · Cancelar: con carrito lo vacía el código; sin carrito habla de un pedido
  // ya registrado, y eso es de Soporte.
  if (c.intencion === 'cancelar_carrito') {
    return carrito
      ? { handler: 'menu', acciones: [{ tipo: 'vaciar_carrito' }], regla: 'cancelar_carrito' }
      : conDatos({ handler: 'soporte', regla: 'cancelar_sin_carrito' })
  }

  // 6 · Productos: los maneja Menú aunque haya datos pendientes (la "única
  // excepción" del orquestador de n8n).
  // Salvo BUG-062: una "pregunta de producto" que no nombra ningún producto y
  // resultó ser un barrio ("pardo") no es de Menú, que no tiene cobertura.
  const barrioDisfrazado = c.intencion === 'pregunta_producto' && !c.productos.length && !!barrio
  const handlerIntencion = barrioDisfrazado ? null : HANDLER_DE[c.intencion]
  if (handlerIntencion === 'menu') return conDatos({ handler: 'menu', regla: `intencion:${c.intencion}` })

  // 7 · Un dato del pedido: con carrito, a Pedidos. Sin carrito, un barrio es
  // una consulta de cobertura (Soporte) y lo demás es alguien que quiere pedir
  // y todavía no eligió nada (Menú). Nunca Pedidos sin carrito: no hay qué cerrar.
  if (traeDatos || c.intencion === 'datos_pedido' || c.intencion === 'cobertura') {
    if (carrito) return conDatos({ handler: 'pedidos', regla: `${c.intencion}:con_carrito` })
    if (barrio || c.intencion === 'cobertura') return conDatos({ handler: 'soporte', regla: `${c.intencion}:cobertura_sin_carrito` })
    if (handlerIntencion) return conDatos({ handler: handlerIntencion, regla: `intencion:${c.intencion}+datos` })
    return conDatos({ handler: 'menu', regla: `${c.intencion}:sin_carrito` })
  }

  if (handlerIntencion) return conDatos({ handler: handlerIntencion, regla: `intencion:${c.intencion}` })

  // 8 · "otro" o un "sí" sin pregunta pendiente: sigue quien llevaba el hilo.
  const hilo = ctx.conversacion.handler
  if (hilo) return conDatos({ handler: hilo === 'pedidos' && !carrito ? 'menu' : hilo, regla: 'sigue_el_hilo' })
  return conDatos({ handler: carrito ? 'pedidos' : 'soporte', regla: 'sin_hilo' })
}

function responderPregunta(
  u: UltimaPregunta,
  c: Clasificacion,
  estado: EstadoPedido | null,
  reserva: BorradorReserva | null,
  texto: string,
): Decision | null {
  const si = c.confirma === 'si'
  switch (u.tipo) {
    case 'confirmar_pedido': {
      if (!si) {
        // "Ah no, mejor a Copacabana": es un cambio, no un "no" a secas (visto con gpt-5.1).
        if (cambiaElPedido(c, estado, texto)) return null
        return hayCarrito(estado)
          ? { handler: 'pedidos', acciones: [], regla: 'resumen:no', nota: 'no confirmó: preguntar qué quiere cambiar' }
          : null
      }
      // "Sí, pero sin cebolla": primero el cambio; el resumen se vuelve a mostrar.
      if (cambiaElPedido(c, estado, texto)) return null
      // El pedido se crea SOLO si la BD dice que el cliente está viendo el resumen
      // y no falta nada. Si no, se vuelve a mostrar (la RPC también lo exige: SIN_RESUMEN).
      if (estado?.paso_flujo === 'resumen' && estado.faltantes.length === 0 && estado.n_items > 0) {
        return { handler: 'pedidos', acciones: [{ tipo: 'crear_pedido' }], regla: 'resumen:si' }
      }
      if (!hayCarrito(estado)) return { handler: 'menu', acciones: [], regla: 'resumen:si_sin_carrito', nota: 'el carrito expiró: armarlo de nuevo' }
      return { handler: 'pedidos', acciones: [], regla: 'resumen:si_sin_resumen_valido', nota: 'volver a mostrar el resumen' }
    }
    case 'sugerir_barrio':
      // "No, estoy en Prado": el barrio nuevo lo resuelve el paso 4.
      if (!si && c.barrio) return null
      if (!si) return { handler: hayCarrito(estado) ? 'pedidos' : 'soporte', acciones: [], regla: 'sugerencia_barrio:no', nota: 'pedir el barrio de nuevo' }
      return {
        handler: hayCarrito(estado) ? 'pedidos' : 'soporte',
        acciones: [{ tipo: 'verificar_cobertura', barrio: u.barrio, guardar: true }],
        regla: 'sugerencia_barrio:si',
      }
    case 'usar_direccion':
      // "Sí" a "¿te lo enviamos a <la registrada>?" = esa. Si trae otra, la guarda el paso 4.
      if (c.direccion || !hayCarrito(estado)) return null // sin carrito (expiró) no hay qué enviar
      if (!si) return { handler: 'pedidos', acciones: [], regla: 'usar_direccion:no', nota: 'pedir la dirección nueva' }
      return { handler: 'pedidos', acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: u.direccion } }], regla: 'usar_direccion:si' }
    case 'ofrecer_recoger': {
      const h = hayCarrito(estado) ? 'pedidos' : 'soporte'
      if (!si && c.barrio) return null // "no, mejor a Prado": otro barrio, a cobertura
      if (!si) return { handler: h, acciones: [], regla: 'ofrecer_recoger:no' }
      return { handler: h, acciones: [{ tipo: 'guardar_datos', datos: { tipo_pedido: 'recoger' } }], regla: 'ofrecer_recoger:si' }
    }
    case 'agregar_producto':
      // "Dale" tras una sugerencia del Menú = agregar ESE producto. Nunca crea el pedido.
      if (!si) return null
      return { handler: 'menu', acciones: [], regla: 'sugerencia_producto:si', nota: `agregar: ${u.producto}` }
    case 'algo_mas':
      // "sí, una gaseosa" o "y una coca cola": lo resuelve la intención. Nombrar un
      // producto a "¿algo más?" es pedir más aunque el clasificador diga "no"
      // (visto con gpt-5.1 el 2026-09-30).
      // Lo mismo con cualquier cosa del menú ("¿y la pizza m&m?"): va a Menú, no a cerrar.
      if (si || cambiaElPedido(c, estado, texto) || HANDLER_DE[c.intencion] === 'menu') return null
      return hayCarrito(estado)
        ? { handler: 'pedidos', acciones: [], regla: 'algo_mas:no', nota: 'seguir con lo que falte del pedido' }
        : null
    case 'confirmar_reserva':
      // "Sí, pero a las 8" / "no, mejor el domingo": es un cambio; Reservas vuelve a consultar y resumir.
      if (cambiaLaReserva(c, reserva)) return null
      if (!si) return { handler: 'reservas', acciones: [], regla: 'reserva:no', nota: 'no confirmó: preguntar qué quiere cambiar' }
      // Se crea SOLO lo que el cliente vio resumido: el borrador completo y con cupo verificado.
      if (!borradorListo(reserva)) return { handler: 'reservas', acciones: [], regla: 'reserva:si_sin_borrador' }
      return { handler: 'reservas', acciones: [{ tipo: 'crear_reserva' }], regla: 'reserva:si' }
    case 'cancelar_reserva':
      if (!si) return { handler: 'reservas', acciones: [], regla: 'cancelar_reserva:no' }
      return { handler: 'reservas', acciones: [{ tipo: 'cancelar_reserva', reserva_id: u.reserva_id }], regla: 'cancelar_reserva:si' }
    case 'dato_pedido':
      return null // un "sí" a "¿en qué barrio?" no dice nada: lo resuelve el paso 4
    case 'ofrecer_humano':
      // "Sí" a "¿te conecto con alguien del equipo?" = pedir una persona, en código. Pero solo si
      // el mensaje ES la respuesta: "cancela la reserva RES-001" llegó con confirma:si y terminó
      // en handoff (2026-10-02, G9). Otra intención concreta sigue su camino.
      return si && RESPONDE_OFERTA.has(c.intencion)
        ? { handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'lo_pidio' }], regla: 'ofrecer_humano:si' }
        : null
    case 'dato_reserva':
    case 'elegir_reserva':
      return null // la respuesta la interpreta Reservas (regla 3b)
    case 'nombre':
      return null // el nombre lo toma conNombre; el resto del mensaje sigue su camino
  }
}
