import React, { useState } from 'react'

const MOTIVOS_PREDETERMINADOS = [
  {
    id: 'fuera_cobertura',
    label: '📍 Fuera de cobertura',
    mensaje: 'Lo sentimos, tu dirección está fuera de nuestra zona de cobertura de domicilios',
  },
  {
    id: 'producto_agotado',
    label: '🍕 Producto agotado',
    mensaje: 'Lo sentimos, uno o más productos de tu pedido se agotaron por hoy',
  },
  {
    id: 'local_cerrado',
    label: '🔒 Local cerrado',
    mensaje: 'Lo sentimos, el local ya cerró y no podemos procesar más pedidos por hoy',
  },
  {
    id: 'pago_no_verificado',
    label: '🏦 Pago no verificado',
    mensaje: 'No pudimos verificar tu comprobante de pago. Por favor envía uno nuevo o contáctanos',
  },
  {
    id: 'datos_incompletos',
    label: '📝 Datos incompletos',
    mensaje: 'Tu pedido no tiene la información completa (dirección, productos, etc). Por favor vuelve a hacer el pedido',
  },
]

export default function RejectModal({ order, loading, onConfirm, onClose }) {
  const [selectedId, setSelectedId] = useState(null)
  const [customMessage, setCustomMessage] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const canConfirm = useCustom
    ? customMessage.trim().length > 0
    : selectedId !== null

  function handleConfirm() {
    if (!canConfirm) return
    const motivo = useCustom
      ? customMessage.trim()
      : (MOTIVOS_PREDETERMINADOS.find(m => m.id === selectedId)?.mensaje ?? '')
    onConfirm(motivo)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel reject-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="m-head">
          <div>
            <div className="title-red">✕ Rechazar pedido</div>
            <div className="sub mono">
              #{String(order.pedido_id).slice(0, 8)} · ${Number(order.total || 0).toLocaleString('es-CO')}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="m-body">
          <div className="desc">
            Selecciona el motivo del rechazo. Se le enviará al cliente por WhatsApp.
          </div>

          <div className="options">
            {MOTIVOS_PREDETERMINADOS.map(motivo => {
              const isSelected = !useCustom && selectedId === motivo.id
              return (
                <button
                  key={motivo.id}
                  className={`option${isSelected ? ' is-selected' : ''}`}
                  onClick={() => { setSelectedId(motivo.id); setUseCustom(false) }}
                >
                  <div className="radio">
                    {isSelected && <div className="dot" />}
                  </div>
                  <div>
                    <div className="opt-label">{motivo.label}</div>
                    <div className="opt-msg">{motivo.mensaje}</div>
                  </div>
                </button>
              )
            })}

            {/* Custom option */}
            <button
              className={`option${useCustom ? ' is-selected' : ''}`}
              onClick={() => setUseCustom(true)}
            >
              <div className="radio">
                {useCustom && <div className="dot" />}
              </div>
              <div className="opt-label">✏️ Mensaje personalizado</div>
            </button>

            {useCustom && (
              <div className="custom-ta-wrap">
                <textarea
                  autoFocus
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  placeholder="Escribe el motivo del rechazo que se enviará al cliente..."
                  maxLength={500}
                />
                <div className="char-count">{customMessage.length}/500</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="m-foot">
          <button className="rm-cancel" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            className={`rm-confirm${canConfirm ? ' active' : ''}`}
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
          >
            {loading ? '...' : '✕ Confirmar rechazo'}
          </button>
        </div>
      </div>
    </div>
  )
}
