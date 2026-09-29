import type { Logger } from '../log.js'
import type { WhatsApp } from '../whatsapp/cliente.js'
import type { MensajeEntrante } from '../whatsapp/payload.js'
import type { ProcesadorTurno } from '../cola/buffer.js'
import { Turno, type RegistroTurnos } from '../log/turnos.js'

// Procesador provisional de la Fase 1: contesta lo que recibe. Sirve para probar
// la tubería completa (Meta → firma → dedupe → buffer → envío → log de turnos)
// antes de que exista el bot de verdad (Fases 3–5 lo reemplazan).

export const TEXTO_NO_SOPORTADO =
  'Por ahora solo puedo leer mensajes de texto y fotos 🙏 ¿Me lo escribes, por favor?'

export function textoDelTurno(mensajes: MensajeEntrante[]): string {
  return mensajes
    .flatMap((m) => (m.tipo === 'texto' || m.tipo === 'boton' ? [m.texto] : []))
    .join('\n')
    .trim()
}

export function crearProcesadorEco(wa: WhatsApp, registro: RegistroTurnos, log: Logger): ProcesadorTurno {
  return async (telefono, mensajes) => {
    const turno = new Turno(telefono, mensajes)
    try {
      const texto = textoDelTurno(mensajes)
      const imagenes = mensajes.filter((m) => m.tipo === 'imagen').length
      const noSoportados = mensajes.filter((m) => m.tipo === 'no_soportado').length

      let respuesta: string | null = null
      if (texto) respuesta = `Eco: ${texto}`
      else if (imagenes) respuesta = `Eco: recibí ${imagenes} imagen(es)`
      else if (noSoportados) respuesta = TEXTO_NO_SOPORTADO

      turno.decision = { handler: 'eco' }
      if (respuesta) {
        await wa.enviarTexto(telefono, respuesta)
        turno.salida.push(respuesta)
      }
      log.info({ telefono, mensajes: mensajes.length }, 'turno eco respondido')
    } catch (err) {
      turno.error = String(err)
      throw err
    } finally {
      await registro.guardar(turno.cerrar())
    }
  }
}
