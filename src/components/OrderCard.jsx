import React, { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '../lib/supabase'

const ESTADO_PAGO_LABEL = {
  pendiente:   { label: 'Pago pendiente', color: 'var(--amber)',  bg: 'var(--amber-dim)' },
  confirmado:  { label: 'Pago confirmado', color: 'var(--green)', bg: 'var(--green-dim)' },
  rechazado:   { label: 'Pago rechazado', color: 'var(--red)',    bg: 'var(--red-dim)'   },
}

const METODO_LABEL = {
  Transferencia: { icon: '🏦', color: 'var(--blue)' },
  Efectivo:      { icon: '💵', color: 'var(--green)' },
}

export default function OrderCard({ order, isNew, onUpdated }) {
  const [loading, setLoading] = useState(false)
  const [showComprobante, setShowComprobante] = useState(false)

  const timeAgo = formatDistanceToNow(new Date(order.fecha_pedido), {
    addSuffix: true,
    locale: es,
  })

  async function updateEstado(estado, estadoPago = null) {
    setLoading(true)
    const updates = { estado }
    if (estadoPago) updates.estado_pago = estadoPago
    const { error } = await supabase
      .from('pedidos')
      .update(updates)
      .eq('pedido_id', order.pedido_id)
    setLoading(false)
    if (!error) onUpdated()
  }

  const metodo = METODO_LABEL[order.metodo_pago] || { icon: '💳', color: 'var(--text-secondary)' }
  const estadoPago = ESTADO_PAGO_LABEL[order.estado_pago] || ESTADO_PAGO_LABEL.pendiente

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isNew ? 'var(--amber-border)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '14px',
      animation: isNew ? 'new-order 1s ease, fadeIn 0.3s ease' : 'fadeIn 0.3s ease',
      transition: 'border-color 0.2s',
      boxShadow: isNew ? 'var(--shadow-glow-amber)' : 'var(--shadow-card)',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
              #{String(order.pedido_id).slice(0, 8)}
            </span>
            {isNew && (
              <span style={{ background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber-border)', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 600 }}>
                NUEVO
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {timeAgo} · {order.telefono}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            ${Number(order.total || 0).toLocaleString('es-CO')}
          </div>
          <div style={{ fontSize: 11, color: metodo.color, marginTop: 2 }}>
            {metodo.icon} {order.metodo_pago}
          </div>
        </div>
      </div>

      {/* Tipo pedido */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{
          background: order.tipo_pedido === 'domicilio' ? 'var(--purple-dim)' : 'var(--blue-dim)',
          color: order.tipo_pedido === 'domicilio' ? 'var(--purple)' : 'var(--blue)',
          border: `1px solid ${order.tipo_pedido === 'domicilio' ? 'var(--purple-border)' : 'var(--blue-border)'}`,
          borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 500,
        }}>
          {order.tipo_pedido === 'domicilio' ? '🛵 Domicilio' : '🏃 Recoger'}
        </span>
        <span style={{
          background: estadoPago.bg,
          color: estadoPago.color,
          border: `1px solid ${estadoPago.color}40`,
          borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 500,
        }}>
          {estadoPago.label}
        </span>
      </div>

      {/* Dirección */}
      {order.tipo_pedido === 'domicilio' && order.direccion_entrega && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', gap: 4 }}>
          <span>📍</span>
          <span>{order.direccion_entrega}</span>
        </div>
      )}

      {/* Items */}
      {order.detalle_pedidos && order.detalle_pedidos.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 10px',
          marginBottom: 10,
        }}>
          {order.detalle_pedidos.map((item, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 12, color: 'var(--text-secondary)',
              paddingBottom: i < order.detalle_pedidos.length - 1 ? 4 : 0,
              marginBottom: i < order.detalle_pedidos.length - 1 ? 4 : 0,
              borderBottom: i < order.detalle_pedidos.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.cantidad}x</span>
                {' '}{item.nombre_producto}
                {item.variante && item.variante !== 'Estándar' && (
                  <span style={{ color: 'var(--text-muted)' }}> · {item.variante}</span>
                )}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                ${Number(item.precio_unitario || 0).toLocaleString('es-CO')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Notas */}
      {order.notas && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>
          📝 {order.notas}
        </div>
      )}

      {/* Comprobante — esperando */}
      {order.metodo_pago === 'Transferencia' && !order.comprobante_url && order.estado === 'pendiente' && (
        <div style={{
          background: 'var(--amber-dim)',
          color: 'var(--amber)',
          border: '1px solid var(--amber-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 500,
          marginBottom: 8,
        }}>
          ⏳ Esperando comprobante de transferencia
        </div>
      )}

      {/* Comprobante — botón ver */}
      {order.comprobante_url && (
        <button
          onClick={() => setShowComprobante(true)}
          style={{
            width: '100%', background: 'var(--blue-dim)', color: 'var(--blue)',
            border: '1px solid var(--blue-border)', borderRadius: 'var(--radius-sm)',
            padding: '6px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            marginBottom: 8, fontFamily: 'var(--font-sans)',
          }}
        >
          🖼️ Ver comprobante de pago
        </button>
      )}

      {/* Acciones según estado */}
      <Actions order={order} loading={loading} onUpdate={updateEstado} />

      {/* Modal comprobante */}
      {showComprobante && order.comprobante_url && (
        <div
          onClick={() => setShowComprobante(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              width: '100%',
              maxWidth: 460,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {/* Header del modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                  Comprobante de pago
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                  #{String(order.pedido_id).slice(0, 8)} · 🏦 Transferencia · ${Number(order.total || 0).toLocaleString('es-CO')}
                </div>
              </div>
              <button
                onClick={() => setShowComprobante(false)}
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 13, padding: '4px 10px',
                  fontFamily: 'var(--font-sans)', lineHeight: 1, flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Imagen */}
            <img
              src={order.comprobante_url}
              alt="Comprobante de pago"
              style={{
                width: '100%',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                display: 'block',
                marginBottom: order.estado === 'pendiente' ? 14 : 0,
              }}
            />

            {/* Acciones rápidas solo para pedidos pendientes */}
            {order.estado === 'pendiente' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setShowComprobante(false); updateEstado('cancelado', 'rechazado') }}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '9px 4px', fontSize: 12, fontWeight: 500,
                    background: 'var(--red-dim)', color: 'var(--red)',
                    border: '1px solid var(--red-border)', borderRadius: 'var(--radius-sm)',
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {loading ? '...' : '✕ Rechazar pedido'}
                </button>
                <button
                  onClick={() => { setShowComprobante(false); updateEstado('en_cocina', 'confirmado') }}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '9px 4px', fontSize: 12, fontWeight: 500,
                    background: 'var(--green-dim)', color: 'var(--green)',
                    border: '1px solid var(--green-border)', borderRadius: 'var(--radius-sm)',
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {loading ? '...' : '✓ Aprobar pedido'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Actions({ order, loading, onUpdate }) {
  const btn = (label, onClick, color, bg, border) => (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        flex: 1, padding: '7px 4px', fontSize: 12, fontWeight: 500,
        background: bg, color, border: `1px solid ${border}`,
        borderRadius: 'var(--radius-sm)', cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1, fontFamily: 'var(--font-sans)',
        transition: 'opacity 0.15s',
      }}
    >
      {loading ? '...' : label}
    </button>
  )

  if (order.estado === 'pendiente') return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('✕ Rechazar', () => onUpdate('cancelado', 'rechazado'), 'var(--red)', 'var(--red-dim)', 'var(--red-border)')}
      {btn('✓ Aprobar', () => onUpdate('en_cocina', 'confirmado'), 'var(--green)', 'var(--green-dim)', 'var(--green-border)')}
    </div>
  )

  if (order.estado === 'en_cocina') return (
    <div style={{ display: 'flex', gap: 6 }}>
      {order.tipo_pedido === 'domicilio'
        ? btn('🛵 Enviar a domicilio', () => onUpdate('en_camino'), 'var(--purple)', 'var(--purple-dim)', 'var(--purple-border)')
        : btn('✓ Listo para recoger', () => onUpdate('recoger'), 'var(--blue)', 'var(--blue-dim)', 'var(--blue-border)')
      }
    </div>
  )

  if (order.estado === 'en_camino') return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('✓ Marcar entregado', () => onUpdate('entregado'), 'var(--green)', 'var(--green-dim)', 'var(--green-border)')}
    </div>
  )

  if (order.estado === 'recoger') return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('✓ Cliente recogió', () => onUpdate('entregado'), 'var(--green)', 'var(--green-dim)', 'var(--green-border)')}
    </div>
  )

  return null
}
