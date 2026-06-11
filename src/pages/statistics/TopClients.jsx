import React, { useState, useMemo } from 'react'
import { formatPrice } from '../../utils/formatters'

export default function TopClients({ clients }) {
  const [sortBy, setSortBy] = useState('pedidos')

  const rows = useMemo(() => {
    const sorted = [...clients].sort((a, b) =>
      sortBy === 'gasto' ? b.gasto - a.gasto : b.pedidos - a.pedidos
    )
    return sorted.slice(0, 10)
  }, [clients, sortBy])

  return (
    <div className="stats-card">
      <div className="stats-card-head">
        <div>
          <div className="stats-card-title">Clientes más fieles</div>
          <div className="stats-card-subtitle">Acumulado histórico</div>
        </div>
        <div className="stats-segment small">
          <button
            className={`stats-segment-btn ${sortBy === 'pedidos' ? 'active' : ''}`}
            onClick={() => setSortBy('pedidos')}
          >
            Por pedidos
          </button>
          <button
            className={`stats-segment-btn ${sortBy === 'gasto' ? 'active' : ''}`}
            onClick={() => setSortBy('gasto')}
          >
            Por gasto
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="stats-empty">Sin clientes con pedidos</div>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th className="num">Pedidos</th>
              <th className="num">Gasto total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.cliente_id}>
                <td className="rank">{i + 1}</td>
                <td>
                  <div className="client-name">{c.nombre || 'Sin nombre'}</div>
                  <div className="client-phone">{c.telefono}</div>
                </td>
                <td className="num">{c.pedidos}</td>
                <td className="num amber">{formatPrice(c.gasto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
