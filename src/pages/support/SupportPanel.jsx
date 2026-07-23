import { useRef, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSupportConversations } from '../../hooks/useSupportConversations'
import { parseDb } from '../../utils/dateRanges'
import ConversationItem from './ConversationItem'
import ChatBubble from './ChatBubble'
import ImageLightbox from './ImageLightbox'
import Icon from '../../components/Icon'

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

  const [inputText,   setInputText]   = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    sendMessage(inputText.trim())
    setInputText('')
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

            <div className="input-area">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje..."
                rows={1}
                onInput={e => {
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
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
