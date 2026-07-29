import React, { useState } from 'react'
import Icon from '../../components/Icon'
import { sendWhatsAppTemplate } from '../../lib/whatsapp'
import { WA_TEMPLATES } from '../../utils/constants'
import { formatPhone } from '../../utils/formatters'

function firstName(nombre) {
  return (nombre || '').trim().split(/\s+/)[0] || ''
}

// Primer contacto con un cliente creado a mano en el dashboard: nunca le escribió al
// bot, así que no hay ventana de 24h abierta y el texto libre NO se entrega (Meta
// responde 200 igual). La plantilla `bienvenida_cliente` es la única vía para abrirla.
// Si el cliente responde, entra al bot como cualquier otra conversación.
export default function WelcomeModal({ client, onClose, onResult }) {
  const [sending, setSending] = useState(false)
  const digits = String(client.telefono || '').replace(/\D/g, '')
  const nombre = firstName(client.nombre)

  async function handleSend() {
    if (sending || !digits) return
    setSending(true)
    const { name, lang } = WA_TEMPLATES.bienvenidaCliente
    try {
      await sendWhatsAppTemplate(digits, name, lang, [nombre || 'Cliente'])
      onResult({ ok: true, message: `Bienvenida enviada a ${client.nombre || 'el cliente'}` })
      onClose()
    } catch (e) {
      onResult({ ok: false, message: `No se pudo enviar: ${e.message}` })
      setSending(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={sending ? undefined : onClose}>
      <div className="modal-panel welcome-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-head">
          <div>
            <div className="title">Enviar bienvenida</div>
            <div className="sub">
              {client.nombre || 'Cliente'}
              {digits && <> · {formatPhone(client.telefono)}</>}
            </div>
          </div>
          <button className="close-btn" onClick={onClose} disabled={sending}><Icon name="x" size={14} /></button>
        </div>

        <div className="pr-body">
          {/* Verbatim del cuerpo aprobado en Meta. Si se edita la plantilla allá, hay
              que editar esta preview aquí también o el operador ve algo distinto de
              lo que recibe el cliente. */}
          <div className="pr-preview">
            Hola <b>{nombre || '…'}</b> 👋 Te saluda Vera Pizzería. Quedaste registrado en nuestro
            WhatsApp: por aquí puedes ver el menú, pedir a domicilio y reservar mesa cuando quieras.
            ¿Te muestro el menú? 🍕
          </div>

          <div className="pr-warn">
            <Icon name="alert" size={14} />
            <span>
              Se envía la plantilla <b>bienvenida_cliente</b> (Marketing). Abre la conversación con
              un cliente que nunca nos ha escrito; si responde, lo atiende el bot.
            </span>
          </div>
        </div>

        <div className="pr-foot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancelar</button>
          <button className="btn primary" onClick={handleSend} disabled={sending || !digits}>
            {sending ? 'Enviando…' : 'Enviar bienvenida'}
          </button>
        </div>
      </div>
    </div>
  )
}
