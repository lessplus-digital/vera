import { timingSafeEqual } from 'node:crypto'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { Logger } from '../log.js'
import type { WhatsApp } from '../whatsapp/cliente.js'
import { avisoEstadoPedido } from '../textos.js'

// POST /hooks/estado-pedido — lo llama el trigger `notificar-estado-pedido` de la
// BD (supabase_functions.http_request, AFTER UPDATE ON pedidos) con el payload de
// Database Webhooks: {type, table, schema, record, old_record}. Se autentica con
// la cabecera `x-webhook-token`, la misma que hoy usa el webhook de n8n.
//
// El trigger salta en CADA update (también al asignar domiciliario o subir el
// comprobante): solo se avisa si cambió el `estado`.

const esquema = z.object({
  type: z.string().optional(),
  record: z.object({
    pedido_id: z.string(),
    telefono: z.string(),
    estado: z.string(),
    tipo_pedido: z.string().nullable().optional(),
    motivo_rechazo: z.string().nullable().optional(),
  }).loose(),
  old_record: z.object({ estado: z.string().nullable().optional() }).loose().nullable().optional(),
}).loose()

function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function montarHooks(app: Hono, d: { hookToken: string | undefined; wa: WhatsApp; log: Logger }) {
  app.post('/hooks/estado-pedido', async (c) => {
    if (!d.hookToken) return c.text('hook deshabilitado', 404)
    if (!tokenValido(c.req.header('x-webhook-token'), d.hookToken)) {
      d.log.warn('hook de estado con token inválido')
      return c.text('no autorizado', 401)
    }

    const r = esquema.safeParse(await c.req.json().catch(() => null))
    if (!r.success) return c.text('payload inválido', 400)
    const { record, old_record } = r.data

    if (record.estado === old_record?.estado) return c.json({ enviado: false, motivo: 'estado sin cambio' })

    const texto = avisoEstadoPedido({
      estado: record.estado,
      tipo_pedido: record.tipo_pedido ?? null,
      motivo_rechazo: record.motivo_rechazo ?? null,
    })
    if (!texto) return c.json({ enviado: false, motivo: `estado ${record.estado} no se avisa` })

    try {
      await d.wa.enviarTexto(record.telefono, texto)
      d.log.info({ pedido_id: record.pedido_id, estado: record.estado }, 'aviso de estado enviado')
      return c.json({ enviado: true })
    } catch (err) {
      // 200 igual: si respondemos error, pg_net no reintenta y solo ensucia su log.
      d.log.error({ err, pedido_id: record.pedido_id }, 'no se pudo enviar el aviso de estado')
      return c.json({ enviado: false, motivo: 'error de WhatsApp' })
    }
  })
}
