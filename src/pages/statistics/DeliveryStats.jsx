import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { axisProps, gridProps, barCursor, ChartTooltip } from './ChartTheme'

const fmtMin = m => (m == null ? '—' : `${Math.round(m)} min`)

export default function DeliveryStats({ entrega }) {
  return (
    <div className="stats-card">
      <div className="stats-card-title">Tiempo de entrega</div>
      <div className="stats-card-subtitle">Desde el pedido hasta marcado entregado</div>

      <div className="cancel-summary" style={{ marginTop: 12 }}>
        <div className="cancel-stat">
          <div className="cancel-stat-value green">{fmtMin(entrega.promedio)}</div>
          <div className="cancel-stat-label">Promedio ({entrega.count})</div>
        </div>
        <div className="cancel-stat">
          <div className="cancel-stat-value">{fmtMin(entrega.promedioDomicilio)}</div>
          <div className="cancel-stat-label">Domicilio</div>
        </div>
        <div className="cancel-stat">
          <div className="cancel-stat-value">{fmtMin(entrega.promedioRecoger)}</div>
          <div className="cancel-stat-label">Recoger</div>
        </div>
      </div>

      <div className="stats-card-section">Distribución</div>
      {entrega.count === 0 ? (
        <div className="stats-empty">
          Sin tiempos registrados en este periodo
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={entrega.buckets} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="rango" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} width={28} />
            <Tooltip cursor={barCursor} content={<ChartTooltip />} />
            <Bar dataKey="pedidos" name="Pedidos" fill="var(--green)" radius={[3, 3, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
