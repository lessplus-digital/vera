import React from 'react'
import { formatPrice } from '../../utils/formatters'
import Icon from '../../components/Icon'

function Delta({ value }) {
  if (value == null) return <span className="kpi-delta muted">—</span>
  const up = value >= 0
  return (
    <span className={`kpi-delta ${up ? 'up' : 'down'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon name={up ? 'arrow-up' : 'arrow-down'} size={12} /> {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function KpiCard({ label, value, delta, hint, color }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      <div className="kpi-footer">
        {delta !== undefined ? <Delta value={delta} /> : <span className="kpi-delta muted">{hint || ''}</span>}
        {delta !== undefined && <span className="kpi-hint">vs periodo anterior</span>}
      </div>
    </div>
  )
}

export default function KpiCards({ kpis, deltas, rating }) {
  return (
    <div className="kpi-grid">
      {/* Valores en tinta neutra; el color queda para los deltas (verde/rojo)
          y para "Cancelados" > 0 como señal de estado. */}
      <KpiCard label="Pedidos" value={kpis.pedidos} delta={deltas.pedidos} />
      <KpiCard label="Ingresos" value={formatPrice(kpis.ingresos)} delta={deltas.ingresos} />
      <KpiCard label="Ticket promedio" value={formatPrice(Math.round(kpis.ticketPromedio))} delta={deltas.ticketPromedio} />
      <KpiCard
        label="Cancelados"
        value={`${kpis.tasaCancelacion.toFixed(1)}%`}
        hint={`${kpis.cancelados} pedido${kpis.cancelados === 1 ? '' : 's'}`}
        color={kpis.cancelados > 0 ? 'var(--red)' : undefined}
      />
      <KpiCard
        label="Calificación"
        value={rating.promedio != null
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="star" size={16} /> {rating.promedio.toFixed(1)}</span>
          : '—'}
        hint={rating.count > 0 ? `${rating.count} reseña${rating.count === 1 ? '' : 's'}` : 'Sin reseñas'}
      />
    </div>
  )
}
