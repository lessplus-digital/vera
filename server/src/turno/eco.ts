import type { Logger } from '../log.js'
import type { WhatsApp } from '../whatsapp/cliente.js'
import type { MensajeEntrante } from '../whatsapp/payload.js'
import type { ProcesadorTurno } from '../cola/buffer.js'

// Procesador provisional de la Fase 1: contesta lo que recibe. Sirve para probar
// la tubería completa (Meta → firma → dedupe → buffer → envío) antes de que
// exista el bot de verdad (Fases 3–5 lo reemplazan).

export const TEXTO_NO_SOPORTADO =
  'Por ahora solo puedo leer mensajes de texto y fotos 🙏 ¿Me lo escribes, por favor?'

export function textoDelTurno(mensajes: MensajeEntrante[]): string {
  return mensajes
    .flatMap((m) => (m.tipo === 'texto' || m.tipo === 'boton' ? [m.texto] : []))
    .join('\n')
    .trim()
}

export function crearProcesadorEco(wa: WhatsApp, log: Logger): ProcesadorTurno {
  return async (telefono, mensajes) => {
    const texto = textoDelTurno(mensajes)
    const imagenes = mensajes.filter((m) => m.tipo === 'imagen').length
    const noSoportados = mensajes.filter((m) => m.tipo === 'no_soportado').length

    let respuesta: string
    if (texto) respuesta = `Eco: ${texto}`
    else if (imagenes) respuesta = `Eco: recibí ${imagenes} imagen(es)`
    else if (noSoportados) respuesta = TEXTO_NO_SOPORTADO
    else return

    await wa.enviarTexto(telefono, respuesta)
    log.info({ telefono, mensajes: mensajes.length }, 'turno eco respondido')
  }
}
