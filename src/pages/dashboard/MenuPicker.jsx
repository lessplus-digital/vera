import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'

const CATEGORY_LABELS = {
  entrada: '🥗 Entradas', pizza_tradicional: '🍕 Pizza Tradicional',
  pizza_especial: '🍕 Pizza Especial', pizza_premium: '🍕 Pizza Premium',
  pizza_premium_especial: '🍕 Pizza Premium Especial', pizza_dulce: '🍕 Pizza Dulce',
  canelones: '🍝 Canelones', lasana: '🍝 Lasaña', pasta: '🍝 Pasta',
  calzone: '🥟 Calzone', maicito: '🌽 Maicito', arepa: '🫓 Arepa',
  patata: '🥔 Patata', hamburguesa: '🍔 Hamburguesa', bebida: '🥤 Bebida',
  cerveza: '🍺 Cerveza', vino: '🍷 Vino', adicion: '➕ Adición',
}

// Deriva las variantes/precios de un producto del menú. Si `tamaño` trae un JSON
// de tallas ({ mediana: 20000, ... }) devuelve una opción por talla; si no, usa `precio`.
export function getProductOptions(product) {
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

// Selector de productos del menú compartido por CreateOrderModal y EditOrderModal.
// Posee su propio fetch del menú y el estado del panel de búsqueda/variantes; emite
// cada producto elegido vía `onAddItem({ producto_id, nombre_producto, variante,
// cantidad, precio_unitario })`. La lista de ítems del pedido la maneja cada padre.
export default function MenuPicker({ onAddItem }) {
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedVariante, setSelectedVariante] = useState(null)
  const [addQty, setAddQty] = useState(1)

  useEffect(() => {
    async function fetchMenu() {
      setMenuLoading(true)
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

  function emitItem(productoId, nombre, variante, precio) {
    onAddItem({
      producto_id: productoId,
      nombre_producto: nombre,
      variante,
      cantidad: addQty,
      precio_unitario: precio,
    })
    setAddQty(1)
  }

  function handleSelectProduct(product) {
    const options = getProductOptions(product)
    if (options.length === 1) {
      emitItem(product.producto_id, product.nombre, options[0].variante, options[0].precio)
      setSelectedProduct(null)
      setShowAddMenu(false)
      setSearchQuery('')
    } else {
      setSelectedProduct({ ...product, options })
      setSelectedVariante(null)
      setAddQty(1)
    }
  }

  function confirmAddWithVariante() {
    if (!selectedProduct || !selectedVariante) return
    emitItem(selectedProduct.producto_id, selectedProduct.nombre, selectedVariante.variante, selectedVariante.precio)
    setSelectedProduct(null)
    setSelectedVariante(null)
    setShowAddMenu(false)
    setSearchQuery('')
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

  if (!showAddMenu) {
    return (
      <button className="em-add-btn" onClick={() => setShowAddMenu(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Icon name="plus" size={14} /> Agregar producto del menú
      </button>
    )
  }

  return (
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
  )
}
