import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM, type MensajeLLM } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import { noLlegamos, siLlegamos } from '../../src/handlers/formato.js'
import { S, citaRespaldada, pedidosParaLLM, pideCuenta, respuestaFija } from '../../src/handlers/soporte.js'
import * as T from '../../src/textos.js'
import { fechaUtc } from '../../src/bd/repo-supabase.js'

// El agente de Soporte dentro del simulador. Se prueba el CÓDIGO: qué lee de la
// BD y le pasa al modelo, los textos fijos (nombre, cobertura, handoff), que el
// modelo no pueda pasar a nadie a humano por su cuenta y que la guardia siga
// mandando. El LLM es de guion.

const TEL = '573000000907'

type Salida = { texto: string; pregunta?: 'ninguna' | 'barrio' | 'ofrecer_humano' | 'otra'; escalar?: 'no' | 'reclamo_grave' | 'pedido_registrado'; cita?: string }

function montar(soporte: (mensajes: MensajeLLM[], n: number) => Salida = () => ({ texto: '¡Con gusto!' })) {
  let cl: Partial<Clasificacion> = {}
  let n = 0
  const llm = new FakeLLM((nombre, mensajes) => {
    if (nombre === 'clasificacion') return clasificacionVacia(cl)
    const s = soporte(mensajes, n++)
    return { pregunta: 'ninguna', escalar: 'no', cita: '', ...s }
  })
  const sim = new EntornoSim({ llm, redactores: 'agentes' })
  const turno = async (texto: string, c: Partial<Clasificacion>) => {
    cl = c
    const antes = sim.wa.textosPara(TEL).length
    await sim.enviarTexto(TEL, texto)
    await sim.esperar()
    return { r: sim.wa.textosPara(TEL).slice(antes).join('\n'), registro: sim.registro.turnos.at(-1)! }
  }
  const contexto = () => llm.llamadas.filter((l) => l.nombre === 'soporte').at(-1)?.mensajes.map((m) => m.texto).join('\n') ?? ''
  return { sim, turno, llm, contexto }
}

const conversacion = async (sim: EntornoSim) => sim.repo.leerConversacion(TEL)
const cliente = (sim: EntornoSim) => sim.repo.clientes.get(TEL)!

describe('nombre', () => {
  it('solo "hola" y no sabemos su nombre → pregunta fija, sin LLM; la respuesta queda guardada', async () => {
    const { sim, turno, llm, contexto } = montar(() => ({ texto: '¡Mucho gusto, Camila! ¿En qué te ayudo?' }))

    let t = await turno('hola', { intencion: 'saludo' })
    expect(t.r).toBe(S.pedirNombre)
    expect(llm.llamadas.some((l) => l.nombre === 'soporte')).toBe(false)
    expect((await conversacion(sim)).ultima_pregunta).toEqual({ tipo: 'nombre' })

    t = await turno('Camila', { intencion: 'otro' })
    expect(cliente(sim).nombre).toBe('Camila')
    expect(t.registro.decision).toMatchObject({ handler: 'soporte' })
    expect(contexto()).toContain('Acaba de decirte su nombre (Camila)')
    expect(t.r).toBe('¡Mucho gusto, Camila! ¿En qué te ayudo?')
  })

  it('con nombre registrado, "hola" lo saluda el modelo (sin volver a preguntar)', async () => {
    const { sim, turno } = montar(() => ({ texto: '¡Hola Ana! 👋 ¿En qué te puedo ayudar hoy?' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana María'
    const t = await turno('hola', { intencion: 'saludo' })
    expect(t.r).toBe('¡Hola Ana! 👋 ¿En qué te puedo ayudar hoy?')
  })

  it('"hola, soy Juan" guarda el nombre y no lo pregunta', async () => {
    const { sim, turno } = montar(() => ({ texto: '¡Hola Juan! ¿En qué te ayudo?' }))
    const t = await turno('hola, soy Juan', { intencion: 'saludo', nombre_cliente: 'Juan' })
    expect(cliente(sim).nombre).toBe('Juan')
    expect(t.r).not.toBe(S.pedirNombre)
  })
})

describe('lo que el código le da al modelo', () => {
  it('info_negocio completa (con la cuenta: G7.5 la pide), las FAQ como datos y sus pedidos con estado real', async () => {
    const { sim, turno, contexto } = montar()
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    sim.repo.agregarPedido({ pedido_id: 'PED-501', telefono: TEL, estado: 'en_cocina', tipo_pedido: 'domicilio', total: 45000 })
    await turno('¿cuál es su instagram?', { intencion: 'info_negocio' })
    const c = contexto()
    expect(c).toContain('horario_semana: Lunes a Viernes 11:00am - 10:00pm')
    expect(c).toContain('datos_transferencia: Bancolombia ahorros 62500073329')
    expect(c).toContain('<faq>\nP: ¿Tienen parqueadero?')
    expect(c).toContain('PED-501')
    expect(c).toContain('aprobado y en preparación en la cocina')
  })

  it('"¿cómo va mi pedido?" puede citar su pedido y su total: salen de la BD', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Tu pedido *PED-502* ($45.000) ya va en camino 🛵' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    sim.repo.agregarPedido({ pedido_id: 'PED-502', telefono: TEL, estado: 'en_camino', total: 45000 })
    const t = await turno('cómo va mi pedido?', { intencion: 'estado_pedido' })
    expect(t.r).toBe('Tu pedido *PED-502* ($45.000) ya va en camino 🛵')
    expect(t.registro.guardia).toMatchObject({ intentos_fallidos: 0 })
  })

  it('un pedido que no es suyo, o un precio sacado de una FAQ, no pasan la guardia', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Tu pedido PED-999 cuesta $12.000' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('cómo va mi pedido?', { intencion: 'estado_pedido' })
    expect(t.r).toBe(T.TEXTO_SEGURO)
  })

  it('texto vacío del modelo → una pregunta abierta, nunca un mensaje vacío', async () => {
    const { sim, turno } = montar(() => ({ texto: '  ' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('mmm', { intencion: 'otro' })
    expect(t.r).toBe(S.enQueAyudo)
  })
})

describe('cobertura sin carrito', () => {
  it('"¿llegan a niqia?" → solo la respuesta del código, sin frase del modelo; como es pregunta, no se guarda nada', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Sofi, a domicilio solo manejamos Bello 😉' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('¿llegan a niqia?', { intencion: 'cobertura', barrio: 'niqia' })
    expect(t.registro.decision).toMatchObject({ handler: 'soporte' })
    expect(t.r).toBe(siLlegamos({ cubierto: true, barrio: 'Niquía', zona: 'Norte', costo_domicilio: 7500, tiempo_estimado: '30 a 45 minutos', sugerencias: [] }))
    expect(sim.repo.carritos.get(TEL)).toBeUndefined()
  })

  it('cobertura + otra cosa en el mismo mensaje → la frase del modelo va encima, sin sus preguntas', async () => {
    const { sim, turno } = montar(() => ({ texto: '¡Hola Ana! 👋 ¿Qué te gustaría pedir?' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('hola! ¿llegan a niqia?', { intencion: 'saludo', intenciones_extra: ['cobertura'], barrio: 'niqia' })
    expect(t.r.startsWith('¡Hola Ana!')).toBe(true)
    expect(t.r).not.toContain('¿Qué te gustaría pedir?') // la única pregunta sería la del código
    expect(t.r).toContain('$7.500')
  })

  it('sin cobertura → "no llegamos" + ofrecer recoger (pregunta del código), sin tarifa ni tiempo', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Te cuento' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('¿llegan a Envigado?', { intencion: 'cobertura', barrio: 'Envigado' })
    expect(t.r).toContain(noLlegamos('Envigado'))
    expect((await conversacion(sim)).ultima_pregunta).toEqual({ tipo: 'ofrecer_recoger' })
  })

  it('"¿hacen domicilios?" sin barrio → el modelo pregunta el barrio y la respuesta suelta pasa por cobertura', async () => {
    const { sim, turno } = montar((_m, n) =>
      n === 0 ? { texto: '¡Sí! ¿En qué barrio estás?', pregunta: 'barrio' } : { texto: '' },
    )
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    await turno('¿hacen domicilios?', { intencion: 'cobertura' })
    expect((await conversacion(sim)).ultima_pregunta).toEqual({ tipo: 'dato_pedido', dato: 'barrio' })
    const t = await turno('prado', { intencion: 'otro' })
    expect(t.registro.decision).toMatchObject({ handler: 'soporte', acciones: [{ tipo: 'verificar_cobertura', barrio: 'prado', guardar: true }] })
    expect(t.r).toContain('¡A Prado sí llegamos!')
  })
})

describe('paso a una persona', () => {
  it('el modelo solo lo señala: el código lo ejecuta y manda el texto fijo', async () => {
    const { sim, turno } = montar(() => ({ texto: 'lo que sea', escalar: 'reclamo_grave' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('me llegó la pizza equivocada', { intencion: 'queja', frustracion: 1 })
    expect(t.r).toBe(T.HANDOFF)
    expect(cliente(sim).modo).toBe('humano')
    expect(await conversacion(sim)).toEqual({ handler: null, ultima_pregunta: null, reserva: null })
  })

  it('"¿te conecto con alguien?" + "sí" → handoff por la política', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Eso no lo tengo. ¿Quieres que te conecte con alguien del equipo?', pregunta: 'ofrecer_humano' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    await turno('hacen eventos privados?', { intencion: 'info_negocio' })
    expect((await conversacion(sim)).ultima_pregunta).toEqual({ tipo: 'ofrecer_humano' })
    const t = await turno('sí porfa', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(t.r).toBe(T.HANDOFF)
    expect(cliente(sim).modo).toBe('humano')
  })
})

describe('pedidosParaLLM', () => {
  it('estado en palabras, tiempo transcurrido y motivo de cancelación', () => {
    const ahora = new Date('2026-09-30T20:00:00Z')
    const txt = pedidosParaLLM(
      [
        { pedido_id: 'PED-1', estado: 'pendiente', tipo_pedido: 'domicilio', metodo_pago: 'Efectivo', total: 45000, fecha_pedido: '2026-09-30T19:35:00Z', motivo_rechazo: null },
        { pedido_id: 'PED-2', estado: 'cancelado', tipo_pedido: 'recoger', metodo_pago: 'Transferencia', total: 30000, fecha_pedido: '2026-09-27T19:00:00Z', motivo_rechazo: 'sin comprobante' },
      ],
      ahora,
    )
    expect(txt).toContain('PED-1, hace 25 min, a domicilio, total $45.000, Efectivo: recibido; el equipo lo está revisando')
    expect(txt).toContain('PED-2, hace 3 días, para recoger, total $30.000, Transferencia: cancelado (motivo: sin comprobante)')
    expect(pedidosParaLLM([])).toBe('(no tiene pedidos registrados)')
  })
})

describe('fechaUtc (fecha_pedido llega de REST sin zona)', () => {
  it.each([
    ['2026-09-30T19:35:00.123456', '2026-09-30T19:35:00.123456Z'],
    ['2026-09-30 19:35:00', '2026-09-30T19:35:00Z'],
    ['2026-09-30T19:35:00Z', '2026-09-30T19:35:00Z'],
    ['2026-09-30T19:35:00+00:00', '2026-09-30T19:35:00+00:00'],
  ])('%s → %s', (entra, sale) => {
    expect(fechaUtc(entra)).toBe(sale)
    expect(new Date(fechaUtc(entra)).getUTCHours()).toBe(19)
  })
})

describe('pregunta del negocio: la respuesta tiene que citar un dato que exista', () => {
  it('"¿tienen wifi?" sin dato que lo respalde → texto fijo que ofrece al equipo (gpt-5.1 se lo inventó 1 de 5)', async () => {
    const { sim, turno } = montar(() => ({ texto: 'Sí, tenemos wifi, pídele la clave al mesero 🙌', cita: 'wifi gratis para clientes' }))
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('¿tienen wifi?', { intencion: 'info_negocio' })
    expect(t.r).toBe(S.noLaTengo)
    expect((await conversacion(sim)).ultima_pregunta).toEqual({ tipo: 'ofrecer_humano' })
    expect(t.registro.herramientas.map((h) => h.nombre)).toContain('cita_sin_respaldo')
  })

  it('con la cita en info_negocio o en una FAQ, sale el texto del modelo', async () => {
    const { sim, turno } = montar((_m, n) =>
      n === 0
        ? { texto: 'Los sábados abrimos de 12:00 pm a 11:00 pm 🍕', cita: 'Sábados y Domingos 12:00pm - 11:00pm' }
        : { texto: 'Sí, hay parqueadero frente al local 🚗', cita: 'Sí, frente al local, gratis para clientes.' },
    )
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    expect((await turno('¿y el sábado hasta tarde también?', { intencion: 'info_negocio' })).r).toBe('Los sábados abrimos de 12:00 pm a 11:00 pm 🍕')
    expect((await turno('¿tienen parqueadero?', { intencion: 'info_negocio' })).r).toBe('Sí, hay parqueadero frente al local 🚗')
  })

  it('citaRespaldada: sin tildes ni mayúsculas; varias partes, todas tienen que existir', () => {
    const f = 'Sábados y Domingos 12:00pm - 11:00pm\nParque de Bello Calle 54 # 52 -07'
    expect(citaRespaldada('sabados y domingos 12:00pm - 11:00pm', f)).toBe(true)
    expect(citaRespaldada('Parque de Bello … Sábados y Domingos', f)).toBe(true)
    expect(citaRespaldada('Parque de Bello … wifi gratis', f)).toBe(false)
    expect(citaRespaldada('', f)).toBe(false)
    expect(citaRespaldada('a', f)).toBe(false)
  })
})

describe('la cuenta para transferir la da el código', () => {
  it('reconoce las formas de pedirla, y no confunde una pregunta por medios de pago', () => {
    for (const t of ['¿me pasas los datos para transferir?', 'a qué cuenta consigno', 'número de cuenta porfa', 'dame los datos para pagar', '¿a dónde transfiero?'])
      expect(pideCuenta(t), t).toBe(true)
    for (const t of ['¿aceptan transferencia?', '¿aceptan tarjeta?', 'ya transferí', 'hola']) expect(pideCuenta(t), t).toBe(false)
  })

  it('responde con el dato de info_negocio, sin modelo', async () => {
    const { sim, turno } = montar(() => {
      throw new Error('no debía llamarse al modelo')
    })
    await sim.repo.clientePorTelefono(TEL)
    cliente(sim).nombre = 'Ana'
    const t = await turno('¿me pasas los datos para transferir?', { intencion: 'info_negocio' })
    expect(t.r).toBe(S.cuenta('Bancolombia ahorros 62500073329'))
  })

  it('una cita con el nombre del campo también está respaldada', () => {
    expect(citaRespaldada('horario_semana: Lunes a Viernes 11:00am - 10:00pm', 'horario_semana: Lunes a Viernes 11:00am - 10:00pm')).toBe(true)
  })
})

describe('respuestas fijas del local', () => {
  const info = {
    horario_semana: 'Lunes a Viernes 11:00am - 10:00pm',
    horario_finsemana: 'Sábados y Domingos 12:00pm - 11:00pm',
    horario_feriados: 'Cerrado',
    direccion: 'Parque de Bello Calle 54 # 52 -07',
    metodos_pago: 'Efectivo y transferencia bancaria',
  }
  it('un solo tema → el dato de la BD, tal cual', () => {
    expect(respuestaFija('¿a qué hora abren?', info)).toBe('Nuestro horario 🕐\nLunes a Viernes 11:00am - 10:00pm\nSábados y Domingos 12:00pm - 11:00pm\nFestivos: Cerrado')
    expect(respuestaFija('¿dónde quedan?', info)).toBe('Estamos en Parque de Bello Calle 54 # 52 -07 📍')
    expect(respuestaFija('¿aceptan tarjeta?', info)).toBe('Recibimos efectivo y transferencia bancaria 💵')
  })
  it('dos temas, ninguno o un mensaje largo → sigue el modelo', () => {
    expect(respuestaFija('¿a qué hora abren y dónde quedan?', info)).toBeNull()
    expect(respuestaFija('¿tienen parqueadero?', info)).toBeNull()
    expect(respuestaFija(`¿a qué hora abren? ${'x'.repeat(80)}`, info)).toBeNull()
  })
})
