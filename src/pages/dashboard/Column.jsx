import React from 'react'
import OrderCard from './OrderCard'

export default function Column({ title, emoji, cls, orders, newIds, onUpdated }) {
  return (
    <div className="col">
      <div className="col-head">
        <div className={`dot ${cls}`} />
        <span className="name">{emoji} {title}</span>
        <span className={`badge mono ${cls}`}>{orders.length}</span>
      </div>

      <div className="cards">
        {orders.length === 0 ? (
          <div className="empty">Sin pedidos</div>
        ) : (
          orders.map(order => (
            <OrderCard
              key={order.pedido_id}
              order={order}
              isNew={newIds.has(order.pedido_id)}
              onUpdated={onUpdated}
            />
          ))
        )}
      </div>
    </div>
  )
}
