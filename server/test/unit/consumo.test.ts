import { describe, expect, it } from 'vitest'
import { anotarConsumo, medirConsumo, type ResumenConsumo } from '../../src/llm/llm.js'

const uso = (tokens_entrada: number, tokens_salida: number) => ({ modelo: 'm', tokens_entrada, tokens_salida, ms: 1 })

describe('consumo del modelo por turno', () => {
  it('suma todo lo que se anota dentro de la caja, aunque pase por awaits', async () => {
    let c: ResumenConsumo | undefined
    const r = await medirConsumo(async () => {
      anotarConsumo('clasificacion', uso(100, 10))
      await new Promise((ok) => setTimeout(ok, 1))
      anotarConsumo('menu#1', uso(900, 50))
      return 'listo'
    }, (x) => (c = x))
    expect(r).toBe('listo')
    expect(c).toMatchObject({ tokens_entrada: 1000, tokens_salida: 60 })
    expect(c?.llamadas.map((l) => l.nombre)).toEqual(['clasificacion', 'menu#1'])
  })

  it('dos turnos en paralelo no se mezclan', async () => {
    const vistos: number[] = []
    const turno = (n: number) =>
      medirConsumo(async () => {
        await new Promise((ok) => setTimeout(ok, n))
        anotarConsumo('x', uso(n, 0))
      }, (c) => vistos.push(c.tokens_entrada))
    await Promise.all([turno(5), turno(1)])
    expect(vistos.sort()).toEqual([1, 5])
  })

  it('si el turno falla, lo gastado igual se registra', async () => {
    let c: ResumenConsumo | undefined
    await expect(
      medirConsumo(async () => {
        anotarConsumo('clasificacion', uso(100, 10))
        throw new Error('se cayó el agente')
      }, (x) => (c = x)),
    ).rejects.toThrow('se cayó')
    expect(c?.tokens_entrada).toBe(100)
  })

  it('fuera de una caja no hace nada, y sin llamadas no se registra', async () => {
    expect(() => anotarConsumo('suelto', uso(1, 1))).not.toThrow()
    let llamado = false
    await medirConsumo(async () => undefined, () => (llamado = true))
    expect(llamado).toBe(false)
  })
})
