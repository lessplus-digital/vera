import React from 'react'

// Recharts renderiza SVG: stroke/fill aceptan var(--x) directamente,
// así las gráficas reaccionan al toggle dark/light sin re-render.

export const axisProps = {
  stroke: 'var(--text-muted)',
  tick: { fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  tickLine: false,
  axisLine: { stroke: 'var(--border)' },
}

export const gridProps = {
  stroke: 'var(--border)',
  vertical: false,
}

export const barCursor = { fill: 'var(--bg-card-hover)' }

// Tooltip custom: el default de Recharts no respeta bien las CSS vars.
// formatter opcional: (value, name) => string
export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: '8px 12px',
      fontSize: 12,
    }}>
      {label != null && (
        <div style={{ color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
          {label}
        </div>
      )}
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 2,
            background: entry.color || entry.fill, flexShrink: 0,
          }} />
          <span style={{ color: 'var(--text-muted)' }}>{entry.name}:</span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {formatter ? formatter(entry.value, entry.dataKey) : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}
