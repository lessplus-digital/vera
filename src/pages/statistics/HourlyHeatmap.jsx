import React from 'react'

// Heatmap 7×24 (día de la semana × hora Colombia) con intensidad amber.
export default function HourlyHeatmap({ heatmap }) {
  const { rows, max } = heatmap
  const empty = max === 0

  return (
    <div className="stats-card">
      <div className="stats-card-title">Horas y días pico</div>
      <div className="stats-card-subtitle">Pedidos por día y hora (hora Colombia)</div>

      {empty ? (
        <div className="stats-empty">Sin datos en este periodo</div>
      ) : (
        <div className="heatmap">
          {rows.map(row => (
            <div key={row.dia} className="heatmap-row">
              <span className="heatmap-day">{row.dia}</span>
              <div className="heatmap-cells">
                {row.horas.map((count, h) => (
                  <div
                    key={h}
                    className="heatmap-cell"
                    title={`${row.dia} ${String(h).padStart(2, '0')}:00 — ${count} pedido${count === 1 ? '' : 's'}`}
                    style={count > 0 ? {
                      background: `rgba(245, 158, 11, ${0.18 + 0.82 * (count / max)})`,
                    } : undefined}
                  />
                ))}
              </div>
              <span className="heatmap-total">{row.total || ''}</span>
            </div>
          ))}

          <div className="heatmap-row">
            <span className="heatmap-day" />
            <div className="heatmap-cells labels">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="heatmap-hour">
                  {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
            </div>
            <span className="heatmap-total" />
          </div>
        </div>
      )}
    </div>
  )
}
