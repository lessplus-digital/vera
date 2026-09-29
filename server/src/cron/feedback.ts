import type { Logger } from '../log.js'
import type { WhatsApp } from '../whatsapp/cliente.js'
import type { Repo } from '../bd/repo.js'
import { pedirCalificacion } from '../textos.js'

// Cada 15 minutos: pide calificación de los pedidos entregados hace 1–6 h.
// La selección y el cambio de modo a 'esperando_feedback' los hace la RPC
// solicitar_feedback_lote (FOR UPDATE SKIP LOCKED, qa/sql/10-resenas.sql); aquí
// solo se envía el mensaje, en tandas de 5 con 2 s de pausa (límite de Meta).

export type OpcionesFeedback = {
  repo: Repo
  wa: WhatsApp
  log: Logger
  limite?: number
  tanda?: number
  pausaMs?: number
  esperar?: (ms: number) => Promise<void>
}

export async function correrFeedback(o: OpcionesFeedback): Promise<{ pedidos: number; enviados: number }> {
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const lote = await o.repo.solicitarFeedbackLote(o.limite ?? 20)
  let enviados = 0
  for (const [i, p] of lote.entries()) {
    if (i > 0 && i % (o.tanda ?? 5) === 0) await esperar(o.pausaMs ?? 2000)
    try {
      await o.wa.enviarTexto(p.telefono, pedirCalificacion(p.nombre))
      enviados++
    } catch (err) {
      // El cliente queda en esperando_feedback: el cron expirar-feedback-pendiente
      // lo libera en ≤ 7 h (misma red de seguridad que con n8n).
      o.log.error({ err, pedido_id: p.pedido_id }, 'no se pudo pedir la calificación')
    }
  }
  if (lote.length) o.log.info({ pedidos: lote.length, enviados }, 'calificaciones pedidas')
  return { pedidos: lote.length, enviados }
}

/** Programa el job sin solaparse: si una corrida tarda más que el intervalo, la siguiente espera. */
export function programarFeedback(o: OpcionesFeedback & { cadaMs?: number }): () => void {
  let corriendo = false
  const t = setInterval(async () => {
    if (corriendo) return
    corriendo = true
    try {
      await correrFeedback(o)
    } catch (err) {
      o.log.error({ err }, 'el job de calificaciones falló')
    } finally {
      corriendo = false
    }
  }, o.cadaMs ?? 15 * 60 * 1000)
  return () => clearInterval(t)
}
