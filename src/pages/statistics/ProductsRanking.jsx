import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts'
import { axisProps, barCursor, ChartTooltip } from './ChartTheme'

function RankChart({ data, color }) {
  if (data.length === 0) return <div className="stats-empty">Sin datos en este periodo</div>
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="nombre"
          width={150}
          {...axisProps}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-sans)' }}
        />
        <Tooltip cursor={barCursor} content={<ChartTooltip />} />
        <Bar dataKey="cantidad" name="Unidades" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18}
          label={{ position: 'right', fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function ProductsRanking({ top, bottom, categorias, categoria, onCategoria }) {
  return (
    <div className="stats-card">
      <div className="stats-card-head">
        <div className="stats-card-title">Productos</div>
        <select
          className="stats-select"
          value={categoria}
          onChange={e => onCategoria(e.target.value)}
        >
          <option value="todas">Todas las categorías</option>
          {categorias.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="stats-card-section">Más pedidos</div>
      <RankChart data={top} color="var(--green)" />

      <div className="stats-card-section">Menos pedidos</div>
      <RankChart data={bottom} color="var(--red)" />
    </div>
  )
}
