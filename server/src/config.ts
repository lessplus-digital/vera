import { z } from 'zod'

// Toda la configuración entra por variables de entorno y se valida al arrancar:
// si falta algo obligatorio, el proceso muere con un mensaje claro en vez de
// fallar a mitad de una conversación.
const esquema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    WA_VERIFY_TOKEN: z.string().min(1),
    WA_APP_SECRET: z.string().min(1),
    WA_MODO: z.enum(['graph', 'fake']).default('graph'),
    WA_ACCESS_TOKEN: z.string().default(''),
    WA_PHONE_NUMBER_ID: z.string().default(''),
    WA_API_VERSION: z.string().default('v25.0'),

    BUFFER_MS: z.coerce.number().int().min(0).default(3000),

    // Supabase con la clave SECRETA (sb_secret_…): solo vive en el servidor.
    // Desde la Fase 3 son obligatorias: sin BD el bot no sabe quién es el cliente
    // ni en qué modo está. (El simulador y las pruebas usan una BD en memoria.)
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),

    // Token que manda el trigger notificar-estado-pedido en `x-webhook-token`.
    // Sin él, /hooks/estado-pedido queda deshabilitado (404).
    // Vacío = apagado (así viene en .env.example; antes "HOOK_TOKEN=" impedía arrancar).
    HOOK_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),

    // Orígenes del dashboard que pueden llamar POST /api/wa desde el navegador (CORS),
    // separados por coma: "https://vera.plateo.cloud,http://localhost:5173".
    DASHBOARD_ORIGENES: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)),

    // Job que pide calificaciones cada 15 min. APAGADO por defecto: mientras n8n
    // siga activo tiene su propio job, y un servidor de pruebas no debe escribirle
    // a clientes por su cuenta. Se enciende en el corte (Fase 8).
    // OpenAI (Fase 4): sin clave el bot arranca con el conversador eco, útil para
    // probar el esqueleto. Con clave: clasificador → política → guardia.
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_MODEL: z.string().default('gpt-5.1'),

    FEEDBACK_ACTIVO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .superRefine((c, ctx) => {
    if (c.WA_MODO === 'graph') {
      if (!c.WA_ACCESS_TOKEN) ctx.addIssue({ code: 'custom', path: ['WA_ACCESS_TOKEN'], message: 'obligatorio con WA_MODO=graph' })
      if (!c.WA_PHONE_NUMBER_ID) ctx.addIssue({ code: 'custom', path: ['WA_PHONE_NUMBER_ID'], message: 'obligatorio con WA_MODO=graph' })
    }
  })

export type Config = z.infer<typeof esquema>

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuración inválida:\n${detalle}`)
  }
  return r.data
}
