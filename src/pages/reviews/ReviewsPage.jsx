import React, { useState, useMemo, useEffect } from 'react'
import { useReviews } from '../../hooks/useReviews'
import { sentimentOf } from './sentiment'
import SatisfactionSummary from './SatisfactionSummary'
import ReviewCard from './ReviewCard'
import ReplyModal from './ReplyModal'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

// El feed revela tarjetas por lotes ("Mostrar más") en vez de paginar como una
// tabla: encaja mejor con un grid de cards y el panel de satisfacción sigue
// agregando sobre TODO el conjunto (no solo lo visible). El hook cachea hasta
// 2000 reseñas; si algún día se supera, migrar a server-side como el Historial.
const BATCH = 24

// Filtros con las negativas primero: la prioridad del operador es resolver esos
// casos. "Todas" queda al final como vista general.
const SENTIMENTS = [
  { key: 'neg',   label: 'Negativas', tone: 'red'    },
  { key: 'neu',   label: 'Neutras',   tone: 'amber'  },
  { key: 'pos',   label: 'Positivas', tone: 'green'  },
  { key: 'todas', label: 'Todas',     tone: null    },
]

// Prioridad de orden del feed: negativas → neutras → positivas.
const SENT_ORDER = { neg: 0, neu: 1, pos: 2 }

export default function ReviewsPage() {
  const { reviews, loading, error, handoffToSupport, marcarResuelta } = useReviews()
  const [sentiment, setSentiment] = useState('todas')
  const [search, setSearch] = useState('')
  const [onlyComment, setOnlyComment] = useState(false)
  const [visible, setVisible] = useState(BATCH)
  const [replyTarget, setReplyTarget] = useState(null)
  const { toast, showToast } = useToast()

  // Conteos por sentimiento para los chips del filtro.
  const counts = useMemo(() => {
    const c = { todas: reviews.length, pos: 0, neu: 0, neg: 0 }
    for (const r of reviews) c[sentimentOf(r.nota)]++
    return c
  }, [reviews])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = reviews.filter(r => {
      if (sentiment !== 'todas' && sentimentOf(r.nota) !== sentiment) return false
      if (onlyComment && !(r.comentario && r.comentario.trim())) return false
      if (!q) return true
      return (
        (r.nombre || '').toLowerCase().includes(q) ||
        (r.comentario || '').toLowerCase().includes(q) ||
        (r.pedido_id || '').toLowerCase().includes(q)
      )
    })

    // Orden: negativas → neutras → positivas y, dentro de cada grupo, las
    // pendientes antes que las resueltas. El sort es estable (V8), así que
    // dentro de empates se conserva el orden por fecha desc que trae el hook.
    return result.sort((a, b) => {
      const s = SENT_ORDER[sentimentOf(a.nota)] - SENT_ORDER[sentimentOf(b.nota)]
      if (s !== 0) return s
      return (a.resueltaAt ? 1 : 0) - (b.resueltaAt ? 1 : 0)
    })
  }, [reviews, sentiment, search, onlyComment])

  // Al cambiar cualquier filtro, volver al primer lote.
  useEffect(() => { setVisible(BATCH) }, [sentiment, search, onlyComment])

  const shown = filtered.slice(0, visible)
  const remaining = filtered.length - shown.length

  return (
    <div className="rev-page">
      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando reseñas…</div>
      ) : error ? (
        <div className="rev-error">Error cargando las reseñas: {error}</div>
      ) : reviews.length === 0 ? (
        <div className="rev-empty">
          <span className="rev-empty-icon"><Icon name="star" size={30} /></span>
          <h3>Aún no hay reseñas</h3>
          <p>
            Cuando un pedido se entrega, el bot le pide al cliente una calificación por WhatsApp.
            Las notas y comentarios aparecerán aquí para que puedas responder y recuperar clientes.
          </p>
        </div>
      ) : (
        <>
          <SatisfactionSummary reviews={reviews} />

          <div className="rev-toolbar">
            <div className="rev-segmented">
              {SENTIMENTS.map(s => (
                <button
                  key={s.key}
                  className={`rev-seg${sentiment === s.key ? ' active' : ''}${s.tone ? ` ${s.tone}` : ''}`}
                  onClick={() => setSentiment(s.key)}
                >
                  {s.label}
                  <span className="rev-seg-count tnum">{counts[s.key]}</span>
                </button>
              ))}
            </div>

            <input
              className="rev-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por cliente, comentario o pedido…"
            />

            <button
              className={`rev-chip${onlyComment ? ' active' : ''}`}
              onClick={() => setOnlyComment(v => !v)}
              title="Mostrar solo reseñas con comentario"
            >
              <Icon name="message" size={13} /> Con comentario
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="rev-empty small">
              No hay reseñas con esos filtros.
            </div>
          ) : (
            <>
              <div className="rev-feed">
                {shown.map(r => (
                  <ReviewCard
                    key={r.feedback_id}
                    review={r}
                    onReply={setReplyTarget}
                  />
                ))}
              </div>

              {remaining > 0 && (
                <div className="rev-more">
                  <button className="rev-more-btn" onClick={() => setVisible(v => v + BATCH)}>
                    Mostrar más
                    <span className="rev-more-count tnum">{remaining} restantes</span>
                  </button>
                  <span className="rev-more-info">
                    Mostrando {shown.length} de {filtered.length}
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {replyTarget && (
        <ReplyModal
          review={replyTarget}
          onClose={() => setReplyTarget(null)}
          onResult={({ ok, message }) => showToast(ok ? 'success' : 'error', message)}
          handoffToSupport={handoffToSupport}
          marcarResuelta={marcarResuelta}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
