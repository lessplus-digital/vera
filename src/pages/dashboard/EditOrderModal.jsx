import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'
import MenuPicker from './MenuPicker'

export default function EditOrderModal({ order, onClose, onUpdated }) {
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notas, setNotas] = useState(order.notas || '')

  useEffect(() => {
    if (order.detalle_pedidos) {
      setItems(
        order.detalle_pedidos.map((item, i) => ({
          key: `existing-${i}`,
          producto_id: item.producto_id,
          nombre_producto: item.nombre_producto,
          variante: item.variante || 'Estándar',
          cantidad: item.cantidad,
          precio_unitario: Number(item.precio_unitario || 0),
        }))
      )
    }
  }, [order])

  const itemsOriginalSum = (order.detalle_pedidos || []).reduce(
    (sum, item) => sum + item.cantidad * Number(item.precio_unitario || 0),
    0
  )
  const domicilioSurcharge = Number(order.total || 0) - itemsOriginalSum

  const itemsTotal = items.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0)
  const total = itemsTotal + domicilioSurcharge

  const updateItemQty = useCallback((key, delta) => {
    setItems(prev =>
      prev.map(item => {
        if (item.key !== key) return item
        return { ...item, cantidad: Math.max(1, item.cantidad + delta) }
      })
    )
  }, [])

  const removeItem = useCallback((key) => {
    setItems(prev => {
      const filtered = prev.filter(item => item.key !== key)
      if (filtered.length === 0) {
        setError('El pedido debe tener al menos un item.')
        return prev
      }
      setError(null)
      return filtered
    })
  }, [])

  const addItem = useCallback((item) => {
    setError(null)
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setItems(prev => [...prev, { key, ...item }])
  }, [])

  async function handleSave() {
    if (items.length === 0) { setError('El pedido debe tener al menos un item.'); return }
    setSaving(true)
    setError(null)

    const rpcItems = items.map((item, i) => ({
      detalle_id: `DET-E${order.pedido_id}-${i + 1}`,
      producto_id: item.producto_id,
      nombre_producto: item.nombre_producto,
      variante: item.variante,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
    }))

    const { data, error: rpcError } = await supabase.rpc('editar_pedido', {
      p_pedido_id: order.pedido_id,
      p_items: rpcItems,
    })

    if (rpcError) {
      setSaving(false)
      console.error('Error RPC:', rpcError)
      setError('Error al guardar los cambios. Intenta de nuevo.')
      return
    }

    if (data && !data.success) {
      setSaving(false)
      if (data.error === 'PEDIDO_YA_PROCESADO') setError('Este pedido ya fue procesado y no se puede editar.')
      else if (data.error === 'PEDIDO_NO_ENCONTRADO') setError('No se encontró el pedido.')
      else setError(data.message || 'Error desconocido.')
      return
    }

    if (notas !== (order.notas || '')) {
      const { error: notasError } = await supabase
        .from('pedidos')
        .update({ notas: notas || null })
        .eq('pedido_id', order.pedido_id)

      if (notasError) {
        // Los ítems ya se guardaron vía el RPC; solo fallaron las notas.
        setSaving(false)
        console.error('Error guardando notas:', notasError)
        setError('Los ítems se guardaron, pero no se pudieron guardar las notas. Intenta de nuevo.')
        return
      }
    }

    setSaving(false)
    onUpdated()
    onClose()
  }

  const canSave = !saving && items.length > 0
  const orderTotal = Number(order.total || 0)
  const deltaColor = total > orderTotal ? 'var(--amber)' : 'var(--green)'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel edit-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="m-head">
          <div>
            <div className="title">Editar pedido</div>
            <div className="sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              #{String(order.pedido_id).slice(0, 8)} · <Icon name={order.tipo_pedido === 'domicilio' ? 'scooter' : 'bag'} size={12} /> {order.tipo_pedido === 'domicilio' ? 'Domicilio' : 'Recoger'}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        {/* Scrollable body */}
        <div className="em-body">

          {/* Items actuales */}
          <div className="em-label">Items del pedido</div>
          <div className="em-items">
            {items.map((item) => (
              <div key={item.key} className="em-item">
                <div className="info">
                  <div className="name">{item.nombre_producto}</div>
                  {item.variante && item.variante !== 'Estándar' && (
                    <div className="variant">{item.variante}</div>
                  )}
                </div>

                <div className="qty-ctrl">
                  <button className="q-btn" onClick={() => updateItemQty(item.key, -1)} disabled={item.cantidad <= 1}>−</button>
                  <span className="q-val">{item.cantidad}</span>
                  <button className="q-btn" onClick={() => updateItemQty(item.key, 1)}>+</button>
                </div>

                <div className="subtotal">${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}</div>

                <button className="del-btn" onClick={() => removeItem(item.key)}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>

          {/* Selector de productos del menú (compartido con CreateOrderModal) */}
          <MenuPicker onAddItem={addItem} />

          {/* Notas */}
          <div className="em-notes-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="note" size={13} /> Notas para cocina</div>
          <textarea
            className="em-notes"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Ej: Adición de tocineta para la Hawaiana, sin cebolla en la Margarita..."
            rows={3}
          />

          {error && <div className="em-error">{error}</div>}
        </div>

        {/* Footer */}
        <div className="em-foot">
          <div className="total">
            <div className="lbl">Nuevo total</div>
            <div className="amount">${total.toLocaleString('es-CO')}</div>
            {domicilioSurcharge > 0 && (
              <div className="breakdown">
                Items: ${itemsTotal.toLocaleString('es-CO')} + Domicilio: ${domicilioSurcharge.toLocaleString('es-CO')}
              </div>
            )}
            {total !== orderTotal && (
              <div className="delta" style={{ color: deltaColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name={total > orderTotal ? 'arrow-up' : 'arrow-down'} size={12} /> ${Math.abs(total - orderTotal).toLocaleString('es-CO')} vs anterior
              </div>
            )}
          </div>

          <div className="actions">
            <button className="cancel" onClick={onClose}>Cancelar</button>
            <button
              className={`save${canSave ? ' ready' : ''}`}
              onClick={handleSave}
              disabled={!canSave}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
            >
              {saving ? 'Guardando...' : <><Icon name="check" size={14} /> Guardar cambios</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
