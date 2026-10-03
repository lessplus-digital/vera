import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { correrFeedback } from '../../src/cron/feedback.js'
import { loggerMudo } from '../../src/log.js'
import { avisoEstadoPedido, pedirCalificacion } from '../../src/textos.js'
import * as T from '../../src/textos.js'
import { extension, notaFeedback } from '../../src/turno/procesador.js'

const TEL = '573000000901'

async function conCliente(modo?: 'humano' | 'esperando_feedback') {
  const sim = new EntornoSim()
  await sim.repo.clientePorTelefono(TEL)
  if (modo) sim.repo.ponerModo(TEL, modo)
  return sim
}

async function turno(sim: EntornoSim, envio: () => Promise<unknown>) {
  const antes = sim.wa.textosPara(TEL).length
  await envio()
  await sim.esperar()
  return sim.wa.textosPara(TEL).slice(antes)
}

describe('cliente nuevo', () => {
  it('se crea con nombre Pendiente y modo bot en su primer mensaje', async () => {
    const sim = new EntornoSim()
    await turno(sim, () => sim.enviarTexto(TEL, 'hola'))
    expect(sim.repo.clientes.get(TEL)).toMatchObject({ nombre: 'Pendiente', modo: 'bot' })
  })
})

describe('modo humano', () => {
  it('el texto va al chat de soporte y el bot NO contesta', async () => {
    const sim = await conCliente('humano')
    const respuestas = await turno(sim, () => sim.enviarTexto(TEL, 'necesito cambiar mi pedido'))
    expect(respuestas).toEqual([])
    expect(sim.repo.soporte).toEqual([
      { telefono: TEL, mensaje: 'necesito cambiar mi pedido', tipo_contenido: 'texto', imagen_url: null },
    ])
    expect(sim.registro.turnos[0]?.decision).toEqual({ handler: 'humano', accion: 'reenviar_a_soporte' })
  })

  it('la foto se sube a soporte/<tel>/ y queda como mensaje de imagen', async () => {
    const sim = await conCliente('humano')
    await turno(sim, () => sim.enviarImagen(TEL, 'img-9', 'image/png', 'mira esto'))
    const [m] = sim.repo.soporte
    expect(m).toMatchObject({ tipo_contenido: 'imagen', mensaje: 'mira esto' })
    expect(m?.imagen_url).toMatch(new RegExp(`/soporte/${TEL}/.+\\.png$`))
  })

  it('un audio deja una nota para el operador en vez de perderse', async () => {
    const sim = await conCliente('humano')
    await turno(sim, () => sim.enviarTipo(TEL, 'audio'))
    expect(sim.repo.soporte[0]?.mensaje).toMatch(/no se puede mostrar/)
  })

  it('no se escribe historial del bot mientras atiende un humano', async () => {
    const sim = await conCliente('humano')
    await turno(sim, () => sim.enviarTexto(TEL, 'hola'))
    expect(sim.repo.historial.get(TEL)).toBeUndefined()
  })
})

describe('modo esperando_feedback', () => {
  function simConCola() {
    return conCliente().then(async (sim) => {
      sim.repo.porCalificar.push({ pedido_id: 'PED-1', cliente_id: 'x', telefono: TEL, nombre: 'Juan' })
      await sim.repo.solicitarFeedbackLote(20)
      return sim
    })
  }

  it('nota 5 → invita a reseña en Google y vuelve a modo bot', async () => {
    const sim = await simConCola()
    expect(await turno(sim, () => sim.enviarTexto(TEL, '5'))).toEqual([T.FEEDBACK_POSITIVA])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('bot')
    expect(sim.repo.feedback).toEqual([{ pedido_id: 'PED-1', nota: 5, comentario: null }])
  })

  it('nota 2 → pide comentario; el comentario se guarda y se agradece', async () => {
    const sim = await simConCola()
    expect(await turno(sim, () => sim.enviarTexto(TEL, '2'))).toEqual([T.FEEDBACK_PEDIR_COMENTARIO])
    expect(await turno(sim, () => sim.enviarTexto(TEL, 'llegó fría'))).toEqual([T.FEEDBACK_AGRADECER])
    expect(sim.repo.feedback[0]?.comentario).toBe('llegó fría')
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('bot')
  })

  it('texto que no es nota → pide la nota de nuevo y sigue esperando', async () => {
    const sim = await simConCola()
    expect(await turno(sim, () => sim.enviarTexto(TEL, '10/10'))).toEqual([T.FEEDBACK_NOTA_INVALIDA])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('esperando_feedback')
  })

  it('notaFeedback lee como la RPC: sin signos ni tildes, el mensaje entero es la nota', () => {
    for (const [m, n] of [['5', 5], ['¡5!', 5], ['Cinco ⭐', 5], ['tres.', 3], [' 1 ', 1]] as const) expect(notaFeedback(m), m).toBe(n)
    for (const m of ['10/10', '5/5', 'quiero 2 pizzas', 'me demoraron 45 minutos', '0', '6', '']) expect(notaFeedback(m), m).toBeNull()
  })

  it('"5" dos veces seguidas (el buffer las junta) → una sola respuesta positiva, no "No entendí"', async () => {
    const sim = await simConCola()
    const r = await turno(sim, async () => {
      await sim.enviarTexto(TEL, '5')
      await sim.enviarTexto(TEL, '5')
    })
    expect(r).toEqual([T.FEEDBACK_POSITIVA])
    expect(sim.repo.feedback).toEqual([{ pedido_id: 'PED-1', nota: 5, comentario: null }])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('bot')
  })

  it('nota baja + comentario juntos → guarda ambos y agradece sin volver a preguntar', async () => {
    const sim = await simConCola()
    const r = await turno(sim, async () => {
      await sim.enviarTexto(TEL, 'hola')
      await sim.enviarTexto(TEL, '2')
      await sim.enviarTexto(TEL, 'llegó fría')
      await sim.enviarTexto(TEL, 'y tarde')
    })
    expect(r).toEqual([T.FEEDBACK_AGRADECER])
    expect(sim.repo.feedback).toEqual([{ pedido_id: 'PED-1', nota: 2, comentario: 'llegó fría\ny tarde' }])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('bot')
  })

  it('nota alta + otra cosa juntas → califica y lo demás sigue al bot', async () => {
    const sim = await simConCola()
    const r = await turno(sim, async () => {
      await sim.enviarTexto(TEL, '5')
      await sim.enviarTexto(TEL, 'quiero otra pizza')
    })
    expect(r).toEqual([T.FEEDBACK_POSITIVA, 'Eco: quiero otra pizza'])
    expect(sim.repo.feedback).toEqual([{ pedido_id: 'PED-1', nota: 5, comentario: null }])
  })

  it('varias líneas sin ninguna nota → pide la nota otra vez y no guarda nada', async () => {
    const sim = await simConCola()
    const r = await turno(sim, async () => {
      await sim.enviarTexto(TEL, 'hola')
      await sim.enviarTexto(TEL, 'quiero 2 pizzas')
    })
    expect(r).toEqual([T.FEEDBACK_NOTA_INVALIDA])
    expect(sim.repo.feedback).toEqual([])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('esperando_feedback')
  })

  it('el intercambio de la calificación queda en el historial (el bot sabe de qué venía)', async () => {
    const sim = await simConCola()
    await turno(sim, () => sim.enviarTexto(TEL, '5'))
    expect(sim.repo.historial.get(TEL)).toEqual([
      { tipo: 'human', texto: '5' },
      { tipo: 'ai', texto: T.FEEDBACK_POSITIVA },
    ])
  })

  it('una foto se rechaza sin tocar la calificación', async () => {
    const sim = await simConCola()
    expect(await turno(sim, () => sim.enviarImagen(TEL, 'img-1'))).toEqual([T.FEEDBACK_SIN_IMAGENES])
    expect(sim.repo.feedback).toEqual([])
  })

  it('sin calificación pendiente, el mensaje sigue al bot (en n8n se perdía)', async () => {
    const sim = await conCliente('esperando_feedback') // modo huérfano, sin cola
    expect(await turno(sim, () => sim.enviarTexto(TEL, 'quiero una pizza'))).toEqual(['Eco: quiero una pizza'])
    expect(sim.repo.clientes.get(TEL)?.modo).toBe('bot')
    expect(sim.registro.turnos[0]?.decision).toEqual({ handler: 'eco' })
  })
})

describe('modo bot: comprobante de transferencia', () => {
  it('se adjunta al pedido pendiente MÁS RECIENTE sin comprobante (edge-case 18)', async () => {
    const sim = await conCliente()
    sim.repo.agregarPedido({ telefono: TEL, pedido_id: 'PED-VIEJO' })
    sim.repo.agregarPedido({ telefono: TEL, pedido_id: 'PED-NUEVO' })
    expect(await turno(sim, () => sim.enviarImagen(TEL, 'img-1', 'image/jpeg'))).toEqual([T.COMPROBANTE_RECIBIDO])
    const p = sim.repo.pedidos.find((x) => x.pedido_id === 'PED-NUEVO')
    expect(p?.comprobante_url).toMatch(/PED-NUEVO\.jpg$/)
    expect(sim.repo.pedidos.find((x) => x.pedido_id === 'PED-VIEJO')?.comprobante_url).toBeNull()
  })

  it('ignora pedidos en efectivo, ya pagados o que ya tienen comprobante', async () => {
    const sim = await conCliente()
    sim.repo.agregarPedido({ telefono: TEL, metodo_pago: 'Efectivo' })
    sim.repo.agregarPedido({ telefono: TEL, estado_pago: 'confirmado' })
    sim.repo.agregarPedido({ telefono: TEL, comprobante_url: 'https://ya/esta.jpg' })
    expect(await turno(sim, () => sim.enviarImagen(TEL, 'img-1'))).toEqual([T.COMPROBANTE_SIN_PEDIDO])
  })

  it('si la descarga falla, avisa al cliente en vez de quedarse callado', async () => {
    const sim = await conCliente()
    sim.repo.agregarPedido({ telefono: TEL, pedido_id: 'PED-1' })
    sim.wa.mediaQueFalla.add('img-roto')
    expect(await turno(sim, () => sim.enviarImagen(TEL, 'img-roto'))).toEqual([T.COMPROBANTE_ERROR])
    expect(sim.registro.turnos[0]?.error).toMatch(/no disponible/)
  })

  it('texto + foto en el mismo turno: comprobante y conversación', async () => {
    const sim = await conCliente()
    sim.repo.agregarPedido({ telefono: TEL })
    const r = await turno(sim, async () => {
      await sim.enviarImagen(TEL, 'img-1')
      await sim.enviarTexto(TEL, 'ya pagué')
    })
    expect(r).toEqual([T.COMPROBANTE_RECIBIDO, 'Eco: ya pagué'])
  })
})

describe('modo bot: conversación e historial', () => {
  it('guarda el turno en el historial (human + ai) para el paso a humano', async () => {
    const sim = await conCliente()
    await turno(sim, () => sim.enviarTexto(TEL, 'hola'))
    expect(sim.repo.historial.get(TEL)).toEqual([
      { tipo: 'human', texto: 'hola' },
      { tipo: 'ai', texto: 'Eco: hola' },
    ])
  })

  it('si el conversador revienta, el cliente recibe un mensaje (nunca silencio)', async () => {
    const sim = new EntornoSim({ conversador: { responder: async () => { throw new Error('OpenAI caído') } } })
    expect(await turno(sim, () => sim.enviarTexto(TEL, 'hola'))).toEqual([T.ERROR_GENERICO])
    expect(sim.registro.turnos[0]?.error).toMatch(/OpenAI caído/)
  })

  it('el conversador recibe el historial previo', async () => {
    const vistos: number[] = []
    const sim = new EntornoSim({
      conversador: { responder: async ({ historial }) => { vistos.push(historial.length); return ['ok'] } },
    })
    await turno(sim, () => sim.enviarTexto(TEL, 'uno'))
    await turno(sim, () => sim.enviarTexto(TEL, 'dos'))
    expect(vistos).toEqual([0, 2])
  })
})

describe('aviso de cambio de estado (/hooks/estado-pedido)', () => {
  const payload = (estado: string, anterior: string | null, extra: object = {}) => ({
    type: 'UPDATE',
    table: 'pedidos',
    record: { pedido_id: 'PED-1', telefono: TEL, estado, tipo_pedido: 'domicilio', motivo_rechazo: null, ...extra },
    old_record: { estado: anterior },
  })

  it('envía el texto del estado nuevo', async () => {
    const sim = new EntornoSim()
    const r = await sim.hookEstado(payload('en_cocina', 'pendiente'))
    expect(r).toEqual({ status: 200, cuerpo: { enviado: true } })
    expect(sim.wa.textosPara(TEL)[0]).toMatch(/enviarlo a tu dirección/)
  })

  it('no avisa si el estado no cambió (el trigger salta en todo UPDATE)', async () => {
    const sim = new EntornoSim()
    expect((await sim.hookEstado(payload('en_cocina', 'en_cocina'))).cuerpo).toMatchObject({ enviado: false })
    expect(sim.wa.enviados).toEqual([])
  })

  it('rechaza un token inválido y no envía nada', async () => {
    const sim = new EntornoSim()
    expect((await sim.hookEstado(payload('entregado', 'en_camino'), 'otro-token-cualquiera')).status).toBe(401)
    expect(sim.wa.enviados).toEqual([])
  })

  it('payload basura → 400', async () => {
    const sim = new EntornoSim()
    expect((await sim.hookEstado({ hola: 1 })).status).toBe(400)
  })
})

describe('textos de estado', () => {
  it('recoger vs domicilio en en_cocina', () => {
    expect(avisoEstadoPedido({ estado: 'en_cocina', tipo_pedido: 'recoger', motivo_rechazo: null })).toMatch(/que lo recojas/)
  })
  it('cancelado sin motivo no dice "null"', () => {
    const t = avisoEstadoPedido({ estado: 'cancelado', tipo_pedido: null, motivo_rechazo: null })
    expect(t).toMatch(/^❌ Tu pedido fue cancelado\. /)
    expect(t).not.toMatch(/null/)
  })
  it('cancelado con motivo lo incluye', () => {
    expect(avisoEstadoPedido({ estado: 'cancelado', tipo_pedido: null, motivo_rechazo: 'no hay domiciliarios' })).toMatch(
      /cancelado, no hay domiciliarios\./,
    )
  })
  it('pendiente y estados desconocidos no se avisan', () => {
    expect(avisoEstadoPedido({ estado: 'pendiente', tipo_pedido: null, motivo_rechazo: null })).toBeNull()
    expect(avisoEstadoPedido({ estado: 'inventado', tipo_pedido: null, motivo_rechazo: null })).toBeNull()
  })
  it('saludo de la calificación', () => {
    expect(pedirCalificacion('Juan Pablo')).toMatch(/^Hola Juan 👋/)
    expect(pedirCalificacion('Pendiente')).toMatch(/^Hola 👋/)
    expect(pedirCalificacion(null)).toMatch(/^Hola 👋/)
  })
})

describe('job de calificaciones', () => {
  it('pide calificación a cada pedido del lote, en tandas con pausa', async () => {
    const sim = new EntornoSim()
    for (let i = 0; i < 7; i++) {
      const t = `57300000095${i}`
      await sim.repo.clientePorTelefono(t)
      sim.repo.porCalificar.push({ pedido_id: `PED-${i}`, cliente_id: 'x', telefono: t, nombre: 'Ana' })
    }
    const pausas: number[] = []
    const r = await correrFeedback({ repo: sim.repo, wa: sim.wa, log: loggerMudo, esperar: async (ms) => void pausas.push(ms) })
    expect(r).toEqual({ pedidos: 7, enviados: 7 })
    expect(pausas).toEqual([2000]) // 5 + 2
    expect(sim.repo.clientes.get('573000000950')?.modo).toBe('esperando_feedback')
    expect(sim.wa.textosPara('573000000950')[0]).toMatch(/^Hola Ana 👋 Te escribo de Vera Pizzería/)
  })

  it('no pide calificación a quien está hablando con un humano', async () => {
    const sim = await conCliente('humano')
    sim.repo.porCalificar.push({ pedido_id: 'PED-1', cliente_id: 'x', telefono: TEL, nombre: null })
    expect(await correrFeedback({ repo: sim.repo, wa: sim.wa, log: loggerMudo })).toEqual({ pedidos: 0, enviados: 0 })
  })
})

describe('extension()', () => {
  it('mapea los mime comunes y cae a bin', () => {
    expect(extension('image/jpeg')).toBe('jpg')
    expect(extension('image/png; charset=binary')).toBe('png')
    expect(extension('application/x-raro')).toBe('bin')
  })
})
