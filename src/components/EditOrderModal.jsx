import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

  // Inicializar items desde el pedido actual
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

  // Calcular recargo de domicilio: diferencia entre total del pedido y suma de items
  const itemsOriginalSum = (order.detalle_pedidos || []).reduce(
    (sum, item) => sum + item.cantidad * Number(item.precio_unitario || 0),
    0
  )
  const domicilioSurcharge = Number(order.total || 0) - itemsOriginalSum

  // Cargar menú disponible
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

  const itemsTotal = items.reduce(
    (sum, item) => sum + item.cantidad * item.precio_unitario,
    0
  )
  const total = itemsTotal + domicilioSurcharge

  const updateItemQty = useCallback((key, delta) => {
    setItems(prev =>
      prev.map(item => {
        if (item.key !== key) return item
        const newQty = Math.max(1, item.cantidad + delta)
        return { ...item, cantidad: newQty }
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

  // Obtener opciones de tamaño/precio de un producto del menú
  function getProductOptions(product) {
    const options = []

    if (product.tamaño) {
      try {
        const sizes = typeof product.tamaño === 'string'
          ? JSON.parse(product.tamaño)
          : product.tamaño
        for (const [sizeName, price] of Object.entries(sizes)) {
          options.push({
            variante: sizeName.charAt(0).toUpperCase() + sizeName.slice(1),
            precio: Number(price),
          })
        }
      } catch (_) {
        // Si falla el parse, usar precio directo
        if (product.precio) {
          options.push({
            variante: product.variante || 'Estándar',
            precio: Number(product.precio),
          })
        }
      }
    } else if (product.precio) {
      options.push({
        variante: product.variante || 'Estándar',
        precio: Number(product.precio),
      })
    }

    return options
  }

  function handleSelectProduct(product) {
    const options = getProductOptions(product)
    if (options.length === 1) {
      // Producto sin tamaños — agregar directo
      addItemToOrder(product.producto_id, product.nombre, options[0].variante, options[0].precio)
      setSelectedProduct(null)
      setShowAddMenu(false)
      setSearchQuery('')
    } else {
      // Producto con tamaños — mostrar selector
      setSelectedProduct({ ...product, options })
      setSelectedVariante(null)
      setAddQty(1)
    }
  }

  function addItemToOrder(productoId, nombre, variante, precio) {
    setError(null)
    const newKey = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setItems(prev => [
      ...prev,
      {
        key: newKey,
        producto_id: productoId,
        nombre_producto: nombre,
        variante: variante,
        cantidad: addQty,
        precio_unitario: precio,
      },
    ])
    setAddQty(1)
  }

  function confirmAddWithVariante() {
    if (!selectedProduct || !selectedVariante) return
    addItemToOrder(
      selectedProduct.producto_id,
      selectedProduct.nombre,
      selectedVariante.variante,
      selectedVariante.precio
    )
    setSelectedProduct(null)
    setSelectedVariante(null)
    setShowAddMenu(false)
    setSearchQuery('')
  }

  async function handleSave() {
    if (items.length === 0) {
      setError('El pedido debe tener al menos un item.')
      return
    }

    setSaving(true)
    setError(null)

    // Preparar items para el RPC
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
      if (data.error === 'PEDIDO_YA_PROCESADO') {
        setError('Este pedido ya fue procesado y no se puede editar.')
      } else if (data.error === 'PEDIDO_NO_ENCONTRADO') {
        setError('No se encontró el pedido.')
      } else {
        setError(data.message || 'Error desconocido.')
      }
      return
    }

    // Actualizar notas
    if (notas !== (order.notas || '')) {
      await supabase
        .from('pedidos')
        .update({ notas: notas || null })
        .eq('pedido_id', order.pedido_id)
    }

    setSaving(false)

    // Éxito — cerrar modal y refrescar
    onUpdated()
    onClose()
  }

  // Filtrar menú por búsqueda
  const filteredMenu = menuItems.filter(p =>
    p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.categoria.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Agrupar menú por categoría
  const groupedMenu = filteredMenu.reduce((acc, item) => {
    const cat = item.categoria
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  const CATEGORY_LABELS = {
    entrada: '🥗 Entradas',
    pizza_tradicional: '🍕 Pizza Tradicional',
    pizza_especial: '🍕 Pizza Especial',
    pizza_premium: '🍕 Pizza Premium',
    pizza_premium_especial: '🍕 Pizza Premium Especial',
    pizza_dulce: '🍕 Pizza Dulce',
    canelones: '🍝 Canelones',
    lasana: '🍝 Lasaña',
    pasta: '🍝 Pasta',
    calzone: '🥟 Calzone',
    maicito: '🌽 Maicito',
    arepa: '🫓 Arepa',
    patata: '🥔 Patata',
    hamburguesa: '🍔 Hamburguesa',
    bebida: '🥤 Bebida',
    cerveza: '🍺 Cerveza',
    vino: '🍷 Vino',
    adicion: '➕ Adición',
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
          maxWidth: 540,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: 'var(--text-primary)',
              }}
            >
              Editar pedido
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: 3,
              }}
            >
              #{String(order.pedido_id).slice(0, 8)} ·{' '}
              {order.tipo_pedido === 'domicilio' ? '🛵 Domicilio' : '🏃 Recoger'}
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

        {/* Scrollable body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
          }}
        >
          {/* Items actuales */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Items del pedido
            </div>

            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}
            >
              {items.map((item, i) => (
                <div
                  key={item.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderBottom:
                      i < items.length - 1
                        ? '1px solid var(--border)'
                        : 'none',
                  }}
                >
                  {/* Info del producto */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {item.nombre_producto}
                    </div>
                    {item.variante && item.variante !== 'Estándar' && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginTop: 1,
                        }}
                      >
                        {item.variante}
                      </div>
                    )}
                  </div>

                  {/* Controles de cantidad */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0,
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      onClick={() => updateItemQty(item.key, -1)}
                      disabled={item.cantidad <= 1}
                      style={{
                        background: 'var(--bg-card)',
                        border: 'none',
                        color:
                          item.cantidad <= 1
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)',
                        cursor:
                          item.cantidad <= 1
                            ? 'not-allowed'
                            : 'pointer',
                        padding: '4px 8px',
                        fontSize: 14,
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 1,
                      }}
                    >
                      −
                    </button>
                    <span
                      style={{
                        padding: '4px 8px',
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                        minWidth: 28,
                        textAlign: 'center',
                        borderLeft: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      {item.cantidad}
                    </span>
                    <button
                      onClick={() => updateItemQty(item.key, 1)}
                      style={{
                        background: 'var(--bg-card)',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        fontSize: 14,
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 1,
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Subtotal */}
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      minWidth: 64,
                      textAlign: 'right',
                    }}
                  >
                    ${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}
                  </div>

                  {/* Botón eliminar */}
                  <button
                    onClick={() => removeItem(item.key)}
                    style={{
                      background: 'var(--red-dim)',
                      border: '1px solid var(--red-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--red)',
                      cursor: 'pointer',
                      padding: '3px 6px',
                      fontSize: 11,
                      lineHeight: 1,
                      fontFamily: 'var(--font-sans)',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Botón agregar item */}
          {!showAddMenu ? (
            <button
              onClick={() => setShowAddMenu(true)}
              style={{
                width: '100%',
                padding: '9px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--blue-dim)',
                color: 'var(--blue)',
                border: '1px solid var(--blue-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                marginBottom: 16,
              }}
            >
              + Agregar producto del menú
            </button>
          ) : (
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 12,
                marginBottom: 16,
              }}
            >
              {/* Header del buscador */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Agregar producto
                </span>
                <button
                  onClick={() => {
                    setShowAddMenu(false)
                    setSelectedProduct(null)
                    setSearchQuery('')
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Cancelar
                </button>
              </div>

              {/* Selector de variante para producto con tamaños */}
              {selectedProduct ? (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      marginBottom: 8,
                    }}
                  >
                    {selectedProduct.nombre} — Selecciona tamaño
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {selectedProduct.options.map(opt => (
                      <button
                        key={opt.variante}
                        onClick={() => setSelectedVariante(opt)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background:
                            selectedVariante?.variante === opt.variante
                              ? 'var(--blue-dim)'
                              : 'var(--bg-card)',
                          border: `1px solid ${
                            selectedVariante?.variante === opt.variante
                              ? 'var(--blue-border)'
                              : 'var(--border)'
                          }`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{opt.variante}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          ${Number(opt.precio).toLocaleString('es-CO')}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Cantidad + confirmar */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        onClick={() => setAddQty(q => Math.max(1, q - 1))}
                        style={{
                          background: 'var(--bg-card)',
                          border: 'none',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          padding: '4px 10px',
                          fontSize: 14,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          padding: '4px 10px',
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          borderLeft: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                        }}
                      >
                        {addQty}
                      </span>
                      <button
                        onClick={() => setAddQty(q => q + 1)}
                        style={{
                          background: 'var(--bg-card)',
                          border: 'none',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          padding: '4px 10px',
                          fontSize: 14,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={confirmAddWithVariante}
                      disabled={!selectedVariante}
                      style={{
                        flex: 1,
                        padding: '7px',
                        fontSize: 12,
                        fontWeight: 500,
                        background: selectedVariante
                          ? 'var(--green-dim)'
                          : 'var(--bg-card)',
                        color: selectedVariante
                          ? 'var(--green)'
                          : 'var(--text-muted)',
                        border: `1px solid ${
                          selectedVariante
                            ? 'var(--green-border)'
                            : 'var(--border)'
                        }`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: selectedVariante
                          ? 'pointer'
                          : 'not-allowed',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      ✓ Agregar
                    </button>
                    <button
                      onClick={() => {
                        setSelectedProduct(null)
                        setSelectedVariante(null)
                      }}
                      style={{
                        padding: '7px 12px',
                        fontSize: 12,
                        background: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      ← Volver
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Buscador */}
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar producto..."
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: 13,
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      outline: 'none',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 8,
                    }}
                  />

                  {/* Lista de productos */}
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {menuLoading ? (
                      <div
                        style={{
                          padding: 20,
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          fontSize: 12,
                        }}
                      >
                        Cargando menú...
                      </div>
                    ) : Object.keys(groupedMenu).length === 0 ? (
                      <div
                        style={{
                          padding: 20,
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          fontSize: 12,
                        }}
                      >
                        No se encontraron productos
                      </div>
                    ) : (
                      Object.entries(groupedMenu).map(([cat, products]) => (
                        <div key={cat}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--text-muted)',
                              padding: '6px 2px 4px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {CATEGORY_LABELS[cat] || cat}
                          </div>
                          {products.map(product => {
                            const opts = getProductOptions(product)
                            const priceDisplay =
                              opts.length === 1
                                ? `$${Number(opts[0].precio).toLocaleString('es-CO')}`
                                : `Desde $${Number(
                                    Math.min(...opts.map(o => o.precio))
                                  ).toLocaleString('es-CO')}`

                            return (
                              <button
                                key={product.producto_id}
                                onClick={() => handleSelectProduct(product)}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  width: '100%',
                                  padding: '7px 8px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: 'var(--radius-sm)',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  color: 'var(--text-primary)',
                                  fontFamily: 'var(--font-sans)',
                                  textAlign: 'left',
                                  transition: 'background 0.1s',
                                }}
                                onMouseEnter={e =>
                                  (e.currentTarget.style.background =
                                    'var(--bg-card-hover)')
                                }
                                onMouseLeave={e =>
                                  (e.currentTarget.style.background =
                                    'transparent')
                                }
                              >
                                <span style={{ fontWeight: 500 }}>
                                  {product.nombre}
                                  {product.variante &&
                                    product.variante !== 'Estándar' && (
                                      <span
                                        style={{
                                          color: 'var(--text-muted)',
                                          fontWeight: 400,
                                        }}
                                      >
                                        {' '}
                                        · {product.variante}
                                      </span>
                                    )}
                                </span>
                                <span
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 11,
                                    color: 'var(--text-secondary)',
                                    flexShrink: 0,
                                    marginLeft: 8,
                                  }}
                                >
                                  {priceDisplay}
                                </span>
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

          {/* Notas para cocina */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              📝 Notas para cocina
            </div>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: Adición de tocineta para la Hawaiana, sin cebolla en la Margarita..."
              rows={3}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 12,
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                resize: 'vertical',
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: 'var(--red-dim)',
                color: 'var(--red)',
                border: '1px solid var(--red-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 500,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer fijo */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: 'var(--bg-card)',
          }}
        >
          {/* Nuevo total */}
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 2,
              }}
            >
              Nuevo total
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ${total.toLocaleString('es-CO')}
            </div>
            {domicilioSurcharge > 0 && (
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Items: ${itemsTotal.toLocaleString('es-CO')} + Domicilio: ${domicilioSurcharge.toLocaleString('es-CO')}
              </div>
            )}
            {total !== Number(order.total || 0) && (
              <div
                style={{
                  fontSize: 11,
                  color:
                    total > Number(order.total || 0)
                      ? 'var(--amber)'
                      : 'var(--green)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {total > Number(order.total || 0) ? '▲' : '▼'} $
                {Math.abs(
                  total - Number(order.total || 0)
                ).toLocaleString('es-CO')}{' '}
                vs anterior
              </div>
            )}
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 16px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || items.length === 0}
              style={{
                padding: '9px 20px',
                fontSize: 12,
                fontWeight: 600,
                background:
                  saving || items.length === 0
                    ? 'var(--bg-surface)'
                    : 'var(--green-dim)',
                color:
                  saving || items.length === 0
                    ? 'var(--text-muted)'
                    : 'var(--green)',
                border: `1px solid ${
                  saving || items.length === 0
                    ? 'var(--border)'
                    : 'var(--green-border)'
                }`,
                borderRadius: 'var(--radius-sm)',
                cursor:
                  saving || items.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {saving ? 'Guardando...' : '✓ Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}