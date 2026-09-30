import type { Cliente, MensajeHistorial, Repo } from '../bd/repo.js'
import type { LLM } from '../llm/llm.js'
import type { Conversador } from '../turno/procesador.js'
import { conGuardia, type Violacion } from '../guardia/guardia.js'
import * as T from '../textos.js'
import { clasificar, hoyEnColombia } from './clasificador.js'
import type { Clasificacion } from './clasificacion.js'
import type { EstadoPedido, Handler, UltimaPregunta } from './contexto.js'
import { ejecutar, type Efectos } from './ejecutor.js'
import { decidir, type Decision } from './politica.js'

// El pipeline de un turno de texto en modo bot:
//   clasificar (LLM) → decidir (código) → ejecutar acciones (código) →
//   redactar (LLM, Fase 5) → guardia → guardar qué se preguntó.
// Cada paso queda anotado en el Turno (bot_turnos).

export type EntradaRedactor = {
  handler: Handler
  texto: string
  cliente: Cliente
  historial: MensajeHistorial[]
  clasificacion: Clasificacion
  decision: Decision
  efectos: Efectos
  /** Estado del pedido DESPUÉS de las acciones de este turno. */
  estado: EstadoPedido | null
  /** Lo que la guardia rechazó del intento anterior (vacío en el primero). */
  violaciones: Violacion[]
}

export type Redaccion = {
  texto: string
  /** Qué quedó preguntando. undefined = la que dejó el código (efectos.pregunta). */
  pregunta?: UltimaPregunta | null
  /** Montos que el redactor leyó de sus propias herramientas (precios del menú…). */
  montos?: number[]
}

export type Redactor = (e: EntradaRedactor) => Promise<Redaccion>

/**
 * Redactor provisional de la Fase 4, mientras llegan los agentes de la Fase 5:
 * dice qué entendió sin afirmar nada que la guardia pueda rechazar. Permite
 * probar la decisión de punta a punta (simulador y WhatsApp real).
 */
export const redactorProvisional: Redactor = async ({ handler, decision, efectos }) => {
  const partes = [`(${handler}) ${decision.regla}${decision.nota ? ` · ${decision.nota}` : ''}`]
  const c = efectos.cobertura
  if (c) {
    partes.push(
      c.cubierto
        ? `Cobertura: sí, ${c.barrio}.`
        : c.sugerencias.length
          ? `Cobertura: no encontré "${c.barrio}". ¿Quisiste decir ${c.sugerencias.join(' o ')}?`
          : `Cobertura: no llegamos a "${c.barrio}".`,
    )
  }
  if (efectos.errorPedido) partes.push(`No se creó el pedido: ${efectos.errorPedido}.`)
  return { texto: partes.join('\n') }
}

export type DepsConversador = {
  repo: Repo
  llm: LLM
  /** Uno por handler; los que falten usan el provisional. */
  redactores?: Partial<Record<Handler, Redactor>>
  ahora?: () => Date
}

export function crearConversadorDecision(d: DepsConversador): Conversador {
  return {
    async responder({ cliente, texto, historial, turno }) {
      const tel = turno.telefono
      const [estado, conversacion] = await Promise.all([d.repo.estadoPedido(tel), d.repo.leerConversacion(tel)])
      const contexto = { estado, conversacion, texto }
      turno.contexto = { ...(turno.contexto as object), estado, conversacion }

      const cl = await clasificar(d.llm, { texto, historial, contexto, hoy: hoyEnColombia(d.ahora?.()) })
      turno.clasificacion = cl.error ? { ...cl.clasificacion, error: cl.error } : cl.clasificacion
      if (cl.uso) turno.costo = { clasificador: cl.uso }

      const decision = decidir(cl.clasificacion, contexto)
      turno.decision = decision

      const efectos = await ejecutar(decision.acciones, { repo: d.repo, turno, cliente, estado })

      if (efectos.handoff) {
        await d.repo.guardarConversacion(tel, { handler: null, ultima_pregunta: null })
        return [T.HANDOFF]
      }
      if (efectos.pedido) {
        // La confirmación la arma el código: número y total salen de la BD, tal cual.
        await d.repo.guardarConversacion(tel, { handler: 'soporte', ultima_pregunta: null })
        return [T.pedidoCreado(efectos.pedido)]
      }

      const handler = decision.handler as Handler
      const redactor = d.redactores?.[handler] ?? redactorProvisional
      const estadoDespues = decision.acciones.length ? await d.repo.estadoPedido(tel) : estado
      let ultima: Redaccion | null = null
      const r = await conGuardia(
        async (violaciones) => {
          ultima = await redactor({
            handler,
            texto,
            cliente,
            historial,
            clasificacion: cl.clasificacion,
            decision,
            efectos,
            estado: estadoDespues,
            violaciones,
          })
          efectos.hechos.montos.push(...(ultima.montos ?? []))
          return ultima.texto
        },
        efectos.hechos,
        T.TEXTO_SEGURO,
      )
      turno.guardia = { intentos_fallidos: r.intentos_fallidos, violaciones: r.violaciones }

      const redaccion = ultima as Redaccion | null
      const pregunta = r.intentos_fallidos === 2 ? null : redaccion?.pregunta !== undefined ? redaccion.pregunta : efectos.pregunta
      await d.repo.guardarConversacion(tel, { handler, ultima_pregunta: pregunta })
      return [r.texto]
    },
  }
}
