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

    let motivo
    if (useCustom) {
      motivo = customMessage.trim()
    } else {
      const preset = MOTIVOS_PREDETERMINADOS.find(m => m.id === selectedId)
      motivo = preset ? preset.mensaje : ''
    }

    onConfirm(motivo)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 0,
          width: '100%',
          maxWidth: 440,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-card)',
          animation: 'fadeIn 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          <div>
            <div style={{
              fontWeight: 600,
              fontSize: 14,
              color: 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              ✕ Rechazar pedido
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: 4,
            }}>
              #{String(order.pedido_id).slice(0, 8)} · ${Number(order.total || 0).toLocaleString('es-CO')}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              padding: '4px 10px',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 12,
          }}>
            Selecciona el motivo del rechazo. Se le enviará al cliente por WhatsApp.
          </div>

          {/* Preset reasons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MOTIVOS_PREDETERMINADOS.map(motivo => {
              const isSelected = !useCustom && selectedId === motivo.id
              return (
                <button
                  key={motivo.id}
                  onClick={() => {
                    setSelectedId(motivo.id)
                    setUseCustom(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    background: isSelected ? 'var(--red-dim)' : 'var(--bg-surface)',
                    border: `1px solid ${isSelected ? 'var(--red-border)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--font-sans)',
                    transition: 'all 0.15s ease',
                    width: '100%',
                  }}
                >
                  {/* Radio indicator */}
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? 'var(--red)' : 'var(--border-hover)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'border-color 0.15s ease',
                  }}>
                    {isSelected && (
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--red)',
                      }} />
                    )}
                  </div>

                  <div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: isSelected ? 'var(--red)' : 'var(--text-primary)',
                    }}>
                      {motivo.label}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}>
                      {motivo.mensaje}
                    </div>
                  </div>
                </button>
              )
            })}

            {/* Custom option */}
            <button
              onClick={() => setUseCustom(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: useCustom ? 'var(--red-dim)' : 'var(--bg-surface)',
                border: `1px solid ${useCustom ? 'var(--red-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.15s ease',
                width: '100%',
              }}
            >
              <div style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: `2px solid ${useCustom ? 'var(--red)' : 'var(--border-hover)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'border-color 0.15s ease',
              }}>
                {useCustom && (
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--red)',
                  }} />
                )}
              </div>
              <div style={{
                fontSize: 12,
                fontWeight: 500,
                color: useCustom ? 'var(--red)' : 'var(--text-primary)',
              }}>
                ✏️ Mensaje personalizado
              </div>
            </button>

            {/* Custom textarea - only shown when custom is selected */}
            {useCustom && (
              <div style={{
                marginTop: 2,
                animation: 'fadeIn 0.15s ease',
              }}>
                <textarea
                  autoFocus
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  placeholder="Escribe el motivo del rechazo que se enviará al cliente..."
                  maxLength={500}
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: '10px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    resize: 'vertical',
                    outline: 'none',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = 'var(--red-border)'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--border)'
                  }}
                />
                <div style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textAlign: 'right',
                  marginTop: 4,
                }}>
                  {customMessage.length}/500
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px 16px',
          display: 'flex',
          gap: 8,
          borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1,
              padding: '9px 4px',
              fontSize: 12,
              fontWeight: 500,
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            style={{
              flex: 1,
              padding: '9px 4px',
              fontSize: 12,
              fontWeight: 500,
              background: canConfirm ? 'var(--red-dim)' : 'var(--bg-surface)',
              color: canConfirm ? 'var(--red)' : 'var(--text-muted)',
              border: `1px solid ${canConfirm ? 'var(--red-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: !canConfirm || loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontFamily: 'var(--font-sans)',
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? '...' : '✕ Confirmar rechazo'}
          </button>
        </div>
      </div>
    </div>
  )
}