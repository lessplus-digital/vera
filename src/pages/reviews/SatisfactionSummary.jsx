import React, { useMemo } from 'react'
import Stars from './Stars'
import { sentimentOf } from './sentiment'

// Panel superior: el pulso de satisfacción. Nota promedio, distribución de
// estrellas y termómetro de sentimiento. Todo agregado en cliente desde las
// reseñas cargadas (volumen acotado).
export default function SatisfactionSummary({ reviews }) {
  const s = useMemo(() => {
    const conNota = reviews.filter(r => r.nota != null)
    const total = conNota.length
    const suma = conNota.reduce((acc, r) => acc + Number(r.nota), 0)
    const promedio = total ? suma / total : 0

    // Distribución 5→1
    const dist = [5, 4, 3, 2, 1].map(n => ({
      n,
      count: conNota.filter(r => r.nota === n).length,
    }))
    const maxDist = Math.max(1, ...dist.map(d => d.count))

    let pos = 0, neu = 0, neg = 0
    for (const r of conNota) {
      const sent = sentimentOf(r.nota)
      if (sent === 'pos') pos++
      else if (sent === 'neg') neg++
      else neu++
    }
    const pct = c => (total ? (c / total) * 100 : 0)

    return {
      total, promedio, dist, maxDist,
      pos, neu, neg,
      posPct: pct(pos), neuPct: pct(neu), negPct: pct(neg),
      conComentario: reviews.filter(r => r.comentario && r.comentario.trim()).length,
    }
  }, [reviews])

  const sentimentCards = [
    { key: 'pos', tone: 'pos', label: 'Positivas', count: s.pos, pct: s.posPct },
    { key: 'neu', tone: 'neu', label: 'Neutras',   count: s.neu, pct: s.neuPct },
    { key: 'neg', tone: 'neg', label: 'Negativas',  count: s.neg, pct: s.negPct },
  ]

  return (
    <section className="rev-summary">
      {/* Score + distribución */}
      <div className="rev-hero">
        <div className="rev-score">
          <div className="rev-score-num tnum">{s.promedio.toFixed(1)}</div>
          <Stars value={s.promedio} size={18} />
          <div className="rev-score-count">
            {s.total} {s.total === 1 ? 'reseña' : 'reseñas'}
          </div>
          {s.pos > 0 && (
            <div className="rev-score-hint">≈{s.pos} invitadas a Google</div>
          )}
        </div>

        <div className="rev-dist">
          {s.dist.map(d => (
            <div className="rev-dist-row" key={d.n}>
              <span className="rev-dist-label">{d.n}<span className="rev-dist-star">★</span></span>
              <span className="rev-dist-track">
                <span
                  className={`rev-dist-fill s${d.n}`}
                  style={{ width: `${(d.count / s.maxDist) * 100}%` }}
                />
              </span>
              <span className="rev-dist-count tnum">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sentimiento en tarjetas pastel */}
      <div className="rev-sentiment">
        {sentimentCards.map(c => (
          <div className={`rev-sent-card ${c.tone}`} key={c.key}>
            <span className="rev-sent-num tnum">{c.count}</span>
            <span className="rev-sent-label">{c.label}</span>
            <span className="rev-sent-pct tnum">{s.total ? Math.round(c.pct) : 0}%</span>
          </div>
        ))}
      </div>
    </section>
  )
}
