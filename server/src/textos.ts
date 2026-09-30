import { pesos } from './guardia/guardia.js'

// Textos fijos que el bot envía (no los redacta el LLM). Copiados de los nodos de
// n8n publicados el 2026-09-29, salvo donde se indica una mejora.

// Nuevo: cuando algo interno falla, el cliente recibe esto en vez de silencio.
export const ERROR_GENERICO =
  'Uy, tuve un problema para responderte 😅 ¿Me lo escribes de nuevo en un momento, por favor?'

export const TEXTO_NO_SOPORTADO =
  'Por ahora solo puedo leer mensajes de texto y fotos 🙏 ¿Me lo escribes, por favor?'

// ── Comprobantes de transferencia ──────────────────────────────────────────
export const COMPROBANTE_RECIBIDO =
  '✅ ¡Recibimos tu comprobante!\n\nEl equipo lo revisará en breve y te avisaremos cuando tu pedido entre a preparación. 🍕\n\nSi tienes alguna duda, escríbenos.'
export const COMPROBANTE_SIN_PEDIDO =
  'Hola 👋 No encontré ningún pedido pendiente de pago por transferencia asociado a tu número.\n\nSi acabas de hacer un pedido, escríbenos y te ayudamos.'
// Nuevo: en n8n una descarga fallida mataba la ejecución sin contestar.
export const COMPROBANTE_ERROR =
  'No pude recibir la imagen 😕 ¿Me la envías de nuevo, por favor?'

// ── Decisión (Fase 4) ──────────────────────────────────────────────────────
// Sale cuando la guardia rechazó dos redacciones seguidas: no afirma nada.
export const TEXTO_SEGURO =
  'Déjame revisar bien eso para no darte un dato equivocado 🙏 ¿Me confirmas qué necesitas?'

/** Confirmación del pedido: la arma el código con los datos que devolvió la BD, nunca el LLM. */
export function pedidoCreado(p: { pedido_id: string; total: number; tipo_pedido: string; metodo_pago: string }): string {
  const total = pesos(p.total)
  const pago =
    p.metodo_pago === 'Transferencia'
      ? '\n\nCuando hagas la transferencia, envíame por aquí la foto del comprobante 📸'
      : ''
  const entrega = p.tipo_pedido === 'domicilio' ? 'te lo enviamos apenas esté listo 🛵' : 'te avisamos cuando esté listo para recoger 🏃'
  return `✅ ¡Pedido registrado! Tu número es *${p.pedido_id}* y el total es *${total}*.\n\nEl equipo lo revisa y ${entrega}${pago}`
}

// ── Paso a humano ──────────────────────────────────────────────────────────
export const HANDOFF = 'Te conecto con nuestro equipo. Un momento por favor 🙋'

// ── Calificaciones (feedback) ──────────────────────────────────────────────
export function pedirCalificacion(nombre: string | null): string {
  const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? ''
  const saludo = primero && primero.toLowerCase() !== 'pendiente' ? `Hola ${primero}` : 'Hola'
  return `${saludo} 👋 Te escribo de Vera Pizzería. ¿Cómo estuvo tu pedido?\n\nCalifícalo del 1 al 5, donde 5 es excelente 🍕`
}

export const RESENA_GOOGLE_URL =
  'https://www.google.com/maps/place/La+Vera+Pizzería/@6.3367641,-75.5605423,17z/data=!4m8!3m7!1s0x8e442fa5d526d4c9:0xa0886a8a97fa7a23!8m2!3d6.3367641!4d-75.5605423!9m1!1b1!16s%2Fg%2F1ptvsz3pr?hl=es-CO&entry=ttu&g_ep=EgoyMDI2MDcyMC4wIKXMDSoASAFQAw%3D%3D'

export const FEEDBACK_POSITIVA = `¡Qué bueno que te gustó! 🍕🔥\n\nNos ayudarías muchísimo dejándonos una reseña en Google:\n${RESENA_GOOGLE_URL}\n\n¡Gracias!`
export const FEEDBACK_PEDIR_COMENTARIO =
  'Lamento que no fuera lo esperado 🙏\n¿Nos cuentas qué pasó? Tu opinión nos ayuda a mejorar.\n\n(Si prefieres no comentar, escribe "saltar")'
export const FEEDBACK_AGRADECER =
  '¡Gracias por contarnos! 🙏 Vamos a trabajar en eso.\n\nSi necesitas algo más, escríbeme y con gusto te ayudo 🍕'
export const FEEDBACK_NOTA_INVALIDA =
  'No entendí 🤔 Por favor responde solo con un número del 1 al 5.\n\n1 = Muy malo\n5 = Excelente'
export const FEEDBACK_SIN_IMAGENES = 'No aceptamos imágenes como parte del feedback de momento.'

// ── Avisos de cambio de estado del pedido ──────────────────────────────────
export function avisoEstadoPedido(p: {
  estado: string
  tipo_pedido: string | null
  motivo_rechazo: string | null
}): string | null {
  switch (p.estado) {
    case 'en_cocina':
      return `✅ ¡Tu pedido fue aprobado! 🍕 Ya está en preparación en nuestra cocina. Te avisaremos cuando esté listo para ${
        p.tipo_pedido === 'domicilio' ? 'enviarlo a tu dirección 🛵' : 'que lo recojas 🏃'
      }.`
    case 'en_camino':
      return '🛵 ¡Tu pedido está en camino! Nuestro repartidor ya salió con tu pedido. En breve llegará a tu dirección. ¡Que lo disfrutes! 🍕'
    case 'recoger':
      return '🏃 ¡Tu pedido está listo! Ya puedes venir a recoger tu pedido. Te esperamos en el local. ¡Que lo disfrutes! 🍕'
    case 'entregado':
      return '✅ ¡Pedido entregado! Esperamos que hayas disfrutado tu pedido 🍕. Si tienes algún comentario o quieres hacer otro pedido, escríbenos aquí mismo. ¡Gracias por elegirnos! ❤️'
    case 'cancelado': {
      // Mejora: en n8n, sin motivo el cliente leía "Tu pedido fue cancelado, null."
      const motivo = p.motivo_rechazo?.trim()
      return `❌ Tu pedido fue cancelado${motivo ? `, ${motivo}` : ''}. Lamentamos los inconvenientes. Si crees que hubo un error o necesitas más información, escríbenos y te ayudamos.`
    }
    default:
      return null // 'pendiente' y cualquier estado nuevo: no se avisa
  }
}
