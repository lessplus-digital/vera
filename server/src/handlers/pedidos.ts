import { z } from 'zod'
import type { Carrito, Cliente, Repo } from '../bd/repo.js'
import type { LLM, MensajeLLM } from '../llm/llm.js'
import type { Turno } from '../log/turnos.js'
import type { EntradaRedactor, Redaccion, Redactor } from '../decision/conversador.js'
import type { EstadoPedido, UltimaPregunta } from '../decision/contexto.js'
import { pesos } from '../guardia/guardia.js'
import { bloqueCarrito, bloqueResumen, montosDeCarrito, noLlegamos, siLlegamos, sinCobertura } from './formato.js'
import { contextoComun, primerNombre, reescritura } from './comun.js'

// AGENTE PEDIDOS: recoge los datos que faltan y muestra el resumen. Portado del
// prompt de n8n (versión 1d7f7d87), pero casi todo lo que allí era una regla en
// texto aquí es código:
//  - qué preguntar lo dice `faltantes` de la vista estado_pedido, UNA pregunta
//    por mensaje, con textos fijos (el prompt pedía "no repreguntes lo que no
//    está en faltantes" y el modelo lo repreguntaba igual);
//  - guardar datos y consultar cobertura ya lo hizo la política antes de llegar
//    aquí; el resumen (ítems, subtotal, domicilio, total) lo arma formato.ts y
//    es el código el que pone paso_flujo='resumen';
//  - el pedido lo crea el conversador tras el "sí" (regla resumen:si), nunca este handler.
// El LLM solo escribe, si hace falta, una frase de enlace encima de la pregunta:
// un "¡Perfecto!" o la respuesta a algo que el cliente preguntó de paso.

export const P = {
  sinCarrito: 'No tienes un pedido armado todavía. ¿Qué te gustaría pedir? 😊',
  tipoPedido: '¿Es para domicilio o lo recoges en el local?',
  barrio: '¿En qué barrio estás?',
  otroBarrio: 'Si quieres, dime otro barrio dentro de Bello y lo reviso 😊',
  direccion: '¿A qué dirección te lo enviamos? (calle y número, y torre/apto si aplica)',
  direccionVaga: 'Para que el domiciliario llegue sin problema necesito la dirección con calle y número (por ejemplo: Calle 50 # 40-20) 🙏',
  metodoPago: '¿Pagas en efectivo o por transferencia?',
  queCambiar: '¿Qué te gustaría cambiar?',
  productoAgotado: 'Uy, algo de tu pedido se nos acabó hoy 😔 ¿Lo cambiamos por otra cosa?',
  carritoVencido: 'Tu pedido anterior se venció 😅 ¿Qué te gustaría pedir?',
  preciosCambiaron: 'Ojo: algunos precios cambiaron desde que armaste el pedido. Te lo dejo actualizado 👇',
  tarifaCambio: 'Ojo: la tarifa del domicilio cambió. Te lo dejo actualizado 👇',
} as const

export const sigues = (barrio: string) => `¿Sigues por el barrio ${barrio}?`
export const enviarA = (dir: string) => `¿Te lo enviamos a ${dir}?`
export { noLlegamos }

/** Lo que el código decidió decir en este turno. El LLM solo le pone una frase encima. */
type Plan = {
  /** Líneas fijas que van antes de la pregunta (cobertura confirmada, avisos). */
  avisos: string[]
  /** La pregunta o el resumen con que cierra el mensaje. */
  cierre: string
  pregunta: UltimaPregunta | null
  montos: number[]
  /** Para el LLM: qué se hizo en este turno. */
  hechos: string[]
}

// Registrado = de pedidos anteriores. 'Pendiente' es el valor con que nace el cliente.
const registrado = (v: string | null) => {
  const t = (v ?? '').trim()
  return t && t.toLowerCase() !== 'pendiente' ? t : null
}

export async function planificar(repo: Repo, e: EntradaRedactor): Promise<Plan> {
  const tel = e.turno.telefono
  const { decision, efectos, cliente } = e
  const estado = e.estado
  const carrito = await repo.carrito(tel)
  const plan: Plan = { avisos: [], cierre: '', pregunta: null, montos: montosDeCarrito(carrito), hechos: [] }
  const cierra = (cierre: string, pregunta: UltimaPregunta | null = null) => Object.assign(plan, { cierre, pregunta })

  // Lo que devolvió crear_orden_desde_carrito si el "sí" no alcanzó a crear el pedido.
  switch (efectos.errorPedido) {
    case 'CARRITO_VACIO':
      return cierra(P.carritoVencido)
    case 'PRODUCTO_NO_DISPONIBLE':
      plan.hechos.push('Al confirmar, un producto del pedido resultó agotado hoy; el cliente debe cambiarlo.')
      return cierra(carrito.lineas.length ? `${P.productoAgotado}\n\n${bloqueCarrito(carrito)}` : P.productoAgotado)
    case 'PRECIOS_ACTUALIZADOS':
      plan.avisos.push(P.preciosCambiaron)
      break
    case 'TARIFA_ACTUALIZADA':
      plan.avisos.push(P.tarifaCambio)
      break
  }

  for (const a of decision.acciones) {
    if (a.tipo === 'guardar_datos') plan.hechos.push(`Quedó guardado: ${Object.entries(a.datos).map(([k, v]) => `${k} = ${v}`).join(', ')}.`)
  }
  if (!decision.acciones.some((a) => a.tipo === 'guardar_datos' || a.tipo === 'verificar_cobertura')) {
    plan.hechos.push('En este turno NO se guardó ni cambió ningún dato del pedido.')
  }

  // Cobertura consultada por el código en este turno.
  const cob = efectos.cobertura
  if (cob?.cubierto && cob.costo_domicilio != null) {
    plan.montos.push(cob.costo_domicilio)
    plan.avisos.push(siLlegamos(cob))
    plan.hechos.push(`Cobertura: sí hay domicilio a ${cob.barrio} (${pesos(cob.costo_domicilio)}).`)
  } else if (cob) {
    plan.hechos.push(`Cobertura: NO hay domicilio a "${cob.barrio}".`)
  }

  // Un barrio sin cobertura se contesta ya, falte lo que falte: si no, un cambio
  // a un barrio sin domicilio DESPUÉS del resumen (el barrio anterior sigue
  // guardado, faltantes vacío) volvería a mostrar el resumen viejo.
  if (cob && !cob.cubierto) return preguntarBarrio(plan, e, cliente)

  const faltantes = estado?.faltantes ?? ['carrito']
  const f = faltantes[0]
  if (e.clasificacion.intencion === 'ver_carrito' && carrito.lineas.length && f) plan.avisos.push(bloqueCarrito(carrito))

  switch (f) {
    case 'carrito':
      return cierra(P.sinCarrito)
    case 'tipo_pedido':
      return cierra(P.tipoPedido, { tipo: 'dato_pedido', dato: 'tipo_pedido' })
    case 'barrio':
    case 'cobertura':
      return preguntarBarrio(plan, e, cliente)
    case 'direccion_entrega': {
      if (decision.direccion_vaga) return cierra(P.direccionVaga, { tipo: 'dato_pedido', dato: 'direccion_entrega' })
      const dir = registrado(cliente.direccion_principal)
      if (dir && decision.regla !== 'usar_direccion:no') return cierra(enviarA(dir), { tipo: 'usar_direccion', direccion: dir })
      return cierra(P.direccion, { tipo: 'dato_pedido', dato: 'direccion_entrega' })
    }
    case 'metodo_pago':
      return cierra(P.metodoPago, { tipo: 'dato_pedido', dato: 'metodo_pago' })
  }

  // No falta nada. "No" al resumen: se pregunta qué cambiar, sin repetirlo.
  if (decision.regla === 'resumen:no') return cierra(P.queCambiar)
  return mostrarResumen(repo, e.turno, plan, estado!, carrito, cliente)
}

function preguntarBarrio(plan: Plan, e: EntradaRedactor, cliente: Cliente): Plan {
  const cierra = (cierre: string, pregunta: UltimaPregunta | null) => Object.assign(plan, { cierre, pregunta })
  const cob = e.efectos.cobertura
  if (cob && !cob.cubierto) {
    const r = sinCobertura(cob)
    return cierra(r.texto, r.pregunta)
  }
  if (e.decision.regla === 'ofrecer_recoger:no') return cierra(P.otroBarrio, { tipo: 'dato_pedido', dato: 'barrio' })
  const reg = registrado(cliente.barrio)
  // "¿Sigues por…?" una sola vez: si ya dijo que no, se pregunta abierto.
  if (reg && e.decision.regla !== 'sugerencia_barrio:no') return cierra(sigues(reg), { tipo: 'sugerir_barrio', barrio: reg })
  return cierra(P.barrio, { tipo: 'dato_pedido', dato: 'barrio' })
}

async function mostrarResumen(repo: Repo, turno: Turno, plan: Plan, estado: EstadoPedido, carrito: Carrito, cliente: Cliente): Promise<Plan> {
  if (!estado.tipo_pedido || !estado.metodo_pago) throw new Error('resumen sin tipo de pedido o sin método de pago')
  // Se marca ANTES de enviarlo: el "sí" del próximo turno solo crea el pedido si
  // la BD dice que el cliente está viendo este resumen. Cualquier cambio posterior
  // (ítems, barrio, pago…) lo saca de 'resumen' por trigger.
  const r = await turno.herramienta('guardar_datos_pedido', { paso_flujo: 'resumen' }, () =>
    repo.guardarDatosPedido(turno.telefono, { paso_flujo: 'resumen' }),
  )
  if (!r.ok) throw new Error(`no se pudo marcar el resumen: ${r.error ?? '?'}`)

  const costo = estado.tipo_pedido === 'domicilio' ? (estado.costo_domicilio ?? 0) : 0
  plan.montos.push(costo, carrito.total + costo)
  plan.hechos.push('Se le muestra el resumen del pedido para que lo confirme. El pedido TODAVÍA NO está creado.')
  return Object.assign(plan, {
    cierre: bloqueResumen({
      nombre: primerNombre(cliente.nombre),
      carrito,
      tipo_pedido: estado.tipo_pedido,
      costo_domicilio: estado.costo_domicilio,
      direccion_entrega: estado.direccion_entrega,
      barrio: estado.barrio,
      metodo_pago: estado.metodo_pago,
    }),
    pregunta: { tipo: 'confirmar_pedido' } satisfies UltimaPregunta,
  })
}

const PROMPT = `Eres el asistente de Vera Pizzería (Bello, Antioquia) cerrando un pedido por WhatsApp. Hablas como una persona amable de la pizzería, en español de Colombia.

Escribes SOLO la frase de arriba de un mensaje. Debajo, el mensaje ya trae (lo pega el código, tal cual) los avisos y la pregunta o el resumen que ves en "LO QUE VA DEBAJO". Tu frase es de enlace:
- Si el cliente acaba de dar un dato: un acuse corto ("¡Perfecto!", "Listo 👌", "¡Gracias!").
- Si además preguntó algo que se responde con lo que ves aquí (lo que va debajo o los hechos del turno), respóndelo en una frase.
- Si no hace falta nada, devuelve texto vacío.

Reglas:
- Máximo 1–2 frases cortas, máximo 1 emoji.
- NO hagas preguntas: la pregunta ya va debajo y es UNA sola por mensaje.
- NO repitas lo que va debajo (ni el resumen, ni la pregunta, ni la tarifa).
- NO escribas precios, totales, tarifas, tiempos de entrega, direcciones ni productos que no estén aquí.
- NUNCA digas que el pedido quedó confirmado, creado o registrado: eso lo dice el código cuando pasa.
- NUNCA digas que cambiaste, guardaste o anotaste algo que no aparezca en los hechos de este turno. Si el cliente pidió un cambio que no quedó hecho, no lo confirmes: lo que va debajo ya le dice cómo sigue.
- NUNCA digas que hay (o no hay) domicilio a un lugar, ni su valor, si no está en los hechos.
- Si pide cambiar productos: "¡Claro! Dime qué cambio necesitas y lo ajustamos."
- Métodos de pago: solo Efectivo y Transferencia (Nequi o Daviplata cuentan como transferencia; no hay tarjeta ni datáfono).
- Nunca menciones el sistema, herramientas, errores técnicos ni tu razonamiento.`

const Salida = z.object({ texto: z.string() })

/** Quita las oraciones con pregunta: la única pregunta del mensaje es la del código. */
export function sinPreguntas(t: string): string {
  return t
    .split(/(?<=[.!?…])\s+/)
    .filter((o) => !/[¿?]/.test(o))
    .join(' ')
    .trim()
}

export function crearRedactorPedidos(d: { repo: Repo; llm: LLM }): Redactor {
  // El plan se calcula una vez por turno: la reescritura (guardia) reusa el mismo.
  const planes = new WeakMap<Turno, Plan>()

  return async (e: EntradaRedactor): Promise<Redaccion> => {
    let plan = planes.get(e.turno)
    if (!plan) {
      plan = await planificar(d.repo, e)
      planes.set(e.turno, plan)
    }
    const debajo = [...plan.avisos, plan.cierre].filter(Boolean).join('\n\n')
    const mensajes: MensajeLLM[] = [
      { rol: 'system', texto: PROMPT },
      {
        rol: 'user',
        texto: [
          contextoComun(e),
          plan.hechos.length ? `Hechos de este turno:\n${plan.hechos.map((h) => `- ${h}`).join('\n')}` : '',
          e.decision.nota ? `Contexto: ${e.decision.nota}` : '',
          `LO QUE VA DEBAJO (no lo repitas):\n${debajo}`,
          `MENSAJE DEL CLIENTE:\n${e.texto}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ]
    if (e.previo) mensajes.push(...reescritura({ texto: e.previo.texto }, e.violaciones))

    const r = await d.llm.estructurado({ nombre: 'pedidos', esquema: Salida, mensajes })
    const enlace = sinPreguntas(r.datos.texto)
    return {
      texto: [enlace, debajo].filter(Boolean).join('\n\n'),
      pregunta: plan.pregunta,
      montos: plan.montos,
    }
  }
}
