import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

export default function ConversationItem({ convo, selected, onClick }) {
  return (
    <button className={`convo${selected ? ' active' : ''}`} onClick={onClick}>
      <div className="row">
        <span className="name">{convo.nombre || 'Sin nombre'}</span>
        {convo.mensajes_sin_leer > 0 && (
          <span className="unread">{convo.mensajes_sin_leer}</span>
        )}
      </div>
      <span className="phone">{convo.telefono}</span>
      {convo.ultimo_mensaje && (
        <span className="preview">
          {convo.ultimo_origen === 'admin' ? '↩ ' : ''}
          {convo.ultimo_mensaje === '📷 Imagen' ? '📷 Imagen' : convo.ultimo_mensaje}
        </span>
      )}
      {convo.ultima_actividad && (
        <span className="time">
          {formatDistanceToNow(new Date(convo.ultima_actividad), { addSuffix: true, locale: es })}
        </span>
      )}
    </button>
  )
}
