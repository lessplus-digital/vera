import React, { useState } from 'react'
import Icon from '../../components/Icon'
import { sendWhatsAppTemplate } from '../../lib/whatsapp'
import { WA_TEMPLATES } from '../../utils/constants'
import { formatPhone } from '../../utils/formatters'

function firstName(nombre) {
  return (nombre || '').trim().split(/\s+/)[0] || ''
}

// Vista previa del cuerpo de la plantilla `seguimiento_resena` con las variables
// resueltas. Debe reflejar el texto aprobado en Meta ({{1}} nombre, {{2}} pedido).
function previewText(review) {
  const nom = firstName(review.nombre) || 'Cliente'
  return `Hola ${nom} 👋 Vimos que tu experiencia con el pedido ${review.pedido_id} no fue la mejor y de verdad lo lamentamos. Nos encantaría escucharte para solucionarlo. ¿Nos cuentas qué pasó?`
}

// Contactar a un cliente por una reseña negativa/neutra. Va SIEMPRE por la
// plantilla aprobada `seguimiento_resena` (no texto libre): fuera de la ventana
// de 24h de Meta el texto libre se "acepta" pero no se entrega — la plantilla es
// la única vía confiable. Al enviarla se hace handoff (modo=humano) para que la
// respuesta del cliente caiga en la tab Soporte, donde ya se responde libre.
export default function ReplyModal({ review, onClose, onResult, handoffToSupport, marcarResuelta }) {
  const [sending, setSending] = useState(false)
  const digits = String(review.telefono || '').replace(/\D/g, '')
  const hasPhone = !!digits

  async function handleSend() {
    if (sending || !hasPhone) return
    setSending(true)
    const { name, lang } = WA_TEMPLATES.seguimientoResena
    try {
      await sendWhatsAppTemplate(digits, name, lang, [firstName(review.nombre) || 'Cliente', review.pedido_id])
      await handoffToSupport(review.cliente_id)
      await marcarResuelta(review.feedback_id) // solo tras enviar OK: ya no se puede volver a responder
      onResult({ ok: true, message: `Seguimiento enviado a ${review.nombre || 'el cliente'}. Cuando responda, lo verás en Soporte.` })
      onClose()
    } catch (e) {
      onResult({ ok: false, message: `No se pudo enviar: ${e.message}` })
      setSending(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={sending ? undefined : onClose}>
      <div className="modal-panel reply-modal" onClick={e => e.stopPropagation()}>
        <div className="rm-head">
          <div>
            <div className="title">Contactar al cliente</div>
            <div className="sub">
              {review.nombre || 'Cliente'}
              {hasPhone && <> · {formatPhone(review.telefono)}</>}
              {' · '}{review.pedido_id}
            </div>
          </div>
          <button className="close-btn" onClick={onClose} disabled={sending}><Icon name="x" size={14} /></button>
        </div>

        <div className="rm-body">
          {hasPhone ? (
            <>
              <div className="rm-preview-label">Se enviará este mensaje de seguimiento:</div>
              <div className="rm-preview">{previewText(review)}</div>
              <div className="rm-note">
                <Icon name="users" size={14} />
                <span>La conversación pasará a <b>Soporte</b>: cuando el cliente responda, le contestas desde ahí.</span>
              </div>
            </>
          ) : (
            <div className="rm-warn">
              <Icon name="alert" size={14} />
              <span>Este cliente no tiene teléfono registrado, no es posible contactarlo.</span>
            </div>
          )}
        </div>

        <div className="rm-foot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancelar</button>
          <button className="btn primary" onClick={handleSend} disabled={sending || !hasPhone}>
            {sending ? 'Enviando…' : 'Enviar seguimiento'}
          </button>
        </div>
      </div>
    </div>
  )
}
