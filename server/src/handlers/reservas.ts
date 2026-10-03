import { z } from 'zod'
import type { MotivoReserva, Repo, Reserva } from '../bd/repo.js'
import type { LLM, MensajeLLM } from '../llm/llm.js'
import type { Turno } from '../log/turnos.js'
import type { EntradaRedactor, Redaccion, Redactor } from '../decision/conversador.js'
import type { BorradorReserva, UltimaPregunta } from '../decision/contexto.js'
import {
  emparejarMotivo,
  faltaReserva,
  fechaLegible,
  horaLegible,
  marcarVerificado,
  mezclar,
} from '../decision/reserva.js'
import { pesos } from '../guardia/guardia.js'
import { contextoComun, primerNombre, reescritura } from './comun.js'
import { sinPreguntas } from './pedidos.js'

// AGENTE RESERVAS. Portado del prompt de n8n (versión 1d7f7d87), pero el flujo
// que allí era una lista de reglas en texto aquí es código:
//  - qué preguntar (personas → día → hora → ocasión) lo dice `faltaReserva`
//    sobre el borrador guardado en conversaciones.reserva, UNA pregunta por mensaje;
//  - la disponibilidad la consulta el código antes de seguir (el prompt pedía
//    "consulta ANTES de proponer" y dependía de que el modelo lo hiciera), y
//    sus errores (fecha pasada, fuera de horario, >14 días) se dicen con el
//    mensaje de la BD;
//  - la ocasión se empareja en código contra motivos_reserva, y su costo sale
//    de ahí: el modelo no puede inventarlo ni multiplicarlo por personas;
//  - el resumen lo arma el código y deja la pregunta confirmar_reserva; la
//    reserva la crea el ejecutor con el "sí" (regla reserva:si), nunca este handler.
// El LLM solo escribe una frase de enlace encima, como en Pedidos.

export const R = {
  personas: '¿Para cuántas personas sería la reserva? 😊',
  fecha: '¿Para qué día la quieres?',
  hora: '¿A qué hora te gustaría llegar?',
  otraHora: 'Para ese horario ya no tenemos mesas 😔 ¿Quieres probar a otra hora ese mismo día?',
  grupoGrande:
    'Por WhatsApp reservamos para máximo 12 personas; los grupos más grandes los atiende directamente el equipo. ¿Quieres que te conecte con ellos?',
  queCambiar: '¿Qué te gustaría cambiar? (día, hora, personas u ocasión)',
  noCancelar: 'Listo, tu reserva sigue en pie 😊',
  sinReservas: 'No tienes reservas activas por ahora. ¿Quieres hacer una? 😊',
  sinReservasCancelar: 'No encontré reservas activas a tu número 🤔',
  cualCancelar: '¿Cuál quieres cancelar?',
  reservaNoEncontrada: 'No encontré esa reserva activa 🤔',
  confirmar: '¿Te la reservo?',
  borradorDescartado: 'Listo, dejé esa reserva de lado 👌 Si quieres armar otra, me dices.',
} as const

/**
 * Las reglas que aplica consultar_disponibilidad_reserva (batería qa/sql/12), para
 * que el modelo pueda contestar "¿puedo reservar para dentro de 3 meses?" sin
 * inventar (2026-10-02: contestó "claro que puedes, sin lío"). Si cambian en la BD,
 * cambian aquí: la BD sigue siendo quien rechaza.
 */
export const REGLAS_RESERVA = [
  'Por WhatsApp se reserva para 1 a 12 personas; los grupos más grandes los atiende el equipo.',
  'Máximo 14 días de anticipación.',
  'Para el mismo día, mínimo 5 horas antes.',
  'Lunes a viernes de 12:00 a 20:30; sábados y domingos de 12:00 a 21:30 (hora de llegada).',
]

export function preguntaMotivo(motivos: MotivoReserva[]): string {
  const ocasiones = motivos.filter((m) => m.clave !== 'sin_ocasion').map((m) => m.nombre.toLowerCase())
  const lista = ocasiones.length > 1 ? `${ocasiones.slice(0, -1).join(', ')} y ${ocasiones.at(-1)}` : (ocasiones[0] ?? '')
  return lista
    ? `¿Es para alguna ocasión especial? Tenemos montaje para ${lista}, o la dejamos como reserva normal 😊`
    : '¿Es para alguna ocasión especial?'
}

export const confirmarCancelar = (r: Reserva) => `¿Seguro que cancelo tu reserva del ${fechaLegible(r.fecha)} a las ${horaLegible(r.hora)}?`

const lineaReserva = (r: Reserva, i?: number) =>
  `${i != null ? `${i + 1}. ` : ''}📅 ${fechaLegible(r.fecha)} — ${horaLegible(r.hora)} · 👥 ${r.personas}`

export function bloqueResumenReserva(b: Required<BorradorReserva>, motivo: MotivoReserva | undefined, nombre: string | null): string {
  const montaje = motivo && motivo.costo > 0 ? `\n🎉 ${motivo.nombre} — ${pesos(motivo.costo)} (se paga en el local)` : ''
  return `${nombre ? `Listo ${nombre}, te` : 'Te'} confirmo:\n\n📅 ${fechaLegible(b.fecha)}\n🕐 ${horaLegible(b.hora)}\n👥 ${b.personas} ${
    b.personas === 1 ? 'persona' : 'personas'
  }${montaje}\n\n${R.confirmar}`
}

type Plan = {
  avisos: string[]
  cierre: string
  pregunta: UltimaPregunta | null
  montos: number[]
  hechos: string[]
  /** undefined = este turno no tocó el borrador (consultar / cancelar). */
  reserva?: BorradorReserva | null
  /** El código ya dice todo (consultar, cancelar): no se llama al modelo; su frase lo repetía. */
  fijo?: boolean
}

/** Qué dato limpiar y volver a preguntar según el error de disponibilidad. */
const CAMPO_DE_ERROR: Record<string, 'fecha' | 'hora' | 'personas'> = {
  FECHA_PASADA: 'hora',
  MUY_LEJOS: 'fecha',
  FUERA_DE_HORARIO: 'hora',
  POCA_ANTICIPACION: 'hora',
  PERSONAS_FUERA_DE_RANGO: 'personas',
  SIN_CUPO: 'hora',
}

export async function planificar(repo: Repo, e: EntradaRedactor): Promise<Plan> {
  const tel = e.turno.telefono
  const c = e.clasificacion
  const ultima = e.conversacion.ultima_pregunta
  const plan: Plan = { avisos: [], cierre: '', pregunta: null, montos: [], hechos: [] }
  const cierra = (cierre: string, pregunta: UltimaPregunta | null = null) => Object.assign(plan, { cierre, pregunta })

  // ── Cancelar ─────────────────────────────────────────────────────────────
  if (e.decision.regla === 'cancelar_reserva:no') return cierra(R.noCancelar)
  const cancelando = c.intencion === 'reserva_cancelar' || ultima?.tipo === 'elegir_reserva'
  if (cancelando || e.efectos.errorReserva === 'RESERVA_NO_ENCONTRADA' || e.efectos.errorReserva === 'RESERVA_YA_CANCELADA') {
    plan.fijo = true
    const lista = await repo.reservasDelCliente(tel)
    if (e.efectos.errorReserva?.startsWith('RESERVA_')) plan.avisos.push(R.reservaNoEncontrada)
    // Nombró una reserva concreta ("cancela la RES-001") que no está entre las suyas: se le dice
    // eso, sin soltar el borrador ni dar pistas de reservas ajenas (BUG-005/009).
    const nombrada = e.texto.match(/\bRES-[\w-]+/i)?.[0]?.toUpperCase()
    if (nombrada && !lista.some((r) => r.reserva_id.toUpperCase() === nombrada)) {
      plan.reserva = undefined
      return cierra(lista.length ? `${R.reservaNoEncontrada}\n\nTienes estas reservas:\n${lista.map(lineaReserva).join('\n')}` : R.reservaNoEncontrada)
    }
    // "Mejor olvídalo" con una reserva a medio armar y ninguna creada: es soltar el borrador.
    if (!lista.length && e.conversacion.reserva && !e.efectos.errorReserva) {
      plan.reserva = null
      return cierra(R.borradorDescartado)
    }
    if (!lista.length) return cierra(e.efectos.errorReserva ? R.sinReservas : R.sinReservasCancelar)
    const elegida = elegirReserva(lista, c.fecha, c.hora, ultima?.tipo === 'elegir_reserva' ? e.texto : null)
    if (elegida) return cierra(confirmarCancelar(elegida), { tipo: 'cancelar_reserva', reserva_id: elegida.reserva_id })
    return cierra(`Tienes estas reservas:\n${lista.map(lineaReserva).join('\n')}\n\n${R.cualCancelar}`, { tipo: 'elegir_reserva' })
  }

  // ── Consultar ────────────────────────────────────────────────────────────
  if (c.intencion === 'reserva_consultar') {
    plan.fijo = true
    const lista = await repo.reservasDelCliente(tel)
    for (const r of lista) plan.montos.push(r.costo_motivo)
    return cierra(lista.length ? `Tienes ${lista.length === 1 ? 'esta reserva' : 'estas reservas'}:\n${lista.map((r) => lineaReserva(r)).join('\n')}` : R.sinReservas)
  }

  // ── Nueva (o seguir la que está a medio armar) ───────────────────────────
  const motivos = await repo.motivosReserva()
  plan.montos.push(...motivos.map((m) => m.costo))
  let b = mezclar(e.conversacion.reserva, c)
  plan.reserva = b

  if (e.decision.regla === 'reserva:no') return cierra(R.queCambiar)

  // El "sí" no alcanzó a crearla: la BD dijo por qué (se ocupó la franja, ya pasó la hora…).
  const err = e.efectos.errorReserva
  if (err && err !== 'SIN_BORRADOR') {
    const campo = CAMPO_DE_ERROR[err]
    if (campo) b = sinCampo(b, campo)
    if (err === 'MOTIVO_INVALIDO') delete b.motivo
    plan.hechos.push(`Al confirmar, la reserva NO se pudo crear (${err}). No digas que quedó reservada.`)
    plan.avisos.push(err === 'SIN_CUPO' ? 'Uy, justo se ocuparon las mesas a esa hora 😔' : 'Uy, no pude dejarla reservada así 😔')
  }

  // Más de 12: por WhatsApp no (regla del restaurante, también en la RPC).
  if (c.personas && c.personas > 12) {
    plan.reserva = sinCampo(b, 'personas')
    return cierra(R.grupoGrande, { tipo: 'ofrecer_humano' })
  }

  // La ocasión: si la nombra (aunque no se le haya preguntado) se toma; "normal" solo cuenta como respuesta.
  const preguntado = ultima?.tipo === 'dato_reserva' && ultima.dato === 'motivo'
  const m = emparejarMotivo(e.texto, motivos, preguntado)
  if (m) b.motivo = m === 'sin_ocasion' ? 'sin_ocasion' : m.clave
  const motivo = motivos.find((x) => x.clave === b.motivo)
  if (m && m !== 'sin_ocasion') plan.hechos.push(`Ocasión: ${m.nombre}${m.costo ? `, montaje de ${pesos(m.costo)} por la reserva (no por persona), se paga en el local` : ''}.`)

  let falta = faltaReserva(b)
  if (falta === 'disponibilidad') {
    const d = await e.turno.herramienta('consultar_disponibilidad_reserva', { fecha: b.fecha, hora: b.hora, personas: b.personas }, () =>
      repo.consultarDisponibilidadReserva(b.fecha!, b.hora!, b.personas!),
    )
    if (d.ok && d.disponible) {
      b = marcarVerificado(b)
      plan.hechos.push(`Hay mesa el ${fechaLegible(b.fecha!)} a las ${horaLegible(b.hora!)} para ${b.personas}.`)
    } else if (d.ok) {
      b = sinCampo(b, 'hora')
      plan.hechos.push('NO hay mesas a esa hora.')
      plan.reserva = b
      return cierra(R.otraHora, { tipo: 'dato_reserva', dato: 'hora' })
    } else {
      const campo = CAMPO_DE_ERROR[String(d.error)] ?? 'hora'
      if (campo === 'personas') {
        plan.reserva = sinCampo(b, 'personas')
        return cierra(R.grupoGrande, { tipo: 'ofrecer_humano' })
      }
      b = sinCampo(b, campo)
      plan.hechos.push(`No se puede reservar así: ${String(d.message ?? d.error)}`)
      plan.avisos.push(String(d.message ?? 'Esa fecha u hora no se puede reservar.'))
    }
    falta = faltaReserva(b)
  }
  plan.reserva = b

  switch (falta) {
    case 'personas':
      return cierra(R.personas, { tipo: 'dato_reserva', dato: 'personas' })
    case 'fecha':
      return cierra(R.fecha, { tipo: 'dato_reserva', dato: 'fecha' })
    case 'hora':
      return cierra(R.hora, { tipo: 'dato_reserva', dato: 'hora' })
    case 'motivo':
      return cierra(preguntaMotivo(motivos), { tipo: 'dato_reserva', dato: 'motivo' })
  }
  plan.hechos.push('Se le muestra el resumen para que confirme. La reserva TODAVÍA NO está creada.')
  return cierra(bloqueResumenReserva(b as Required<BorradorReserva>, motivo, primerNombre(e.cliente.nombre)), { tipo: 'confirmar_reserva' })
}

function sinCampo(b: BorradorReserva, campo: 'fecha' | 'hora' | 'personas'): BorradorReserva {
  const { [campo]: _fuera, verificado: _v, ...resto } = b
  return resto
}

/** La reserva que quiere cancelar: la única, la que coincide en día/hora, o la del número que eligió ("la 2"). */
export function elegirReserva(lista: Reserva[], fecha: string | null, hora: string | null, respuesta: string | null): Reserva | null {
  if (lista.length === 1) return lista[0]!
  const n = respuesta ? /^\D*(\d{1,2})\D*$/.exec(respuesta.trim())?.[1] : undefined
  if (n && lista[Number(n) - 1]) return lista[Number(n) - 1]!
  const coinciden = lista.filter((r) => (!fecha || r.fecha === fecha) && (!hora || r.hora === hora))
  return (fecha || hora) && coinciden.length === 1 ? coinciden[0]! : null
}

const PROMPT = `Eres el asistente de Vera Pizzería (Bello, Antioquia) gestionando reservas por WhatsApp. Hablas como una persona amable de la pizzería, en español de Colombia, cálido y directo.

Escribes SOLO la frase de arriba de un mensaje. Debajo, el código ya pega (tal cual) lo que ves en "LO QUE VA DEBAJO": la pregunta que toca o el resumen de la reserva. Tu frase es de enlace:
- Si el cliente acaba de dar un dato: un acuse corto ("¡Perfecto!", "Listo 👌", "¡Qué bien, un cumpleaños! 🎉").
- Si además preguntó algo que se responde con lo que ves aquí (las ocasiones y su descripción, los hechos del turno), respóndelo en una frase.
- Si no hace falta nada, devuelve texto vacío.

Reglas:
- Máximo 1–2 frases cortas, máximo 1 emoji.
- NO hagas preguntas: la pregunta ya va debajo y es UNA sola por mensaje.
- NO repitas lo que va debajo (ni el resumen, ni fechas, ni horas, ni la pregunta).
- NUNCA digas que la reserva quedó hecha, confirmada o apartada: eso lo dice el código cuando pasa.
- NUNCA digas que hay (o no hay) mesa si no está en los hechos de este turno.
- Precios: solo el costo de una ocasión tal como aparece en OCASIONES; es por reserva, NUNCA por persona. Nunca otro precio.
- Nunca menciones el sistema, herramientas, errores técnicos ni tu razonamiento.`

const Salida = z.object({ texto: z.string() })

export function crearRedactorReservas(d: { repo: Repo; llm: LLM }): Redactor {
  const planes = new WeakMap<Turno, Plan>()

  return async (e: EntradaRedactor): Promise<Redaccion> => {
    let plan = planes.get(e.turno)
    if (!plan) {
      plan = await planificar(d.repo, e)
      planes.set(e.turno, plan)
    }
    const debajo = [...plan.avisos, plan.cierre].filter(Boolean).join('\n\n')
    // Lo que el código ya explica completo (consultar, cancelar, un rechazo de la BD) va sin
    // frase del modelo: repetía lo de debajo ("reservamos de 12 a 9:30" + "se reserva de 12:00 a 21:30").
    if ((plan.fijo || plan.avisos.length) && !e.previo) {
      return {
        texto: debajo,
        pregunta: plan.pregunta,
        montos: plan.montos,
        ...(plan.reserva !== undefined ? { reserva: plan.reserva } : {}),
      }
    }
    const motivos = await d.repo.motivosReserva()
    const mensajes: MensajeLLM[] = [
      { rol: 'system', texto: PROMPT },
      {
        rol: 'user',
        texto: [
          contextoComun(e),
          `OCASIONES (montaje; costo fijo por reserva, se paga en el local):\n${motivos
            .filter((m) => m.clave !== 'sin_ocasion')
            .map((m) => `- ${m.nombre}: ${m.descripcion ?? ''} — ${pesos(m.costo)}`)
            .join('\n')}`,
          `REGLAS DE RESERVA (si pregunta por anticipación, personas u horario, contesta SOLO con esto):\n${REGLAS_RESERVA.map((r) => `- ${r}`).join('\n')}`,
          plan.hechos.length ? `Hechos de este turno:\n${plan.hechos.map((h) => `- ${h}`).join('\n')}` : '',
          `LO QUE VA DEBAJO (no lo repitas):\n${debajo}`,
          `MENSAJE DEL CLIENTE:\n${e.texto}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ]
    if (e.previo) mensajes.push(...reescritura({ texto: e.previo.texto }, e.violaciones))

    const r = await d.llm.estructurado({ nombre: 'reservas', esquema: Salida, mensajes })
    const enlace = sinPreguntas(r.datos.texto)
    return {
      texto: [enlace, debajo].filter(Boolean).join('\n\n'),
      pregunta: plan.pregunta,
      montos: plan.montos,
      ...(plan.reserva !== undefined ? { reserva: plan.reserva } : {}),
    }
  }
}
