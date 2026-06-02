import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ─── CONFIG ──────────────────────────────────────────────
// ⚠️ En producción: mover a Supabase Edge Function para no
// exponer el token en el frontend.
const WA_PHONE_NUMBER_ID = '1026022853935447'
const WA_API_VERSION = 'v25.0'
const WA_ACCESS_TOKEN = 'EAASmnZAekbwoBRhq1ZBZA8619wRerkoR0CQTvfQMnQf9WBySGwYsUD5pNZBKdewT1lDMY1a8PWbqqxHK8VSRh8x1RgOvMhEUozGhXpoKHp1BL6ZAZCkfYoDWguaCbfZAVTgM3hmMTZARVkE0ZBOIpb8OoDsY0e3bM7bC1JMZAxUwJIvGBzEQ4RahwSSQOApktRcAZDZD'

// ─── MAIN COMPONENT ─────────────────────────────────────
export default function SupportPanel() {
  const [conversations, setConversations] = useState([])
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingConvos, setLoadingConvos] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [resolving, setResolving] = useState(false)
  const messagesEndRef = useRef(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  // ─── Fetch conversations from the view ───────────────
  const fetchConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('conversaciones_soporte')
      .select('*')

    if (!error && data) setConversations(data)
    setLoadingConvos(false)
  }, [])

  // ─── Fetch messages for a phone number ───────────────
  const fetchMessages = useCallback(async (telefono) => {
    if (!telefono) return
    setLoadingMessages(true)
    const { data, error } = await supabase
      .from('mensajes_soporte')
      .select('*')
      .eq('telefono', telefono)
      .order('created_at', { ascending: true })

    if (!error && data) setMessages(data)
    setLoadingMessages(false)
  }, [])

  // ─── Initial load ────────────────────────────────────
  useEffect(() => { fetchConversations() }, [fetchConversations])

  // ─── Realtime: new messages ──────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('soporte-messages-rt')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensajes_soporte' },
        (payload) => {
          const msg = payload.new
          if (msg.telefono === selectedPhone) {
            setMessages(prev => [...prev, msg])
          }
          fetchConversations()
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [selectedPhone, fetchConversations])

  // ─── Realtime: clientes mode changes ─────────────────
  useEffect(() => {
    const channel = supabase
      .channel('soporte-clientes-rt')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clientes' },
        () => { fetchConversations() }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [fetchConversations])

  // ─── Auto-scroll ─────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Select conversation ─────────────────────────────
  function handleSelectConvo(telefono) {
    setSelectedPhone(telefono)
    setInputText('')
    fetchMessages(telefono)
  }

  // ─── Send message via WhatsApp ───────────────────────
  async function handleSend() {
    const text = inputText.trim()
    if (!text || !selectedPhone || sending) return

    if (!WA_ACCESS_TOKEN) {
      alert('WA_ACCESS_TOKEN no configurado. Edita SupportPanel.jsx línea 10.')
      return
    }

    setSending(true)

    // 1. Guardar en BD (aparece vía realtime)
    const { error: dbError } = await supabase
      .from('mensajes_soporte')
      .insert({ telefono: selectedPhone, origen: 'admin', mensaje: text })

    if (dbError) {
      setSending(false)
      alert('Error guardando mensaje.')
      return
    }

    // 2. Enviar por WhatsApp API
    try {
      const res = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: selectedPhone,
            type: 'text',
            text: { body: text },
          }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Mensaje guardado, pero error WhatsApp: ${err?.error?.message || res.statusText}`)
      }
    } catch (_) {
      alert('Mensaje guardado, pero error de red al enviar por WhatsApp.')
    }

    setInputText('')
    setSending(false)
  }

  // ─── Resolve conversation ────────────────────────────
  async function handleResolve() {
    if (!selectedPhone || resolving) return
    setResolving(true)

    // Mensaje del sistema
    await supabase.from('mensajes_soporte').insert({
      telefono: selectedPhone,
      origen: 'sistema',
      mensaje: 'Conversación resuelta. El cliente vuelve al bot.',
    })

    // Cambiar modo a bot
    await supabase
      .from('clientes')
      .update({ modo: 'bot' })
      .eq('telefono', selectedPhone)

    // Notificar al cliente
    if (WA_ACCESS_TOKEN) {
      try {
        await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: selectedPhone,
              type: 'text',
              text: { body: '¡Listo! Tu consulta ha sido resuelta. Si necesitas algo más, escríbeme y con gusto te ayudo 🍕' },
            }),
          }
        )
      } catch (_) { /* no bloquear */ }
    }

    setResolving(false)
    setSelectedPhone(null)
    setMessages([])
    fetchConversations()
  }

  // ─── Enter key ───────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectedConvo = conversations.find(c => c.telefono === selectedPhone)

  // ═══════════════════════════════════════════════════════
  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 56px)',
      overflow: 'hidden',
    }}>

      {/* ─── LEFT SIDEBAR ─── */}
      <aside style={{
        width: 320,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Conversaciones activas
          </span>
          <span style={{
            background: 'var(--blue-dim)',
            color: 'var(--blue)',
            border: '1px solid var(--blue-border)',
            borderRadius: 20,
            padding: '1px 8px',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
          }}>
            {conversations.length}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
          {loadingConvos ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Cargando...
            </div>
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
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}>
        {!selectedPhone ? (
          <NoChatSelected />
        ) : (
          <>
            {/* Chat header */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {selectedConvo?.nombre || 'Cliente'}
                  <span style={{
                    background: 'var(--blue-dim)', color: 'var(--blue)',
                    border: '1px solid var(--blue-border)', borderRadius: 20,
                    padding: '1px 8px', fontSize: 10, fontWeight: 500,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {selectedPhone}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Handoff activo
                  {selectedConvo?.ultima_actividad
                    ? ` · ${formatDistanceToNow(new Date(selectedConvo.ultima_actividad), { addSuffix: true, locale: es })}`
                    : ''}
                </div>
              </div>
              <button
                onClick={handleResolve}
                disabled={resolving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  background: 'var(--green-dim)', color: 'var(--green)',
                  border: '1px solid var(--green-border)', borderRadius: 8,
                  cursor: resolving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-sans)',
                  opacity: resolving ? 0.6 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {resolving ? 'Resolviendo...' : '✓ Resolver'}
              </button>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '16px 20px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {loadingMessages ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 24 }}>
                  Cargando mensajes...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 24 }}>
                  Sin mensajes aún.
                </div>
              ) : (
                messages.map(msg => (
                  <ChatBubble
                    key={msg.id}
                    msg={msg}
                    onImageClick={(url) => setLightboxUrl(url)}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex', gap: 10, alignItems: 'flex-end',
              flexShrink: 0,
            }}>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje..."
                rows={1}
                style={{
                  flex: 1, padding: '10px 14px', fontSize: 13,
                  fontFamily: 'var(--font-sans)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  resize: 'none', outline: 'none',
                  lineHeight: 1.5, maxHeight: 120, overflow: 'auto',
                }}
                onInput={e => {
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--blue-border)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || sending}
                style={{
                  padding: '10px 18px', fontSize: 13, fontWeight: 600,
                  background: inputText.trim() ? 'var(--blue)' : 'var(--bg-card)',
                  color: inputText.trim() ? '#fff' : 'var(--text-muted)',
                  border: inputText.trim()
                    ? '1px solid var(--blue)'
                    : '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: (!inputText.trim() || sending) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-sans)',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </>
        )}
      </div>
      {/* ─── Image Lightbox ─── */}
      <ImageLightbox
        src={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
      </div>
  )
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════

function ConversationItem({ convo, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        width: '100%', padding: '10px 12px',
        background: selected ? 'var(--blue-dim)' : 'transparent',
        border: selected ? '1px solid var(--blue-border)' : '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'var(--font-sans)',
        transition: 'all 0.1s ease',
        marginBottom: 2,
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', width: '100%',
      }}>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: selected ? 'var(--blue)' : 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {convo.nombre || 'Sin nombre'}
        </span>
        {convo.mensajes_sin_leer > 0 && (
          <span style={{
            background: 'var(--red)', color: '#fff',
            fontSize: 10, fontWeight: 700,
            borderRadius: 10, padding: '1px 6px',
            minWidth: 18, textAlign: 'center',
            fontFamily: 'var(--font-mono)', lineHeight: '16px',
            flexShrink: 0,
          }}>
            {convo.mensajes_sin_leer}
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {convo.telefono}
      </span>
      {convo.ultimo_mensaje && (
        <span style={{
          fontSize: 11, color: 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', width: '100%',
        }}>
          {convo.ultimo_origen === 'admin' ? '↩ ' : ''}
          {convo.ultimo_mensaje === '📷 Imagen'
            ? '📷 Imagen'
            : convo.ultimo_mensaje}
        </span>
      )}
      {convo.ultima_actividad && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {formatDistanceToNow(new Date(convo.ultima_actividad), { addSuffix: true, locale: es })}
        </span>
      )}
    </button>
  )
}

function ChatBubble({ msg, onImageClick }) {
  const isSystem = msg.origen === 'sistema'
  const isAdmin = msg.origen === 'admin'
  const isImage = msg.tipo_contenido === 'imagen' && msg.imagen_url

  if (isSystem) {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 20, padding: '3px 12px',
          fontStyle: 'italic',
        }}>
          {msg.mensaje}
        </span>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isAdmin ? 'flex-end' : 'flex-start',
      padding: '2px 0',
    }}>
      <div style={{
        maxWidth: '70%',
        padding: isImage ? '6px' : '8px 12px',
        borderRadius: isAdmin ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        background: isAdmin ? 'var(--blue-dim)' : 'var(--bg-card)',
        border: `1px solid ${isAdmin ? 'var(--blue-border)' : 'var(--border)'}`,
      }}>
        {/* ─── Label origen ─── */}
        <div style={{
          fontSize: 10, fontWeight: 600,
          marginBottom: 3,
          color: isAdmin ? 'var(--blue)' : 'var(--amber)',
          padding: isImage ? '2px 6px 0' : 0,
        }}>
          {isAdmin ? 'Tú' : 'Cliente'}
        </div>

        {/* ─── Contenido: imagen o texto ─── */}
        {isImage ? (
          <div>
            <img
              src={msg.imagen_url}
              alt="Imagen del cliente"
              onClick={() => onImageClick && onImageClick(msg.imagen_url)}
              style={{
                maxWidth: '100%',
                maxHeight: 280,
                borderRadius: 8,
                cursor: 'pointer',
                display: 'block',
                objectFit: 'cover',
              }}
              loading="lazy"
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            {/* Fallback si la imagen no carga */}
            <div style={{
              display: 'none',
              alignItems: 'center',
              gap: 6,
              padding: '8px 6px',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}>
              <span>⚠️</span>
              <span>No se pudo cargar la imagen</span>
            </div>

            {/* Caption (si el mensaje no es solo "📷 Imagen") */}
            {msg.mensaje && msg.mensaje !== '📷 Imagen' && (
              <div style={{
                fontSize: 13, color: 'var(--text-primary)',
                lineHeight: 1.5, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                padding: '4px 6px 0',
              }}>
                {msg.mensaje}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            fontSize: 13, color: 'var(--text-primary)',
            lineHeight: 1.5, whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {msg.mensaje}
          </div>
        )}

        {/* ─── Timestamp ─── */}
        <div style={{
          fontSize: 10, color: 'var(--text-muted)',
          marginTop: 4, textAlign: 'right',
          padding: isImage ? '0 6px 2px' : 0,
        }}>
          {new Date(msg.created_at).toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
        Sin conversaciones pendientes
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Cuando un cliente solicite hablar con un humano, aparecerá aquí.
      </div>
    </div>
  )
}

function NoChatSelected() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 40,
    }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
        Selecciona una conversación
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 280, lineHeight: 1.5 }}>
        Elige un cliente de la lista para ver sus mensajes y responderle directamente por WhatsApp.
      </div>
    </div>
  )
}

function ImageLightbox({ src, onClose }) {
  if (!src) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        padding: 24,
      }}
    >
      {/* Botón cerrar */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 20,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          padding: '6px 14px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          backdropFilter: 'blur(8px)',
        }}
      >
        ✕ Cerrar
      </button>

      {/* Abrir en nueva pestaña */}
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 16,
          right: 110,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
          fontWeight: 500,
          padding: '6px 14px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          backdropFilter: 'blur(8px)',
          textDecoration: 'none',
        }}
      >
        ↗ Abrir original
      </a>

      <img
        src={src}
        alt="Imagen ampliada"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: 'default',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  )
}