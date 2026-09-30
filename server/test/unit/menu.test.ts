import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM, type LlamadaLLM, type MensajeLLM, type PasoFake } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { UltimaPregunta } from '../../src/decision/contexto.js'
import { PREGUNTA_ALGO_MAS } from '../../src/handlers/menu.js'

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
    expect(await sim.repo.leerConversacion(TEL)).toEqual({ handler: 'menu', ultima_pregunta: { tipo: 'algo_mas' } })
  })

  it('distingue la masa: la hawaiana estofada tiene otro precio y otra línea', async () => {
    const { sim } = montar(pedir, [
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
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-031', tamano: 'grande', cantidad: 1, notas: null }),
      () => final('¡Listo! En las mitad y mitad se cobra la más cara 😊'),
    ])
    const { respuestas } = await turno(sim, 'mitad hawaiana mitad premium hawaiana grande')
    expect(respuestas[0]).toContain('1. 1x Mitad Hawaiana / Mitad Premium Hawaiana (Tradicional, Grande) — $57.000')
  })

  it('masas distintas: error, sin carrito', async () => {
    const { sim } = montar(pedir, [
      () => llamar('agregar_mitad_y_mitad', { producto_a: 'PROD-010', producto_b: 'PROD-015', tamano: 'grande', cantidad: 1, notas: null }),
      (previas) => {
        expect(previas[0]?.resultado).toMatchObject({ ok: false, error: 'MASA_DISTINTA' })
        return final('Las dos mitades tienen que ser de la misma masa. ¿Tradicional o estofada?', 'otra')
      },
    ])
    await turno(sim, 'mitad hawaiana tradicional mitad hawaiana estofada')
    expect(sim.repo.carritos.get(TEL)?.items ?? []).toHaveLength(0)
  })
})

describe('guardia y reescritura', () => {
  it('precio inventado → se reescribe SIN volver a agregar (el carrito no se duplica)', async () => {
    const { sim, menuLlamadas } = montar(
      pedir,
      [
        () => llamar('agregar_al_carrito', { producto_id: 'PROD-010', tamano: 'mediana', cantidad: 1, notas: null }),
        () => final('¡Listo! Te agregué la hawaiana por $30.000'),
      ],
      { texto: '¡Listo! 🍕', pregunta: 'ninguna', producto_sugerido: null },
    )
    const { respuestas, registro } = await turno(sim, 'una hawaiana tradicional mediana')
    expect(sim.repo.carritos.get(TEL)?.items).toHaveLength(1)
    expect(sim.repo.carritos.get(TEL)?.items[0]?.cantidad).toBe(1)
    expect(registro.guardia).toMatchObject({ intentos_fallidos: 1 })
    expect(respuestas[0]).not.toContain('$30.000')
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
