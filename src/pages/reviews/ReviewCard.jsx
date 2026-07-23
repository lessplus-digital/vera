import React from 'react'
import Icon from '../../components/Icon'
import Stars from './Stars'
import { sentimentOf, SENTIMENT_META } from './sentiment'
import { parseDb, toColombia } from '../../utils/dateRanges'
import { timeAgo, formatPrice, formatPhone } from '../../utils/formatters'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Fecha absoluta en hora Colombia para el tooltip (la columna es UTC sin tz).
function fechaColombia(fecha) {
  const d = toColombia(fecha)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`
}

export default function ReviewCard({ review, onReply }) {
  const sent = sentimentOf(review.nota)
  const meta = SENTIMENT_META[sent]
  const inicial = (review.nombre || '?').trim().charAt(0).toUpperCase()
  const tieneComentario = review.comentario && review.comentario.trim()
  const telefono = formatPhone(review.telefono)
  const resuelta = !!review.resueltaAt

  return (
    <article className={`rev-card ${sent}${resuelta ? ' resolved' : ''}`}>
      <div className="rev-card-top">
        <span className={`rev-avatar ${sent}`}>{inicial}</span>
        <div className="rev-who">
          <span className="rev-name">{review.nombre || 'Cliente'}</span>
          <span className="rev-meta">
            <Stars value={review.nota || 0} size={13} />
            <span className="rev-dot">·</span>
            <time title={fechaColombia(review.fecha)}>{timeAgo(parseDb(review.fecha))}</time>
          </span>
          {telefono && (
            <span className="rev-phone"><Icon name="phone" size={11} /> {telefono}</span>
          )}
        </div>
        <span className={`rev-badge ${meta.tone}`}>{meta.label}</span>
      </div>

      {/* Las positivas van a Google sin comentario (el bot no lo pide para nota ≥4);
          si por dato viejo hubiera uno, no se muestra — solo el label de Google en el pie. */}
      {sent !== 'pos' && (
        tieneComentario ? (
          <p className="rev-comment">{review.comentario}</p>
        ) : (
          <p className="rev-comment empty">Calificó {review.nota}★ sin dejar comentario.</p>
        )
      )}

      <div className="rev-card-foot">
        <span className="rev-order">
          <Icon name="bag" size={12} /> {review.pedido_id}
          {review.total != null && <> · <span className="tnum">{formatPrice(review.total)}</span></>}
        </span>
        {sent === 'pos' ? (
          <span className="rev-google" title="El bot invita a las reseñas positivas a Google">
            <Icon name="star" size={12} /> Invitado a Google
          </span>
        ) : resuelta ? (
          <span className="rev-resolved" title={`Resuelta ${timeAgo(parseDb(review.resueltaAt))}`}>
            <Icon name="check-circle" size={13} /> Resuelta
          </span>
        ) : (
          <button className="rev-act" onClick={() => onReply(review)} title="Contactar al cliente por su reseña">
            <Icon name="message" size={13} /> Responder
          </button>
        )}
      </div>
    </article>
  )
}
