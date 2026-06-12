import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import Icon from '../../components/Icon'

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
        <span className="preview" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {convo.ultimo_origen === 'admin' && <Icon name="reply" size={11} />}
          {convo.ultimo_mensaje === '📷 Imagen'
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="camera" size={12} /> Imagen</span>
            : convo.ultimo_mensaje}
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
