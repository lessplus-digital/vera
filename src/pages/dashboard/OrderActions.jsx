import React from 'react'

export default function OrderActions({ order, loading, onUpdate, onRejectClick }) {
  const btn = (label, onClick, cls) => (
    <button
      onClick={onClick}
      disabled={loading}
      className={`act-btn ${cls}`}
    >
      {loading ? '...' : label}
    </button>
  )

  if (order.estado === 'pendiente') return (
    <div className="order-actions">
      {btn('✕ Rechazar', onRejectClick, 'red')}
      {btn('✓ Aprobar', () => onUpdate('en_cocina', 'confirmado'), 'green')}
    </div>
  )

  if (order.estado === 'en_cocina') return (
    <div className="order-actions">
      {order.tipo_pedido === 'domicilio'
        ? btn('🛵 Enviar a domicilio', () => onUpdate('en_camino'), 'purple')
        : btn('✓ Listo para recoger', () => onUpdate('recoger'), 'blue')
      }
    </div>
  )

  if (order.estado === 'en_camino') return (
    <div className="order-actions">
      {btn('✓ Marcar entregado', () => onUpdate('entregado'), 'green')}
    </div>
  )

  if (order.estado === 'recoger') return (
    <div className="order-actions">
      {btn('✓ Cliente recogió', () => onUpdate('entregado'), 'green')}
    </div>
  )

  return null
}
