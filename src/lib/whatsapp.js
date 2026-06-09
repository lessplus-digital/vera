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
