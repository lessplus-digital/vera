import type { Cliente, MensajeHistorial, Repo } from '../bd/repo.js'
import type { LLM, LlamadaLLM } from '../llm/llm.js'
import type { Turno } from '../log/turnos.js'
import type { Conversador } from '../turno/procesador.js'
import { conGuardia, type Violacion } from '../guardia/guardia.js'
import * as T from '../textos.js'
import { clasificar, hoyEnColombia } from './clasificador.js'
import type { Clasificacion } from './clasificacion.js'
import type { BorradorReserva, Conversacion, EstadoPedido, Handler, UltimaPregunta } from './contexto.js'
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
  /** Quién llevaba el hilo, qué se preguntó y la reserva a medio armar, al empezar el turno. */
  conversacion: Conversacion
  /** Estado del pedido DESPUÉS de las acciones de este turno. */
  estado: EstadoPedido | null
  /** Lo que la guardia rechazó del intento anterior (vacío en el primero). */
  violaciones: Violacion[]
  /**
   * El intento anterior, si la guardia lo rechazó. Al reescribir NO se vuelven a
   * correr herramientas (agregarían el producto dos veces): se redacta con estos resultados.
   */
  previo: Redaccion | null
  turno: Turno
}

export type Redaccion = {
  texto: string
  /** Qué quedó preguntando. undefined = la que dejó el código (efectos.pregunta). */
  pregunta?: UltimaPregunta | null
  /** Montos que el redactor leyó de sus propias herramientas (precios del menú…). */
  montos?: number[]
  /** Herramientas que corrió el LLM (para reescribir sin repetirlas). */
  llamadas?: LlamadaLLM[]
  /** Pedidos del cliente que el redactor leyó de la BD: son los únicos PED- que puede citar. */
  pedidos?: string[]
  /** El redactor pasó al cliente a una persona (Soporte ante un reclamo grave). */
  handoff?: boolean
  /** Borrador de reserva actualizado (Reservas). undefined = no lo tocó. */
  reserva?: BorradorReserva | null
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
      // El cliente nace como 'Pendiente'; lo que diga que se llama se guarda (política).
      const sinNombre = !/\p{L}/u.test(cliente.nombre ?? '') || cliente.nombre!.trim().toLowerCase() === 'pendiente'
      const contexto = { estado, conversacion, texto, sin_nombre: sinNombre }
      turno.contexto = { ...(turno.contexto as object), estado, conversacion }

      const cl = await clasificar(d.llm, { texto, historial, contexto, hoy: hoyEnColombia(d.ahora?.()) })
      turno.clasificacion = cl.error ? { ...cl.clasificacion, error: cl.error } : cl.clasificacion
      if (cl.uso) turno.costo = { clasificador: cl.uso }

      const decision = decidir(cl.clasificacion, contexto)
      turno.decision = decision

      const efectos = await ejecutar(decision.acciones, { repo: d.repo, turno, cliente, estado, reserva: conversacion.reserva ?? null })
      // El borrador de reserva se conserva salvo que alguien lo cambie o lo termine.
      const reserva = conversacion.reserva ?? null

      if (efectos.handoff) {
        await d.repo.guardarConversacion(tel, { handler: null, ultima_pregunta: null, reserva })
        return [efectos.errorPedido ? T.PEDIDO_FALLO_HANDOFF : T.HANDOFF]
      }
      if (efectos.pedido) {
        // La confirmación la arma el código: número y total salen de la BD, tal cual.
        const p = efectos.pedido
        await d.repo.guardarConversacion(tel, { handler: 'soporte', ultima_pregunta: null, reserva })
        if (p.tipo_pedido === 'domicilio' && p.direccion_entrega && p.direccion_entrega !== cliente.direccion_principal) {
          // La próxima vez se le ofrece esta dirección ("¿te lo enviamos a …?"). Si
          // falla, el pedido ya existe: se registra y se sigue.
          await turno
            .herramienta('actualizar_direccion_cliente', { direccion_principal: p.direccion_entrega, barrio: p.barrio }, () =>
              d.repo.actualizarDireccionCliente(cliente.cliente_id, { direccion_principal: p.direccion_entrega!, barrio: p.barrio }),
            )
            .catch(() => undefined)
        }
        const cuenta = p.metodo_pago === 'Transferencia' ? await d.repo.infoNegocio('datos_transferencia').catch(() => null) : null
        return [T.pedidoCreado(p, cuenta)]
      }
      if (efectos.reserva) {
        // Igual que el pedido: la confirmación la arma el código con lo que devolvió la BD.
        const motivos = await d.repo.motivosReserva().catch(() => [])
        await d.repo.guardarConversacion(tel, { handler: 'reservas', ultima_pregunta: null, reserva: null })
        return [T.reservaCreada(efectos.reserva, motivos.find((m) => m.clave === efectos.reserva!.motivo)?.nombre ?? null)]
      }
      if (efectos.reservaCancelada) {
        await d.repo.guardarConversacion(tel, { handler: 'reservas', ultima_pregunta: null, reserva })
        return [T.reservaCancelada(efectos.reservaCancelada)]
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
            conversacion,
            estado: estadoDespues,
            violaciones,
            previo: ultima,
            turno,
          })
          efectos.hechos.montos.push(...(ultima.montos ?? []))
          efectos.hechos.pedidosConocidos = [...(efectos.hechos.pedidosConocidos ?? []), ...(ultima.pedidos ?? [])]
          return ultima.texto
        },
        efectos.hechos,
        T.TEXTO_SEGURO,
      )
      turno.guardia = { intentos_fallidos: r.intentos_fallidos, violaciones: r.violaciones }

      const redaccion = ultima as Redaccion | null
      const pregunta = r.intentos_fallidos === 2 ? null : redaccion?.pregunta !== undefined ? redaccion.pregunta : efectos.pregunta
      // Tras un handoff atiende una persona: el próximo turno del bot empieza sin hilo.
      const borrador = redaccion?.reserva !== undefined ? redaccion.reserva : reserva
      await d.repo.guardarConversacion(
        tel,
        redaccion?.handoff ? { handler: null, ultima_pregunta: null, reserva: borrador } : { handler, ultima_pregunta: pregunta, reserva: borrador },
      )
      return [r.texto]
    },
  }
}
