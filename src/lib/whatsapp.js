import { supabase } from './supabase'

// Envíos de WhatsApp del dashboard. Dos caminos, mientras dura la migración:
//
// - Con VITE_WA_PROXY_URL (el servidor del bot, Fase 7): POST {proxy}/api/wa con el
//   JWT de la sesión. El token de Meta vive SOLO en el servidor, que además revalida
//   el rol (texto libre: admin; plantillas: admin y mesero). Es el camino definitivo.
// - Sin ella: llamada directa a Meta con VITE_WA_ACCESS_TOKEN, que viaja en el bundle
//   (riesgo diferido y conocido). Se retira en el corte (Fase 8): se configura
//   VITE_WA_PROXY_URL en Vercel, se BORRA VITE_WA_ACCESS_TOKEN y se rota el token.
const WA_PROXY_URL       = import.meta.env.VITE_WA_PROXY_URL
const WA_PHONE_NUMBER_ID = import.meta.env.VITE_WA_PHONE_NUMBER_ID
const WA_API_VERSION     = import.meta.env.VITE_WA_API_VERSION || 'v25.0'
const WA_ACCESS_TOKEN    = import.meta.env.VITE_WA_ACCESS_TOKEN

const WA_API_URL = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`

/** POST al servidor del bot. Lanza un Error con el mensaje que devuelve (el de Meta si falló allá). */
async function enviarPorServidor(cuerpo) {
  const { data } = await supabase.auth.getSession()
  const jwt = data.session?.access_token
  if (!jwt) throw new Error('Tu sesión expiró: vuelve a iniciar sesión')

  const res = await fetch(`${WA_PROXY_URL.replace(/\/$/, '')}/api/wa`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cuerpo, telefono: String(cuerpo.telefono).replace(/\D/g, '') }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || res.statusText)
  }
}

async function enviarDirecto(cuerpo) {
  if (!WA_ACCESS_TOKEN) throw new Error('VITE_WA_ACCESS_TOKEN no configurado en .env.local')

  const res = await fetch(WA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || res.statusText)
  }
}

/**
 * Envía un mensaje de texto por WhatsApp Business API.
 * Lanza un Error con message legible si la API responde con error.
 */
export async function sendWhatsAppMessage(phone, text) {
  if (WA_PROXY_URL) return enviarPorServidor({ tipo: 'texto', telefono: phone, texto: text })
  return enviarDirecto({ to: phone, type: 'text', text: { body: text } })
}

/**
 * Envía una PLANTILLA de mensaje aprobada (type: template). Es la única forma
 * de escribir FUERA de la ventana de 24h de Meta. `bodyParams` son los valores
 * de las variables {{1}}, {{2}}… del cuerpo, EN ORDEN (ver WA_TEMPLATES en
 * constants.js). Lanza un Error legible si la API responde con error.
 */
export async function sendWhatsAppTemplate(phone, templateName, languageCode, bodyParams = []) {
  if (WA_PROXY_URL) {
    return enviarPorServidor({
      tipo: 'plantilla', telefono: phone, nombre: templateName, idioma: languageCode,
      parametros: bodyParams.map(String),
    })
  }

  const template = { name: templateName, language: { code: languageCode } }
  if (bodyParams.length) {
    template.components = [{
      type: 'body',
      parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })),
    }]
  }
  return enviarDirecto({ to: phone, type: 'template', template })
}
