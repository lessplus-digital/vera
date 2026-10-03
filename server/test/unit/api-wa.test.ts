import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { Limitador, montarApiWa, type Autorizador } from '../../src/http/wa.js'
import { ErrorWhatsApp, FakeWhatsApp } from '../../src/whatsapp/cliente.js'
import { loggerMudo } from '../../src/log.js'

// POST /api/wa: los envíos del dashboard pasan por el servidor (Fase 7) para que el
// token de Meta no viaje en el bundle del navegador.

const ORIGEN = 'https://vera.plateo.cloud'
const TOKENS: Record<string, { usuario_id: string; rol: string }> = {
  'jwt-admin': { usuario_id: 'u-admin', rol: 'admin' },
  'jwt-mesero': { usuario_id: 'u-mesero', rol: 'mesero' },
  'jwt-domi': { usuario_id: 'u-domi', rol: 'domiciliario' },
}
const autorizador: Autorizador = { quienEs: async (t) => TOKENS[t] ?? null }

function montar(o: { autorizador?: Autorizador | null; wa?: FakeWhatsApp; limitador?: Limitador } = {}) {
  const app = new Hono()
  const wa = o.wa ?? new FakeWhatsApp()
  montarApiWa(app, {
    wa,
    log: loggerMudo,
    origenes: [ORIGEN],
    ...(o.autorizador === null ? {} : { autorizador: o.autorizador ?? autorizador }),
    ...(o.limitador ? { limitador: o.limitador } : {}),
  })
  const post = (cuerpo: unknown, token?: string) =>
    app.request('/api/wa', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cuerpo),
    })
  return { app, wa, post }
}

const texto = { tipo: 'texto', telefono: '573113298122', texto: 'Tu chat de soporte quedó resuelto 🙌' }
const plantilla = { tipo: 'plantilla', telefono: '573113298122', nombre: 'bienvenida_cliente', idioma: 'es_CO', parametros: ['Ana'] }

describe('POST /api/wa', () => {
  it('sin Supabase (sin autorizador) no existe', async () => {
    expect((await montar({ autorizador: null }).post(texto, 'jwt-admin')).status).toBe(404)
  })

  it('sin token o con un token que Auth no reconoce → 401, y no se envía nada', async () => {
    const { wa, post } = montar()
    expect((await post(texto)).status).toBe(401)
    expect((await post(texto, 'jwt-inventado')).status).toBe(401)
    expect(wa.enviados).toEqual([])
  })

  it('admin manda texto libre (chat de Soporte)', async () => {
    const { wa, post } = montar()
    const r = await post(texto, 'jwt-admin')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, id: expect.stringMatching(/^wamid\./) })
    expect(wa.enviados).toMatchObject([{ tipo: 'texto', telefono: '573113298122', texto: texto.texto }])
  })

  it('mesero: plantillas sí, texto libre no', async () => {
    const { wa, post } = montar()
    expect((await post(texto, 'jwt-mesero')).status).toBe(403)
    expect((await post(plantilla, 'jwt-mesero')).status).toBe(200)
    expect(wa.enviados).toMatchObject([{ tipo: 'plantilla', nombre: 'bienvenida_cliente', idioma: 'es_CO', parametros: ['Ana'] }])
  })

  it('domiciliario no envía nada', async () => {
    const { wa, post } = montar()
    expect((await post(texto, 'jwt-domi')).status).toBe(403)
    expect((await post(plantilla, 'jwt-domi')).status).toBe(403)
    expect(wa.enviados).toEqual([])
  })

  it('valida lo que entra: teléfono, campos de más, plantilla con nombre raro', async () => {
    const { wa, post } = montar()
    for (const malo of [
      { ...texto, telefono: '+57 311 329 8122' },
      { ...texto, texto: '   ' },
      { ...texto, extra: 1 },
      { ...plantilla, nombre: 'Bienvenida; DROP' },
      { ...plantilla, idioma: 'español' },
      { tipo: 'audio', telefono: '573113298122' },
    ]) {
      expect((await post(malo, 'jwt-admin')).status, JSON.stringify(malo)).toBe(400)
    }
    expect(wa.enviados).toEqual([])
  })

  it('si Meta rechaza, el mensaje de Meta llega al operador (502)', async () => {
    const wa = new FakeWhatsApp()
    wa.enviarTexto = async () => {
      throw new ErrorWhatsApp('Re-engagement message: más de 24 horas desde la última respuesta', 400, 131047)
    }
    const r = await montar({ wa }).post(texto, 'jwt-admin')
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'Re-engagement message: más de 24 horas desde la última respuesta' })
  })

  it('tope por usuario: una sesión robada no puede mandar spam', async () => {
    const { post } = montar({ limitador: new Limitador(2, 60_000) })
    expect((await post(plantilla, 'jwt-mesero')).status).toBe(200)
    expect((await post(plantilla, 'jwt-mesero')).status).toBe(200)
    expect((await post(plantilla, 'jwt-mesero')).status).toBe(429)
    expect((await post(plantilla, 'jwt-admin')).status).toBe(200) // el tope es por usuario
  })

  it('el tope se libera al pasar la ventana', () => {
    let t = 0
    const l = new Limitador(1, 1000, () => t)
    expect(l.permitir('u')).toBe(true)
    expect(l.permitir('u')).toBe(false)
    t = 1001
    expect(l.permitir('u')).toBe(true)
  })

  it('CORS: el dashboard puede llamarlo; otro origen no recibe permiso', async () => {
    const { app } = montar()
    const preflight = (origin: string) =>
      app.request('/api/wa', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
      })
    expect((await preflight(ORIGEN)).headers.get('access-control-allow-origin')).toBe(ORIGEN)
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull()
  })
})
