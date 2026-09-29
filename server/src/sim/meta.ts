// Construye webhooks con el formato EXACTO de Meta (WhatsApp Cloud API) para el
// simulador y las pruebas. Si Meta cambia el formato, se ajusta solo aquí.

let contador = 0
export function nuevoWamid(): string {
  return `wamid.SIM${Date.now().toString(36)}${(++contador).toString(36)}`
}

type Base = { telefono: string; nombre?: string; wamid?: string; timestamp?: number }

function envolver(b: Base, mensaje: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_SIM',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '570000000000', phone_number_id: 'PHONE_SIM' },
              contacts: [{ profile: { name: b.nombre ?? 'Cliente Sim' }, wa_id: b.telefono }],
              messages: [
                {
                  from: b.telefono,
                  id: b.wamid ?? nuevoWamid(),
                  timestamp: String(b.timestamp ?? Math.floor(Date.now() / 1000)),
                  ...mensaje,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

export const payloadTexto = (b: Base & { texto: string }) => envolver(b, { type: 'text', text: { body: b.texto } })

export const payloadImagen = (b: Base & { imagenId: string; mime?: string; caption?: string }) =>
  envolver(b, {
    type: 'image',
    image: { id: b.imagenId, mime_type: b.mime ?? 'image/jpeg', ...(b.caption ? { caption: b.caption } : {}) },
  })

/** Tap en un botón de respuesta rápida de una plantilla. */
export const payloadBoton = (b: Base & { texto: string }) =>
  envolver(b, { type: 'button', button: { text: b.texto, payload: b.texto } })

/** Cualquier tipo que el bot no procesa (audio, location, sticker, video…). */
export const payloadTipo = (b: Base & { tipo: string }) => envolver(b, { type: b.tipo, [b.tipo]: {} })

/** Acuse de entrega/lectura: Meta los manda al mismo webhook y deben ignorarse. */
export function payloadEstado(telefono: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_SIM',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '570000000000', phone_number_id: 'PHONE_SIM' },
              statuses: [{ id: nuevoWamid(), status: 'delivered', recipient_id: telefono, timestamp: '0' }],
            },
          },
        ],
      },
    ],
  }
}
