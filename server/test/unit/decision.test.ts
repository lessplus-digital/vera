import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { Redactor } from '../../src/decision/conversador.js'
import type { UltimaPregunta } from '../../src/decision/contexto.js'
import * as T from '../../src/textos.js'

// El pipeline completo de un turno (Fase 4) dentro del simulador: webhook →
// clasificador (FakeLLM) → política → acciones sobre la BD en memoria →
// redactor → guardia → conversaciones. Sin red.

const TEL = '573000000902'

function entorno(c: Partial<Clasificacion> | (() => never), redactores?: Record<string, Redactor>) {
  const llm = new FakeLLM(() => (typeof c === 'function' ? c() : clasificacionVacia(c)))
  const sim = new EntornoSim({ llm, ...(redactores ? { redactores } : {}) })
  return sim
}

async function turno(sim: EntornoSim, texto: string) {
  const antes = sim.wa.textosPara(TEL).length
  await sim.enviarTexto(TEL, texto)
  await sim.esperar()
  return { respuestas: sim.wa.textosPara(TEL).slice(antes), registro: sim.registro.turnos.at(-1)! }
}

async function preparar(sim: EntornoSim, ultima: UltimaPregunta | null, carrito?: Parameters<EntornoSim['repo']['ponerCarrito']>[1]) {
  await sim.repo.clientePorTelefono(TEL)
  if (carrito) sim.repo.ponerCarrito(TEL, carrito)
  await sim.repo.guardarConversacion(TEL, { handler: carrito ? 'pedidos' : null, ultima_pregunta: ultima })
}

const listoParaResumen = {
  n_items: 2,
  subtotal: 38000,
  tipo_pedido: 'domicilio' as const,
  barrio: 'Niquía',
  direccion_entrega: 'cra 45 # 52-10',
  metodo_pago: 'Efectivo' as const,
  costo_domicilio: 7500,
  cobertura_ok: true,
}

describe('crear el pedido', () => {
  it('"sí" al resumen con la BD en resumen: lo crea el código y confirma con id y total exactos', async () => {
    const sim = entorno({ intencion: 'respuesta_corta', confirma: 'si' })
    await preparar(sim, { tipo: 'confirmar_pedido' }, { ...listoParaResumen, paso_flujo: 'resumen' })
    const { respuestas } = await turno(sim, 'sí')
    expect(sim.repo.ordenes).toHaveLength(1)
    const { pedido_id } = sim.repo.ordenes[0]!
    expect(respuestas).toEqual([T.pedidoCreado({ pedido_id, total: 45500, tipo_pedido: 'domicilio', metodo_pago: 'Efectivo' })])
    expect(respuestas[0]).toContain('$45.500')
    expect(await sim.repo.leerConversacion(TEL)).toEqual({ handler: 'soporte', ultima_pregunta: null, reserva: null })
  })

  it('"sí" sin pregunta de resumen registrada: NO crea', async () => {
    const sim = entorno({ intencion: 'respuesta_corta', confirma: 'si' })
    await preparar(sim, null, { ...listoParaResumen, paso_flujo: 'resumen' })
    await turno(sim, 'sí')
    expect(sim.repo.ordenes).toHaveLength(0)
  })

  it('"sí" al resumen pero la BD no está en resumen: NO crea', async () => {
    const sim = entorno({ intencion: 'respuesta_corta', confirma: 'si' })
    await preparar(sim, { tipo: 'confirmar_pedido' }, { ...listoParaResumen, paso_flujo: 'datos' })
    const { registro } = await turno(sim, 'sí')
    expect(sim.repo.ordenes).toHaveLength(0)
    expect(registro.decision).toMatchObject({ regla: 'resumen:si_sin_resumen_valido' })
  })
})

describe('BUG-061 · barrio con errata', () => {
  it('"estoy en niqia": corrige a Niquía, guarda el nombre CANÓNICO con su tarifa (nunca "niqia")', async () => {
    const sim = entorno({ intencion: 'datos_pedido', barrio: 'niqia' })
    await preparar(sim, { tipo: 'dato_pedido', dato: 'barrio' }, { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' })
    const { registro } = await turno(sim, 'estoy en niqia')
    expect(registro.herramientas.filter((h) => h.nombre === 'consultar_cobertura').map((h) => h.args)).toEqual([
      { barrio: 'niqia' },
      { barrio: 'Niquía' },
    ])
    expect(sim.repo.carritos.get(TEL)).toMatchObject({ barrio: 'Niquía', costo_domicilio: 7500, cobertura_ok: true })
  })

  it('sin cobertura: la guardia no deja salir una tarifa ni un tiempo', async () => {
    const inventa: Redactor = async () => ({ texto: 'Sí llegamos a Envigado, el domicilio es $7.500 y tarda 30 minutos' })
    const sim = entorno({ intencion: 'datos_pedido', barrio: 'Envigado' }, { pedidos: inventa })
    await preparar(sim, { tipo: 'dato_pedido', dato: 'barrio' }, { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' })
    const { respuestas, registro } = await turno(sim, 'estoy en envigado')
    expect(respuestas).toEqual([T.TEXTO_SEGURO])
    expect(registro.guardia).toMatchObject({ intentos_fallidos: 2 })
    expect(sim.repo.carritos.get(TEL)?.barrio).toBeNull()
  })
})

describe('BUG-062 · "pardo" tras "¿en qué barrio?"', () => {
  it('aunque el clasificador lo lea como producto, se consulta cobertura y queda Prado', async () => {
    const sim = entorno({ intencion: 'pregunta_producto' })
    await preparar(sim, { tipo: 'dato_pedido', dato: 'barrio' }, { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' })
    const { registro } = await turno(sim, 'pardo')
    expect(registro.decision).toMatchObject({ handler: 'pedidos' })
    expect(sim.repo.carritos.get(TEL)).toMatchObject({ barrio: 'Prado', cobertura_ok: true })
  })
})

describe('sugerencias', () => {
  it('barrio sin match y con varias sugerencias → queda preguntando el barrio', async () => {
    const sim = entorno({ intencion: 'datos_pedido', barrio: 'xyz' })
    await preparar(sim, { tipo: 'dato_pedido', dato: 'barrio' }, { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' })
    sim.repo.consultarCobertura = async (b) => ({ cubierto: false, barrio: b, zona: null, costo_domicilio: null, tiempo_estimado: null, sugerencias: ['Prado', 'Pradera'] })
    await turno(sim, 'xyz')
    expect((await sim.repo.leerConversacion(TEL)).ultima_pregunta).toEqual({ tipo: 'dato_pedido', dato: 'barrio' })
  })
})

describe('handoff', () => {
  it('pedir una persona: modo humano y el aviso fijo', async () => {
    const sim = entorno({ intencion: 'otro', pide_humano: true })
    await preparar(sim, null)
    const { respuestas } = await turno(sim, 'quiero hablar con alguien')
    expect(respuestas).toEqual([T.HANDOFF])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('humano')
  })
})

describe('robustez', () => {
  it('si el clasificador falla, el cliente igual recibe respuesta y queda anotado', async () => {
    const sim = entorno(() => {
      throw new Error('OpenAI caído')
    })
    await preparar(sim, null)
    const { respuestas, registro } = await turno(sim, 'hola')
    expect(respuestas).toHaveLength(1)
    expect(registro.clasificacion).toMatchObject({ intencion: 'otro', error: expect.stringContaining('OpenAI caído') })
  })

  it('el redactor se corrige en el segundo intento con lo que marcó la guardia', async () => {
    const vistas: string[][] = []
    const redactor: Redactor = async ({ violaciones }) => {
      vistas.push(violaciones.map((v) => v.regla))
      return { texto: violaciones.length ? 'Con gusto 🍕' : 'Lo miré en el sistema' }
    }
    const sim = entorno({ intencion: 'saludo' }, { soporte: redactor })
    await preparar(sim, null)
    const { respuestas, registro } = await turno(sim, 'hola')
    expect(respuestas).toEqual(['Con gusto 🍕'])
    expect(vistas).toEqual([[], ['internos']])
    expect(registro.guardia).toMatchObject({ intentos_fallidos: 1 })
  })

  it('guarda qué preguntó el redactor, para interpretar el próximo "sí"', async () => {
    const redactor: Redactor = async () => ({ texto: '¿Te agrego una hawaiana mediana?', pregunta: { tipo: 'agregar_producto', producto: 'hawaiana mediana' } })
    const sim = entorno({ intencion: 'pregunta_producto' }, { menu: redactor })
    await preparar(sim, null)
    await turno(sim, 'la hawaiana qué trae?')
    expect(await sim.repo.leerConversacion(TEL)).toEqual({
      handler: 'menu',
      ultima_pregunta: { tipo: 'agregar_producto', producto: 'hawaiana mediana' },
      reserva: null,
    })
  })
})
