import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cargarEscenario,
  correrEscenario,
  esquemaEscenario,
  verificar,
  veredicto,
  type ResultadoCorrida,
} from '../../src/sim/escenario.js'

const debe = (d: object) => esquemaEscenario.parse({ nombre: 'x', pasos: [{ envia: 'x', debe: d }] }).pasos[0]!.debe

describe('verificar', () => {
  it('contiene / no_contiene sin distinguir mayúsculas', () => {
    expect(verificar(debe({ contiene: ['niquía'] }), ['A NIQUÍA sí llegamos'])).toEqual([])
    expect(verificar(debe({ contiene: ['$7.500'] }), ['no llegamos'])).toEqual(['falta "$7.500"'])
    expect(verificar(debe({ no_contiene: ['sin problema'] }), ['Sí, Sin problema'])).toEqual(['no debía decir "sin problema"'])
  })

  it('coincide (regex) y número exacto de respuestas', () => {
    expect(verificar(debe({ coincide: 'PED-\\d+' }), ['Tu pedido PED-250 quedó'])).toEqual([])
    expect(verificar(debe({ coincide: 'PED-\\d+' }), ['listo'])).toHaveLength(1)
    expect(verificar(debe({ respuestas: 1 }), ['a', 'b'])).toEqual(['esperaba 1 respuesta(s), llegaron 2'])
  })
})

describe('verificar · bd', () => {
  const foto = { modo: 'bot', feedback: [{ pedido_id: 'PED-1', nota: 5, comentario: null }], feedback_pendiente: false, carrito: [{ nombre: 'Pan de Ajo', subtotal: 13900 }], soporte: ['hola'] }

  it('compara modo, la lista completa de calificaciones y la cola', () => {
    expect(verificar(debe({ bd: { modo: 'bot', feedback: [{ pedido_id: 'PED-1', nota: 5 }], feedback_pendiente: false } }), [], undefined, foto)).toEqual([])
    expect(verificar(debe({ bd: { modo: 'esperando_feedback' } }), [], undefined, foto)).toEqual(['modo bot, esperaba esperando_feedback'])
    expect(verificar(debe({ bd: { feedback: [] } }), [], undefined, foto)).toHaveLength(1)
    expect(verificar(debe({ bd: { feedback: [{ pedido_id: 'PED-2', nota: 5 }] } }), [], undefined, foto)).toHaveLength(1)
    expect(verificar(debe({ bd: { feedback_pendiente: true } }), [], undefined, foto)).toHaveLength(1)
  })

  it('carrito exacto, solo productos permitidos y total', () => {
    expect(verificar(debe({ bd: { carrito: ['Pan de Ajo'], carrito_solo: ['pan de ajo', 'Corona'], carrito_total: 13900 } }), [], undefined, foto)).toEqual([])
    expect(verificar(debe({ bd: { carrito: [] } }), [], undefined, foto)).toHaveLength(1)
    expect(verificar(debe({ bd: { carrito_solo: ['Corona'] } }), [], undefined, foto)).toEqual(['el carrito tiene productos que no se pidieron: Pan de Ajo'])
    expect(verificar(debe({ bd: { carrito_total: 1 } }), [], undefined, foto)).toEqual(['carrito_total 13900, esperaba 1'])
  })

  it('turno.accion compara decision.accion', () => {
    expect(verificar(debe({ turno: { accion: 'positiva' } }), [], { accion: 'positiva' })).toEqual([])
    expect(verificar(debe({ turno: { accion: 'positiva' } }), [], { accion: 'nota_invalida' })).toEqual(['accion nota_invalida, esperaba positiva'])
  })
})

describe('esquema de escenarios', () => {
  it('rechaza claves con typo en vez de ignorarlas', () => {
    expect(() => esquemaEscenario.parse({ nombre: 'x', pasos: [{ envia: 'x', debe: { contine: ['a'] } }] })).toThrow()
  })

  it('exige exactamente una acción por paso', () => {
    expect(() => esquemaEscenario.parse({ nombre: 'x', pasos: [{ debe: {} }] })).toThrow()
    expect(() => esquemaEscenario.parse({ nombre: 'x', pasos: [{ envia: 'a', envia_boton: 'b' }] })).toThrow()
  })

  it('todos los YAML de test/escenarios son válidos', () => {
    const dir = join(import.meta.dirname, '..', 'escenarios')
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      expect(() => cargarEscenario(join(dir, f)), f).not.toThrow()
    }
  })
})

describe('veredicto', () => {
  const corrida = (ok: boolean): ResultadoCorrida => ({ ok, pasos: [] })
  const e = (critico: boolean) => esquemaEscenario.parse({ nombre: 'x', critico, pasos: [{ envia: 'x' }] })

  it('crítico exige todas las corridas', () => {
    expect(veredicto(e(true), [corrida(true), corrida(true), corrida(false)]).ok).toBe(false)
    expect(veredicto(e(true), [corrida(true), corrida(true)]).ok).toBe(true)
  })

  it('normal exige ≥ 90%', () => {
    const nueve = Array.from({ length: 9 }, () => corrida(true))
    expect(veredicto(e(false), [...nueve, corrida(false)]).ok).toBe(true)
    expect(veredicto(e(false), [corrida(true), corrida(false)]).ok).toBe(false)
  })
})

describe('correrEscenario (de punta a punta)', () => {
  it('los escenarios sin LLM (bot: eco) pasan', async () => {
    const dir = join(import.meta.dirname, '..', 'escenarios')
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const e = cargarEscenario(join(dir, f))
      if (e.bot !== 'eco') continue
      const r = await correrEscenario(e)
      expect(r.pasos.flatMap((p) => p.fallos), f).toEqual([])
    }
  })

  it('reporta el fallo con lo que contestó el bot', async () => {
    const e = esquemaEscenario.parse({ nombre: 'x', pasos: [{ envia: 'hola', debe: { contiene: ['adiós'] } }] })
    const r = await correrEscenario(e)
    expect(r.ok).toBe(false)
    expect(r.pasos[0]).toMatchObject({ respuestas: ['Eco: hola'], fallos: ['falta "adiós"'] })
  })
})
