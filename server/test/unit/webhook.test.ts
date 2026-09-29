import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { payloadTexto } from '../../src/sim/meta.js'
import { cargarConfig } from '../../src/config.js'

const tel = '573000000901'

describe('webhook /webhook/whatsapp', () => {
  it('GET: responde el challenge solo con el verify token correcto', async () => {
    const { bot } = new EntornoSim()
    const ok = await bot.app.request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-sim&hub.challenge=123')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('123')
    const mal = await bot.app.request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123')
    expect(mal.status).toBe(403)
  })

  it('POST con firma inválida → 401 y no procesa nada', async () => {
    const sim = new EntornoSim()
    expect(await sim.postear(payloadTexto({ telefono: tel, texto: 'hola' }), 'sha256=00')).toBe(401)
    await sim.esperar()
    expect(sim.wa.enviados).toHaveLength(0)
  })

  it('POST con JSON roto (pero firmado) → 400', async () => {
    const sim = new EntornoSim()
    const { firmar } = await import('../../src/whatsapp/firma.js')
    const res = await sim.bot.app.request('/webhook/whatsapp', {
      method: 'POST',
      headers: { 'x-hub-signature-256': firmar('{roto', 'secreto-del-simulador') },
      body: '{roto',
    })
    expect(res.status).toBe(400)
  })

  it('POST válido → 200 y el bot responde', async () => {
    const sim = new EntornoSim()
    expect(await sim.enviarTexto(tel, 'hola')).toBe(200)
    await sim.esperar()
    expect(sim.wa.textosPara(tel)).toEqual(['Eco: hola'])
  })

  it('el mismo wamid reenviado por Meta se procesa una sola vez', async () => {
    const sim = new EntornoSim()
    const p = payloadTexto({ telefono: tel, texto: 'hola', wamid: 'wamid.repetido' })
    await sim.postear(p)
    await sim.postear(p)
    await sim.postear(p)
    await sim.esperar()
    expect(sim.wa.textosPara(tel)).toEqual(['Eco: hola'])
  })

  it('los acuses de entrega no generan respuesta', async () => {
    const sim = new EntornoSim()
    expect(await sim.enviarEstado(tel)).toBe(200)
    await sim.esperar()
    expect(sim.wa.enviados).toHaveLength(0)
  })

  it('GET /salud', async () => {
    const res = await new EntornoSim().bot.app.request('/salud')
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('cargarConfig', () => {
  const minimo = { WA_VERIFY_TOKEN: 'v', WA_APP_SECRET: 's', WA_MODO: 'fake' }

  it('aplica valores por defecto', () => {
    const c = cargarConfig(minimo)
    expect(c).toMatchObject({ PORT: 3000, BUFFER_MS: 3000, WA_API_VERSION: 'v25.0', WA_MODO: 'fake' })
  })

  it('exige token y phone id cuando envía de verdad por Meta', () => {
    expect(() => cargarConfig({ ...minimo, WA_MODO: 'graph' })).toThrow(/WA_ACCESS_TOKEN[\s\S]*WA_PHONE_NUMBER_ID/)
  })

  it('falla con mensaje claro si falta el secreto de la app', () => {
    expect(() => cargarConfig({ WA_VERIFY_TOKEN: 'v' })).toThrow(/WA_APP_SECRET/)
  })
})
