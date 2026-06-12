import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'

export default function EditOrderModal({ order, onClose, onUpdated }) {
  const [items, setItems] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedVariante, setSelectedVariante] = useState(null)
  const [addQty, setAddQty] = useState(1)
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

  useEffect(() => {
    async function fetchMenu() {
      setMenuLoading(true)
      const { data, error: menuError } = await supabase
        .from('menu')
        .select('producto_id, nombre, categoria, variante, precio, disponible, tamaño')
        .eq('disponible', true)
        .order('categoria')
        .order('nombre')

      if (menuError) {
        console.error('Error cargando menú:', menuError)
      } else {
        setMenuItems(data || [])
      }
      setMenuLoading(false)
    }
    fetchMenu()
  }, [])

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

  function getProductOptions(product) {
    const options = []
    if (product.tamaño) {
      try {
        const sizes = typeof product.tamaño === 'string' ? JSON.parse(product.tamaño) : product.tamaño
        for (const [sizeName, price] of Object.entries(sizes)) {
          options.push({ variante: sizeName.charAt(0).toUpperCase() + sizeName.slice(1), precio: Number(price) })
        }
      } catch (_) {
        if (product.precio) options.push({ variante: product.variante || 'Estándar', precio: Number(product.precio) })
      }
    } else if (product.precio) {
      options.push({ variante: product.variante || 'Estándar', precio: Number(product.precio) })
    }
    return options
  }

  function handleSelectProduct(product) {
    const options = getProductOptions(product)
    if (options.length === 1) {
      addItemToOrder(product.producto_id, product.nombre, options[0].variante, options[0].precio)
      setSelectedProduct(null)
      setShowAddMenu(false)
      setSearchQuery('')
    } else {
      setSelectedProduct({ ...product, options })
      setSelectedVariante(null)
      setAddQty(1)
    }
  }

  function addItemToOrder(productoId, nombre, variante, precio) {
    setError(null)
    const newKey = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setItems(prev => [...prev, { key: newKey, producto_id: productoId, nombre_producto: nombre, variante, cantidad: addQty, precio_unitario: precio }])
    setAddQty(1)
  }

  function confirmAddWithVariante() {
    if (!selectedProduct || !selectedVariante) return
    addItemToOrder(selectedProduct.producto_id, selectedProduct.nombre, selectedVariante.variante, selectedVariante.precio)
    setSelectedProduct(null)
    setSelectedVariante(null)
    setShowAddMenu(false)
    setSearchQuery('')
  }

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
      await supabase.from('pedidos').update({ notas: notas || null }).eq('pedido_id', order.pedido_id)
    }

    setSaving(false)
    onUpdated()
    onClose()
  }

  const filteredMenu = menuItems.filter(p =>
    p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.categoria.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupedMenu = filteredMenu.reduce((acc, item) => {
    if (!acc[item.categoria]) acc[item.categoria] = []
    acc[item.categoria].push(item)
    return acc
  }, {})

  const CATEGORY_LABELS = {
    entrada: '🥗 Entradas', pizza_tradicional: '🍕 Pizza Tradicional',
    pizza_especial: '🍕 Pizza Especial', pizza_premium: '🍕 Pizza Premium',
    pizza_premium_especial: '🍕 Pizza Premium Especial', pizza_dulce: '🍕 Pizza Dulce',
    canelones: '🍝 Canelones', lasana: '🍝 Lasaña', pasta: '🍝 Pasta',
    calzone: '🥟 Calzone', maicito: '🌽 Maicito', arepa: '🫓 Arepa',
    patata: '🥔 Patata', hamburguesa: '🍔 Hamburguesa', bebida: '🥤 Bebida',
    cerveza: '🍺 Cerveza', vino: '🍷 Vino', adicion: '➕ Adición',
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

          {/* Botón / panel agregar */}
          {!showAddMenu ? (
            <button className="em-add-btn" onClick={() => setShowAddMenu(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Icon name="plus" size={14} /> Agregar producto del menú
            </button>
          ) : (
            <div className="em-menu">
              <div className="menu-head">
                <span className="title">Agregar producto</span>
                <button className="cancel" onClick={() => { setShowAddMenu(false); setSelectedProduct(null); setSearchQuery('') }}>
                  Cancelar
                </button>
              </div>

              {selectedProduct ? (
                <div>
                  <div className="variant-title">{selectedProduct.nombre} — Selecciona tamaño</div>

                  <div className="variants">
                    {selectedProduct.options.map(opt => (
                      <button
                        key={opt.variante}
                        className={`v-opt${selectedVariante?.variante === opt.variante ? ' active' : ''}`}
                        onClick={() => setSelectedVariante(opt)}
                      >
                        <span className="v-name">{opt.variante}</span>
                        <span className="v-price">${Number(opt.precio).toLocaleString('es-CO')}</span>
                      </button>
                    ))}
                  </div>

                  <div className="add-row">
                    <div className="qty-ctrl">
                      <button className="q-btn" onClick={() => setAddQty(q => Math.max(1, q - 1))}>−</button>
                      <span className="q-val">{addQty}</span>
                      <button className="q-btn" onClick={() => setAddQty(q => q + 1)}>+</button>
                    </div>
                    <button
                      className={`add-confirm${selectedVariante ? ' ready' : ''}`}
                      onClick={confirmAddWithVariante}
                      disabled={!selectedVariante}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                    >
                      <Icon name="check" size={13} /> Agregar
                    </button>
                    <button className="back-btn" onClick={() => { setSelectedProduct(null); setSelectedVariante(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="arrow-left" size={13} /> Volver
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    className="search"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar producto..."
                    autoFocus
                  />

                  <div className="list">
                    {menuLoading ? (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                        Cargando menú...
                      </div>
                    ) : Object.keys(groupedMenu).length === 0 ? (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                        No se encontraron productos
                      </div>
                    ) : (
                      Object.entries(groupedMenu).map(([cat, products]) => (
                        <div key={cat}>
                          <div className="cat-label">{CATEGORY_LABELS[cat] || cat}</div>
                          {products.map(product => {
                            const opts = getProductOptions(product)
                            const priceDisplay = opts.length === 1
                              ? `$${Number(opts[0].precio).toLocaleString('es-CO')}`
                              : `Desde $${Number(Math.min(...opts.map(o => o.precio))).toLocaleString('es-CO')}`

                            return (
                              <button key={product.producto_id} className="product" onClick={() => handleSelectProduct(product)}>
                                <span className="prod-name">
                                  {product.nombre}
                                  {product.variante && product.variante !== 'Estándar' && (
                                    <span className="prod-variant"> · {product.variante}</span>
                                  )}
                                </span>
                                <span className="prod-price">{priceDisplay}</span>
                              </button>
                            )
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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
