import type { Clasificacion, Intencion } from './clasificacion.js'
import type { ContextoDecision, EstadoPedido, Faltante, Handler, UltimaPregunta } from './contexto.js'

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
}

// El carrito lo arma Menú (tiene el catálogo); Pedidos recoge los datos y cierra.
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

const hayCarrito = (e: EstadoPedido | null) => !!e && e.n_items > 0

/** El cliente cambió algo del pedido en el mismo mensaje ("sí, pero sin cebolla"). */
const cambiaElPedido = (c: Clasificacion) =>
  c.productos.length > 0 ||
  c.intencion === 'quitar_producto' ||
  c.intenciones_extra.includes('quitar_producto') ||
  !!(c.tipo_pedido || c.barrio || c.direccion || c.metodo_pago)

type DatoPreguntable = Exclude<Faltante, 'carrito' | 'cobertura'>

/**
 * Qué dato está esperando el bot. Primero lo que se preguntó de verdad; si no
 * consta, lo primero que falta del pedido (la regla del orquestador de n8n: con
 * carrito y datos pendientes, un mensaje suelto responde a esa pregunta).
 */
function datoEsperado(ultima: UltimaPregunta | null, e: EstadoPedido | null): DatoPreguntable | null {
  if (ultima?.tipo === 'dato_pedido') return ultima.dato
  if (ultima || !hayCarrito(e)) return null
  const f = e!.faltantes.find((x) => x !== 'carrito')
  if (!f) return null
  return f === 'cobertura' ? 'barrio' : f
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

export function decidir(c: Clasificacion, ctx: ContextoDecision): Decision {
  const { estado } = ctx
  const ultima = ctx.conversacion.ultima_pregunta
  const carrito = hayCarrito(estado)

  // 1 · Pedir una persona gana a todo.
  if (c.pide_humano) {
    return { handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'lo_pidio' }], regla: 'pide_humano' }
  }

  // 2 · Respuesta a la última pregunta del bot. Va antes que la intención: un
  // "dale" no significa nada sin saber qué se preguntó.
  if (ultima && c.confirma !== 'na') {
    const r = responderPregunta(ultima, c, estado)
    if (r) return r
  }

  // 3 · Muy molesto: a una persona. (Una queja normal la atiende Soporte.)
  if (c.frustracion >= 2) {
    return { handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'frustracion' }], regla: 'frustracion_alta' }
  }

  // 4 · Datos del pedido que traiga el mensaje, sea cual sea la intención.
  // Solo se guarda lo que el cliente AFIRMA: "¿hacen domicilios?" o "¿llegan a
  // Prado?" son preguntas, no decisiones (regla crítica del orquestador de n8n).
  const pregunta = c.intencion === 'cobertura' || c.intencion === 'info_negocio'
  const datos: DatosPedido = {}
  if (!pregunta && c.tipo_pedido) datos.tipo_pedido = c.tipo_pedido
  if (c.metodo_pago && (!pregunta || carrito)) datos.metodo_pago = c.metodo_pago
  if (!pregunta && c.direccion?.trim()) datos.direccion_entrega = c.direccion.trim()
  let barrio = c.barrio?.trim() || null

  // BUG-062: si el bot espera un dato y el mensaje es una respuesta suelta, ES
  // ese dato, aunque el clasificador no lo haya reconocido ("pardo" → menú).
  const esperado = datoEsperado(ultima, estado)
  if (esRespuestaSuelta(ctx.texto, c)) {
    if (esperado === 'barrio' && !barrio && !c.direccion) barrio = ctx.texto.trim()
    if (esperado === 'direccion_entrega' && !datos.direccion_entrega) datos.direccion_entrega = ctx.texto.trim()
  }

  const acciones: Accion[] = []
  if (Object.keys(datos).length) acciones.push({ tipo: 'guardar_datos', datos })
  // El barrio SIEMPRE pasa por cobertura en código (BUG-061): nunca se le deja al
  // LLM decidir si hay domicilio ni cuánto cuesta. "Para recoger" no la necesita.
  if (barrio && (datos.tipo_pedido ?? estado?.tipo_pedido) !== 'recoger') {
    acciones.push({ tipo: 'verificar_cobertura', barrio, guardar: !pregunta })
  }
  const traeDatos = acciones.length > 0
  const conDatos = (d: Omit<Decision, 'acciones'>): Decision => ({ ...d, acciones })

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

function responderPregunta(u: UltimaPregunta, c: Clasificacion, estado: EstadoPedido | null): Decision | null {
  const si = c.confirma === 'si'
  switch (u.tipo) {
    case 'confirmar_pedido': {
      if (!si) {
        return hayCarrito(estado)
          ? { handler: 'pedidos', acciones: [], regla: 'resumen:no', nota: 'no confirmó: preguntar qué quiere cambiar' }
          : null
      }
      // "Sí, pero sin cebolla": primero el cambio; el resumen se vuelve a mostrar.
      if (cambiaElPedido(c)) return null
      // El pedido se crea SOLO si la BD dice que el cliente está viendo el resumen
      // y no falta nada. Si no, se vuelve a mostrar (la RPC también lo exige: SIN_RESUMEN).
      if (estado?.paso_flujo === 'resumen' && estado.faltantes.length === 0 && estado.n_items > 0) {
        return { handler: 'pedidos', acciones: [{ tipo: 'crear_pedido' }], regla: 'resumen:si' }
      }
      if (!hayCarrito(estado)) return { handler: 'menu', acciones: [], regla: 'resumen:si_sin_carrito', nota: 'el carrito expiró: armarlo de nuevo' }
      return { handler: 'pedidos', acciones: [], regla: 'resumen:si_sin_resumen_valido', nota: 'volver a mostrar el resumen' }
    }
    case 'sugerir_barrio':
      if (!si) return { handler: hayCarrito(estado) ? 'pedidos' : 'soporte', acciones: [], regla: 'sugerencia_barrio:no', nota: 'pedir el barrio de nuevo' }
      return {
        handler: hayCarrito(estado) ? 'pedidos' : 'soporte',
        acciones: [{ tipo: 'verificar_cobertura', barrio: u.barrio, guardar: true }],
        regla: 'sugerencia_barrio:si',
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
      if (si || cambiaElPedido(c) || HANDLER_DE[c.intencion] === 'menu') return null
      return hayCarrito(estado)
        ? { handler: 'pedidos', acciones: [], regla: 'algo_mas:no', nota: 'seguir con lo que falte del pedido' }
        : null
    case 'confirmar_reserva':
      if (!si) return { handler: 'reservas', acciones: [], regla: 'reserva:no' }
      return { handler: 'reservas', acciones: [{ tipo: 'crear_reserva' }], regla: 'reserva:si' }
    case 'cancelar_reserva':
      if (!si) return { handler: 'reservas', acciones: [], regla: 'cancelar_reserva:no' }
      return { handler: 'reservas', acciones: [{ tipo: 'cancelar_reserva', reserva_id: u.reserva_id }], regla: 'cancelar_reserva:si' }
    case 'dato_pedido':
      return null // un "sí" a "¿en qué barrio?" no dice nada: lo resuelve el paso 4
  }
}
