import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'
import { categoryLabel } from '../../utils/constants'

// Categorías que aceptan pizza mitad y mitad. Debe coincidir con la lista de la RPC
// `cotizar_mitad_y_mitad` (las dulces no se parten). La RPC es la que manda: aquí
// solo se usa para no ofrecer combinaciones que el servidor va a rechazar.
const CATEGORIAS_MITAD = [
  'pizza_tradicional', 'pizza_especial', 'pizza_premium', 'pizza_premium_especial',
]

// Tamaños válidos para mitad y mitad — una porción no se parte.
const TAMANOS_MITAD = ['pequena', 'mediana', 'grande', 'familiar']

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

// Deriva las variantes/precios de un producto del menú. Si `tamaño` trae un JSON
// de tallas ({ mediana: 20000, ... }) devuelve una opción por talla; si no, usa `precio`.
export function getProductOptions(product) {
  const options = []
  const sizes = parseSizes(product)
  if (sizes) {
    for (const [sizeName, price] of Object.entries(sizes)) {
      options.push({ variante: capitalize(sizeName), precio: Number(price) })
    }
  } else if (product.precio) {
    options.push({ variante: product.variante || 'Estándar', precio: Number(product.precio) })
  }
  return options
}

// `tamaño` llega como texto con JSON adentro. Devuelve el objeto o null.
function parseSizes(product) {
  if (!product?.tamaño) return null
  try {
    const sizes = typeof product.tamaño === 'string' ? JSON.parse(product.tamaño) : product.tamaño
    return sizes && typeof sizes === 'object' ? sizes : null
  } catch (_) {
    return null
  }
}

// Selector de productos del menú compartido por CreateOrderModal y EditOrderModal.
// Posee su propio fetch del menú y el estado del panel de búsqueda/variantes; emite
// cada producto elegido vía `onAddItem({ producto_id, nombre_producto, variante,
// cantidad, precio_unitario, mitades })`. La lista de ítems del pedido la maneja cada
// padre. `mitades` solo viene en las pizzas mitad y mitad (null en el resto).
export default function MenuPicker({ onAddItem }) {
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedVariante, setSelectedVariante] = useState(null)
  const [addQty, setAddQty] = useState(1)

  // ── Modo mitad y mitad ──
  const [mode, setMode] = useState('producto') // 'producto' | 'mitad'
  const [halfA, setHalfA] = useState(null)
  const [halfB, setHalfB] = useState(null)
  const [halfSize, setHalfSize] = useState(null)
  const [halfError, setHalfError] = useState(null)
  const [halfSaving, setHalfSaving] = useState(false)

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

  function closePanel() {
    setShowAddMenu(false)
    setSelectedProduct(null)
    setSelectedVariante(null)
    setSearchQuery('')
    resetHalves()
  }

  function resetHalves() {
    setHalfA(null)
    setHalfB(null)
    setHalfSize(null)
    setHalfError(null)
  }

  function switchMode(next) {
    setMode(next)
    setSearchQuery('')
    setSelectedProduct(null)
    setSelectedVariante(null)
    setAddQty(1)
    resetHalves()
  }

  function emitItem(item) {
    onAddItem({ cantidad: addQty, mitades: null, ...item })
    setAddQty(1)
  }

  function handleSelectProduct(product) {
    const options = getProductOptions(product)
    if (options.length === 1) {
      emitItem({
        producto_id: product.producto_id,
        nombre_producto: product.nombre,
        variante: options[0].variante,
        precio_unitario: options[0].precio,
      })
      closePanel()
    } else {
      setSelectedProduct({ ...product, options })
      setSelectedVariante(null)
      setAddQty(1)
    }
  }

  function confirmAddWithVariante() {
    if (!selectedProduct || !selectedVariante) return
    emitItem({
      producto_id: selectedProduct.producto_id,
      nombre_producto: selectedProduct.nombre,
      variante: selectedVariante.variante,
      precio_unitario: selectedVariante.precio,
    })
    closePanel()
  }

  // ── Mitad y mitad ────────────────────────────────────────────────────────
  // Las dos mitades tienen que ser de la misma masa (`menu.variante`) y de una
  // categoría de pizza salada; el tamaño debe existir en ambas.
  const pizzasMitad = menuItems.filter(p => CATEGORIAS_MITAD.includes(p.categoria))

  const halfCandidates = (halfA
    ? pizzasMitad.filter(p => p.variante === halfA.variante && p.producto_id !== halfA.producto_id)
    : pizzasMitad
  ).filter(p => {
    const q = searchQuery.trim().toLowerCase()
    return !q || p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q)
  })

  // Tamaños que existen en AMBAS mitades, con el precio de la más cara (así se cobra).
  const halfSizes = (() => {
    if (!halfA || !halfB) return []
    const a = parseSizes(halfA) || {}
    const b = parseSizes(halfB) || {}
    return TAMANOS_MITAD
      .filter(t => Number(a[t]) > 0 && Number(b[t]) > 0)
      .map(t => ({ tamano: t, variante: capitalize(t), precio: Math.max(Number(a[t]), Number(b[t])) }))
  })()

  async function confirmAddHalves() {
    if (!halfA || !halfB || !halfSize) return
    setHalfSaving(true)
    setHalfError(null)

    // El precio SIEMPRE lo decide la BD (misma RPC que usa el bot), no este JS.
    const { data, error } = await supabase.rpc('cotizar_mitad_y_mitad', {
      p_producto_a: halfA.producto_id,
      p_producto_b: halfB.producto_id,
      p_tamano: halfSize.tamano,
    })

    setHalfSaving(false)

    if (error) {
      console.error('Error cotizando mitad y mitad:', error)
      setHalfError('No se pudo cotizar la pizza mitad y mitad. Intenta de nuevo.')
      return
    }
    if (!data?.ok) {
      setHalfError(data?.message || 'Esa combinación no se puede pedir mitad y mitad.')
      return
    }

    emitItem({
      producto_id: data.producto_id,
      nombre_producto: data.nombre_producto,
      variante: data.variante,
      precio_unitario: Number(data.precio_unitario),
      mitades: data.mitades,
    })
    closePanel()
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

  const qtyControl = (
    <div className="qty-ctrl">
      <button className="q-btn" onClick={() => setAddQty(q => Math.max(1, q - 1))}>−</button>
      <span className="q-val">{addQty}</span>
      <button className="q-btn" onClick={() => setAddQty(q => q + 1)}>+</button>
    </div>
  )

  return (
    <div className="em-menu">
      <div className="menu-head">
        <span className="title">Agregar producto</span>
        <button className="cancel" onClick={closePanel}>Cancelar</button>
      </div>

      <div className="mp-mode">
        <button
          className={`opt${mode === 'producto' ? ' active' : ''}`}
          onClick={() => switchMode('producto')}
        >
          Producto
        </button>
        <button
          className={`opt${mode === 'mitad' ? ' active' : ''}`}
          onClick={() => switchMode('mitad')}
        >
          Mitad y mitad
        </button>
      </div>

      {mode === 'mitad' ? (
        <div className="mp-halves">
          {/* Resumen de lo elegido hasta ahora */}
          <div className="mm-picked">
            <button
              className={`mm-slot${halfA ? ' filled' : ''}`}
              onClick={() => { setHalfA(null); setHalfB(null); setHalfSize(null); setHalfError(null); setSearchQuery('') }}
              disabled={!halfA}
            >
              <span className="lbl">Primera mitad</span>
              <span className="val">{halfA ? halfA.nombre : 'Elige una pizza'}</span>
            </button>
            <button
              className={`mm-slot${halfB ? ' filled' : ''}`}
              onClick={() => { setHalfB(null); setHalfSize(null); setHalfError(null); setSearchQuery('') }}
              disabled={!halfB}
            >
              <span className="lbl">Segunda mitad</span>
              <span className="val">{halfB ? halfB.nombre : 'Elige una pizza'}</span>
            </button>
          </div>

          {halfA && (
            <div className="mm-hint">
              Masa <strong>{halfA.variante}</strong> — las dos mitades deben compartir masa.
            </div>
          )}

          {/* Paso 1 y 2: elegir cada mitad */}
          {!halfA || !halfB ? (
            <>
              <input
                className="search"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={halfA ? 'Buscar la segunda mitad...' : 'Buscar la primera mitad...'}
                autoFocus
              />
              <div className="list">
                {menuLoading ? (
                  <div className="mm-msg">Cargando menú...</div>
                ) : halfCandidates.length === 0 ? (
                  <div className="mm-msg">
                    {halfA
                      ? `No hay otras pizzas ${halfA.variante} disponibles para la segunda mitad.`
                      : 'No se encontraron pizzas'}
                  </div>
                ) : (
                  halfCandidates.map(product => {
                    const sizes = parseSizes(product) || {}
                    const precios = TAMANOS_MITAD.map(t => Number(sizes[t])).filter(n => n > 0)
                    return (
                      <button
                        key={product.producto_id}
                        className="product"
                        onClick={() => {
                          if (!halfA) setHalfA(product)
                          else setHalfB(product)
                          setSearchQuery('')
                          setHalfSize(null)
                          setHalfError(null)
                        }}
                      >
                        <span className="prod-name">
                          {product.nombre}
                          {product.variante && <span className="prod-variant"> · {product.variante}</span>}
                        </span>
                        <span className="prod-price">
                          {precios.length > 0 ? `Desde $${Math.min(...precios).toLocaleString('es-CO')}` : '—'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            /* Paso 3: tamaño */
            <>
              <div className="variant-title">Selecciona tamaño</div>
              {halfSizes.length === 0 ? (
                <div className="mm-msg">
                  Estas dos pizzas no comparten ningún tamaño. Cambia una de las mitades.
                </div>
              ) : (
                <div className="variants">
                  {halfSizes.map(opt => (
                    <button
                      key={opt.tamano}
                      className={`v-opt${halfSize?.tamano === opt.tamano ? ' active' : ''}`}
                      onClick={() => { setHalfSize(opt); setHalfError(null) }}
                    >
                      <span className="v-name">{opt.variante}</span>
                      <span className="v-price">${opt.precio.toLocaleString('es-CO')}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mm-rule">Se cobra el precio de la mitad más cara.</div>

              {halfError && <div className="mm-error">{halfError}</div>}

              <div className="add-row">
                {qtyControl}
                <button
                  className={`add-confirm${halfSize ? ' ready' : ''}`}
                  onClick={confirmAddHalves}
                  disabled={!halfSize || halfSaving}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  {halfSaving ? 'Agregando...' : <><Icon name="check" size={13} /> Agregar</>}
                </button>
                <button
                  className="back-btn"
                  onClick={() => { setHalfB(null); setHalfSize(null); setHalfError(null) }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon name="arrow-left" size={13} /> Volver
                </button>
              </div>
            </>
          )}
        </div>
      ) : selectedProduct ? (
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
            {qtyControl}
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
                  <div className="cat-label">{categoryLabel(cat)}</div>
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
