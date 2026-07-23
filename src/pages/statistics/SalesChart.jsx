import React from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { axisProps, gridProps, barCursor, ChartTooltip } from './ChartTheme'
import { formatPrice, formatPriceShort } from '../../utils/formatters'

export default function SalesChart({ data }) {
  const empty = data.every(d => d.pedidos === 0)
  return (
    <div className="stats-card">
      <div className="stats-card-title">Pedidos e ingresos</div>
      {empty ? (
        <div className="stats-empty">Sin datos en este periodo</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="bucket" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis yAxisId="left" {...axisProps} allowDecimals={false} width={36} />
            <YAxis yAxisId="right" orientation="right" {...axisProps} tickFormatter={formatPriceShort} width={56} />
            <Tooltip
              cursor={barCursor}
              content={<ChartTooltip formatter={(v, key) => (key === 'ingresos' ? formatPrice(v) : v)} />}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} iconSize={10} />
            <Bar yAxisId="left" dataKey="pedidos" name="Pedidos" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Line yAxisId="right" type="monotone" dataKey="ingresos" name="Ingresos" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2, fill: 'var(--chart-1)' }} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
