import React, { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { parseDb } from '../../utils/dateRanges'
import { formatPrice, formatPhone } from '../../utils/formatters'
import { METODO_LABEL } from '../../utils/constants'
import Icon from '../../components/Icon'
import { useAuth } from '../../hooks/useAuth'
import DeliveryHistory from './DeliveryHistory'

/*
 * Pantalla del domiciliario. Sustituye al kanban: las cuatro columnas de flujo
 * de cocina no son su trabajo — él necesita a dónde va, cuánto cobra y un botón.
 *
 * No filtra por `domiciliario_id` en JS a propósito: `useOrders` ya recibe SOLO
 * sus pedidos porque la política `pedidos_select` filtra por esa columna. Si
 * algún día esta pantalla mostrara de más, el fallo estaría en la RLS, no aquí.
 */
export default function DeliveriesPage({ loading, orders, onUpdated }) {
  const { user } = useAuth()
  const [vista, setVista] = useState('activas')

  if (loading) {
    return (
      <div className="page-loading">
        <div className="inner">
          <div className="icon" style={{ color: 'var(--amber)' }}><Icon name="scooter" size={32} /></div>
          <div className="msg">Cargando tus entregas…</div>
        </div>
      </div>
    )
  }

  return (
    <main className="deliveries">

      <div className="dv-segmented">
        <button
          className={`dv-seg${vista === 'activas' ? ' active' : ''}`}
          onClick={() => setVista('activas')}
        >
          Activas{orders.length > 0 ? ` (${orders.length})` : ''}
        </button>
        <button
          className={`dv-seg${vista === 'historial' ? ' active' : ''}`}
          onClick={() => setVista('historial')}
        >
          Historial
        </button>
      </div>

      {/* El historial monta su propio hook: `useOrders` solo trae el día de
          negocio actual y estados vivos, así que lo entregado no está ahí. */}
      {vista === 'historial'
        ? <DeliveryHistory domiciliarioId={user?.id} />
        : <VistaActivas orders={orders} onUpdated={onUpdated} />}

    </main>
  )
}

function VistaActivas({ orders, onUpdated }) {
  const enCamino  = orders.filter(o => o.estado === 'en_camino')
  const enCocina  = orders.filter(o => o.estado === 'en_cocina')
  const aCobrar   = enCamino
    .filter(o => o.metodo_pago === 'Efectivo')
    .reduce((suma, o) => suma + Number(o.total || 0), 0)

  return (
    <>
      <div className="dv-summary">
        <div className="dv-stat">
          <span className="dv-stat-num tnum">{enCamino.length}</span>
          <span className="dv-stat-label">En camino</span>
        </div>
        <div className="dv-stat">
          <span className="dv-stat-num tnum">{enCocina.length}</span>
          <span className="dv-stat-label">En preparación</span>
        </div>
        <div className="dv-stat">
          {/* Lo que va a llevar en el bolsillo al terminar la ronda. */}
          <span className="dv-stat-num tnum">{formatPrice(aCobrar)}</span>
          <span className="dv-stat-label">Por cobrar en efectivo</span>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="dv-empty">
          <div style={{ color: 'var(--text-muted)' }}><Icon name="scooter" size={40} /></div>
          <div className="dv-empty-title">No tienes entregas asignadas</div>
          <p className="dv-empty-text">
            Cuando el administrador te asigne un domicilio, aparecerá aquí con la dirección
            y el monto a cobrar.
          </p>
        </div>
      ) : (
        <>
          {enCamino.length > 0 && (
            <section className="dv-group">
              <h2 className="dv-group-title">
                <Icon name="scooter" size={15} /> En camino
              </h2>
              {enCamino.map(o => (
                <DeliveryCard key={o.pedido_id} order={o} onUpdated={onUpdated} entregable />
              ))}
            </section>
          )}

          {enCocina.length > 0 && (
            <section className="dv-group">
              <h2 className="dv-group-title">
                <Icon name="chef" size={15} /> En preparación
              </h2>
              {enCocina.map(o => (
                <DeliveryCard key={o.pedido_id} order={o} onUpdated={onUpdated} />
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}

function DeliveryCard({ order, onUpdated, entregable = false }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmar, setConfirmar] = useState(false)

  const metodo   = METODO_LABEL[order.metodo_pago] || { icon: 'card', cls: 'blue' }
  const efectivo = order.metodo_pago === 'Efectivo'
  const desde    = formatDistanceToNow(parseDb(order.fecha_pedido), { addSuffix: true, locale: es })

  async function entregar() {
    setLoading(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('marcar_entregado', { p_pedido_id: order.pedido_id })
    setLoading(false)

    if (rpcError) {
      console.error('Error marcando entregado:', rpcError)
      setError(
        rpcError.message?.includes('no está asignado')
          ? 'Este pedido ya no está asignado a ti.'
          : 'No se pudo marcar como entregado. Revisa tu conexión.'
      )
      setConfirmar(false)
      return
    }
    onUpdated()
  }

  return (
    <article className="dv-card">
      <div className="dv-head">
        <span className="dv-id">#{String(order.pedido_id).slice(0, 8)}</span>
        <span className="dv-time">{desde}</span>
      </div>

      {/* La dirección es lo único que importa de un vistazo: va primero y grande. */}
      <div className="dv-addr">
        <Icon name="pin" size={16} />
        <span>
          {order.direccion_entrega || 'Sin dirección registrada'}
          {order.barrio && <span className="dv-barrio">{order.barrio}</span>}
        </span>
      </div>

      <div className="dv-client">
        <span className="dv-client-name">{order.clientes?.nombre || 'Cliente'}</span>
        {/* tel: para que en el celular sea un toque, no copiar y pegar. */}
        <a className="dv-phone" href={`tel:+${String(order.telefono).replace(/\D/g, '')}`}>
          <Icon name="phone" size={13} /> {formatPhone(order.telefono)}
        </a>
      </div>

      {order.detalle_pedidos?.length > 0 && (
        <ul className="dv-items">
          {order.detalle_pedidos.map((item, i) => (
            <li key={i}>
              <span className="dv-qty tnum">{item.cantidad}×</span> {item.nombre_producto}
            </li>
          ))}
        </ul>
      )}

      {order.notas && (
        <div className="dv-notes"><Icon name="note" size={13} /> {order.notas}</div>
      )}

      {/* El dato operativo del repartidor: ¿cobro o ya está pago? */}
      <div className={`dv-cobro${efectivo ? ' efectivo' : ''}`}>
        <span className="dv-cobro-label">
          <Icon name={metodo.icon} size={14} />
          {efectivo ? 'Cobrar en efectivo' : `Pagado por ${order.metodo_pago}`}
        </span>
        <span className="dv-cobro-monto tnum">{formatPrice(order.total)}</span>
      </div>

      {error && <div className="dv-error">{error}</div>}

      {entregable && (
        confirmar ? (
          <div className="dv-confirm">
            <span className="dv-confirm-text">
              {efectivo
                ? `¿Recibiste ${formatPrice(order.total)} en efectivo?`
                : '¿Confirmas que ya lo entregaste?'}
            </span>
            <div className="dv-confirm-actions">
              <button className="btn ghost" onClick={() => setConfirmar(false)} disabled={loading}>
                Todavía no
              </button>
              <button className="btn primary" onClick={entregar} disabled={loading}>
                {loading ? 'Guardando…' : 'Sí, entregado'}
              </button>
            </div>
          </div>
        ) : (
          // Confirmación en dos pasos: el botón vive en un celular dentro del
          // bolsillo de alguien en moto, y marcar entregado no tiene deshacer.
          <button className="btn primary dv-entregar" onClick={() => setConfirmar(true)} disabled={loading}>
            <Icon name="check" size={15} /> Marcar entregado
          </button>
        )
      )}
    </article>
  )
}
