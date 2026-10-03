import type { Logger } from '../log.js'
import type { WhatsApp } from '../whatsapp/cliente.js'
import type { MensajeEntrante } from '../whatsapp/payload.js'
import type { ProcesadorTurno } from '../cola/buffer.js'
import type { Cliente, MensajeHistorial, Repo } from '../bd/repo.js'
import { Turno, type RegistroTurnos } from '../log/turnos.js'
import * as T from '../textos.js'

// Núcleo determinista de un turno (Fase 3). Aquí NO hay LLM: se decide por el
// modo del cliente y el tipo de mensaje. La conversación libre (texto en modo
// bot) la resuelve un `Conversador`, que en las Fases 4–5 es el pipeline
// clasificador → política → handler; mientras tanto es un eco.
//
//   modo humano             → todo va al chat de soporte; el bot no contesta.
//   modo esperando_feedback → el texto es una calificación (RPC); una foto se rechaza;
//                              si ya no había calificación pendiente, el texto
//                              sigue al bot (en n8n se perdía sin respuesta).
//   modo bot                → foto = comprobante de transferencia; texto = Conversador.

export type ContextoConversacion = {
  cliente: Cliente
  texto: string
  historial: MensajeHistorial[]
  turno: Turno
}

export interface Conversador {
  /** Devuelve los textos a enviar (en orden). Puede registrar decisión y herramientas en `ctx.turno`. */
  responder(ctx: ContextoConversacion): Promise<string[]>
}

export const conversadorEco: Conversador = {
  async responder({ texto, turno }) {
    turno.decision = { handler: 'eco' }
    return [`Eco: ${texto}`]
  },
}

export type DepsProcesador = {
  wa: WhatsApp
  repo: Repo
  registro: RegistroTurnos
  conversador: Conversador
  log: Logger
  /** Mensajes de historial que ve el conversador. */
  ventanaHistorial?: number
}

type Clasificados = {
  texto: string
  imagenes: Extract<MensajeEntrante, { tipo: 'imagen' }>[]
  noSoportados: number
}

export function clasificar(mensajes: MensajeEntrante[]): Clasificados {
  return {
    texto: mensajes
      .flatMap((m) => (m.tipo === 'texto' || m.tipo === 'boton' ? [m.texto] : []))
      .join('\n')
      .trim(),
    imagenes: mensajes.filter((m): m is Extract<MensajeEntrante, { tipo: 'imagen' }> => m.tipo === 'imagen'),
    noSoportados: mensajes.filter((m) => m.tipo === 'no_soportado').length,
  }
}

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}
/**
 * La nota tal como la lee procesar_respuesta_feedback: sin tildes ni signos, el
 * mensaje entero tiene que SER la nota (BUG-051: "10/10" no es 1).
 */
export function notaFeedback(mensaje: string): number | null {
  const limpio = mensaje.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  if (/^[1-5]$/.test(limpio)) return Number(limpio)
  return ({ uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 } as Record<string, number>)[limpio] ?? null
}

export const extension = (mime: string) => EXTENSIONES[mime.split(';')[0]!.trim().toLowerCase()] ?? 'bin'

export function crearProcesador(d: DepsProcesador): ProcesadorTurno {
  const enviar = async (turno: Turno, texto: string) => {
    await d.wa.enviarTexto(turno.telefono, texto)
    turno.salida.push(texto)
  }

  // ── modo humano ───────────────────────────────────────────────────────────
  async function modoHumano(turno: Turno, c: Clasificados) {
    turno.decision = { handler: 'humano', accion: 'reenviar_a_soporte' }
    if (c.texto) {
      await turno.herramienta('guardar_mensaje_soporte', { tipo: 'texto' }, () =>
        d.repo.guardarMensajeSoporte({ telefono: turno.telefono, mensaje: c.texto, tipo_contenido: 'texto' }),
      )
    }
    for (const img of c.imagenes) {
      const media = await d.wa.descargarMedia(img.imagenId)
      const ruta = `soporte/${turno.telefono}/${Date.now()}_${img.wamid.slice(-8)}.${extension(media.mime)}`
      const url = await turno.herramienta('subir_imagen', { ruta }, () => d.repo.subirImagen(ruta, media.bytes, media.mime))
      await d.repo.guardarMensajeSoporte({
        telefono: turno.telefono,
        mensaje: img.caption ?? '📷 Imagen',
        tipo_contenido: 'imagen',
        imagen_url: url,
      })
    }
    if (c.noSoportados) {
      await d.repo.guardarMensajeSoporte({
        telefono: turno.telefono,
        mensaje: `(El cliente envió ${c.noSoportados} mensaje(s) de un tipo que no se puede mostrar: audio, ubicación o sticker)`,
        tipo_contenido: 'texto',
      })
    }
  }

  // ── modo esperando_feedback ───────────────────────────────────────────────
  const procesarFeedback = (turno: Turno, mensaje: string) =>
    turno.herramienta('procesar_respuesta_feedback', { mensaje }, () =>
      d.repo.procesarRespuestaFeedback(turno.telefono, mensaje),
    )

  /**
   * Devuelve el texto que debe seguir al bot (null = turno resuelto).
   *
   * El buffer junta los mensajes seguidos en un solo texto ("5⏎5", "2⏎llegó
   * fría"), y la RPC exige que el mensaje entero SEA la nota (BUG-051). Si el
   * texto junto no es una nota, se leen las líneas en orden: la primera que sea
   * nota califica, lo que sigue es el comentario (nota baja) o vuelve al bot
   * (nota alta). Sin esto, "5" mandado dos veces contestaba "No entendí".
   */
  async function modoFeedback(turno: Turno, c: Clasificados): Promise<string | null> {
    if (!c.texto) {
      turno.decision = { handler: 'feedback', accion: 'rechazar_no_texto' }
      if (c.imagenes.length || c.noSoportados) await enviar(turno, T.FEEDBACK_SIN_IMAGENES)
      return null
    }
    let accion = await procesarFeedback(turno, c.texto)
    let resto: string[] = []
    const lineas = c.texto.split('\n').map((l) => l.trim()).filter(Boolean)
    if (accion === 'nota_invalida' && lineas.length > 1) {
      const i = lineas.findIndex((l) => notaFeedback(l) !== null)
      if (i >= 0) {
        accion = await procesarFeedback(turno, lineas[i]!)
        resto = lineas.slice(i + 1)
        if (accion === 'pedir_comentario' && resto.length) {
          accion = await procesarFeedback(turno, resto.join('\n'))
          resto = []
        }
      }
    }
    turno.decision = { handler: 'feedback', accion }
    const respuesta = {
      positiva: T.FEEDBACK_POSITIVA,
      pedir_comentario: T.FEEDBACK_PEDIR_COMENTARIO,
      agradecer: T.FEEDBACK_AGRADECER,
      nota_invalida: T.FEEDBACK_NOTA_INVALIDA,
      sin_pendiente: null,
    }[accion]
    if (!respuesta) return c.texto // sin_pendiente: la RPC ya lo devolvió a 'bot'
    // El intercambio queda en el historial: si el cliente sigue escribiendo, el bot sabe de qué venía.
    await d.repo.agregarHistorial(turno.telefono, { tipo: 'human', texto: c.texto })
    await enviar(turno, respuesta)
    await d.repo.agregarHistorial(turno.telefono, { tipo: 'ai', texto: respuesta })
    // Tras una nota alta, lo que no sea otra nota ("5⏎quiero otra pizza") sigue al bot.
    const paraBot = resto.filter((l) => notaFeedback(l) === null).join('\n')
    return paraBot || null
  }

  // ── modo bot: comprobante por foto ────────────────────────────────────────
  async function comprobante(turno: Turno, img: Clasificados['imagenes'][number]) {
    const pedido = await turno.herramienta('pedido_pendiente_de_comprobante', {}, () =>
      d.repo.pedidoPendienteDeComprobante(turno.telefono),
    )
    if (!pedido) {
      turno.decision = { handler: 'comprobante', accion: 'sin_pedido' }
      await enviar(turno, T.COMPROBANTE_SIN_PEDIDO)
      return
    }
    try {
      const media = await d.wa.descargarMedia(img.imagenId)
      const ruta = `${pedido.pedido_id}.${extension(media.mime)}`
      const url = await turno.herramienta('subir_imagen', { ruta }, () => d.repo.subirImagen(ruta, media.bytes, media.mime))
      await turno.herramienta('adjuntar_comprobante', { pedido_id: pedido.pedido_id }, () =>
        d.repo.adjuntarComprobante(pedido.pedido_id, url),
      )
      turno.decision = { handler: 'comprobante', accion: 'adjuntado', pedido_id: pedido.pedido_id }
      await enviar(turno, T.COMPROBANTE_RECIBIDO)
    } catch (err) {
      d.log.error({ err, telefono: turno.telefono }, 'no se pudo guardar el comprobante')
      turno.decision = { handler: 'comprobante', accion: 'error' }
      turno.error = String(err)
      await enviar(turno, T.COMPROBANTE_ERROR)
    }
  }

  // ── modo bot ──────────────────────────────────────────────────────────────
  async function modoBot(turno: Turno, cliente: Cliente, c: Clasificados) {
    if (c.imagenes.length) {
      // Varias fotos seguidas = un solo comprobante: se usa la última.
      await comprobante(turno, c.imagenes[c.imagenes.length - 1]!)
    }
    if (c.texto) {
      const historial = await d.repo.leerHistorial(turno.telefono, d.ventanaHistorial ?? 10)
      let respuestas: string[]
      try {
        respuestas = await d.conversador.responder({ cliente, texto: c.texto, historial, turno })
      } catch (err) {
        // El cliente nunca se queda en silencio (en n8n un nodo caído = cero respuesta).
        d.log.error({ err, telefono: turno.telefono }, 'el conversador falló')
        turno.error = String(err)
        respuestas = [T.ERROR_GENERICO]
      }
      await d.repo.agregarHistorial(turno.telefono, { tipo: 'human', texto: c.texto })
      for (const r of respuestas) {
        await enviar(turno, r)
        await d.repo.agregarHistorial(turno.telefono, { tipo: 'ai', texto: r })
      }
    } else if (!c.imagenes.length && c.noSoportados) {
      turno.decision = { handler: 'no_soportado' }
      await enviar(turno, T.TEXTO_NO_SOPORTADO)
    }
  }

  return async (telefono, mensajes) => {
    const turno = new Turno(telefono, mensajes)
    try {
      // No se anota como herramienta: el log de turnos no necesita la dirección del cliente.
      const cliente = await d.repo.clientePorTelefono(telefono)
      const c = clasificar(mensajes)
      turno.contexto = { modo: cliente.modo, cliente_id: cliente.cliente_id }

      if (cliente.modo === 'humano') {
        await modoHumano(turno, c)
      } else if (cliente.modo === 'esperando_feedback') {
        const paraBot = await modoFeedback(turno, c)
        if (paraBot) await modoBot(turno, { ...cliente, modo: 'bot' }, { ...c, texto: paraBot, imagenes: [] })
      } else {
        await modoBot(turno, cliente, c)
      }
    } catch (err) {
      turno.error = String(err)
      throw err
    } finally {
      await d.registro.guardar(turno.cerrar())
    }
  }
}
