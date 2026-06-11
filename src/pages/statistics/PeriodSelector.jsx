import React from 'react'
import { PRESETS } from '../../utils/dateRanges'

const GRANULARITIES = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
]

export default function PeriodSelector({
  preset, onPreset,
  customFrom, customTo, onCustomFrom, onCustomTo,
  granularity, onGranularity,
}) {
  return (
    <div className="stats-toolbar">
      <div className="stats-segment">
        {PRESETS.map(p => (
          <button
            key={p.key}
            className={`stats-segment-btn ${preset === p.key ? 'active' : ''}`}
            onClick={() => onPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="stats-custom-range">
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={e => onCustomFrom(e.target.value)}
          />
          <span>→</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={e => onCustomTo(e.target.value)}
          />
        </div>
      )}

      <div className="stats-segment" style={{ marginLeft: 'auto' }}>
        {GRANULARITIES.map(g => (
          <button
            key={g.key}
            className={`stats-segment-btn ${granularity === g.key ? 'active' : ''}`}
            onClick={() => onGranularity(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}
