import React, { useState } from 'react'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'
import { formatPhone } from '../../utils/formatters'
import PromoModal from './PromoModal'

// Clientes recurrentes (3+ pedidos) sin pedir hace más de 30 días.
// Están fuera de la ventana de 24h de Meta, así que la reactivación va por la
// plantilla `reactivacion_cliente` (PromoModal), no por texto libre.
export default function RiskClients({ clients }) {
  const [promoTarget, setPromoTarget] = useState(null)
  const { toast, showToast } = useToast()

  return (
    <div className="stats-card">
      <div className="stats-card-title">Clientes en riesgo</div>
      <div className="stats-card-subtitle">
        Recurrentes (3+ pedidos) que no piden hace más de 30 días
      </div>

      {clients.length === 0 ? (
        <div className="stats-empty">Ningún cliente recurrente inactivo</div>
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
                  <div className="client-phone">{formatPhone(c.telefono)}</div>
                </td>
                <td className="num">{c.pedidos}</td>
                <td className="num red">{c.diasDesde} días</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="promo-btn"
                    onClick={() => setPromoTarget(c)}
                    disabled={!String(c.telefono || '').replace(/\D/g, '')}
                    title="Enviar promo de reactivación"
                  >
                    <Icon name="message" size={13} /> Promo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {promoTarget && (
        <PromoModal
          client={promoTarget}
          onClose={() => setPromoTarget(null)}
          onResult={({ ok, message }) => showToast(ok ? 'success' : 'error', message)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
