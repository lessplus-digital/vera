import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendWhatsAppMessage } from '../../lib/whatsapp'
import Icon from '../../components/Icon'

// Debe coincidir con costo_domicilio del trigger actualizar_total_pedido (solo preview;
// el total real siempre lo escribe el trigger)
const COSTO_DOMICILIO = 5000

const CATEGORY_LABELS = {
  entrada: '🥗 Entradas', pizza_tradicional: '🍕 Pizza Tradicional',
  pizza_especial: '🍕 Pizza Especial', pizza_premium: '🍕 Pizza Premium',
  pizza_premium_especial: '🍕 Pizza Premium Especial', pizza_dulce: '🍕 Pizza Dulce',
  canelones: '🍝 Canelones', lasana: '🍝 Lasaña', pasta: '🍝 Pasta',
  calzone: '🥟 Calzone', maicito: '🌽 Maicito', arepa: '🫓 Arepa',
  patata: '🥔 Patata', hamburguesa: '🍔 Hamburguesa', bebida: '🥤 Bebida',
  cerveza: '🍺 Cerveza', vino: '🍷 Vino', adicion: '➕ Adición',
}

export default function CreateOrderModal({ onClose, onUpdated }) {
  // Cliente
  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)

  // Datos del pedido
  const [tipoPedido, setTipoPedido] = useState('domicilio')
  const [metodoPago, setMetodoPago] = useState('Efectivo')
  const [direccion, setDireccion] = useState('')
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState([])

  // Menú
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedVariante, setSelectedVariante] = useState(null)
  const [addQty, setAddQty] = useState(1)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [waWarning, setWaWarning] = useState(null)

  useEffect(() => {
    async function fetchClients() {
      const { data, error: clientsError } = await supabase
        .from('clientes')
        .select('cliente_id, nombre, telefono, direccion_principal')
        .order('nombre')
      if (clientsError) console.error('Error cargando clientes:', clientsError)
      else setClients(data || [])
      setClientsLoading(false)
    }
    fetchClients()
  }, [])

  useEffect(() => {
    async function fetchMenu() {
      const { data, error: menuError } = await supabase
        .from('menu')
        .select('producto_id, nombre, categoria, variante, precio, disponible, tamaño')
        .eq('disponible', true)
        .order('categoria')
        .order('nombre')
      if (menuError) console.error('Error cargando menú:', menuError)
      else setMenuItems(data || [])
      setMenuLoading(false)
    }
    fetchMenu()
  }, [])

  const itemsTotal = items.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0)
  const domicilioFee = tipoPedido === 'domicilio' ? COSTO_DOMICILIO : 0
  const total = itemsTotal + domicilioFee

  function selectClient(client) {
    setSelectedClient(client)
    setClientSearch('')
    if (client.direccion_principal && !direccion) setDireccion(client.direccion_principal)
  }

  const updateItemQty = useCallback((key, delta) => {
    setItems(prev =>
      prev.map(item => {
        if (item.key !== key) return item
        return { ...item, cantidad: Math.max(1, item.cantidad + delta) }
      })
    )
  }, [])

  const removeItem = useCallback((key) => {
    setItems(prev => prev.filter(item => item.key !== key))
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

  function buildResumenWhatsApp(totalFinal, feeFinal) {
    const nombre = selectedClient.nombre && selectedClient.nombre !== 'Pendiente'
      ? ` ${selectedClient.nombre.split(' ')[0]}`
      : ''

    const lineas = items.map(item => {
      const variante = item.variante && item.variante !== 'Estándar' ? ` (${item.variante})` : ''
      return `• ${item.cantidad}x ${item.nombre_producto}${variante} — $${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}`
    })
    if (feeFinal > 0) lineas.push(`• Domicilio — $${feeFinal.toLocaleString('es-CO')}`)

    const entrega = tipoPedido === 'domicilio'
      ? `📍 Entrega en: ${direccion.trim()}`
      : '🏃 Para recoger en el local'

    const pago = metodoPago === 'Transferencia'
      ? '💳 Pago: Transferencia — recuerda enviarnos el comprobante por este chat'
      : '💵 Pago: Efectivo'

    return [
      `¡Hola${nombre}! 🍕 Tu pedido en Vera Pizzería fue registrado con éxito.`,
      '',
      '*Resumen del pedido:*',
      ...lineas,
      '',
      `*Total: $${totalFinal.toLocaleString('es-CO')}*`,
      entrega,
      pago,
      '',
      '¡Gracias por tu pedido! Te avisaremos cuando esté listo. 🍕',
    ].join('\n')
  }

  async function handleSave() {
    if (!selectedClient) { setError('Selecciona un cliente.'); return }
    if (items.length === 0) { setError('El pedido debe tener al menos un item.'); return }
    if (tipoPedido === 'domicilio' && !direccion.trim()) { setError('Ingresa la dirección de entrega.'); return }

    setSaving(true)
    setError(null)

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({
        cliente_id: selectedClient.cliente_id,
        telefono: selectedClient.telefono,
        tipo_pedido: tipoPedido,
        metodo_pago: metodoPago,
        direccion_entrega: tipoPedido === 'domicilio' ? direccion.trim() : null,
        estado: 'pendiente',
        estado_pago: 'pendiente',
        notas: notas.trim() || null,
        total: 0,
        fecha_pedido: new Date().toISOString(),
      })
      .select('pedido_id')
      .single()

    if (pedidoError) {
      setSaving(false)
      console.error('Error creando pedido:', pedidoError)
      setError('Error al crear el pedido. Intenta de nuevo.')
      return
    }

    const detalles = items.map((item, i) => ({
      detalle_id: `DET-M${pedido.pedido_id}-${i + 1}`,
      pedido_id: pedido.pedido_id,
      producto_id: item.producto_id,
      nombre_producto: item.nombre_producto,
      variante: item.variante,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
    }))

    const { error: detalleError } = await supabase.from('detalle_pedidos').insert(detalles)

    if (detalleError) {
      // Rollback best-effort: no dejar un pedido vacío en el Kanban
      await supabase.from('pedidos').delete().eq('pedido_id', pedido.pedido_id)
      setSaving(false)
      console.error('Error creando items:', detalleError)
      setError('Error al guardar los items del pedido. Intenta de nuevo.')
      return
    }

    // El total real lo escribió el trigger — leerlo para el resumen de WhatsApp
    const { data: pedidoFinal } = await supabase
      .from('pedidos')
      .select('total')
      .eq('pedido_id', pedido.pedido_id)
      .single()

    const totalFinal = Number(pedidoFinal?.total ?? total)
    const feeFinal = totalFinal - itemsTotal

    onUpdated()

    try {
      await sendWhatsAppMessage(selectedClient.telefono, buildResumenWhatsApp(totalFinal, feeFinal))
    } catch (waError) {
      console.error('Error enviando WhatsApp:', waError)
      setSaving(false)
      setWaWarning(`El pedido se creó correctamente, pero no se pudo notificar por WhatsApp: ${waError.message}`)
      return
    }

    setSaving(false)
    onClose()
  }

  const clientQuery = clientSearch.trim().toLowerCase()
  const clientDigits = clientSearch.replace(/[^\d]/g, '')
  const filteredClients = clients.filter(c =>
    !clientQuery ||
    (c.nombre || '').toLowerCase().includes(clientQuery) ||
    (clientDigits && (c.telefono || '').includes(clientDigits))
  )

  const filteredMenu = menuItems.filter(p =>
    p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.categoria.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupedMenu = filteredMenu.reduce((acc, item) => {
    if (!acc[item.categoria]) acc[item.categoria] = []
    acc[item.categoria].push(item)
    return acc
  }, {})

  const canSave = !saving && !waWarning && selectedClient && items.length > 0 &&
    (tipoPedido !== 'domicilio' || direccion.trim().length > 0)

  return (
    <div className="modal-overlay" onClick={waWarning ? undefined : onClose}>
      <div className="modal-panel edit-modal create-order-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="m-head">
          <div>
            <div className="title">Crear pedido manual</div>
            <div className="sub">Se registra en "Por aprobar" y se notifica al cliente</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        {/* Scrollable body */}
        <div className="em-body">

          {/* Cliente */}
          <div className="em-label">Cliente</div>
          {selectedClient ? (
            <div className="co-client-selected">
              <div className="info">
                <div className="name">{selectedClient.nombre || 'Sin nombre'}</div>
                <div className="phone">{selectedClient.telefono}</div>
              </div>
              <button className="change" onClick={() => setSelectedClient(null)}>Cambiar</button>
            </div>
          ) : (
            <div className="co-client-picker">
              <input
                className="search"
                type="text"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar por nombre o teléfono..."
                autoFocus
              />
              <div className="list">
                {clientsLoading ? (
                  <div className="msg">Cargando clientes...</div>
                ) : filteredClients.length === 0 ? (
                  <div className="msg">No se encontraron clientes</div>
                ) : (
                  filteredClients.slice(0, 30).map(c => (
                    <button key={c.cliente_id} className="client" onClick={() => selectClient(c)}>
                      <span className="name">{c.nombre || 'Sin nombre'}</span>
                      <span className="phone">{c.telefono}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tipo y método de pago */}
          <div className="co-fields">
            <div className="co-field">
              <div className="em-label">Tipo de pedido</div>
              <div className="co-toggle">
                <button
                  className={`opt${tipoPedido === 'domicilio' ? ' active' : ''}`}
                  onClick={() => setTipoPedido('domicilio')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="scooter" size={14} /> Domicilio</button>
                <button
                  className={`opt${tipoPedido === 'recoger' ? ' active' : ''}`}
                  onClick={() => setTipoPedido('recoger')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="bag" size={14} /> Recoger</button>
              </div>
            </div>

            <div className="co-field">
              <div className="em-label">Método de pago</div>
              <div className="co-toggle">
                <button
                  className={`opt${metodoPago === 'Efectivo' ? ' active' : ''}`}
                  onClick={() => setMetodoPago('Efectivo')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="cash" size={14} /> Efectivo</button>
                <button
                  className={`opt${metodoPago === 'Transferencia' ? ' active' : ''}`}
                  onClick={() => setMetodoPago('Transferencia')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="bank" size={14} /> Transfer.</button>
              </div>
            </div>
          </div>

          {/* Dirección (solo domicilio) */}
          {tipoPedido === 'domicilio' && (
            <div className="co-field co-address">
              <div className="em-label">Dirección de entrega</div>
              <input
                type="text"
                value={direccion}
                onChange={e => setDireccion(e.target.value)}
                placeholder="Ej: Calle 10 # 5-23, Barrio Centro"
              />
            </div>
          )}

          {/* Items */}
          <div className="em-label">Items del pedido</div>
          {items.length === 0 ? (
            <div className="co-no-items">Aún no hay productos en el pedido</div>
          ) : (
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
          )}

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
          {waWarning && <div className="co-warning" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={14} /> {waWarning}</div>}
        </div>

        {/* Footer */}
        <div className="em-foot">
          <div className="total">
            <div className="lbl">Total estimado</div>
            <div className="amount">${total.toLocaleString('es-CO')}</div>
            {domicilioFee > 0 && (
              <div className="breakdown">
                Items: ${itemsTotal.toLocaleString('es-CO')} + Domicilio: ${domicilioFee.toLocaleString('es-CO')}
              </div>
            )}
          </div>

          <div className="actions">
            {waWarning ? (
              <button className="save ready" onClick={onClose}>Cerrar</button>
            ) : (
              <>
                <button className="cancel" onClick={onClose}>Cancelar</button>
                <button
                  className={`save${canSave ? ' ready' : ''}`}
                  onClick={handleSave}
                  disabled={!canSave}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  {saving ? 'Creando...' : <><Icon name="check" size={14} /> Crear pedido</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
