import { z } from 'zod'

// Traduce el webhook de Meta a mensajes normalizados. Todo lo que no sea un
// mensaje entrante (acuses de entrega/lectura en `statuses`) se ignora aquí.

export type MensajeEntrante = {
  wamid: string
  telefono: string
  nombre: string
  /** Epoch en segundos, tal como lo manda Meta. */
  timestamp: number
} & (
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagen'; imagenId: string; mime: string | null; caption: string | null }
  // Un tap en un botón de plantilla se trata como texto (ya remapeado).
  | { tipo: 'boton'; texto: string }
  // Audio, ubicación, stickers, video… no se procesan, pero SÍ se contestan
  // (en n8n se descartaban en silencio: edge-case 19).
  | { tipo: 'no_soportado'; tipoOriginal: string }
)

// Las plantillas `recordatorio_reserva` traen botones "Confirmar" / "Cancelar".
// Sueltos son ambiguos (¿confirmar qué?), así que se reescriben con el sentido
// real — el mismo remapeo que hacía el nodo `Normalizar tap` de n8n.
const REMAPEO_BOTONES: Record<string, string> = {
  Confirmar: 'Confirmar mi reserva',
  Cancelar: 'Cancelar mi reserva',
}

export function remapearBoton(texto: string): string {
  const limpio = texto.trim()
  return REMAPEO_BOTONES[limpio] ?? limpio
}

const esquemaMensaje = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.coerce.number(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    image: z
      .object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() })
      .optional(),
    button: z.object({ text: z.string() }).optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).optional(),
        list_reply: z.object({ title: z.string() }).optional(),
      })
      .optional(),
  })
  .loose()

const esquemaWebhook = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                value: z
                  .object({
                    contacts: z
                      .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).loose().optional() }).loose())
                      .optional(),
                    messages: z.array(esquemaMensaje).optional(),
                  })
                  .loose(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
  })
  .loose()

export function parsearWebhook(cuerpo: unknown): MensajeEntrante[] {
  const r = esquemaWebhook.safeParse(cuerpo)
  if (!r.success || r.data.object !== 'whatsapp_business_account') return []

  const salida: MensajeEntrante[] = []
  for (const entry of r.data.entry) {
    for (const change of entry.changes) {
      const { contacts = [], messages = [] } = change.value
      for (const m of messages) {
        const nombre = contacts.find((c) => c.wa_id === m.from)?.profile?.name ?? ''
        const base = { wamid: m.id, telefono: m.from, nombre, timestamp: m.timestamp }

        if (m.type === 'text' && m.text) {
          salida.push({ ...base, tipo: 'texto', texto: m.text.body })
        } else if (m.type === 'image' && m.image) {
          salida.push({
            ...base,
            tipo: 'imagen',
            imagenId: m.image.id,
            mime: m.image.mime_type ?? null,
            caption: m.image.caption ?? null,
          })
        } else if (m.type === 'button' && m.button) {
          salida.push({ ...base, tipo: 'boton', texto: remapearBoton(m.button.text) })
        } else if (m.type === 'interactive' && (m.interactive?.button_reply || m.interactive?.list_reply)) {
          const titulo = m.interactive.button_reply?.title ?? m.interactive.list_reply?.title ?? ''
          salida.push({ ...base, tipo: 'boton', texto: remapearBoton(titulo) })
        } else {
          salida.push({ ...base, tipo: 'no_soportado', tipoOriginal: m.type })
        }
      }
    }
  }
  return salida
}
