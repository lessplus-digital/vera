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
    // Sin ellas el bot arranca igual (desarrollo) pero sin dedupe persistente
    // ni log de turnos; en producción son obligatorias.
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    NODE_ENV: z.string().default('development'),
  })
  .superRefine((c, ctx) => {
    if (!!c.SUPABASE_URL !== !!c.SUPABASE_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_SECRET_KEY'], message: 'SUPABASE_URL y SUPABASE_SECRET_KEY van juntas' })
    }
    if (c.NODE_ENV === 'production' && !c.SUPABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'obligatoria en producción' })
    }
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
