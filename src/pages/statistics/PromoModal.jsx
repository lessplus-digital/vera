import React, { useState } from 'react'
import Icon from '../../components/Icon'
import { sendWhatsAppTemplate } from '../../lib/whatsapp'
import { WA_TEMPLATES } from '../../utils/constants'
import { formatPhone } from '../../utils/formatters'

function firstName(nombre) {
  return (nombre || '').trim().split(/\s+/)[0] || ''
}

// Enviar la plantilla de reactivación (Marketing) a un cliente inactivo. Estos
// clientes están por definición fuera de la ventana de 24h, así que la plantilla
// es la única vía. Si el cliente responde ("Quiero pedir"), lo atiende el bot.
export default function PromoModal({ client, onClose, onResult }) {
  const [cupon, setCupon] = useState('VUELVE20')
  const [sending, setSending] = useState(false)
  const digits = String(client.telefono || '').replace(/\D/g, '')

  async function handleSend() {
    const code = cupon.trim()
    if (!code || sending || !digits) return
    setSending(true)
    const { name, lang } = WA_TEMPLATES.reactivacionCliente
    try {
      await sendWhatsAppTemplate(digits, name, lang, [firstName(client.nombre) || 'Cliente', code])
      onResult({ ok: true, message: `Promo enviada a ${client.nombre || 'el cliente'}` })
      onClose()
    } catch (e) {
      onResult({ ok: false, message: `No se pudo enviar: ${e.message}` })
      setSending(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={sending ? undefined : onClose}>
      <div className="modal-panel promo-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-head">
          <div>
            <div className="title">Enviar promo de reactivación</div>
            <div className="sub">
              {client.nombre || 'Cliente'}
              {digits && <> · {formatPhone(client.telefono)}</>}
              {' · '}{client.diasDesde} días sin pedir
            </div>
          </div>
          <button className="close-btn" onClick={onClose} disabled={sending}><Icon name="x" size={14} /></button>
        </div>

        <div className="pr-body">
          <label className="pr-field">
            <span className="pr-label">Código del cupón</span>
            <input
              value={cupon}
              onChange={e => setCupon(e.target.value.toUpperCase())}
              placeholder="VUELVE20"
              disabled={sending}
              autoFocus
            />
          </label>

          <div className="pr-preview">
            Hola {firstName(client.nombre) || '…'} 🍕 ¡Hace rato no te vemos y te extrañamos! Vuelve
            hoy y usa <b>{cupon || '—'}</b> para un 20% de descuento en tu próximo pedido 😋
          </div>

          <div className="pr-warn">
            <Icon name="alert" size={14} />
            <span>Se envía la plantilla <b>reactivacion_cliente</b> (Marketing). Si el cliente responde, el bot atiende el pedido.</span>
          </div>
        </div>

        <div className="pr-foot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancelar</button>
          <button className="btn primary" onClick={handleSend} disabled={sending || !cupon.trim() || !digits}>
            {sending ? 'Enviando…' : 'Enviar promo'}
          </button>
        </div>
      </div>
    </div>
  )
}
