import type { Cliente, Cobertura, PedidoCreado, Repo } from '../bd/repo.js'
import type { Hechos } from '../guardia/guardia.js'
import type { Turno } from '../log/turnos.js'
import type { EstadoPedido, UltimaPregunta } from './contexto.js'
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
}

export type DepsEjecutor = { repo: Repo; turno: Turno; cliente: Cliente; estado: EstadoPedido | null }

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
        }
        break
      }

      case 'crear_reserva':
      case 'cancelar_reserva':
        // Los datos de la reserva los reúne el handler de Reservas (Fase 5). Hasta
        // entonces se anota y NO se escribe nada: el texto provisional no la confirma.
        await turno.herramienta(a.tipo, a, async () => ({ pendiente: 'Fase 5: handler de Reservas' }))
        break
    }
  }
  return ef
}
