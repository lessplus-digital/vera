import type { LLM, UsoLLM } from '../llm/llm.js'
import type { MensajeHistorial } from '../bd/repo.js'
import { Clasificacion, clasificacionVacia } from './clasificacion.js'
import type { ContextoDecision, UltimaPregunta } from './contexto.js'

// CLASIFICADOR: el único uso del LLM antes de decidir. Lee el mensaje y
// devuelve JSON estricto (clasificacion.ts). No elige agente ni ejecuta nada:
// eso es de politica.ts. Cuanto menos decida el modelo, menos puede ignorar.

const PROMPT = `Eres el lector de mensajes de WhatsApp de Vera Pizzería (Bello, Antioquia, Colombia).
Tu único trabajo es LEER el mensaje del cliente y devolver el JSON pedido. No respondes al cliente ni decides qué hacer.

## intencion (la principal) e intenciones_extra (las demás del mismo mensaje, en orden)
- saludo: saludo, despedida o agradecimiento sin más ("hola", "gracias", "chao").
- ver_menu: quiere ver la carta o saber qué hay.
- pregunta_producto: pregunta por un producto, precio, tamaño, ingrediente o disponibilidad, sin pedirlo aún.
- agregar_producto: pide uno o más productos o cambia uno del carrito ("mejor grande").
- quitar_producto: pide quitar del carrito algo que nombra ("quítale la gaseosa"). "No", "así está bien" o "nada más" NO es quitar.
- datos_pedido: AFIRMA un dato de entrega o pago: domicilio/recoger, barrio, dirección, efectivo/transferencia.
- ver_carrito: pregunta qué lleva o cuánto va.
- cancelar_carrito: ya no quiere nada de lo que está pidiendo ("cancela todo", "ya no quiero").
- cobertura: PREGUNTA si llegan a un barrio o cuánto cuesta el domicilio.
- estado_pedido: pregunta por un pedido ya hecho ("¿cómo va?", "no ha llegado").
- reserva_nueva / reserva_consultar / reserva_cancelar: mesas y reservas.
- info_negocio: horario, dirección del local, medios de pago aceptados, promociones, preguntas frecuentes.
- queja: algo salió mal con un pedido o con la atención.
- respuesta_corta: "sí", "no", "dale", "ok", "listo", "esa", "eso es todo": solo contesta a la última pregunta del bot.
- otro: nada de lo anterior.

## confirma
Si el mensaje contesta la ÚLTIMA PREGUNTA DEL BOT (abajo): "si" si acepta ("sí", "dale", "listo", "de una", "confírmalo"),
"no" si la rechaza o dice que ya no quiere más ("no", "eso es todo", "nada más", "así está bien" a "¿algo más?").
"na" si no la contesta o no hay pregunta. Un "sí, pero …" es "si" y el cambio va en los demás campos.
A "¿algo más?", nombrar otro producto ("y una coca cola", "también unas papas") es "si": quiere más.

## Datos (null si el mensaje no los trae; nunca los inventes ni los copies del historial)
- productos: cada producto que PIDE, con el nombre como lo escribió; cantidad, tamaño, "mitad_con" (la otra mitad) y notas ("sin cebolla").
- tipo_pedido: "domicilio" o "recoger" ("para llevar", "paso por ella" = recoger), solo si lo AFIRMA.
- barrio: el barrio o sector TAL CUAL lo escribió, con errores incluidos ("niqia", "pardo"). No lo corrijas.
- direccion: calle/carrera con número, tal cual. Sepárala del barrio. Una dirección vaga ("por ahí", "la de siempre") es null.
- metodo_pago: "Efectivo" o "Transferencia" (Nequi, Daviplata, Bancolombia = Transferencia).
- fecha (YYYY-MM-DD, resuelve "hoy", "mañana", "el sábado" con la fecha de hoy de abajo), hora (HH:MM, 24 h; "a las 7" de la noche = 19:00), personas.
- nombre_cliente: solo si dice cómo se llama.
- Una PREGUNTA o una NEGACIÓN no es un dato: "¿hacen domicilios?" no es tipo_pedido; "no, domicilio no" tampoco.
- EXCEPCIÓN, el barrio: si pregunta por un barrio ("¿llegan a niqia?", "¿cuánto a Prado?"), ponlo en barrio igual, tal cual. Hay que consultarlo; guardarlo o no lo decide otro paso.

## pide_humano y frustracion
- pide_humano: true solo si pide hablar con una persona, un asesor o el administrador.
- frustracion: 0 tranquilo · 1 molesto · 2 muy molesto (insultos, mayúsculas de enojo, amenaza con irse o denunciar).`

const DATO: Record<Extract<UltimaPregunta, { tipo: 'dato_pedido' }>['dato'], string> = {
  tipo_pedido: '¿Es a domicilio o para recoger?',
  barrio: '¿En qué barrio estás?',
  direccion_entrega: '¿Cuál es la dirección de entrega?',
  metodo_pago: '¿Pagas en efectivo o por transferencia?',
}

export function describirPregunta(u: UltimaPregunta | null): string {
  switch (u?.tipo) {
    case undefined: return '(ninguna registrada)'
    case 'confirmar_pedido': return 'Le mostró el resumen del pedido y preguntó si lo confirma.'
    case 'dato_pedido': return DATO[u.dato]
    case 'sugerir_barrio': return `¿El barrio es ${u.barrio}? (si dice sí, es ese barrio; si nombra otro, es el otro)`
    case 'usar_direccion': return `¿Te lo enviamos a ${u.direccion}? (su dirección registrada)`
    case 'ofrecer_recoger': return 'No hay domicilio a su barrio; le preguntó si lo recoge en el local.'
    case 'agregar_producto': return `¿Te agrego ${u.producto}?`
    case 'algo_mas': return '¿Quieres algo más?'
    case 'ofrecer_humano': return '¿Quieres que te conecte con alguien del equipo?'
    case 'nombre': return '¿Con quién tengo el gusto? (le preguntó su nombre)'
    case 'confirmar_reserva': return 'Le mostró los datos de la reserva y preguntó si la confirma.'
    case 'dato_reserva': return ({ personas: '¿Para cuántas personas es la reserva?', fecha: '¿Para qué día es la reserva?', hora: '¿A qué hora sería la reserva?', motivo: '¿La reserva es para alguna ocasión especial (cumpleaños, aniversario…) o normal?' })[u.dato]
    case 'elegir_reserva': return 'Tiene varias reservas y le preguntó cuál quiere cancelar.'
    case 'cancelar_reserva': return `¿Cancelo la reserva ${u.reserva_id}?`
  }
}

export type EntradaClasificador = {
  texto: string
  historial: MensajeHistorial[]
  contexto: ContextoDecision
  /** YYYY-MM-DD y día de la semana en Colombia, para resolver "el sábado". */
  hoy: { fecha: string; dia: string }
}

export function armarMensajes(e: EntradaClasificador) {
  const est = e.contexto.estado
  const estado = !est
    ? 'sin pedido en curso'
    : `productos en el carrito: ${est.n_items} | falta por preguntar: ${
        est.faltantes.filter((f) => f !== 'carrito').join(', ') || 'nada'
      }`
  // Pocas líneas y solo como contexto: los datos se leen del mensaje actual.
  const hist = e.historial
    .slice(-6)
    .map((m) => `${m.tipo === 'human' ? 'Cliente' : 'Bot'}: ${m.texto.slice(0, 300)}`)
    .join('\n')
  return [
    { rol: 'system' as const, texto: PROMPT },
    {
      rol: 'user' as const,
      texto: [
        `Hoy: ${e.hoy.dia} ${e.hoy.fecha} (hora de Colombia).`,
        `Estado del pedido: ${estado}.`,
        `ÚLTIMA PREGUNTA DEL BOT: ${describirPregunta(e.contexto.conversacion.ultima_pregunta)}`,
        hist ? `Conversación reciente (solo contexto, no extraigas datos de aquí):\n${hist}` : '',
        `MENSAJE DEL CLIENTE:\n${e.texto}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}

export type ResultadoClasificador = { clasificacion: Clasificacion; uso: UsoLLM | null; error?: string }

/**
 * Nunca lanza: si el modelo falla, devuelve una clasificación vacía ("otro") y
 * la política sigue el hilo de la conversación. Mejor una respuesta genérica
 * que dejar al cliente sin respuesta.
 */
export async function clasificar(llm: LLM, e: EntradaClasificador): Promise<ResultadoClasificador> {
  try {
    const r = await llm.estructurado({ nombre: 'clasificacion', esquema: Clasificacion, mensajes: armarMensajes(e) })
    return { clasificacion: r.datos, uso: r.uso }
  } catch (err) {
    return { clasificacion: clasificacionVacia(), uso: null, error: String(err) }
  }
}

export function hoyEnColombia(ahora = new Date()) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', ...o }).format(ahora)
  return {
    fecha: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora),
    dia: f({ weekday: 'long' }),
  }
}
