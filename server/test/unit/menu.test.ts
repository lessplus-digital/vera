import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM, type LlamadaLLM, type MensajeLLM, type PasoFake } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { UltimaPregunta } from '../../src/decision/contexto.js'
import { PREGUNTA_ALGO_MAS, quitarAlgoMas } from '../../src/handlers/menu.js'
import { masasNombradas, recortarRuido } from '../../src/herramientas/menu.js'

// El agente de Menú dentro del simulador, con un LLM de guion: se verifica lo
// que hace el CÓDIGO alrededor del modelo (precio desde la BD, bloque del
// carrito, guardia, reescritura sin repetir herramientas, pregunta abierta).

const TEL = '573000000904'

type Guion = (previas: LlamadaLLM[], mensajes: MensajeLLM[]) => PasoFake
type Menu = { texto: string; pregunta: 'ninguna' | 'agregar_producto' | 'algo_mas' | 'otra'; producto_sugerido: string | null }
const final = (texto: string, pregunta: Menu['pregunta'] = 'ninguna', producto_sugerido: string | null = null): PasoFake => ({
  final: { texto, pregunta, producto_sugerido },
})
const llamar = (nombre: string, args: unknown): PasoFake => ({ llamar: [{ nombre, args }] })

/** Guion por pasos: cada paso ve las llamadas previas. `reescribe` contesta a la reescritura. */
function montar(c: Partial<Clasificacion>, pasos: Guion[], reescribe?: Menu) {
  const menuLlamadas: MensajeLLM[][] = []
  const llm = new FakeLLM((nombre, mensajes, previas) => {
    if (nombre === 'clasificacion') return clasificacionVacia(c)
    menuLlamadas.push(mensajes)
    if (reescribe && mensajes.some((m) => m.texto.startsWith('Tu respuesta anterior NO se envió'))) return reescribe
    return pasos[Math.min(previas.length, pasos.length - 1)]!(previas, mensajes)
  })
  const sim = new EntornoSim({ llm, redactores: 'agentes' })
  return { sim, menuLlamadas }
}

async function turno(sim: EntornoSim, texto: string) {
  const antes = sim.wa.textosPara(TEL).length
  await sim.enviarTexto(TEL, texto)
  await sim.esperar()
  return { respuestas: sim.wa.textosPara(TEL).slice(antes), registro: sim.registro.turnos.at(-1)! }
}

const pedir: Partial<Clasificacion> = { intencion: 'agregar_producto' }

/**
 * Lo que devolvieron las herramientas en el turno, en orden. Se verifica aquí y no
 * con expect dentro del guion del LLM falso: allí un fallo se traga (el turno
 * responde ERROR_GENERICO) y la prueba pasaría igual.
 */
const resultados = (registro: { herramientas: { nombre: string; resultado: unknown }[] }, nombre: string) =>
  registro.herramientas.filter((h) => h.nombre === nombre).map((h) => h.resultado)

describe('agregar al carrito', () => {
  it('el precio lo pone la BD y el bloque 🛒 lo arma el código', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 2, notas: null }),
      () => final('¡Listo! 🍕'),
    ])
    const { respuestas } = await turno(sim, 'dame 2 hawaianas tradicionales medianas')
    expect(respuestas).toHaveLength(1)
    const r = respuestas[0]!
    expect(r).toContain('¡Listo! 🍕')
    expect(r).toContain('1. 2x Hawaiana Tradicional (Mediana) — $75.000')
    expect(r).toContain('*Subtotal: $75.000*')
    expect(r.endsWith(PREGUNTA_ALGO_MAS)).toBe(true)
    expect(await sim.repo.leerConversacion(TEL)).toEqual({ handler: 'menu', ultima_pregunta: { tipo: 'algo_mas' }, reserva: null })
  })

  it('distingue la masa: la hawaiana estofada tiene otro precio y otra línea', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => ({ llamar: [
        { nombre: 'agregar_al_carrito', args: { producto_id: 'PROD-010', tamano: 'grande', cantidad: 1, notas: null } },
        { nombre: 'agregar_al_carrito', args: { producto_id: 'PROD-015', tamano: 'grande', cantidad: 1, notas: 'bien tostada' } },
      ] }),
      () => final('Listo'),
    ])
    const { respuestas } = await turno(sim, 'una hawaiana grande tradicional y otra estofada bien tostada')
    expect(respuestas[0]).toContain('1. 1x Hawaiana Tradicional (Grande) — $50.500')
    expect(respuestas[0]).toContain('2. 1x Hawaiana Estofada (Grande) — $65.000\n    _bien tostada_')
    expect(respuestas[0]).toContain('*Subtotal: $115.500*')
  })

  it('si la herramienta falla (agotado), no hay carrito ni "¿algo más?"', async () => {
    const { sim } = montar(pedir, [
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-060', tamano: 'mediana', cantidad: 1, notas: null }),
      () => final('Uy, la Pizza M&M sí la manejamos pero hoy se nos agotó 😔 ¿Te muestro las otras dulces?', 'otra'),
    ])
    const { respuestas } = await turno(sim, 'una m&m mediana')
    expect(respuestas[0]).not.toContain('🛒')
    expect(sim.repo.carritos.get(TEL)?.items ?? []).toHaveLength(0)
    expect((await sim.repo.leerConversacion(TEL)).ultima_pregunta).toBeNull()
  })

  it('argumentos imposibles no llegan a la BD', async () => {
    const { sim } = montar(pedir, [
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 0, notas: null }),
      () => final('¿Cuántas quieres?', 'otra'),
    ])
    const { registro } = await turno(sim, 'hawaiana')
    expect(registro.herramientas.map((h) => h.nombre)).not.toContain('carrito_agregar_item')
  })
})

describe('mitad y mitad', () => {
  it('se cobra la mitad más cara y la línea muestra masa y tamaño', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-031', tamano: 'grande', cantidad: 1, notas: null }),
      () => final('¡Listo! En las mitad y mitad se cobra la más cara 😊'),
    ])
    const { respuestas } = await turno(sim, 'mitad hawaiana mitad premium hawaiana grande')
    expect(respuestas[0]).toContain('1. 1x Mitad Hawaiana / Mitad Premium Hawaiana (Tradicional, Grande) — $57.000')
  })

  it('masas distintas: error, sin carrito', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-015', tamano: 'grande', cantidad: 1, notas: null }),
      () => final('Las dos mitades tienen que ser de la misma masa. ¿Tradicional o estofada?', 'otra'),
    ])
    const { registro } = await turno(sim, 'mitad hawaiana tradicional mitad hawaiana estofada')
    expect(resultados(registro, 'carrito_agregar_mitad')).toMatchObject([{ ok: false, error: 'MASA_DISTINTA' }])
    expect(sim.repo.carritos.get(TEL)?.items ?? []).toHaveLength(0)
  })
})

describe('el producto_id sale de consultar_menu, nunca adivinado', () => {
  it('un id que no salió de la búsqueda se rechaza sin tocar la BD; tras buscar, entra', async () => {
    const { sim } = montar(pedir, [
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-031', tamano: 'grande', cantidad: 1, notas: null }),
      () => llamar('consultar_menu', { termino: 'premium hawaiana' }),
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-031', tamano: 'grande', cantidad: 1, notas: null }),
      () => final('¡Listo! 🍕'),
    ])
    const { respuestas, registro } = await turno(sim, 'una premium hawaiana grande')
    expect(resultados(registro, 'carrito_agregar_item')).toMatchObject([{ ok: false, error: 'PRODUCTO_SIN_CONSULTAR' }, { ok: true }])
    expect(sim.repo.carritos.get(TEL)?.items.map((i) => i.producto_id)).toEqual(['PROD-031'])
    expect(respuestas[0]).toMatch(/1x Premium Hawaiana.*\(Grande\) — \$57\.000/)
  })

  it('mitad y mitad con un id adivinado tampoco llega a la BD', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-011', tamano: 'grande', cantidad: 1, notas: null }),
      () => final('¿Cuál es la otra mitad? 🍕', 'otra'),
    ])
    const { registro } = await turno(sim, 'mitad hawaiana mitad la otra')
    expect(resultados(registro, 'carrito_agregar_mitad')).toMatchObject([{ ok: false, error: 'PRODUCTO_SIN_CONSULTAR' }])
    expect(sim.repo.carritos.get(TEL)?.items ?? []).toHaveLength(0)
  })

  it('lo que ya está en el carrito se puede volver a pedir sin buscarlo ("otra igual")', async () => {
    const { sim } = montar(pedir, [
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 1, notas: null }),
      () => final('¡Listo! 🍕'),
    ])
    sim.repo.ponerCarrito(TEL, { items: [{ producto_id: 'PROD-010', nombre: 'Hawaiana', variante: 'Mediana', cantidad: 1, precio_unitario: 37500, subtotal: 37500 }] })
    await turno(sim, 'otra igual')
    expect(sim.repo.carritos.get(TEL)?.items[0]?.cantidad).toBe(2)
  })
})

describe('guardia y reescritura', () => {
  it('precio inventado → se reescribe SIN volver a agregar (el carrito no se duplica)', async () => {
    const { sim, menuLlamadas } = montar(
      pedir,
      [
        () => llamar('consultar_menu', { termino: 'hawaiana' }),
        () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 1, notas: null }),
        () => final('¡Listo! Te agregué la hawaiana por $31.000'),
      ],
      { texto: '¡Listo! 🍕', pregunta: 'ninguna', producto_sugerido: null },
    )
    const { respuestas, registro } = await turno(sim, 'una hawaiana tradicional mediana')
    expect(sim.repo.carritos.get(TEL)?.items).toHaveLength(1)
    expect(sim.repo.carritos.get(TEL)?.items[0]?.cantidad).toBe(1)
    expect(registro.guardia).toMatchObject({ intentos_fallidos: 1 })
    expect(respuestas[0]).not.toContain('$31.000')
    expect(respuestas[0]).toContain('$37.500')
    // La reescritura vio lo que ya se había hecho.
    expect(menuLlamadas.at(-1)!.at(-1)!.texto).toContain('agregar_al_carrito')
  })
})

describe('preguntas abiertas', () => {
  it('guarda el producto sugerido para interpretar el "dale" siguiente', async () => {
    const { sim } = montar({ intencion: 'pregunta_producto' }, [
      () => llamar('consultar_menu', { termino: 'hawaina' }),
      () => final('¿Te refieres a la Hawaiana Tradicional? 🍕', 'agregar_producto', 'Hawaiana Tradicional'),
    ])
    await turno(sim, 'hawaina')
    expect((await sim.repo.leerConversacion(TEL)).ultima_pregunta).toEqual<UltimaPregunta>({
      tipo: 'agregar_producto',
      producto: 'Hawaiana Tradicional',
    })
  })

  it('"dale" a esa sugerencia: el agente recibe qué producto agregar', async () => {
    const { sim, menuLlamadas } = montar({ intencion: 'respuesta_corta', confirma: 'si' }, [() => final('¿De qué tamaño la quieres?', 'otra')])
    await sim.repo.clientePorTelefono(TEL)
    await sim.repo.guardarConversacion(TEL, { handler: 'menu', ultima_pregunta: { tipo: 'agregar_producto', producto: 'Hawaiana Tradicional' } })
    await turno(sim, 'dale')
    expect(menuLlamadas[0]!.at(-1)!.texto).toContain('agregar: Hawaiana Tradicional')
  })
})

describe('recortarRuido', () => {
  const p = (nombre: string, similitud: number) => ({ producto_id: nombre, nombre, categoria: 'x', variante: null, descripcion: null, precio: 1, tamanos: null, similitud })
  it('con una coincidencia clara, quita lo que está por debajo de 0.5', () => {
    const r = recortarRuido({ disponibles: [p('Pan de Ajo', 1), p('Copa de Sangría', 0.81), p('Pasta Alfredo', 0.49)], agotados: [p('Jarra', 0.3)] })
    expect(r.disponibles.map((x) => x.nombre)).toEqual(['Pan de Ajo', 'Copa de Sangría'])
    expect(r.agotados).toEqual([])
  })
  it('sin coincidencia clara devuelve todo (el modelo tiene que preguntar)', () => {
    const r = { disponibles: [p('Mexicana', 0.7), p('Patatas de la Casa', 0.28)], agotados: [] }
    expect(recortarRuido(r)).toEqual(r)
  })
})

describe('quitarAlgoMas', () => {
  it('quita la pregunta que el código va a poner, con su emoji', () => {
    expect(quitarAlgoMas('Te agregué la hawaiana 🍕\n\n¿Quieres agregar algo más? 😊')).toBe('Te agregué la hawaiana 🍕')
    expect(quitarAlgoMas('Listo. ¿Deseas algo mas?')).toBe('Listo.')
    expect(quitarAlgoMas('¿La quieres tradicional o estofada?')).toBe('¿La quieres tradicional o estofada?')
  })
})

describe('la masa que nombró el cliente no se cambia', () => {
  it('masasNombradas', () => {
    expect([...masasNombradas('una hawaiana Tradicional')]).toEqual(['tradicional'])
    expect([...masasNombradas('mitad hawaiana masa tradicional y mitad pepperoni masa estofada')].sort()).toEqual(['estofada', 'tradicional'])
    expect([...masasNombradas('la quiero rellena')]).toEqual(['estofada'])
    expect(masasNombradas('una hawaiana mediana').size).toBe(0)
  })

  it('pidió estofada y el modelo agrega la tradicional → MASA_NO_PEDIDA, sin tocar el carrito', async () => {
    const { sim } = montar(pedir, [
      () => llamar('consultar_menu', { termino: 'hawaiana' }),
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 1, notas: null }),
      () => llamar('agregar_al_carrito', { producto_id: 'PROD-015', tamano: 'mediana', cantidad: 1, notas: null }),
      () => final('¡Listo! 🍕'),
    ])
    const { registro } = await turno(sim, 'una hawaiana estofada mediana')
    expect(resultados(registro, 'carrito_agregar_item')).toMatchObject([{ ok: false, error: 'MASA_NO_PEDIDA' }, { ok: true }])
    expect(sim.repo.carritos.get(TEL)?.items.map((i) => i.producto_id)).toEqual(['PROD-015'])
  })

  it('mitad y mitad con una mitad en cada masa → MASA_DISTINTA desde el código (G5, 2026-10-02)', async () => {
    const { sim } = montar(pedir, [
      () => ({ llamar: [
        { nombre: 'consultar_menu', args: { termino: 'hawaiana' } },
        { nombre: 'consultar_menu', args: { termino: 'pepperoni' } },
      ] }),
      () => final('(no se usa: el guion elige el paso por cuántas herramientas ya corrieron)'),
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-020', tamano: 'mediana', cantidad: 1, notas: null }),
      () => final('Las dos mitades tienen que ser de la misma masa 🙏 ¿Tradicional o estofada?', 'otra'),
    ])
    const { registro } = await turno(sim, 'mitad hawaiana masa tradicional y mitad pepperoni masa estofada, mediana')
    expect(resultados(registro, 'carrito_agregar_mitad')).toMatchObject([{ ok: false, error: 'MASA_DISTINTA', message: expect.stringContaining('una mitad en masa tradicional') }])
    expect(sim.repo.carritos.get(TEL)?.items ?? []).toHaveLength(0)
  })
})
