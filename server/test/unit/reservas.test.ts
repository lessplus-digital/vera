import { describe, expect, it } from 'vitest'
import { EntornoSim } from '../../src/sim/entorno.js'
import { FakeLLM } from '../../src/llm/llm.js'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import { R, REGLAS_RESERVA, confirmarCancelar, preguntaMotivo } from '../../src/handlers/reservas.js'
import * as T from '../../src/textos.js'

// El agente de Reservas dentro del simulador. Se prueba el CÓDIGO: una pregunta
// a la vez sobre el borrador guardado, la disponibilidad consultada antes de
// seguir, la ocasión y su costo desde motivos_reserva, el resumen, y que la
// reserva la cree el ejecutor SOLO con el "sí". El LLM (de guion) pone la frase de enlace.

const TEL = '573000000910'
// Miércoles 30 de septiembre, 10:00 en Colombia.
const AHORA = new Date('2026-09-30T15:00:00Z')
const SABADO = '2026-10-03'

function montar(enlace = '') {
  let cl: Partial<Clasificacion> = {}
  const llm = new FakeLLM((nombre) => (nombre === 'clasificacion' ? clasificacionVacia(cl) : { texto: enlace }))
  const sim = new EntornoSim({ llm, redactores: 'agentes' })
  sim.repo.ahora = () => AHORA
  const turno = async (texto: string, c: Partial<Clasificacion>) => {
    cl = c
    const antes = sim.wa.textosPara(TEL).length
    await sim.enviarTexto(TEL, texto)
    await sim.esperar()
    return { r: sim.wa.textosPara(TEL).slice(antes).join('\n'), registro: sim.registro.turnos.at(-1)! }
  }
  const conv = () => sim.repo.leerConversacion(TEL)
  return { sim, turno, conv }
}

async function conNombre(sim: EntornoSim) {
  await sim.repo.clientePorTelefono(TEL)
  sim.repo.clientes.get(TEL)!.nombre = 'Ana María'
}

describe('reserva nueva de punta a punta', () => {
  it('una pregunta a la vez, cupo verificado, ocasión con su costo, resumen y la crea el "sí"', async () => {
    const { sim, turno, conv } = montar()
    await conNombre(sim)

    let t = await turno('quiero reservar una mesa', { intencion: 'reserva_nueva' })
    expect(t.r).toBe(R.personas)
    expect((await conv()).ultima_pregunta).toEqual({ tipo: 'dato_reserva', dato: 'personas' })

    t = await turno('somos 4', { intencion: 'otro', personas: 4 })
    expect(t.registro.decision).toMatchObject({ handler: 'reservas', regla: 'dato_reserva' })
    expect(t.r).toBe(R.fecha)

    t = await turno('el sábado', { intencion: 'otro', fecha: SABADO })
    expect(t.r).toBe(R.hora)

    t = await turno('a las 7', { intencion: 'otro', hora: '07:00' })
    expect(t.r).toBe(preguntaMotivo(sim.repo.motivos))
    expect((await conv()).reserva).toEqual({ personas: 4, fecha: SABADO, hora: '19:00', verificado: `${SABADO}|19:00|4` })

    t = await turno('es el cumple de mi novia', { intencion: 'otro' })
    expect(t.r).toBe(
      'Listo Ana, te confirmo:\n\n📅 Sábado 3 de octubre\n🕐 7:00 PM\n👥 4 personas\n🎉 Cumpleaños — $80.000 (se paga en el local)\n\n¿Te la reservo?',
    )
    expect((await conv()).ultima_pregunta).toEqual({ tipo: 'confirmar_reserva' })
    expect(sim.repo.reservas).toHaveLength(0) // mostrar el resumen no crea nada

    t = await turno('sí, dale', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(t.registro.decision).toMatchObject({ regla: 'reserva:si', acciones: [{ tipo: 'crear_reserva' }] })
    expect(sim.repo.reservas).toMatchObject([{ fecha: SABADO, hora: '19:00', personas: 4, motivo: 'cumpleanos', costo_motivo: 80000 }])
    expect(t.r).toBe(T.reservaCreada({ reserva_id: 'x', fecha: SABADO, hora: '19:00', personas: 4, costo_motivo: 80000 }, 'Cumpleaños'))
    expect(await conv()).toMatchObject({ reserva: null, ultima_pregunta: null })
  })

  it('todo en un mensaje: salta directo a la ocasión; "no, normal" = sin ocasión y sin línea de costo', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    let t = await turno('reserva para 2 el sábado a las 8', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '20:00' })
    expect(t.r).toBe(preguntaMotivo(sim.repo.motivos))
    t = await turno('no, normal', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r).toContain('👥 2 personas\n\n¿Te la reservo?')
    expect(t.r).not.toContain('🎉')
  })

  it('"sí, pero a las 8" al resumen NO crea: vuelve a consultar y resume con la hora nueva', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    await turno('reserva para 2 el sábado a las 7 para un aniversario', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '19:00' })
    const t = await turno('sí, pero a las 8', { intencion: 'respuesta_corta', confirma: 'si', hora: '20:00' })
    expect(sim.repo.reservas).toHaveLength(0)
    expect(t.r).toContain('🕐 8:00 PM')
    expect(t.r).toContain('🎉 Aniversario — $120.000')
    expect(t.registro.herramientas.map((h) => h.nombre)).toContain('consultar_disponibilidad_reserva')
  })

  it('"no" al resumen → qué cambiar, sin perder el borrador', async () => {
    const { sim, turno, conv } = montar()
    await conNombre(sim)
    await turno('reserva para 2 el sábado a las 7, normal', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '19:00' })
    await turno('no, normal', { intencion: 'respuesta_corta', confirma: 'no' })
    const t = await turno('no', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r).toBe(R.queCambiar)
    expect((await conv()).reserva).toMatchObject({ personas: 2, fecha: SABADO, hora: '19:00', motivo: 'sin_ocasion' })
  })
})

describe('lo que decide la BD', () => {
  it('sin mesas a esa hora → pide otra hora (la del borrador se borra)', async () => {
    const { sim, turno, conv } = montar()
    await conNombre(sim)
    for (let i = 0; i < 8; i++) {
      sim.repo.reservas.push({ reserva_id: `R${i}`, telefono: `57300000099${i}`, fecha: SABADO, hora: '19:00', personas: 2, motivo: null, costo_motivo: 0, estado: 'confirmada' })
    }
    const t = await turno('reserva para 2 el sábado a las 7', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '19:00' })
    expect(t.r).toBe(R.otraHora)
    expect((await conv()).reserva).toEqual({ personas: 2, fecha: SABADO })
  })

  it('fuera de horario → el mensaje de la BD y la pregunta de la hora', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    const t = await turno('reserva para 2 el sábado a las 11 de la noche', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '23:00' })
    expect(t.r).toBe(`Ese día se reserva de 12:00 a 21:30.\n\n${R.hora}`)
  })

  it('más de 12 personas → ofrece al equipo (y el "sí" lo pasa la política)', async () => {
    const { sim, turno, conv } = montar()
    await conNombre(sim)
    let t = await turno('reserva para 20 personas', { intencion: 'reserva_nueva', personas: 20 })
    expect(t.r).toBe(R.grupoGrande)
    expect((await conv()).ultima_pregunta).toEqual({ tipo: 'ofrecer_humano' })
    t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(t.r).toBe(T.HANDOFF)
  })

  it('se ocupó la franja entre el resumen y el "sí" → no se crea, pide otra hora', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    await turno('reserva para 2 el sábado a las 7, normal', { intencion: 'reserva_nueva', personas: 2, fecha: SABADO, hora: '19:00' })
    await turno('ninguna', { intencion: 'respuesta_corta', confirma: 'no' })
    for (let i = 0; i < 8; i++) {
      sim.repo.reservas.push({ reserva_id: `R${i}`, telefono: `57300000099${i}`, fecha: SABADO, hora: '19:00', personas: 2, motivo: null, costo_motivo: 0, estado: 'confirmada' })
    }
    const t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.reservas.filter((r) => r.telefono === TEL)).toHaveLength(0)
    expect(t.r).toContain('justo se ocuparon las mesas')
    expect(t.r.endsWith(R.hora)).toBe(true)
  })
})

describe('consultar y cancelar', () => {
  const dos = (sim: EntornoSim) => {
    sim.repo.reservas.push(
      { reserva_id: 'RES-1', telefono: TEL, fecha: SABADO, hora: '19:00', personas: 4, motivo: 'sin_ocasion', costo_motivo: 0, estado: 'confirmada' },
      { reserva_id: 'RES-2', telefono: TEL, fecha: '2026-10-04', hora: '13:00', personas: 2, motivo: 'sin_ocasion', costo_motivo: 0, estado: 'confirmada' },
    )
  }

  it('"¿tengo reserva?" lista las confirmadas', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    dos(sim)
    const t = await turno('tengo reserva?', { intencion: 'reserva_consultar' })
    expect(t.r).toBe('Tienes estas reservas:\n📅 Sábado 3 de octubre — 7:00 PM · 👥 4\n📅 Domingo 4 de octubre — 1:00 PM · 👥 2')
  })

  it('varias → "¿cuál?"; "la 2" → confirmación; "sí" → la cancela el código', async () => {
    const { sim, turno, conv } = montar()
    await conNombre(sim)
    dos(sim)
    let t = await turno('quiero cancelar mi reserva', { intencion: 'reserva_cancelar' })
    expect(t.r.endsWith(R.cualCancelar)).toBe(true)
    t = await turno('la 2', { intencion: 'otro' })
    expect(t.r).toBe(confirmarCancelar(sim.repo.reservas[1]!))
    expect((await conv()).ultima_pregunta).toEqual({ tipo: 'cancelar_reserva', reserva_id: 'RES-2' })
    t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.reservas.map((r) => r.estado)).toEqual(['confirmada', 'cancelada'])
    expect(t.r).toBe(T.reservaCancelada({ fecha: '2026-10-04', hora: '13:00' }))
  })

  it('"no" a "¿seguro que cancelo?" → sigue en pie', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    sim.repo.reservas.push({ reserva_id: 'RES-1', telefono: TEL, fecha: SABADO, hora: '19:00', personas: 4, motivo: null, costo_motivo: 0, estado: 'confirmada' })
    await turno('cancela mi reserva', { intencion: 'reserva_cancelar' })
    const t = await turno('no, déjala', { intencion: 'respuesta_corta', confirma: 'no' })
    expect(t.r).toBe(R.noCancelar)
    expect(sim.repo.reservas[0]!.estado).toBe('confirmada')
  })

  it('una reserva ajena no se cancela (RESERVA_NO_ENCONTRADA)', async () => {
    const { sim, turno } = montar()
    await conNombre(sim)
    sim.repo.reservas.push({ reserva_id: 'RES-9', telefono: '573000000999', fecha: SABADO, hora: '19:00', personas: 4, motivo: null, costo_motivo: 0, estado: 'confirmada' })
    await sim.repo.guardarConversacion(TEL, { handler: 'reservas', ultima_pregunta: { tipo: 'cancelar_reserva', reserva_id: 'RES-9' } })
    const t = await turno('sí', { intencion: 'respuesta_corta', confirma: 'si' })
    expect(sim.repo.reservas[0]!.estado).toBe('confirmada')
    expect(t.r).toContain(R.reservaNoEncontrada)
  })
})

describe('la frase del modelo', () => {
  it('no puede preguntar ni prometer: se le quitan las preguntas y la guardia revisa precios', async () => {
    const { sim, turno } = montar('¡Qué bien! ¿Para qué hora?')
    await conNombre(sim)
    const t = await turno('quiero reservar', { intencion: 'reserva_nueva' })
    expect(t.r).toBe(`¡Qué bien!\n\n${R.personas}`)
  })
})

describe('Fase 6: lo que destapó G9', () => {
  it('"mejor olvídalo" con una reserva a medio armar suelta el borrador (no busca reservas para cancelar)', async () => {
    const { sim, turno, conv } = montar('esto no debía salir')
    await conNombre(sim)
    await turno('quiero reservar para 4 el sábado', { intencion: 'reserva_nueva', personas: 4, fecha: SABADO })
    expect((await conv()).reserva).toMatchObject({ personas: 4, fecha: SABADO })
    const t = await turno('mejor olvídalo', { intencion: 'reserva_cancelar' })
    expect(t.r).toBe(R.borradorDescartado)
    expect((await conv()).reserva ?? null).toBeNull()
  })

  it('consultar y cancelar los contesta el código, sin frase del modelo encima', async () => {
    const { sim, turno } = montar('Por ahora no tengo ninguna reserva activa 😊')
    await conNombre(sim)
    expect((await turno('¿tengo reservas?', { intencion: 'reserva_consultar' })).r).toBe(R.sinReservas)
    expect((await turno('cancela mi reserva', { intencion: 'reserva_cancelar' })).r).toBe(R.sinReservasCancelar)
  })

  it('un rechazo de la BD va sin frase del modelo (la repetía)', async () => {
    const { sim, turno } = montar('Te cuento que ese día reservamos de 12 a 9:30 pm.')
    await conNombre(sim)
    const t = await turno('para 4 el sábado a las 11 de la noche', { intencion: 'reserva_nueva', personas: 4, fecha: SABADO, hora: '23:00' })
    expect(t.r).not.toContain('Te cuento')
    expect(t.r).toContain('21:30')
  })

  it('las reglas de reserva van en el contexto del modelo', async () => {
    let contexto = ''
    const llm = new FakeLLM((nombre, mensajes) => {
      if (nombre === 'clasificacion') return clasificacionVacia({ intencion: 'reserva_nueva' })
      contexto = mensajes.map((m) => m.texto).join('\n')
      return { texto: '' }
    })
    const sim = new EntornoSim({ llm, redactores: 'agentes' })
    sim.repo.ahora = () => AHORA
    await conNombre(sim)
    await sim.enviarTexto(TEL, '¿puedo reservar para dentro de 3 meses?')
    await sim.esperar()
    for (const r of REGLAS_RESERVA) expect(contexto).toContain(r)
  })
})

describe('cancelar una reserva nombrada que no es suya (BUG-005/009)', () => {
  it('"cancela la RES-001" sin ser suya → "no encontré esa reserva", y el borrador sigue', async () => {
    const { sim, turno, conv } = montar('esto no debía salir')
    await conNombre(sim)
    sim.repo.reservas.push({ reserva_id: 'RES-001', telefono: '573000000999', fecha: SABADO, hora: '19:00', personas: 2, motivo: 'sin_ocasion', costo_motivo: 0, estado: 'confirmada' })
    await turno('quiero reservar para 4 el sábado', { intencion: 'reserva_nueva', personas: 4, fecha: SABADO })
    const t = await turno('cancela la reserva RES-001', { intencion: 'reserva_cancelar' })
    expect(t.r).toBe(R.reservaNoEncontrada)
    expect(t.r).not.toContain('19:00')
    expect((await conv()).reserva).toMatchObject({ personas: 4 })
    expect(sim.repo.reservas[0]!.estado).toBe('confirmada')
  })
})
