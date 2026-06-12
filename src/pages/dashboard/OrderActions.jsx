import React from 'react'
import Icon from '../../components/Icon'

export default function OrderActions({ order, loading, onUpdate, onRejectClick }) {
  const btn = (icon, text, onClick, cls) => (
    <button
      onClick={onClick}
      disabled={loading}
      className={`act-btn ${cls}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
    >
      {loading ? '...' : <><Icon name={icon} size={13} /> {text}</>}
    </button>
  )

  if (order.estado === 'pendiente') return (
    <div className="order-actions">
      {btn('x', 'Rechazar', onRejectClick, 'red')}
      {btn('check', 'Aprobar', () => onUpdate('en_cocina', 'confirmado'), 'green')}
    </div>
  )

  if (order.estado === 'en_cocina') return (
    <div className="order-actions">
      {order.tipo_pedido === 'domicilio'
        ? btn('scooter', 'Enviar a domicilio', () => onUpdate('en_camino'), 'purple')
        : btn('check', 'Listo para recoger', () => onUpdate('recoger'), 'blue')
      }
    </div>
  )

  if (order.estado === 'en_camino') return (
    <div className="order-actions">
      {btn('check', 'Marcar entregado', () => onUpdate('entregado'), 'green')}
    </div>
  )

  if (order.estado === 'recoger') return (
    <div className="order-actions">
      {btn('check', 'Cliente recogió', () => onUpdate('entregado'), 'green')}
    </div>
  )

  return null
}
