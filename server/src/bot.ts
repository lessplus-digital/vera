import type { Hono } from 'hono'
import type { Logger } from './log.js'
import type { WhatsApp } from './whatsapp/cliente.js'
import { crearApp } from './http/app.js'
import { DedupeMemoria, type Dedupe } from './cola/dedupe.js'
import { BufferPorTelefono, type ProcesadorTurno } from './cola/buffer.js'
import { crearProcesadorEco } from './turno/eco.js'

// Punto único donde se arma el bot. Lo usan el servidor real (index.ts), el
// simulador y las pruebas: así el simulador ejercita EXACTAMENTE el mismo
// código que producción, cambiando solo las piezas externas (WhatsApp, BD, LLM).

export type OpcionesBot = {
  verifyToken: string
  appSecret: string
  bufferMs: number
  wa: WhatsApp
  log: Logger
  dedupe?: Dedupe
  /** Para pruebas: reemplaza el procesador de turnos. */
  procesador?: ProcesadorTurno
}

export type Bot = {
  app: Hono
  buffer: BufferPorTelefono
}

export function crearBot(o: OpcionesBot): Bot {
  const procesador = o.procesador ?? crearProcesadorEco(o.wa, o.log)
  const buffer = new BufferPorTelefono(o.bufferMs, procesador, (telefono, err) =>
    o.log.error({ telefono, err }, 'turno falló'),
  )
  const app = crearApp({
    verifyToken: o.verifyToken,
    appSecret: o.appSecret,
    dedupe: o.dedupe ?? new DedupeMemoria(),
    buffer,
    log: o.log,
  })
  return { app, buffer }
}
