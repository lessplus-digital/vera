import { Hono } from 'hono'
import type { Logger } from '../log.js'
import type { Dedupe } from '../cola/dedupe.js'
import type { BufferPorTelefono } from '../cola/buffer.js'
import { firmaValida } from '../whatsapp/firma.js'
import { parsearWebhook } from '../whatsapp/payload.js'

export type DepsApp = {
  verifyToken: string
  appSecret: string
  dedupe: Dedupe
  buffer: BufferPorTelefono
  log: Logger
}

export function crearApp(d: DepsApp): Hono {
  const app = new Hono()

  app.get('/salud', (c) => c.json({ ok: true }))

  // Verificación inicial que hace Meta al configurar el webhook.
  app.get('/webhook/whatsapp', (c) => {
    const modo = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token')
    const reto = c.req.query('hub.challenge')
    const ok = modo === 'subscribe' && token === d.verifyToken && !!reto
    // Nunca se registra el token: solo si coincide y su largo, para depurar
    // un "no se pudo validar" de Meta sin exponer el secreto.
    d.log[ok ? 'info' : 'warn'](
      { modo, tokenCoincide: token === d.verifyToken, largoRecibido: token?.length ?? 0, largoEsperado: d.verifyToken.length, hayReto: !!reto },
      ok ? 'verificación de Meta aceptada' : 'verificación de Meta rechazada',
    )
    if (ok) return c.text(reto)
    return c.text('forbidden', 403)
  })

  app.post('/webhook/whatsapp', async (c) => {
    const crudo = new Uint8Array(await c.req.arrayBuffer())
    if (!firmaValida(crudo, c.req.header('x-hub-signature-256'), d.appSecret)) {
      d.log.warn('webhook con firma inválida: descartado')
      return c.text('firma inválida', 401)
    }

    let cuerpo: unknown
    try {
      cuerpo = JSON.parse(new TextDecoder().decode(crudo))
    } catch {
      return c.text('json inválido', 400)
    }

    // Se encola y se responde 200 enseguida: el turno corre fuera de esta
    // petición. Si tardáramos, Meta reintentaría y duplicaría mensajes.
    for (const m of parsearWebhook(cuerpo)) {
      if (!(await d.dedupe.primeraVez(m.wamid, m.telefono))) {
        d.log.info({ wamid: m.wamid }, 'mensaje duplicado ignorado')
        continue
      }
      d.buffer.agregar(m)
    }
    return c.text('ok')
  })

  return app
}
