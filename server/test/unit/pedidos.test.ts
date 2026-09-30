import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM, type MensajeLLM } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { UltimaPregunta } from '../../src/decision/contexto.js'
import { enviarA, noLlegamos, P, sigues, sinPreguntas } from '../../src/handlers/pedidos.js'
import { PREGUNTA_CONFIRMAR } from '../../src/handlers/formato.js'
import * as T from '../../src/textos.js'

// El agente de Pedidos dentro del simulador. Lo que se prueba es el CÓDIGO: qué
// pregunta toca (faltantes), el resumen con sus cuentas, la marca de 'resumen'
// en la BD y el cierre. El LLM (de guion) solo pone la frase de enlace.

const TEL = '573000000905'

function montar(enlace: (mensajes: MensajeLLM[]) => string = () => '¡Perfecto!') {
  let cl: Partial<Clasificacion> = {}
  const llm = new FakeLLM((nombre, mensajes) => (nombre === 'clasificacion' ? clasificacionVacia(cl) : { texto: enlace(mensajes) }))
  const sim = new EntornoSim({ llm, redactores: 'agentes' })
  const turno = async (texto: string, c: Partial<Clasificacion>) => {
    cl = c
    const antes = sim.wa.textosPara(TEL).length
    await sim.enviarTexto(TEL, texto)
    await sim.esperar()
    const respuestas = sim.wa.textosPara(TEL).slice(antes)
    return { r: respuestas.join('\n'), respuestas, registro: sim.registro.turnos.at(-1)! }
  }
  return { sim, turno }
}

async function preparar(
  sim: EntornoSim,
  o: { ultima?: UltimaPregunta | null; carrito?: Parameters<EntornoSim['repo']['ponerCarrito']>[1]; barrio?: string; direccion?: string } = {},
) {
  await sim.repo.clientePorTelefono(TEL)
  const c = sim.repo.clientes.get(TEL)!
  c.nombre = 'Ana María'
  if (o.barrio) c.barrio = o.barrio
  if (o.direccion) c.direccion_principal = o.direccion
  sim.repo.ponerCarrito(TEL, o.carrito ?? { n_items: 1, subtotal: 30000 })
  await sim.repo.guardarConversacion(TEL, { handler: 'menu', ultima_pregunta: o.ultima ?? { tipo: 'algo_mas' } })
}

const pregunta = async (sim: EntornoSim) => (await sim.repo.leerConversacion(TEL)).ultima_pregunta

describe('flujo completo de un domicilio', () => {
  it('pregunta UNA cosa a la vez según faltantes, arma el resumen y crea el pedido con el "sí"', async () => {
    const { sim, turno } = montar()
    await preparar(sim)

    let t = await turno('no, eso es todo', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.registro.decision).toMatchObject({ handler: 'pedidos', regla: 'algo_mas:no' })
    expect(t.r).toBe(`¡Perfecto!\n\n${P.tipoPedido}`)
    expect(await pregunta(sim)).toEqual({ tipo: 'dato_pedido', dato: 'tipo_pedido' })

    t = await turno('a domicilio', { intencion: 'datos_pedido', tipo_pedido: 'domicilio' })
    expect(t.r.endsWith(P.barrio)).toBe(true)

    t = await turno('niqia', { intencion: 'datos_pedido', barrio: 'niqia' })
    expect(t.r).toContain('¡A Niquía sí llegamos! 🛵 El domicilio cuesta $7.500 y tarda 30 a 45 minutos.')
    expect(t.r.endsWith(P.direccion)).toBe(true)

    t = await turno('calle 10 # 5-20', { intencion: 'datos_pedido', direccion: 'calle 10 # 5-20' })
    expect(t.r.endsWith(P.metodoPago)).toBe(true)
    expect(sim.repo.carritos.get(TEL)!.paso_flujo).toBe('datos')

    t = await turno('por transferencia', { intencion: 'datos_pedido', metodo_pago: 'Transferencia' })
    expect(t.r).toContain('Perfecto Ana, tu pedido queda así:')
    expect(t.r).toContain('💰 Subtotal: $30.000\n🛵 Domicilio: $7.500\n💰 *Total a pagar: $37.500*\n📍 Envío a: calle 10 # 5-20, Niquía\n💳 Transferencia')
    expect(t.r.endsWith(PREGUNTA_CONFIRMAR)).toBe(true)
    expect(sim.repo.carritos.get(TEL)!.paso_flujo).toBe('resumen')
    expect(await pregunta(sim)).toEqual({ tipo: 'confirmar_pedido' })
    expect(sim.repo.ordenes).toHaveLength(0)

    t = await turno('sí, confirmo', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.ordenes).toHaveLength(1)
    const { pedido_id } = sim.repo.ordenes[0]!
    expect(t.r).toContain(pedido_id)
    expect(t.r).toContain('$37.500')
    expect(t.r).toContain('Bancolombia ahorros 62500073329') // la cuenta sale de info_negocio
    // La dirección de este pedido queda como la registrada del cliente.
    expect(sim.repo.clientes.get(TEL)).toMatchObject({ direccion_principal: 'calle 10 # 5-20', barrio: 'Niquía' })
  })

  it('con barrio y dirección registrados los ofrece, y un "sí" los usa', async () => {
    const { sim, turno } = montar()
    await preparar(sim, { barrio: 'Prado', direccion: 'Cra 50 # 40-20', carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' } })

    let t = await turno('listo', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r.endsWith(sigues('Prado'))).toBe(true)
    expect(await pregunta(sim)).toEqual({ tipo: 'sugerir_barrio', barrio: 'Prado' })

    t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(t.r).toContain('¡A Prado sí llegamos!')
    expect(t.r.endsWith(enviarA('Cra 50 # 40-20'))).toBe(true)

    t = await turno('sí señor', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.carritos.get(TEL)!.direccion_entrega).toBe('Cra 50 # 40-20')
    expect(t.r.endsWith(P.metodoPago)).toBe(true)
  })

  it('"no" al barrio registrado → pregunta abierta, sin volver a ofrecerlo', async () => {
    const { sim, turno } = montar()
    await preparar(sim, { barrio: 'Prado', carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' }, ultima: { tipo: 'sugerir_barrio', barrio: 'Prado' } })
    const t = await turno('no', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r.endsWith(P.barrio)).toBe(true)
    expect(t.r).not.toContain('Prado')
  })
})

describe('casos borde', () => {
  it('sin cobertura: no promete nada, ofrece recoger; "dale" pasa a recoger y el resumen no cobra domicilio', async () => {
    const { sim, turno } = montar()
    await preparar(sim, { carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio' }, ultima: { tipo: 'dato_pedido', dato: 'barrio' } })

    let t = await turno('copacabana', { intencion: 'datos_pedido', barrio: 'Copacabana' })
    expect(t.r.endsWith(noLlegamos('Copacabana'))).toBe(true)
    expect(t.r).not.toMatch(/\$|minutos/)
    expect(await pregunta(sim)).toEqual({ tipo: 'ofrecer_recoger' })

    t = await turno('dale', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.carritos.get(TEL)!.tipo_pedido).toBe('recoger')
    expect(t.r.endsWith(P.metodoPago)).toBe(true)

    t = await turno('efectivo', { intencion: 'datos_pedido', metodo_pago: 'Efectivo' })
    expect(t.r).toContain('💰 *Total: $30.000*\n🏃 Recoger en el local\n💳 Efectivo')
    expect(t.r).not.toContain('Domicilio')
  })

  it('cambio a un barrio sin cobertura DESPUÉS del resumen: no repite el resumen viejo, ofrece recoger', async () => {
    const { sim, turno } = montar()
    await preparar(sim, {
      carrito: {
        n_items: 1,
        subtotal: 30000,
        tipo_pedido: 'domicilio',
        barrio: 'Prado',
        costo_domicilio: 5000,
        cobertura_ok: true,
        direccion_entrega: 'Calle 50 # 40-20',
        metodo_pago: 'Efectivo',
        paso_flujo: 'resumen',
      },
      ultima: { tipo: 'confirmar_pedido' },
    })
    const t = await turno('mejor mándalo a Copacabana', { intencion: 'datos_pedido', barrio: 'Copacabana' })
    expect(t.r.endsWith(noLlegamos('Copacabana'))).toBe(true)
    expect(t.r).not.toContain(PREGUNTA_CONFIRMAR)
    expect(await pregunta(sim)).toEqual({ tipo: 'ofrecer_recoger' })
    // El "sí" siguiente es a recoger, nunca crea el pedido a Prado.
    await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.ordenes).toHaveLength(0)
    expect(sim.repo.carritos.get(TEL)!.tipo_pedido).toBe('recoger')
  })

  it('dirección vaga: no se guarda y se pide con calle y número', async () => {
    const { sim, turno } = montar()
    await preparar(sim, {
      carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'domicilio', barrio: 'Prado', costo_domicilio: 5000, cobertura_ok: true },
      ultima: { tipo: 'dato_pedido', dato: 'direccion_entrega' },
    })
    const t = await turno('cerca al parque', { intencion: 'datos_pedido', direccion: 'cerca al parque' })
    expect(sim.repo.carritos.get(TEL)!.direccion_entrega).toBeNull()
    expect(t.r.endsWith(P.direccionVaga)).toBe(true)
  })

  it('"no" al resumen: pregunta qué cambiar, sin repetir el resumen', async () => {
    const { sim, turno } = montar()
    await preparar(sim, {
      carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'recoger', metodo_pago: 'Efectivo', paso_flujo: 'resumen' },
      ultima: { tipo: 'confirmar_pedido' },
    })
    const t = await turno('no', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r.endsWith(P.queCambiar)).toBe(true)
    expect(t.r).not.toContain('$')
    expect(sim.repo.ordenes).toHaveLength(0)
  })

  it('la frase del LLM no puede agregar otra pregunta: el mensaje lleva UNA', async () => {
    const { sim, turno } = montar(() => '¡Listo! ¿Te ayudo con algo más?')
    await preparar(sim)
    const t = await turno('ya', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r).toBe(`¡Listo!\n\n${P.tipoPedido}`)
  })

  it('la frase del LLM con un precio inventado la frena la guardia y se reescribe', async () => {
    const { sim, turno } = montar((m) => (m.some((x) => x.texto.startsWith('Tu respuesta anterior NO se envió')) ? 'Perfecto 👌' : 'Perfecto, son $99.000'))
    await preparar(sim)
    const t = await turno('ya', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r).toBe(`Perfecto 👌\n\n${P.tipoPedido}`)
    expect(t.registro.guardia).toMatchObject({ intentos_fallidos: 1 })
  })

  it('error que el cliente no puede arreglar al crear → a una persona, con aviso honesto', async () => {
    const { sim, turno } = montar()
    await preparar(sim, {
      carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'recoger', metodo_pago: 'Efectivo', paso_flujo: 'resumen' },
      ultima: { tipo: 'confirmar_pedido' },
    })
    sim.repo.crearOrdenDesdeCarrito = async () => ({ ok: false, error: 'CLIENTE_INVALIDO' })
    const t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(t.respuestas).toEqual([T.PEDIDO_FALLO_HANDOFF])
    expect(sim.repo.clientes.get(TEL)!.modo).toBe('humano')
  })

  it('"sí" con el resumen vencido (SIN_RESUMEN) → vuelve a mostrar el resumen, no crea', async () => {
    const { sim, turno } = montar()
    await preparar(sim, {
      carrito: { n_items: 1, subtotal: 30000, tipo_pedido: 'recoger', metodo_pago: 'Efectivo', paso_flujo: 'datos' },
      ultima: { tipo: 'confirmar_pedido' },
    })
    const t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.ordenes).toHaveLength(0)
    expect(t.r.endsWith(PREGUNTA_CONFIRMAR)).toBe(true)
    expect(sim.repo.carritos.get(TEL)!.paso_flujo).toBe('resumen')
  })
})

describe('sinPreguntas', () => {
  it.each([
    ['¡Perfecto! ¿Algo más?', '¡Perfecto!'],
    ['Claro. Aceptamos transferencia.', 'Claro. Aceptamos transferencia.'],
    ['¿Cómo vas?', ''],
    ['', ''],
  ])('%s → %s', (a, b) => expect(sinPreguntas(a)).toBe(b))
})
