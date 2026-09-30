import type { Cliente, Cobertura, PedidoCreado, Repo, Reserva } from '../bd/repo.js'
import type { Hechos } from '../guardia/guardia.js'
import type { Turno } from '../log/turnos.js'
import type { BorradorReserva, EstadoPedido, UltimaPregunta } from './contexto.js'
import type { Accion } from './politica.js'

// Ejecuta las acciones críticas que decidió la política, ANTES de que el LLM
// redacte nada. El resultado (los "hechos") es lo único que el handler puede
// afirmar, y lo que la guardia usa para revisar su texto.

export type Efectos = {
  hechos: Hechos
  handoff: boolean
  pedido: PedidoCreado | null
  /** Código de crear_orden_desde_carrito si no se pudo crear (SIN_RESUMEN, PRECIOS_ACTUALIZADOS…). */
  errorPedido: string | null
  cobertura: Cobertura | null
  /** La pregunta que ya toca hacer por lo que devolvió la BD (p. ej. "¿quisiste decir Niquía?"). */
  pregunta: UltimaPregunta | null
  /** Reserva creada en este turno por el código (crear_reserva_bot). */
  reserva?: Reserva
  reservaCancelada?: { reserva_id: string; fecha: string; hora: string }
  /** Código de crear/cancelar_reserva_bot si no se pudo (SIN_CUPO, FECHA_PASADA…). */
  errorReserva?: string
}

/** Códigos de crear_orden_desde_carrito que se arreglan siguiendo la conversación. */
export const ERRORES_RECUPERABLES = new Set([
  'SIN_RESUMEN', //            no vio el resumen vigente: se le muestra
  'DATOS_INCOMPLETOS', //      falta algo: se pregunta
  'PRECIOS_ACTUALIZADOS', //   la RPC ya corrigió el carrito: resumen nuevo
  'TARIFA_ACTUALIZADA', //     ídem con el domicilio
  'PRODUCTO_NO_DISPONIBLE', // se agotó algo: que lo cambie
  'CARRITO_VACIO', //          el carrito expiró: armarlo de nuevo
])

export type DepsEjecutor = {
  repo: Repo
  turno: Turno
  cliente: Cliente
  estado: EstadoPedido | null
  /** El borrador de reserva que el cliente vio resumido (conversaciones.reserva). */
  reserva?: BorradorReserva | null
}

export async function ejecutar(acciones: Accion[], d: DepsEjecutor): Promise<Efectos> {
  const { repo, turno } = d
  const tel = turno.telefono
  const ef: Efectos = { hechos: { montos: [] }, handoff: false, pedido: null, errorPedido: null, cobertura: null, pregunta: null }

  for (const a of acciones) {
    switch (a.tipo) {
      case 'pasar_a_humano':
        await turno.herramienta('pasar_a_humano', { motivo: a.motivo }, () => repo.pasarAHumano(d.cliente.cliente_id))
        ef.handoff = true
        return ef // nada más corre: desde aquí atiende una persona

      case 'guardar_datos':
        await turno.herramienta('guardar_datos_pedido', a.datos, () => repo.guardarDatosPedido(tel, a.datos))
        break

      case 'verificar_cobertura': {
        let r = await turno.herramienta('consultar_cobertura', { barrio: a.barrio }, () => repo.consultarCobertura(a.barrio))
        // Una sola sugerencia es casi seguro una errata ("niqia" → Niquía): se
        // consulta la sugerencia y se responde con el dato real, sin preguntar.
        // (Regla escrita para n8n el 2026-09-29 que nunca llegó a correr: BUG-063.)
        if (!r.cubierto && r.sugerencias.length === 1) {
          const sug = r.sugerencias[0]!
          const r2 = await turno.herramienta('consultar_cobertura', { barrio: sug }, () => repo.consultarCobertura(sug))
          if (r2.cubierto) r = r2
        }
        ef.cobertura = r
        ef.hechos.cobertura = { cubierto: r.cubierto }
        if (r.cubierto && r.costo_domicilio != null) ef.hechos.montos.push(r.costo_domicilio)

        if (r.cubierto && a.guardar) {
          // Se guarda el nombre CANÓNICO con su tarifa. Nunca el texto crudo: con
          // 'niqia' en el carrito, el trigger cobraba la tarifa base (BUG-061).
          const datos = {
            barrio: r.barrio,
            costo_domicilio: r.costo_domicilio ?? undefined,
            cobertura_ok: true,
            ...(d.estado?.tipo_pedido ? {} : { tipo_pedido: 'domicilio' as const }),
          }
          await turno.herramienta('guardar_datos_pedido', datos, () => repo.guardarDatosPedido(tel, datos))
        } else if (!r.cubierto) {
          ef.pregunta = r.sugerencias.length
            ? r.sugerencias.length === 1
              ? { tipo: 'sugerir_barrio', barrio: r.sugerencias[0]! }
              : { tipo: 'dato_pedido', dato: 'barrio' } // "¿Prado o Pradera?": la respuesta es el barrio
            : null
        }
        break
      }

      case 'guardar_nombre':
        await turno.herramienta('actualizar_nombre_cliente', { nombre: a.nombre }, () => repo.actualizarNombreCliente(d.cliente.cliente_id, a.nombre))
        d.cliente.nombre = a.nombre // el handler de este mismo turno ya lo usa
        break

      case 'vaciar_carrito':
        await turno.herramienta('carrito_vaciar', {}, () => repo.carritoVaciar(tel))
        break

      case 'crear_pedido': {
        const r = await turno.herramienta('crear_orden_desde_carrito', {}, () => repo.crearOrdenDesdeCarrito(tel, d.cliente.cliente_id))
        if (r.ok) {
          ef.pedido = r
          ef.hechos.pedidoCreado = { pedido_id: r.pedido_id, total: r.total }
          ef.hechos.montos.push(r.total, r.costo_domicilio)
        } else {
          ef.errorPedido = r.error ?? 'ERROR'
          // Los recuperables los resuelve Pedidos (vuelve a mostrar el resumen o
          // pide lo que falta). Lo demás no lo arregla el cliente: a una persona.
          if (!ERRORES_RECUPERABLES.has(ef.errorPedido)) {
            await turno.herramienta('pasar_a_humano', { motivo: `crear_pedido:${ef.errorPedido}` }, () => repo.pasarAHumano(d.cliente.cliente_id))
            ef.handoff = true
            return ef
          }
        }
        break
      }

      case 'crear_reserva': {
        // Se crea el borrador que el cliente vio resumido (la política ya exigió
        // que esté completo y con cupo verificado); la RPC vuelve a validar cupo,
        // horario y motivo, y el costo lo pone el trigger.
        const b = d.reserva
        if (!b?.personas || !b.fecha || !b.hora || !b.motivo) {
          ef.errorReserva = 'SIN_BORRADOR'
          break
        }
        const nombre = (d.cliente.nombre ?? '').trim()
        const args = {
          telefono: tel,
          cliente_id: d.cliente.cliente_id,
          nombre: nombre && nombre.toLowerCase() !== 'pendiente' ? nombre : '',
          fecha: b.fecha,
          hora: b.hora,
          personas: b.personas,
          motivo: b.motivo,
        }
        const r = await turno.herramienta('crear_reserva_bot', args, () => repo.crearReserva(args))
        if (r.ok) {
          ef.reserva = r as unknown as Reserva
          if (ef.reserva.costo_motivo) ef.hechos.montos.push(ef.reserva.costo_motivo)
        } else ef.errorReserva = r.error ?? 'ERROR'
        break
      }

      case 'cancelar_reserva': {
        const r = await turno.herramienta('cancelar_reserva_bot', { reserva_id: a.reserva_id }, () => repo.cancelarReserva(tel, a.reserva_id))
        if (r.ok) ef.reservaCancelada = { reserva_id: a.reserva_id, fecha: String(r.fecha), hora: String(r.hora) }
        else ef.errorReserva = r.error ?? 'ERROR'
        break
      }
    }
  }
  return ef
}
