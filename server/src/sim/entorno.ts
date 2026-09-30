import { crearBot, type Bot } from '../bot.js'
import { loggerMudo, type Logger } from '../log.js'
import { FakeWhatsApp } from '../whatsapp/cliente.js'
import { firmar } from '../whatsapp/firma.js'
import type { ProcesadorTurno } from '../cola/buffer.js'
import { RegistroMemoria } from '../log/turnos.js'
import type { Conversador } from '../turno/procesador.js'
import { RepoMemoria } from './repo-memoria.js'
import type { LLM } from '../llm/llm.js'
import { crearConversadorDecision, type Redactor } from '../decision/conversador.js'
import type { Handler } from '../decision/contexto.js'
import { agentes } from '../handlers/index.js'
import { payloadBoton, payloadEstado, payloadImagen, payloadTexto, payloadTipo } from './meta.js'

// Un bot completo en memoria: mismo código que producción (crearBot), con
// WhatsApp falso. Los mensajes entran por el webhook HTTP real — firmados como
// los firma Meta — sin abrir puertos ni tocar la red.

const SECRETO_SIM = 'secreto-del-simulador'

export const HOOK_TOKEN_SIM = 'token-de-hook-del-simulador'

export type OpcionesEntorno = {
  bufferMs?: number
  log?: Logger
  conversador?: Conversador
  /** Con un LLM, el bot usa el pipeline de decisión (Fase 4) sobre la BD en memoria. */
  llm?: LLM
  /** Redactores por handler; 'agentes' = los agentes reales de la Fase 5 (necesita un LLM real). */
  redactores?: Partial<Record<Handler, Redactor>> | 'agentes'
  procesador?: (wa: FakeWhatsApp) => ProcesadorTurno
}

export class EntornoSim {
  readonly wa = new FakeWhatsApp()
  /** BD en memoria: clientes, modos, pedidos, soporte, historial, calificaciones. */
  readonly repo = new RepoMemoria()
  /** Los turnos del bot, para verificar decisiones y herramientas (no solo textos). */
  readonly registro = new RegistroMemoria()
  readonly bot: Bot

  constructor(o: OpcionesEntorno = {}) {
    const log = o.log ?? loggerMudo
    const conversador =
      o.conversador ?? (o.llm ? crearConversadorDecision({
              repo: this.repo,
              llm: o.llm,
              redactores: o.redactores === 'agentes' ? agentes({ repo: this.repo, llm: o.llm }) : (o.redactores ?? {}),
            }) : undefined)
    this.bot = crearBot({
      verifyToken: 'verify-sim',
      appSecret: SECRETO_SIM,
      bufferMs: o.bufferMs ?? 30,
      hookToken: HOOK_TOKEN_SIM,
      wa: this.wa,
      repo: this.repo,
      log,
      registro: this.registro,
      ...(conversador ? { conversador } : {}),
      ...(o.procesador ? { procesador: o.procesador(this.wa) } : {}),
    })
  }

  /** Simula el trigger notificar-estado-pedido de la BD. */
  async hookEstado(cuerpo: unknown, token = HOOK_TOKEN_SIM) {
    const res = await this.bot.app.request('/hooks/estado-pedido', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-token': token },
      body: JSON.stringify(cuerpo),
    })
    return { status: res.status, cuerpo: await res.json().catch(() => null) }
  }

  /** POST firmado al webhook, igual que Meta. Devuelve el status HTTP. */
  async postear(cuerpo: unknown, firma?: string): Promise<number> {
    const json = JSON.stringify(cuerpo)
    const res = await this.bot.app.request('/webhook/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma ?? firmar(json, SECRETO_SIM) },
      body: json,
    })
    return res.status
  }

  enviarTexto(telefono: string, texto: string, nombre?: string) {
    return this.postear(payloadTexto({ telefono, texto, ...(nombre ? { nombre } : {}) }))
  }
  enviarBoton(telefono: string, texto: string) {
    return this.postear(payloadBoton({ telefono, texto }))
  }
  enviarImagen(telefono: string, imagenId: string, mime?: string, caption?: string) {
    if (mime) this.wa.mimes.set(imagenId, mime)
    return this.postear(payloadImagen({ telefono, imagenId, ...(mime ? { mime } : {}), ...(caption ? { caption } : {}) }))
  }
  enviarTipo(telefono: string, tipo: string) {
    return this.postear(payloadTipo({ telefono, tipo }))
  }
  enviarEstado(telefono: string) {
    return this.postear(payloadEstado(telefono))
  }

  /** Espera a que el bot termine todo lo pendiente (buffer + turnos). */
  esperar() {
    return this.bot.buffer.esperarInactivo()
  }
}
