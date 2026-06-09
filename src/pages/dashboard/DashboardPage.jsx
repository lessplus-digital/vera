import React from 'react'
import Column from './Column'
import { COLUMNS } from '../../utils/constants'

export default function DashboardPage({ loading, orders, newIds, onUpdated }) {
  if (loading) {
    return (
      <div className="page-loading">
        <div className="inner">
          <div className="icon">🍕</div>
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
          emoji={col.emoji}
          cls={col.cls}
          orders={getColumnOrders(col)}
          newIds={newIds}
          onUpdated={onUpdated}
        />
      ))}
    </main>
  )
}
