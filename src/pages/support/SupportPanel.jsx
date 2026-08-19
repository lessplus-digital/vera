import { useRef, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSupportConversations } from '../../hooks/useSupportConversations'
import { useRespuestasRapidas } from '../../hooks/useRespuestasRapidas'
import { parseDb } from '../../utils/dateRanges'
import { aplicarNombre } from '../../utils/quickReplies'
import ConversationItem from './ConversationItem'
import ChatBubble from './ChatBubble'
import ImageLightbox from './ImageLightbox'
import Icon from '../../components/Icon'

// El textarea crece con el contenido hasta un tope. Se llama tanto desde el
// `onInput` del usuario como tras insertar una respuesta rápida — asignar
// `value` por código no dispara `onInput`, así que sin esto la caja se quedaría
// de una línea con el texto oculto.
function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

export default function SupportPanel() {
  const {
    conversations,
    selectedPhone,
    selectedConvo,
    messages,
    loadingConvos,
    loadingMessages,
    sending,
    resolving,
    error,
    dismissError,
    selectConversation,
    sendMessage,
    resolveConversation,
  } = useSupportConversations()

  // Solo lectura aquí: se administran en Configuración › Respuestas rápidas.
  const { respuestas } = useRespuestasRapidas()
  const activas = respuestas.filter(r => r.activa)

  const [inputText,   setInputText]   = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Un solo punto de ajuste del alto, en vez de recalcularlo en cada handler:
  // corre DESPUÉS de que React pinta, que es la única forma de medir bien el
  // `scrollHeight` cuando el valor lo cambió el código (insertar una rápida,
  // limpiar al enviar o al cambiar de conversación) y no el teclado.
  useEffect(() => { autoResize(inputRef.current) }, [inputText, selectedPhone])

  function handleSend() {
    sendMessage(inputText.trim())
    setInputText('')
  }

  // Escribe la respuesta en el input — nunca la envía. El admin la revisa,
  // completa lo que falte y presiona Enviar.
  function insertQuickReply(respuesta) {
    const el = inputRef.current
    const texto = aplicarNombre(respuesta.texto, selectedConvo?.nombre)

    const ini = el?.selectionStart ?? inputText.length
    const fin = el?.selectionEnd   ?? inputText.length
    const antes   = inputText.slice(0, ini)
    const despues = inputText.slice(fin)

    // Si ya había algo escrito, separa con un espacio en vez de pegar las
    // palabras; si el input está vacío, no mete espacios de más.
    const sep = antes && !/\s$/.test(antes) ? ' ' : ''
    const siguiente = antes + sep + texto + despues

    setInputText(siguiente)

    // El cursor queda al final de lo insertado, listo para seguir escribiendo.
    requestAnimationFrame(() => {
      el?.focus()
      const pos = (antes + sep + texto).length
      el?.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSelectConvo(telefono) {
    setInputText('')
    selectConversation(telefono)
  }

  return (
    <div className="sp">

      {/* ─── LEFT SIDEBAR ─── */}
      <aside className="side">
        <div className="s-head">
          <span className="title">Conversaciones activas</span>
          <span className="count">{conversations.length}</span>
        </div>

        <div className="s-list">
          {loadingConvos ? (
            <div className="s-loading">Cargando...</div>
          ) : conversations.length === 0 ? (
            <EmptyState />
          ) : (
            conversations.map(c => (
              <ConversationItem
                key={c.telefono}
                convo={c}
                selected={c.telefono === selectedPhone}
                onClick={() => handleSelectConvo(c.telefono)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ─── RIGHT: CHAT ─── */}
      <div className="chat">
        {!selectedPhone ? (
          <NoChatSelected />
        ) : (
          <>
            <div className="chat-head">
              <div>
                <div className="ch-name">
                  {selectedConvo?.nombre || 'Cliente'}
                  <span className="phone">{selectedPhone}</span>
                </div>
                <div className="ch-status">
                  Handoff activo
                  {selectedConvo?.ultima_actividad
                    ? ` · ${formatDistanceToNow(parseDb(selectedConvo.ultima_actividad), { addSuffix: true, locale: es })}`
                    : ''}
                </div>
              </div>
              <button className="resolve" onClick={resolveConversation} disabled={resolving} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {resolving ? 'Resolviendo...' : <><Icon name="check" size={14} /> Resolver</>}
              </button>
            </div>

            <div className="messages">
              {loadingMessages ? (
                <div className="msg-placeholder">Cargando mensajes...</div>
              ) : messages.length === 0 ? (
                <div className="msg-placeholder">Sin mensajes aún.</div>
              ) : (
                messages.map(msg => (
                  <ChatBubble
                    key={msg.id}
                    msg={msg}
                    onImageClick={setLightboxUrl}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <div
                className="sp-error"
                onClick={dismissError}
                style={{
                  margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8,
                  background: 'var(--red-bg, rgba(220,38,38,.12))', color: 'var(--red, #dc2626)',
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                }}
              >
                <Icon name="x" size={12} /> {error}
              </div>
            )}

            {activas.length > 0 && (
              <div className="quick-replies">
                <span className="qr-label"><Icon name="reply" size={12} /> Rápidas</span>
                <div className="qr-chips">
                  {activas.map(r => (
                    <button
                      key={r.respuesta_id}
                      className="qr-chip"
                      onClick={() => insertQuickReply(r)}
                      title={aplicarNombre(r.texto, selectedConvo?.nombre)}
                    >
                      {r.atajo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-area">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje..."
                rows={1}
              />
              <button
                className={`send${inputText.trim() ? ' active' : ''}`}
                onClick={handleSend}
                disabled={!inputText.trim() || sending}
              >
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </>
        )}
      </div>

      <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="sp-empty">
      <div className="icon" style={{ color: 'var(--green)' }}><Icon name="check-circle" size={40} /></div>
      <div className="title">Sin conversaciones pendientes</div>
      <div className="sub">Cuando un cliente solicite hablar con un humano, aparecerá aquí.</div>
    </div>
  )
}

function NoChatSelected() {
  return (
    <div className="no-chat">
      <div className="icon" style={{ color: 'var(--text-muted)' }}><Icon name="message" size={40} /></div>
      <div className="title">Selecciona una conversación</div>
      <div className="sub">Elige un cliente de la lista para ver sus mensajes y responderle directamente por WhatsApp.</div>
    </div>
  )
}
