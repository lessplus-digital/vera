import React, { useState } from 'react'
import Column from './Column'
import CreateOrderModal from './CreateOrderModal'
import { COLUMNS } from '../../utils/constants'
import Icon from '../../components/Icon'

export default function DashboardPage({ loading, orders, newIds, onUpdated }) {
  const [showCreate, setShowCreate] = useState(false)

  if (loading) {
    return (
      <div className="page-loading">
        <div className="inner">
          <div className="icon" style={{ color: 'var(--amber)' }}><Icon name="pizza" size={32} /></div>
          <div className="msg">Cargando pedidos...</div>
        </div>
      </div>
    )
  }

  function getColumnOrders(col) {
    const keys = Array.isArray(col.key) ? col.key : [col.key]
    return orders.filter(o => keys.includes(o.estado))
  }

  return (
    <main className="kanban">
      {COLUMNS.map(col => (
        <Column
          key={Array.isArray(col.key) ? col.key.join('-') : col.key}
          title={col.title}
          icon={col.icon}
          cls={col.cls}
          orders={getColumnOrders(col)}
          newIds={newIds}
          onUpdated={onUpdated}
          onCreate={col.key === 'pendiente' ? () => setShowCreate(true) : undefined}
        />
      ))}

      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onUpdated={onUpdated}
        />
      )}
    </main>
  )
}
