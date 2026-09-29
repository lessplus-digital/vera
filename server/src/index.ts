import { serve } from '@hono/node-server'
import { cargarConfig } from './config.js'
import { crearLogger } from './log.js'
import { crearBot } from './bot.js'
import { FakeWhatsApp, GraphWhatsApp, type WhatsApp } from './whatsapp/cliente.js'

const config = cargarConfig()
const log = crearLogger(config.LOG_LEVEL)

const wa: WhatsApp =
  config.WA_MODO === 'graph'
    ? new GraphWhatsApp({
        accessToken: config.WA_ACCESS_TOKEN,
        phoneNumberId: config.WA_PHONE_NUMBER_ID,
        apiVersion: config.WA_API_VERSION,
      })
    : new FakeWhatsApp()

const { app, buffer } = crearBot({
  verifyToken: config.WA_VERIFY_TOKEN,
  appSecret: config.WA_APP_SECRET,
  bufferMs: config.BUFFER_MS,
  wa,
  log,
})

const servidor = serve({ fetch: app.fetch, port: config.PORT }, (info) =>
  log.info({ puerto: info.port, waModo: config.WA_MODO }, 'bot escuchando'),
)

// Apagado ordenado (docker stop): deja de aceptar peticiones y termina los turnos en curso.
async function apagar(senal: string) {
  log.info({ senal }, 'apagando')
  servidor.close()
  await buffer.esperarInactivo()
  process.exit(0)
}
process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
