import type { Clasificacion } from './clasificacion.js'
import type { BorradorReserva, DatoReserva } from './contexto.js'

// Piezas puras de la reserva, compartidas por la política (¿el "sí" crea?) y el
// agente de Reservas (¿qué falta preguntar?). Sin LLM ni BD: todo con pruebas.

/**
 * La hora como la entiende el restaurante. Se reserva de 12:00 a 21:30, así que
 * "a las 7" es 19:00 (regla del prompt de n8n, ahora en código): de 1 a 9 se
 * suman 12. 10 y 11 se dejan: la RPC dirá que está fuera de horario.
 */
export function normalizarHora(h: string | null | undefined): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec((h ?? '').trim())
  if (!m) return undefined
  let hh = Number(m[1])
  const mm = Number(m[2] ?? 0)
  if (hh > 23 || mm > 59) return undefined
  if (hh >= 1 && hh <= 9) hh += 12
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const huella = (b: BorradorReserva) => `${b.fecha}|${b.hora}|${b.personas}`

/** Lo que el mensaje trae de la reserva, sobre lo que ya había. Cambiar día, hora o personas invalida la disponibilidad. */
export function mezclar(b: BorradorReserva | null | undefined, c: Clasificacion): BorradorReserva {
  const nuevo: BorradorReserva = { ...(b ?? {}) }
  if (c.personas) nuevo.personas = c.personas
  if (c.fecha && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) nuevo.fecha = c.fecha
  const hora = normalizarHora(c.hora)
  if (hora) nuevo.hora = hora
  if (nuevo.verificado && nuevo.verificado !== huella(nuevo)) delete nuevo.verificado
  return nuevo
}

/** El mensaje cambia algo de lo que se le mostró ("sí, pero a las 8"). */
export function cambiaLaReserva(c: Clasificacion, b: BorradorReserva | null | undefined): boolean {
  if (!b) return false
  const hora = normalizarHora(c.hora)
  return (!!c.personas && c.personas !== b.personas) || (!!c.fecha && c.fecha !== b.fecha) || (!!hora && hora !== b.hora)
}

/** Completo, con disponibilidad confirmada para ESTOS datos y la ocasión elegida: se puede resumir y crear. */
export const borradorListo = (b: BorradorReserva | null | undefined): b is Required<BorradorReserva> =>
  !!b && !!b.personas && !!b.fecha && !!b.hora && !!b.motivo && b.verificado === huella(b)

export const marcarVerificado = (b: BorradorReserva): BorradorReserva => ({ ...b, verificado: huella(b) })

/** Qué falta, en el orden del prompt de n8n: personas → día → hora → (disponibilidad) → ocasión. */
export function faltaReserva(b: BorradorReserva): DatoReserva | 'disponibilidad' | null {
  if (!b.personas) return 'personas'
  if (!b.fecha) return 'fecha'
  if (!b.hora) return 'hora'
  if (b.verificado !== huella(b)) return 'disponibilidad'
  if (!b.motivo) return 'motivo'
  return null
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const NINGUNA = /\b(ninguna?|normal|nada|sin ocasion|no gracias|solo (la )?mesa|ningun)\b|^no\b/

export type MotivoReserva = { clave: string; nombre: string; descripcion: string | null; costo: number }

/**
 * La ocasión que nombra el cliente, contra las vigentes de `motivos_reserva`
 * (las edita el restaurante: nada escrito aquí). Coincide si alguna palabra del
 * mensaje empieza como una palabra del nombre ("cumple" ~ "Cumpleaños",
 * "propuesta" ~ "Declaración / propuesta"). `sinOcasion` = dijo que ninguna.
 */
export function emparejarMotivo(texto: string, motivos: MotivoReserva[], preguntado: boolean): MotivoReserva | 'sin_ocasion' | null {
  const t = sinTildes(texto)
  const palabras = t.split(/[^\p{L}]+/u).filter((w) => w.length >= 4)
  const hallados = motivos.filter((m) => m.clave !== 'sin_ocasion').filter((m) =>
    sinTildes(m.nombre)
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length >= 4)
      .some((raiz) => palabras.some((w) => w.startsWith(raiz.slice(0, 5)) || raiz.startsWith(w.slice(0, 5)))),
  )
  if (hallados.length === 1) return hallados[0]!
  if (hallados.length > 1) return null // "cumpleaños y grado": que elija
  return preguntado && NINGUNA.test(t) ? 'sin_ocasion' : null
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-10-03' → 'Sábado 3 de octubre' (sin zonas horarias: es una fecha de calendario). */
export function fechaLegible(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  const dia = DIAS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!
  return `${dia[0]!.toUpperCase()}${dia.slice(1)} ${d} de ${MESES[m! - 1]}`
}

/** '19:00' → '7:00 PM' */
export function horaLegible(h: string): string {
  const [hh, mm] = h.split(':').map(Number)
  const suf = hh! >= 12 ? 'PM' : 'AM'
  return `${hh! % 12 || 12}:${String(mm).padStart(2, '0')} ${suf}`
}
