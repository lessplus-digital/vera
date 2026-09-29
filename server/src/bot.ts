import type { Hono } from 'hono'
import type { Logger } from './log.js'
import type { WhatsApp } from './whatsapp/cliente.js'
import type { Repo } from './bd/repo.js'
import { crearApp } from './http/app.js'
import { montarHooks } from './http/hooks.js'
import { DedupeMemoria, type Dedupe } from './cola/dedupe.js'
import { BufferPorTelefono, type ProcesadorTurno } from './cola/buffer.js'
import { conversadorEco, crearProcesador, type Conversador } from './turno/procesador.js'
import { RegistroLog, type RegistroTurnos } from './log/turnos.js'

// Punto único donde se arma el bot. Lo usan el servidor real (index.ts), el
// simulador y las pruebas: así el simulador ejercita EXACTAMENTE el mismo
// código que producción, cambiando solo las piezas externas (WhatsApp, BD, LLM).

export type OpcionesBot = {
  verifyToken: string
  appSecret: string
  bufferMs: number
  wa: WhatsApp
  repo: Repo
  log: Logger
  hookToken?: string
  dedupe?: Dedupe
  registro?: RegistroTurnos
  conversador?: Conversador
  /** Para pruebas: reemplaza el procesador de turnos completo. */
  procesador?: ProcesadorTurno
}

export type Bot = {
  app: Hono
  buffer: BufferPorTelefono
}

export function crearBot(o: OpcionesBot): Bot {
  const registro = o.registro ?? new RegistroLog(o.log)
  const procesador =
    o.procesador ??
    crearProcesador({ wa: o.wa, repo: o.repo, registro, conversador: o.conversador ?? conversadorEco, log: o.log })
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
  montarHooks(app, { hookToken: o.hookToken, wa: o.wa, log: o.log })
  return { app, buffer }
}
