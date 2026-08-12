import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { parseDb } from '../../utils/dateRanges'
import { ESTADO_PAGO_LABEL, METODO_LABEL } from '../../utils/constants'
import EditOrderModal from './EditOrderModal'
import RejectModal from './RejectModal'
import OrderActions from './OrderActions'
import AssignCourier from './AssignCourier'
import Icon from '../../components/Icon'
import { useAuth } from '../../hooks/useAuth'
import { puede } from '../../utils/permisos'

export default function OrderCard({ order, isNew, onUpdated, domiciliarios = [] }) {
  const { rol } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showComprobante, setShowComprobante] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [errorAccion, setErrorAccion] = useState(null)

  const puedeAsignar = puede(rol, 'asignarDomiciliario')
  const puedeEditar  = puede(rol, 'editarPedido')
  const puedeAprobar = puede(rol, 'cambiarEstadoPedido')

  const timeAgo = formatDistanceToNow(parseDb(order.fecha_pedido), {
    addSuffix: true,
    locale: es,
  })

  async function updateEstado(estado, estadoPago = null) {
    setLoading(true)
    setErrorAccion(null)
    const updates = { estado }
    if (estadoPago) updates.estado_pago = estadoPago
    const { error } = await supabase
      .from('pedidos')
      .update(updates)
      .eq('pedido_id', order.pedido_id)
    setLoading(false)
    if (error) setErrorAccion('No se pudo actualizar el pedido.')
    else onUpdated()
  }

  /*
   * La entrega va SIEMPRE por el RPC, sea quien sea el que la marca.
   *
   * Para el domiciliario es obligatorio: no tiene política de UPDATE sobre
   * `pedidos` (RLS no puede limitar columnas, así que un UPDATE suyo le dejaría
   * tocar también `total` o `estado_pago`). Para admin y mesero, que sí podrían
   * hacerlo directo, se usa igual para no tener dos caminos que puedan
   * divergir — y porque el RPC ya valida que el pedido no esté cerrado.
   *
   * `fecha_entrega` la pone `trigger_fecha_entrega` en la BD; antes también se
   * mandaba desde JS, que era la misma verdad escrita dos veces.
   */
  async function marcarEntregado() {
    setLoading(true)
    setErrorAccion(null)
    const { error } = await supabase.rpc('marcar_entregado', { p_pedido_id: order.pedido_id })
    setLoading(false)
    if (error) {
      console.error('Error marcando entregado:', error)
      setErrorAccion(
        error.message?.includes('no está asignado')
          ? 'Ese pedido ya no está asignado a ti.'
          : 'No se pudo marcar como entregado.'
      )
      return
    }
    onUpdated()
  }

  async function handleReject(motivo) {
    setLoading(true)
    const { error } = await supabase
      .from('pedidos')
      .update({
        estado: 'cancelado',
        estado_pago: 'rechazado',
        motivo_rechazo: motivo,
      })
      .eq('pedido_id', order.pedido_id)
    setLoading(false)
    if (!error) {
      setShowRejectModal(false)
      setShowComprobante(false)
      onUpdated()
    }
  }

  const metodo = METODO_LABEL[order.metodo_pago] || { icon: 'card', cls: 'blue' }
  const estadoPago = ESTADO_PAGO_LABEL[order.estado_pago] || ESTADO_PAGO_LABEL.pendiente

  return (
    <>
      <div className={`order-card${isNew ? ' is-new' : ''}`}>

        {/* Header */}
        <div className="head">
          <div>
            <div className="id-row">
              <span className="oc-id">#{String(order.pedido_id).slice(0, 8)}</span>
              {isNew && <span className="badge sm amber">NUEVO</span>}
            </div>
            <div className="meta">{timeAgo} · {order.telefono}</div>
          </div>
          <div className="total-col">
            <div className="amount">${Number(order.total || 0).toLocaleString('es-CO')}</div>
            <div className={`method ${metodo.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
              <Icon name={metodo.icon} size={12} /> {order.metodo_pago}
            </div>
          </div>
        </div>

        {/* Tipo pedido + estado pago */}
        <div className="tags">
          <span className={`badge ${order.tipo_pedido === 'domicilio' ? 'purple' : 'blue'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name={order.tipo_pedido === 'domicilio' ? 'scooter' : 'bag'} size={12} />
            {order.tipo_pedido === 'domicilio' ? 'Domicilio' : 'Recoger'}
          </span>
          <span className={`badge ${estadoPago.cls}`}>{estadoPago.label}</span>
        </div>

        {/* Dirección */}
        {order.tipo_pedido === 'domicilio' && order.direccion_entrega && (
          <div className="addr">
            <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}><Icon name="pin" size={13} /></span>
            <span>{order.direccion_entrega}</span>
          </div>
        )}

        {/* Items */}
        {order.detalle_pedidos?.length > 0 && (
          <div className="items-box">
            {order.detalle_pedidos.map((item, i) => {
              // `mitades` solo viene en pizzas mitad y mitad. `nombre_producto` ya dice
              // "Mitad X / Mitad Y", pero la masa vive únicamente aquí y la cocina la necesita.
              const masa = item.mitades?.[0]?.variante
              return (
                <div key={i} className="item">
                  <span>
                    <span className="qty">{item.cantidad}x</span>
                    {' '}
                    {item.mitades && <span className="mm-tag">½+½</span>}
                    {item.nombre_producto}
                    {item.variante && item.variante !== 'Estándar' && (
                      <span className="variant"> · {item.variante}</span>
                    )}
                    {masa && <span className="variant"> · {masa}</span>}
                  </span>
                  <span className="price">${Number(item.precio_unitario || 0).toLocaleString('es-CO')}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Notas */}
        {order.notas && (
          <div className="notes" style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
            <Icon name="note" size={13} style={{ marginTop: 1 }} /> {order.notas}
          </div>
        )}

        {/* Esperando comprobante */}
        {order.metodo_pago === 'Transferencia' && !order.comprobante_url && order.estado === 'pendiente' && (
          <div className="transfer-wait" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="clock" size={13} /> Esperando comprobante de transferencia
          </div>
        )}

        {/* Ver comprobante */}
        {order.comprobante_url && (
          <button className="oc-btn voucher" onClick={() => setShowComprobante(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="image" size={14} /> Ver comprobante de pago
          </button>
        )}

        {/* Editar pedido */}
        {order.estado === 'pendiente' && puedeEditar && (
          <button className="oc-btn edit" onClick={() => setShowEdit(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="edit" size={14} /> Editar pedido
          </button>
        )}

        {/* Asignación de domiciliario — solo admin, y solo si el pedido sigue vivo */}
        {puedeAsignar && order.tipo_pedido === 'domicilio' && (
          <AssignCourier
            order={order}
            domiciliarios={domiciliarios}
            onUpdated={onUpdated}
          />
        )}

        <OrderActions
          order={order}
          loading={loading}
          onUpdate={updateEstado}
          onEntregar={marcarEntregado}
          onRejectClick={() => setShowRejectModal(true)}
        />

        {errorAccion && <div className="oc-error">{errorAccion}</div>}

      </div>

      {/* Modal comprobante — portal a body para centrar y difuminar todo el dashboard */}
      {showComprobante && order.comprobante_url && createPortal(
        <div className="voucher-overlay" onClick={() => setShowComprobante(false)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="vp-head">
              <div>
                <div className="title">Comprobante de pago</div>
                <div className="sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  #{String(order.pedido_id).slice(0, 8)} · <Icon name="bank" size={12} /> Transferencia · ${Number(order.total || 0).toLocaleString('es-CO')}
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowComprobante(false)}><Icon name="x" size={14} /></button>
            </div>

            <img
              src={order.comprobante_url}
              alt="Comprobante de pago"
              className={order.estado === 'pendiente' && puedeAprobar ? 'has-actions' : ''}
            />

            {order.estado === 'pendiente' && puedeAprobar && (
              <div className="vp-actions">
                <button
                  className="act-btn red"
                  onClick={() => { setShowComprobante(false); setShowRejectModal(true) }}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  {loading ? '...' : <><Icon name="x" size={13} /> Rechazar pedido</>}
                </button>
                <button
                  className="act-btn green"
                  onClick={() => { setShowComprobante(false); updateEstado('en_cocina', 'confirmado') }}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  {loading ? '...' : <><Icon name="check" size={13} /> Aprobar pedido</>}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showEdit && (
        <EditOrderModal
          order={order}
          onClose={() => setShowEdit(false)}
          onUpdated={onUpdated}
        />
      )}

      {showRejectModal && (
        <RejectModal
          order={order}
          loading={loading}
          onConfirm={handleReject}
          onClose={() => setShowRejectModal(false)}
        />
      )}
    </>
  )
}
