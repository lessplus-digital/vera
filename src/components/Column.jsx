import React from 'react'
import OrderCard from './OrderCard'

export default function Column({ title, emoji, color, colorDim, colorBorder, orders, newIds, onUpdated }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      minWidth: 0,
    }}>
      {/* Header de columna */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        padding: '0 2px',
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
          {emoji} {title}
        </span>
        <span style={{
          background: colorDim,
          color: color,
          border: `1px solid ${colorBorder}`,
          borderRadius: 20,
          padding: '1px 8px',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          marginLeft: 'auto',
        }}>
          {orders.length}
        </span>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orders.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '28px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 12,
          }}>
            Sin pedidos
          </div>
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
