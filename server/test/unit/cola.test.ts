import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferPorTelefono } from '../../src/cola/buffer.js'
import { DedupeMemoria } from '../../src/cola/dedupe.js'
import type { MensajeEntrante } from '../../src/whatsapp/payload.js'

let n = 0
const msg = (telefono: string, texto: string): MensajeEntrante => ({
  wamid: `w${++n}`,
  telefono,
  nombre: '',
  timestamp: 0,
  tipo: 'texto',
  texto,
})
const textos = (ms: MensajeEntrante[]) => ms.map((m) => (m.tipo === 'texto' ? m.texto : '?'))

describe('DedupeMemoria', () => {
  it('true la primera vez, false las siguientes', async () => {
    const d = new DedupeMemoria()
    expect(await d.primeraVez('a')).toBe(true)
    expect(await d.primeraVez('a')).toBe(false)
    expect(await d.primeraVez('b')).toBe(true)
  })

  it('olvida después del TTL', async () => {
    let t = 0
    const d = new DedupeMemoria(1000, 100, () => t)
    await d.primeraVez('a')
    t = 999
    expect(await d.primeraVez('a')).toBe(false)
    t = 2000
    expect(await d.primeraVez('a')).toBe(true)
  })

  it('no crece sin límite', async () => {
    const d = new DedupeMemoria(1e9, 2)
    await d.primeraVez('a')
    await d.primeraVez('b')
    await d.primeraVez('c') // expulsa 'a'
    expect(await d.primeraVez('a')).toBe(true)
    expect(await d.primeraVez('c')).toBe(false)
  })
})

describe('BufferPorTelefono', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('junta los mensajes seguidos en un solo turno, esperando desde el ÚLTIMO', async () => {
    const turnos: string[][] = []
    const b = new BufferPorTelefono(1000, async (_t, ms) => void turnos.push(textos(ms)))
    b.agregar(msg('1', 'hola'))
    await vi.advanceTimersByTimeAsync(800)
    b.agregar(msg('1', 'quiero pizza'))
    await vi.advanceTimersByTimeAsync(800) // 1600 ms desde el primero, 800 desde el último
    expect(turnos).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(turnos).toEqual([['hola', 'quiero pizza']])
  })

  it('teléfonos distintos son turnos distintos y corren en paralelo', async () => {
    const enCurso = new Set<string>()
    let maxParalelo = 0
    const b = new BufferPorTelefono(100, async (t) => {
      enCurso.add(t)
      maxParalelo = Math.max(maxParalelo, enCurso.size)
      await new Promise((r) => setTimeout(r, 500))
      enCurso.delete(t)
    })
    b.agregar(msg('1', 'a'))
    b.agregar(msg('2', 'b'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(maxParalelo).toBe(2)
  })

  it('nunca corre dos turnos del mismo teléfono a la vez; lo que llega durante un turno forma el siguiente', async () => {
    const turnos: string[][] = []
    let paralelo = 0
    let maxParalelo = 0
    const b = new BufferPorTelefono(100, async (_t, ms) => {
      paralelo++
      maxParalelo = Math.max(maxParalelo, paralelo)
      turnos.push(textos(ms))
      await new Promise((r) => setTimeout(r, 1000)) // el LLM tarda
      paralelo--
    })
    b.agregar(msg('1', 'primero'))
    await vi.advanceTimersByTimeAsync(150) // turno 1 en curso
    b.agregar(msg('1', 'segundo'))
    b.agregar(msg('1', 'tercero'))
    await vi.advanceTimersByTimeAsync(300) // su espera vence, pero el turno 1 sigue
    expect(turnos).toEqual([['primero']])
    await vi.advanceTimersByTimeAsync(2000)
    expect(turnos).toEqual([['primero'], ['segundo', 'tercero']])
    expect(maxParalelo).toBe(1)
  })

  it('si un turno falla, avisa y el teléfono sigue funcionando', async () => {
    const fallos: string[] = []
    const turnos: string[][] = []
    const b = new BufferPorTelefono(
      50,
      async (_t, ms) => {
        if (textos(ms)[0] === 'boom') throw new Error('falló')
        turnos.push(textos(ms))
      },
      (t) => fallos.push(t),
    )
    b.agregar(msg('1', 'boom'))
    await vi.advanceTimersByTimeAsync(100)
    b.agregar(msg('1', 'hola'))
    await vi.advanceTimersByTimeAsync(100)
    expect(fallos).toEqual(['1'])
    expect(turnos).toEqual([['hola']])
  })

  it('esperarInactivo resuelve cuando no queda nada pendiente', async () => {
    vi.useRealTimers()
    let hechos = 0
    const b = new BufferPorTelefono(20, async () => {
      await new Promise((r) => setTimeout(r, 30))
      hechos++
    })
    b.agregar(msg('1', 'a'))
    b.agregar(msg('2', 'b'))
    await b.esperarInactivo()
    expect(hechos).toBe(2)
  })
})
