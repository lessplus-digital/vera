const WA_PHONE_NUMBER_ID = import.meta.env.VITE_WA_PHONE_NUMBER_ID
const WA_API_VERSION     = import.meta.env.VITE_WA_API_VERSION || 'v25.0'
const WA_ACCESS_TOKEN    = import.meta.env.VITE_WA_ACCESS_TOKEN

const WA_API_URL = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`

/**
 * Envía un mensaje de texto por WhatsApp Business API.
 * Lanza un Error con message legible si la API responde con error.
 */
export async function sendWhatsAppMessage(phone, text) {
  if (!WA_ACCESS_TOKEN) throw new Error('VITE_WA_ACCESS_TOKEN no configurado en .env.local')

  const res = await fetch(WA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || res.statusText)
  }
}

/**
 * Envía una PLANTILLA de mensaje aprobada (type: template). Es la única forma
 * de escribir FUERA de la ventana de 24h de Meta. `bodyParams` son los valores
 * de las variables {{1}}, {{2}}… del cuerpo, EN ORDEN (ver WA_TEMPLATES en
 * constants.js). Lanza un Error legible si la API responde con error.
 */
export async function sendWhatsAppTemplate(phone, templateName, languageCode, bodyParams = []) {
  if (!WA_ACCESS_TOKEN) throw new Error('VITE_WA_ACCESS_TOKEN no configurado en .env.local')

  const template = { name: templateName, language: { code: languageCode } }
  if (bodyParams.length) {
    template.components = [{
      type: 'body',
      parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })),
    }]
  }

  const res = await fetch(WA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || res.statusText)
  }
}
