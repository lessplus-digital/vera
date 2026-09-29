import { describe, expect, it } from 'vitest'
import { DedupeBD, DedupeEnCapas, DedupeMemoria, type InsertarWaEvento } from '../../src/cola/dedupe.js'
import { Turno } from '../../src/log/turnos.js'
import { loggerMudo } from '../../src/log.js'
import { EntornoSim } from '../../src/sim/entorno.js'
import { payloadTexto } from '../../src/sim/meta.js'

/** Imita la tabla wa_eventos: PK wamid → 23505 al repetir. */
function tablaFalsa() {
  const filas = new Map<string, string>()
  const insertar: InsertarWaEvento = async ({ wamid, telefono }) => {
    if (filas.has(wamid)) return { error: { code: '23505', message: 'duplicate key' } }
    filas.set(wamid, telefono)
    return { error: null }
  }
  return { filas, insertar }
}

describe('DedupeBD', () => {
  it('primera vez true, repetido false (unique violation)', async () => {
    const t = tablaFalsa()
    const d = new DedupeBD(t.insertar, loggerMudo)
    expect(await d.primeraVez('w1', '573000000901')).toBe(true)
    expect(await d.primeraVez('w1', '573000000901')).toBe(false)
    expect(t.filas.get('w1')).toBe('573000000901')
  })

  it('si la BD falla, procesa igual (no se pierde el mensaje del cliente)', async () => {
    const caida = new DedupeBD(async () => ({ error: { code: '08006', message: 'connection failure' } }), loggerMudo)
    expect(await caida.primeraVez('w1', 't')).toBe(true)
    const excepcion = new DedupeBD(async () => { throw new Error('timeout') }, loggerMudo)
    expect(await excepcion.primeraVez('w1', 't')).toBe(true)
  })
})

describe('DedupeEnCapas', () => {
  it('sobrevive a un "reinicio": memoria nueva, misma BD', async () => {
    const t = tablaFalsa()
    const antes = new DedupeEnCapas([new DedupeMemoria(), new DedupeBD(t.insertar, loggerMudo)])
    expect(await antes.primeraVez('w1', 't')).toBe(true)
    const despues = new DedupeEnCapas([new DedupeMemoria(), new DedupeBD(t.insertar, loggerMudo)])
    expect(await despues.primeraVez('w1', 't')).toBe(false)
  })

  it('la memoria corta el reintento inmediato sin tocar la BD', async () => {
    let llamadas = 0
    const d = new DedupeEnCapas([
      new DedupeMemoria(),
      new DedupeBD(async () => { llamadas++; return { error: null } }, loggerMudo),
    ])
    await d.primeraVez('w1', 't')
    await d.primeraVez('w1', 't')
    expect(llamadas).toBe(1)
  })
})

describe('Turno (caja negra)', () => {
  it('anota herramientas con resultado y duración, y la salida', async () => {
    let t = 1000
    const turno = new Turno('573000000901', [], () => t)
    const r = await turno.herramienta('precio_producto', { id: 'PROD-006' }, async () => {
      t += 25
      return { ok: true }
    })
    expect(r).toEqual({ ok: true })
    turno.salida.push('hola')
    t += 5
    const reg = turno.cerrar()
    expect(reg.duracion_ms).toBe(30)
    expect(reg.herramientas).toEqual([{ nombre: 'precio_producto', args: { id: 'PROD-006' }, resultado: { ok: true }, ms: 25 }])
    expect(reg.salida).toEqual(['hola'])
  })

  it('una herramienta que revienta queda anotada y el error sube', async () => {
    const turno = new Turno('t', [])
    await expect(turno.herramienta('x', {}, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(turno.herramientas[0]).toMatchObject({ nombre: 'x', resultado: { excepcion: 'Error: boom' } })
  })

  it('no guarda el nombre del perfil de WhatsApp', () => {
    const turno = new Turno('t', [{ wamid: 'w', telefono: 't', nombre: 'Juan', timestamp: 0, tipo: 'texto', texto: 'hola' }])
    expect(turno.cerrar().entrada).toEqual([{ wamid: 'w', telefono: 't', timestamp: 0, tipo: 'texto', texto: 'hola' }])
  })
})

describe('cada turno queda registrado', () => {
  it('el bot guarda un turno por respuesta, con entrada y salida', async () => {
    const sim = new EntornoSim()
    await sim.postear(payloadTexto({ telefono: '573000000901', texto: 'hola' }))
    await sim.esperar()
    expect(sim.registro.turnos).toHaveLength(1)
    expect(sim.registro.turnos[0]).toMatchObject({
      telefono: '573000000901',
      salida: ['Eco: hola'],
      decision: { handler: 'eco' },
      error: null,
    })
  })
})
