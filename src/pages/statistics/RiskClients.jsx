import React from 'react'

// Clientes recurrentes (3+ pedidos) sin pedir hace más de 30 días.
// El link abre WhatsApp para reactivarlos con una promo.
export default function RiskClients({ clients }) {
  return (
    <div className="stats-card">
      <div className="stats-card-title">Clientes en riesgo</div>
      <div className="stats-card-subtitle">
        Recurrentes (3+ pedidos) que no piden hace más de 30 días
      </div>

      {clients.length === 0 ? (
        <div className="stats-empty">Ningún cliente recurrente inactivo 🎉</div>
      ) : (
        <table className="stats-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="num">Pedidos</th>
              <th className="num">Sin pedir</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.slice(0, 10).map(c => (
              <tr key={c.telefono}>
                <td>
                  <div className="client-name">{c.nombre || 'Sin nombre'}</div>
                  <div className="client-phone">{c.telefono}</div>
                </td>
                <td className="num">{c.pedidos}</td>
                <td className="num red">{c.diasDesde} días</td>
                <td style={{ textAlign: 'right' }}>
                  <a
                    className="wa-link"
                    href={`https://wa.me/${String(c.telefono).replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Escribirle por WhatsApp"
                  >
                    💬
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
