import type { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { Logger } from '../log.js'
import { ErrorWhatsApp, type WhatsApp } from '../whatsapp/cliente.js'
import type { SupabaseClient } from '../bd/supabase.js'

// POST /api/wa — los envíos de WhatsApp del DASHBOARD (Fase 7). Hasta ahora el
// navegador llamaba a Meta con VITE_WA_ACCESS_TOKEN, que viaja en el bundle: quien
// abriera las herramientas del navegador se llevaba el token. Con este proxy el
// token vive solo en el servidor y el dashboard manda el JWT de su sesión.
//
// Se autoriza dos veces, como la Edge Function admin-password: el token lo valida
// Supabase Auth (no se lee del JWT a mano) y el rol sale de `perfiles` en la BD.
//   texto libre  → solo admin (es el chat de Soporte)
//   plantilla    → admin y mesero (bienvenida, reservas, pedidos manuales, reseñas, promos)

export type Quien = { usuario_id: string; rol: string }

/** Devuelve quién manda la petición, o null si el token no vale o el usuario no puede entrar. */
export interface Autorizador {
  quienEs(token: string): Promise<Quien | null>
}

export function autorizadorSupabase(sb: SupabaseClient): Autorizador {
  return {
    async quienEs(token) {
      const { data, error } = await sb.auth.getUser(token)
      if (error || !data.user) return null
      const { data: p, error: e2 } = await sb.from('perfiles').select('rol, activo').eq('usuario_id', data.user.id).maybeSingle()
      if (e2 || !p || p.activo === false) return null
      return { usuario_id: data.user.id, rol: String(p.rol) }
    },
  }
}

const telefono = z.string().regex(/^\d{10,15}$/, 'teléfono: solo dígitos, con indicativo')
const cuerpo = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('texto'), telefono, texto: z.string().trim().min(1).max(4096) }).strict(),
  z
    .object({
      tipo: z.literal('plantilla'),
      telefono,
      nombre: z.string().regex(/^[a-z0-9_]{1,512}$/),
      idioma: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
      parametros: z.array(z.string().max(1024)).max(10).default([]),
    })
    .strict(),
])

export const PERMISOS: Record<'texto' | 'plantilla', string[]> = {
  texto: ['admin'],
  plantilla: ['admin', 'mesero'],
}

/** Tope por usuario: una sesión robada no puede usar el número del restaurante para spam. */
export class Limitador {
  private readonly envios = new Map<string, number[]>()
  constructor(
    private readonly maximo = 30,
    private readonly ventanaMs = 60_000,
    private readonly ahora = () => Date.now(),
  ) {}
  permitir(clave: string): boolean {
    const t = this.ahora()
    const recientes = (this.envios.get(clave) ?? []).filter((x) => t - x < this.ventanaMs)
    if (recientes.length >= this.maximo) {
      this.envios.set(clave, recientes)
      return false
    }
    recientes.push(t)
    this.envios.set(clave, recientes)
    return true
  }
}

export type DepsApiWa = {
  wa: WhatsApp
  /** Sin autorizador (sin Supabase) el endpoint no existe: 404. */
  autorizador?: Autorizador
  /** Orígenes del dashboard que el navegador deja llamar (CORS). */
  origenes: string[]
  log: Logger
  limitador?: Limitador
}

export function montarApiWa(app: Hono, d: DepsApiWa) {
  const limitador = d.limitador ?? new Limitador()
  app.use(
    '/api/wa',
    cors({ origin: d.origenes, allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['authorization', 'content-type'], maxAge: 600 }),
  )

  app.post('/api/wa', async (c) => {
    if (!d.autorizador) return c.json({ error: 'no disponible' }, 404)

    const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    const quien = token ? await d.autorizador.quienEs(token).catch(() => null) : null
    if (!quien) return c.json({ error: 'sesión inválida' }, 401)

    const r = cuerpo.safeParse(await c.req.json().catch(() => null))
    if (!r.success) return c.json({ error: 'petición inválida', detalle: r.error.issues.map((i) => i.message) }, 400)
    const m = r.data

    if (!PERMISOS[m.tipo].includes(quien.rol)) {
      d.log.warn({ usuario_id: quien.usuario_id, rol: quien.rol, tipo: m.tipo }, 'envío de WhatsApp sin permiso')
      return c.json({ error: 'tu rol no puede enviar este mensaje' }, 403)
    }
    if (!limitador.permitir(quien.usuario_id)) return c.json({ error: 'demasiados envíos seguidos; espera un minuto' }, 429)

    try {
      const { id } =
        m.tipo === 'texto'
          ? await d.wa.enviarTexto(m.telefono, m.texto)
          : await d.wa.enviarPlantilla(m.telefono, m.nombre, m.idioma, m.parametros)
      // El teléfono no va completo al log: basta para cruzar con Meta.
      d.log.info({ usuario_id: quien.usuario_id, tipo: m.tipo, plantilla: m.tipo === 'plantilla' ? m.nombre : undefined, tel: m.telefono.slice(-4), id }, 'envío del dashboard')
      return c.json({ ok: true, id })
    } catch (err) {
      // El mensaje de Meta le sirve al operador ("fuera de la ventana de 24 h"…): se devuelve tal cual.
      const meta = err instanceof ErrorWhatsApp
      d.log.error({ err, usuario_id: quien.usuario_id, tipo: m.tipo }, 'envío del dashboard falló')
      return c.json({ error: meta ? err.message : 'no se pudo enviar' }, 502)
    }
  })
}
