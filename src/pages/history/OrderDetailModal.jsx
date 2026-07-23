import React, { useState } from 'react'
import { ORDER_STATES, ESTADO_PAGO_LABEL, METODO_LABEL } from '../../utils/constants'
import { parseDb } from '../../utils/dateRanges'
import { formatPrice } from '../../utils/formatters'
import Icon from '../../components/Icon'

// Minutos entre pedido y entrega; null si no aplica (mismo criterio ≤3h que Estadísticas).
function deliveryMinutes(order) {
  if (order.estado !== 'entregado' || !order.fecha_entrega) return null
  const mins = (parseDb(order.fecha_entrega) - parseDb(order.fecha_pedido)) / 60000
  return mins > 0 && mins <= 180 ? Math.round(mins) : null
}

// Fecha completa en hora Colombia para el detalle.
function fmtFull(d) {
  const date = parseDb(d)
  const day = date.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
  const time = date.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return `${day}, ${time}`
}

// Detalle completo de un pedido del historial. Para pedidos que quedaron colgados
// en un estado intermedio (pendiente/en_cocina/en_camino/recoger) permite la
// corrección a entregado o cancelado, con confirmación inline: el trigger de BD
// notifica al cliente por WhatsApp en CADA cambio de estado, así que se advierte.
export default function OrderDetailModal({ order, onMarkDelivered, onCancelOrder, onClose }) {
  const [confirm, setConfirm] = useState(null) // null | 'entregar' | 'cancelar'
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState(null)

  // Estados finales no se tocan; el resto se puede corregir.
  const actionable = order.estado !== 'entregado' && order.estado !== 'cancelado'

  async function handleDeliver() {
    setSaving(true)
    setActionError(null)
    const { error } = await onMarkDelivered(order.pedido_id)
    setSaving(false)
    if (error) setActionError(error)
    else setConfirm(null) // el modal queda abierto mostrando el estado nuevo
  }

  async function handleCancel() {
    if (!motivo.trim()) return
    setSaving(true)
    setActionError(null)
    const { error } = await onCancelOrder(order.pedido_id, motivo.trim())
    setSaving(false)
    if (error) setActionError(error)
    else { setConfirm(null); setMotivo('') }
  }

  const st = ORDER_STATES[order.estado] || { label: order.estado, cls: 'amber' }
  const pago = ESTADO_PAGO_LABEL[order.estado_pago]
  const metodo = METODO_LABEL[order.metodo_pago]
  const items = order.detalle_pedidos || []
  const itemsTotal = items.reduce((sum, it) => sum + Number(it.subtotal || 0), 0)
  const recargo = Number(order.total || 0) - itemsTotal
  const mins = deliveryMinutes(order)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel order-detail-modal" onClick={e => e.stopPropagation()}>

        <div className="od-head">
          <div>
            <div className="title tnum">
              #{order.pedido_id}
              <span className={`state-badge ${st.cls}`}>{st.label}</span>
            </div>
            <div className="sub">{fmtFull(order.fecha_pedido)}</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="od-body">

          {/* ── Datos generales ── */}
          <div className="od-grid">
            <div className="od-item">
              <span className="od-label">Cliente</span>
              <span className="od-value">{order.clientes?.nombre || 'Sin nombre'}</span>
            </div>
            <div className="od-item">
              <span className="od-label">Teléfono</span>
              <span className="od-value tnum">
                <a href={`https://wa.me/${order.telefono}`} target="_blank" rel="noreferrer" title="Abrir en WhatsApp">
                  {order.telefono}
                </a>
              </span>
            </div>
            <div className="od-item">
              <span className="od-label">Tipo</span>
              <span className="od-value">
                <Icon name={order.tipo_pedido === 'domicilio' ? 'scooter' : 'bag'} size={13} />{' '}
                {order.tipo_pedido === 'domicilio' ? 'Domicilio' : 'Recoger'}
              </span>
            </div>
            <div className="od-item">
              <span className="od-label">Pago</span>
              <span className="od-value">
                {metodo && <Icon name={metodo.icon} size={13} />} {order.metodo_pago || '—'}
                {pago && order.metodo_pago === 'Transferencia' && (
                  <span className="state-badge sm" style={{ color: pago.color, background: pago.bg, marginLeft: 6 }}>
                    {pago.label}
                  </span>
                )}
              </span>
            </div>
            {order.tipo_pedido === 'domicilio' && (
              <div className="od-item wide">
                <span className="od-label">Dirección de entrega</span>
                <span className="od-value">{order.direccion_entrega || '—'}</span>
              </div>
            )}
            {order.repartidor && (
              <div className="od-item">
                <span className="od-label">Repartidor</span>
                <span className="od-value">{order.repartidor}</span>
              </div>
            )}
            {order.fecha_entrega && (
              <div className="od-item wide">
                <span className="od-label">Entregado</span>
                <span className="od-value">
                  {fmtFull(order.fecha_entrega)}
                  {mins !== null && <span className="od-duration"> · {mins} min desde el pedido</span>}
                </span>
              </div>
            )}
            {order.comprobante_url && (
              <div className="od-item wide">
                <span className="od-label">Comprobante</span>
                <span className="od-value">
                  <a href={order.comprobante_url} target="_blank" rel="noreferrer">
                    <Icon name="image" size={13} /> Ver comprobante
                  </a>
                </span>
              </div>
            )}
          </div>

          {/* ── Items ── */}
          <div className="od-section">
            <div className="od-label">Productos</div>
            {items.length === 0 ? (
              <div className="od-noitems">Este pedido no tiene líneas registradas.</div>
            ) : (
              <div className="od-items">
                {items.map(it => (
                  <div className="od-item-row" key={it.detalle_id}>
                    <span className="qty tnum">{it.cantidad}×</span>
                    <span className="name">
                      {it.nombre_producto}
                      {it.variante && it.variante !== 'Estándar' && <span className="variant"> · {it.variante}</span>}
                      {it.notas_item && <span className="inote">“{it.notas_item}”</span>}
                    </span>
                    <span className="sub tnum">{formatPrice(it.subtotal)}</span>
                  </div>
                ))}
                {recargo > 0 && (
                  <div className="od-item-row extra">
                    <span className="qty" />
                    <span className="name">Recargo domicilio</span>
                    <span className="sub tnum">{formatPrice(recargo)}</span>
                  </div>
                )}
                <div className="od-item-row total">
                  <span className="qty" />
                  <span className="name">Total</span>
                  <span className="sub tnum">{formatPrice(order.total)}</span>
                </div>
              </div>
            )}
          </div>

          {order.notas && (
            <div className="od-section">
              <div className="od-label">Notas del cliente</div>
              <p className="od-notes">{order.notas}</p>
            </div>
          )}

          {order.estado === 'cancelado' && order.motivo_rechazo && (
            <div className="od-cancel">
              <span className="od-label">Motivo de cancelación</span>
              {order.motivo_rechazo}
            </div>
          )}
        </div>

        <div className="od-foot">
          {confirm === 'entregar' ? (
            <div className="od-confirm green">
              <div className="od-confirm-text">
                El pedido pasará a <strong>entregado</strong> y el cliente recibirá la
                confirmación automática por WhatsApp.
              </div>
              {actionError && <div className="od-confirm-error">{actionError}</div>}
              <div className="od-confirm-actions">
                <button className="btn ghost" onClick={() => setConfirm(null)} disabled={saving}>
                  Volver
                </button>
                <button className="btn primary" onClick={handleDeliver} disabled={saving}>
                  {saving ? 'Guardando…' : <><Icon name="check" size={14} /> Sí, marcar entregado</>}
                </button>
              </div>
            </div>
          ) : confirm === 'cancelar' ? (
            <div className="od-confirm red">
              <div className="od-confirm-text">
                El pedido pasará a <strong>cancelado</strong> y el motivo se le enviará
                al cliente por WhatsApp.
              </div>
              <textarea
                rows={2}
                autoFocus
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Motivo de la cancelación (lo lee el cliente)..."
                maxLength={500}
              />
              {actionError && <div className="od-confirm-error">{actionError}</div>}
              <div className="od-confirm-actions">
                <button className="btn ghost" onClick={() => { setConfirm(null); setMotivo('') }} disabled={saving}>
                  Volver
                </button>
                <button className="btn danger" onClick={handleCancel} disabled={!motivo.trim() || saving}>
                  {saving ? 'Guardando…' : <><Icon name="x" size={14} /> Confirmar cancelación</>}
                </button>
              </div>
            </div>
          ) : (
            <>
              {actionable && (
                <button
                  className="btn danger"
                  style={{ marginRight: 'auto' }}
                  onClick={() => { setConfirm('cancelar'); setActionError(null) }}
                >
                  <Icon name="x" size={14} /> Cancelar pedido
                </button>
              )}
              <button className="btn ghost" onClick={onClose}>Cerrar</button>
              {actionable && (
                <button
                  className="btn primary"
                  onClick={() => { setConfirm('entregar'); setActionError(null) }}
                >
                  <Icon name="check" size={14} /> Marcar entregado
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
