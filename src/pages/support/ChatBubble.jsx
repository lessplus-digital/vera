import { parseDb } from '../../utils/dateRanges'
import Icon from '../../components/Icon'

export default function ChatBubble({ msg, onImageClick }) {
  const isSystem = msg.origen === 'sistema'
  const isAdmin  = msg.origen === 'admin'
  const isImage  = msg.tipo_contenido === 'imagen' && msg.imagen_url

  if (isSystem) {
    return (
      <div className="bubble-system">
        <span>{msg.mensaje}</span>
      </div>
    )
  }

  const side      = isAdmin ? 'right' : 'left'
  const bubbleCls = `bubble ${isAdmin ? 'admin' : 'client'}${isImage ? ' img' : ''}`

  return (
    <div className={`bubble-wrap ${side}`}>
      <div className={bubbleCls}>
        <div className={`sender ${isAdmin ? 'admin' : 'client'}${isImage ? ' img-pad' : ''}`}>
          {isAdmin ? 'Tú' : 'Cliente'}
        </div>

        {isImage ? (
          <div>
            <img
              src={msg.imagen_url}
              alt="Imagen del cliente"
              className="img-thumb"
              onClick={() => onImageClick?.(msg.imagen_url)}
              loading="lazy"
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            <div className="img-error">
              <span style={{ display: 'inline-flex' }}><Icon name="alert" size={14} /></span>
              <span>No se pudo cargar la imagen</span>
            </div>
            {msg.mensaje && msg.mensaje !== '📷 Imagen' && (
              <div className="img-caption">{msg.mensaje}</div>
            )}
          </div>
        ) : (
          <div className="text">{msg.mensaje}</div>
        )}

        <div className={`time${isImage ? ' img-pad' : ''}`}>
          {parseDb(msg.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
