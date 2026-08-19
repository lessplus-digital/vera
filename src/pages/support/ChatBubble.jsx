import { parseDb } from '../../utils/dateRanges'
import Icon from '../../components/Icon'

// `origen` puede ser: cliente · admin · sistema · bot.
// `bot` son los turnos del agente IA que se recuperan del historial al escalar la
// conversación (ver la RPC `registrar_contexto_handoff`): van del lado del cliente
// pero atenuados, porque son contexto pasado y no algo que haya que responder.
const ROLES = {
  admin:   { side: 'right', cls: 'admin',  label: 'Tú'      },
  bot:     { side: 'left',  cls: 'bot',    label: 'Bot'     },
  cliente: { side: 'left',  cls: 'client', label: 'Cliente' },
}

export default function ChatBubble({ msg, onImageClick }) {
  const isSystem = msg.origen === 'sistema'
  const isImage  = msg.tipo_contenido === 'imagen' && msg.imagen_url

  if (isSystem) {
    return (
      <div className="bubble-system">
        <span>{msg.mensaje}</span>
      </div>
    )
  }

  const role      = ROLES[msg.origen] || ROLES.cliente
  const bubbleCls = `bubble ${role.cls}${isImage ? ' img' : ''}`

  return (
    <div className={`bubble-wrap ${role.side}`}>
      <div className={bubbleCls}>
        <div className={`sender ${role.cls}${isImage ? ' img-pad' : ''}`}>
          {role.label}
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
