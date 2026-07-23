import React from 'react'
import Icon from '../../components/Icon'

export default function CancellationStats({ kpis, motivos, rating }) {
  const maxCount = motivos.length > 0 ? motivos[0].count : 0

  return (
    <div className="stats-card">
      <div className="stats-card-title">Cancelaciones y feedback</div>

      <div className="cancel-summary">
        <div className="cancel-stat">
          <div className="cancel-stat-value red">{kpis.tasaCancelacion.toFixed(1)}%</div>
          <div className="cancel-stat-label">Tasa de cancelación</div>
        </div>
        <div className="cancel-stat">
          <div className="cancel-stat-value">{kpis.cancelados}</div>
          <div className="cancel-stat-label">Pedidos cancelados</div>
        </div>
        <div className="cancel-stat">
          <div className="cancel-stat-value">
            {rating.promedio != null
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="star" size={17} /> {rating.promedio.toFixed(1)}</span>
              : '—'}
          </div>
          <div className="cancel-stat-label">
            {rating.count > 0 ? `Calificación (${rating.count})` : 'Sin reseñas'}
          </div>
        </div>
      </div>

      <div className="stats-card-section">Motivos de cancelación</div>
      {motivos.length === 0 ? (
        <div className="stats-empty">Sin cancelaciones en este periodo</div>
      ) : (
        <div className="reason-list">
          {motivos.map(m => (
            <div key={m.motivo} className="reason-row">
              <div className="reason-label" title={m.motivo}>{m.motivo}</div>
              <div className="reason-bar-track">
                <div
                  className="reason-bar"
                  style={{ width: `${(m.count / maxCount) * 100}%` }}
                />
              </div>
              <div className="reason-count">{m.count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
