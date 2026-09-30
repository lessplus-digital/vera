import { serve } from '@hono/node-server'
import { cargarConfig } from './config.js'
import { crearLogger } from './log.js'
import { crearBot } from './bot.js'
import { FakeWhatsApp, GraphWhatsApp, type WhatsApp } from './whatsapp/cliente.js'
import { crearSupabase } from './bd/supabase.js'
import { RepoSupabase } from './bd/repo-supabase.js'
import { DedupeBD, DedupeEnCapas, DedupeMemoria, insertarWaEventoSupabase } from './cola/dedupe.js'
import { RegistroBD } from './log/turnos.js'
import { programarFeedback } from './cron/feedback.js'
import { LLMOpenAI } from './llm/openai.js'
import { crearConversadorDecision } from './decision/conversador.js'
import { agentes } from './handlers/index.js'

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

const sb = crearSupabase(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY)
const repo = new RepoSupabase(sb)

const conversador = config.OPENAI_API_KEY
  ? (() => {
      const llm = new LLMOpenAI(config.OPENAI_API_KEY, config.OPENAI_MODEL)
      return crearConversadorDecision({ repo, llm, redactores: agentes({ repo, llm }) })
    })()
  : undefined
if (!conversador) log.warn('sin OPENAI_API_KEY: el bot contesta en modo eco')

const { app, buffer } = crearBot({
  verifyToken: config.WA_VERIFY_TOKEN,
  appSecret: config.WA_APP_SECRET,
  bufferMs: config.BUFFER_MS,
  hookToken: config.HOOK_TOKEN,
  wa,
  repo,
  log,
  dedupe: new DedupeEnCapas([new DedupeMemoria(), new DedupeBD(insertarWaEventoSupabase(sb), log)]),
  registro: new RegistroBD(sb, log),
  ...(conversador ? { conversador } : {}),
})

const detenerFeedback = config.FEEDBACK_ACTIVO ? programarFeedback({ repo, wa, log }) : () => {}

const servidor = serve({ fetch: app.fetch, port: config.PORT }, (info) =>
  log.info(
    { puerto: info.port, waModo: config.WA_MODO, llm: conversador ? config.OPENAI_MODEL : 'eco', hooks: !!config.HOOK_TOKEN, feedback: config.FEEDBACK_ACTIVO },
    'bot escuchando',
  ),
)

// Apagado ordenado (docker stop): deja de aceptar peticiones y termina los turnos en curso.
async function apagar(senal: string) {
  log.info({ senal }, 'apagando')
  detenerFeedback()
  servidor.close()
  await buffer.esperarInactivo()
  process.exit(0)
}
process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
