import React from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { ChartTooltip } from './ChartTheme'
import { formatPrice } from '../../utils/formatters'

// Paleta categórica validada (index.css) — orden fijo, sin ciclar:
// las categorías más allá del top 3 se agrupan en "otras" (muted).
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--text-muted)']
const MAX_SLICES = 3

export default function CategoryRevenue({ data }) {
  // Top 5 categorías + "otras" agrupadas
  const slices = data.slice(0, MAX_SLICES)
  const resto = data.slice(MAX_SLICES).reduce((s, d) => s + d.ingresos, 0)
  if (resto > 0) slices.push({ categoria: 'otras', ingresos: resto })
  const total = slices.reduce((s, d) => s + d.ingresos, 0)

  return (
    <div className="stats-card">
      <div className="stats-card-title">Ingresos por categoría</div>

      {total === 0 ? (
        <div className="stats-empty">Sin datos en este periodo</div>
      ) : (
        <div className="cat-revenue">
          <ResponsiveContainer width="45%" height={210}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="ingresos"
                nameKey="categoria"
                innerRadius="55%"
                outerRadius="90%"
                paddingAngle={2}
                stroke="var(--bg-card)"
              >
                {slices.map((s, i) => (
                  <Cell key={s.categoria} fill={PALETTE[Math.min(i, PALETTE.length - 1)]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip formatter={v => formatPrice(v)} />} />
            </PieChart>
          </ResponsiveContainer>

          <div className="cat-legend">
            {slices.map((s, i) => (
              <div key={s.categoria} className="cat-legend-row">
                <span className="cat-dot" style={{ background: PALETTE[Math.min(i, PALETTE.length - 1)] }} />
                <span className="cat-name">{s.categoria}</span>
                <span className="cat-pct">{((s.ingresos / total) * 100).toFixed(0)}%</span>
                <span className="cat-amount">{formatPrice(s.ingresos)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
