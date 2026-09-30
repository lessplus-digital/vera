import { describe, expect, it } from 'vitest'
import { clasificacionVacia } from '../../src/decision/clasificacion.js'
import {
  borradorListo,
  cambiaLaReserva,
  emparejarMotivo,
  faltaReserva,
  fechaLegible,
  horaLegible,
  marcarVerificado,
  mezclar,
  normalizarHora,
  type MotivoReserva,
} from '../../src/decision/reserva.js'

// Las piezas puras de la reserva: lo que en n8n eran reglas del prompt
// ("a las 7 = 19:00", "fechas legibles", "pregunta la ocasión antes de crear").

const MOTIVOS: MotivoReserva[] = [
  { clave: 'sin_ocasion', nombre: 'Sin ocasión especial', descripcion: null, costo: 0 },
  { clave: 'cumpleanos', nombre: 'Cumpleaños', descripcion: null, costo: 80000 },
  { clave: 'grado', nombre: 'Grado', descripcion: null, costo: 90000 },
  { clave: 'aniversario', nombre: 'Aniversario', descripcion: null, costo: 120000 },
  { clave: 'declaracion', nombre: 'Declaración / propuesta', descripcion: null, costo: 150000 },
  { clave: 'empresarial', nombre: 'Evento empresarial', descripcion: null, costo: 200000 },
]

describe('normalizarHora', () => {
  it.each([
    ['7', '19:00'],
    ['07:00', '19:00'],
    ['7:30', '19:30'],
    ['19:00', '19:00'],
    ['12:00', '12:00'],
    ['12:30', '12:30'],
    ['11:00', '11:00'], // fuera de horario: lo dirá la BD
    ['25:00', undefined],
    ['mañana', undefined],
    [null, undefined],
  ])('%s → %s', (h, esperado) => {
    expect(normalizarHora(h)).toBe(esperado)
  })
})

describe('borrador', () => {
  it('mezclar suma lo nuevo; cambiar día, hora o personas invalida la disponibilidad verificada', () => {
    const b = marcarVerificado({ personas: 4, fecha: '2026-10-03', hora: '19:00', motivo: 'cumpleanos' })
    expect(borradorListo(b)).toBe(true)
    const otra = mezclar(b, clasificacionVacia({ hora: '8' }))
    expect(otra).toEqual({ personas: 4, fecha: '2026-10-03', hora: '20:00', motivo: 'cumpleanos' })
    expect(borradorListo(otra)).toBe(false)
    expect(faltaReserva(otra)).toBe('disponibilidad')
    // Repetir lo mismo no invalida nada.
    expect(borradorListo(mezclar(b, clasificacionVacia({ hora: '7', personas: 4 })))).toBe(true)
  })

  it('faltaReserva: personas → fecha → hora → disponibilidad → ocasión', () => {
    expect(faltaReserva({})).toBe('personas')
    expect(faltaReserva({ personas: 2 })).toBe('fecha')
    expect(faltaReserva({ personas: 2, fecha: '2026-10-03' })).toBe('hora')
    expect(faltaReserva({ personas: 2, fecha: '2026-10-03', hora: '19:00' })).toBe('disponibilidad')
    expect(faltaReserva(marcarVerificado({ personas: 2, fecha: '2026-10-03', hora: '19:00' }))).toBe('motivo')
    expect(faltaReserva(marcarVerificado({ personas: 2, fecha: '2026-10-03', hora: '19:00', motivo: 'sin_ocasion' }))).toBeNull()
  })

  it('cambiaLaReserva: solo cuenta lo que es distinto de lo resumido', () => {
    const b = { personas: 4, fecha: '2026-10-03', hora: '19:00' }
    expect(cambiaLaReserva(clasificacionVacia({ hora: '7' }), b)).toBe(false)
    expect(cambiaLaReserva(clasificacionVacia({ hora: '8' }), b)).toBe(true)
    expect(cambiaLaReserva(clasificacionVacia({ personas: 5 }), b)).toBe(true)
    expect(cambiaLaReserva(clasificacionVacia({ fecha: '2026-10-04' }), b)).toBe(true)
    expect(cambiaLaReserva(clasificacionVacia({ hora: '8' }), null)).toBe(false)
  })
})

describe('emparejarMotivo (contra motivos_reserva, sin nada escrito a mano)', () => {
  it.each([
    ['es el cumple de mi novia', 'cumpleanos'],
    ['cumpleaños', 'cumpleanos'],
    ['para un aniversario', 'aniversario'],
    ['le voy a pedir que se case, una propuesta', 'declaracion'],
    ['es una declaración', 'declaracion'],
    ['celebramos el grado de mi hija', 'grado'],
    ['un evento de la empresa', 'empresarial'],
  ])('"%s" → %s', (t, clave) => {
    expect((emparejarMotivo(t, MOTIVOS, false) as MotivoReserva).clave).toBe(clave)
  })

  it('"normal" / "no" solo cuentan como respuesta a la pregunta de la ocasión', () => {
    expect(emparejarMotivo('no, normal', MOTIVOS, true)).toBe('sin_ocasion')
    expect(emparejarMotivo('ninguna', MOTIVOS, true)).toBe('sin_ocasion')
    expect(emparejarMotivo('no, normal', MOTIVOS, false)).toBeNull()
  })

  it('sin coincidencia o con dos ocasiones → null (se pregunta)', () => {
    expect(emparejarMotivo('para 4 personas el sábado', MOTIVOS, false)).toBeNull()
    expect(emparejarMotivo('me siento agradecido', MOTIVOS, false)).toBeNull()
    expect(emparejarMotivo('cumpleaños y grado', MOTIVOS, false)).toBeNull()
  })
})

describe('fechas y horas legibles', () => {
  it('"2026-10-03" → "Sábado 3 de octubre", "19:00" → "7:00 PM"', () => {
    expect(fechaLegible('2026-10-03')).toBe('Sábado 3 de octubre')
    expect(fechaLegible('2026-12-31')).toBe('Jueves 31 de diciembre')
    expect(horaLegible('19:00')).toBe('7:00 PM')
    expect(horaLegible('12:30')).toBe('12:30 PM')
  })
})
