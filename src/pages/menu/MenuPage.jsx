import React, { useState, useMemo, useEffect } from 'react'
import { useMenu } from '../../hooks/useMenu'
import { categoryLabel } from '../../utils/constants'
import { getProductOptions } from '../dashboard/MenuPicker'
import { formatPrice } from '../../utils/formatters'
import SortHeader from '../../components/SortHeader'
import ProductModal from './ProductModal'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

const PAGE_SIZES = [25, 50, 100]

const catLabel = categoryLabel
const byName = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
const byCat  = (a, b) => catLabel(a.categoria).localeCompare(catLabel(b.categoria), 'es', { sensitivity: 'base' })

// Precio "desde" (mínimo entre tamaños); null si el producto no tiene precio.
function minPrice(p) {
  const opts = getProductOptions(p)
  return opts.length ? Math.min(...opts.map(o => o.precio)) : null
}

function priceDisplay(p) {
  const opts = getProductOptions(p)
  if (opts.length === 0) return '—'
  if (opts.length === 1) return formatPrice(opts[0].precio)
  return `Desde ${formatPrice(Math.min(...opts.map(o => o.precio)))}`
}

export default function MenuPage() {
  const { products, loading, error, setDisponible } = useMenu()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('todas')
  const [estado, setEstado] = useState('todos') // 'todos' | 'disponible' | 'agotado'
  const [sortKey, setSortKey] = useState('categoria') // 'nombre' | 'categoria' | 'precio' | 'disponible'
  const [sortAsc, setSortAsc] = useState(true)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modalId, setModalId] = useState(null)
  const { toast, showToast } = useToast()

  // El producto del modal se deriva de la lista para que el realtime lo mantenga fresco.
  const modalProduct = modalId ? products.find(p => p.producto_id === modalId) : null

  // Categorías presentes en el catálogo (ya vienen ordenadas por categoría desde el hook).
  const categorias = useMemo(() => [...new Set(products.map(p => p.categoria))], [products])
  const agotados = useMemo(() => products.filter(p => !p.disponible).length, [products])

  async function handleToggle(product) {
    const next = !product.disponible
    const { error: toggleError } = await setDisponible(product.producto_id, next)
    if (toggleError) {
      showToast('error', toggleError)
    } else {
      showToast('success', next
        ? `✓ ${product.nombre} vuelve a estar disponible`
        : `${product.nombre} marcado como agotado — el bot ya no lo ofrece`)
    }
  }

  // Click en un encabezado: misma columna invierte el orden, columna nueva arranca en su default.
  function sortBy(key, defaultAsc = true) {
    if (sortKey === key) {
      setSortAsc(v => !v)
    } else {
      setSortKey(key)
      setSortAsc(defaultAsc)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    const result = products.filter(p => {
      if (cat !== 'todas' && p.categoria !== cat) return false
      if (estado === 'disponible' && !p.disponible) return false
      if (estado === 'agotado' && p.disponible) return false
      if (!q) return true
      return (
        (p.nombre || '').toLowerCase().includes(q) ||
        (p.descripcion || '').toLowerCase().includes(q) ||
        catLabel(p.categoria).toLowerCase().includes(q) ||
        (p.producto_id || '').toLowerCase().includes(q)
      )
    })

    return result.sort((a, b) => {
      let cmp
      if (sortKey === 'nombre') {
        cmp = byName(a, b)
      } else if (sortKey === 'precio') {
        cmp = (minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity)
      } else if (sortKey === 'disponible') {
        cmp = (a.disponible ? 1 : 0) - (b.disponible ? 1 : 0) // asc = agotados primero
      } else {
        cmp = byCat(a, b)
      }
      if (cmp === 0) cmp = byName(a, b) // desempate estable por nombre
      return sortAsc ? cmp : -cmp
    })
  }, [products, search, cat, estado, sortKey, sortAsc])

  // Paginación client-side (mismo patrón que Clientes).
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const startIdx = (pageClamped - 1) * pageSize
  const paged = filtered.slice(startIdx, startIdx + pageSize)

  useEffect(() => { setPage(1) }, [search, cat, estado, sortKey, sortAsc, pageSize])

  return (
    <div className="menu-page">

      <div className="menu-toolbar">
        <input
          className="menu-search"
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, categoría o descripción..."
        />

        <select value={cat} onChange={e => setCat(e.target.value)} title="Filtrar por categoría">
          <option value="todas">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
        </select>

        <select value={estado} onChange={e => setEstado(e.target.value)} title="Filtrar por disponibilidad">
          <option value="todos">Todos los estados</option>
          <option value="disponible">Disponibles</option>
          <option value="agotado">Agotados</option>
        </select>

        <span className="menu-count">
          {filtered.length} {filtered.length === 1 ? 'producto' : 'productos'}
          {filtered.length !== products.length && ` de ${products.length}`}
          {agotados > 0 && <span className="menu-count-off"> · {agotados} {agotados === 1 ? 'agotado' : 'agotados'}</span>}
        </span>
      </div>

      {error && <div className="menu-error">Error cargando el menú: {error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando menú…</div>
      ) : filtered.length === 0 ? (
        <div className="menu-empty">
          {search || cat !== 'todas' || estado !== 'todos'
            ? 'No se encontraron productos con esos filtros'
            : 'El menú está vacío'}
        </div>
      ) : (
        <>
        <div className="menu-table">
          <div className="menu-row head">
            <SortHeader label="Producto" colKey="nombre" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <SortHeader label="Categoría" colKey="categoria" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <SortHeader label="Precio" colKey="precio" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <span>Descripción</span>
            <SortHeader label="Estado" colKey="disponible" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <span></span>
          </div>

          {paged.map(product => (
            <div key={product.producto_id} className="menu-row">
              <span className="name">
                {product.nombre}
                {product.variante && product.variante !== 'Estándar' && (
                  <span className="variant"> · {product.variante}</span>
                )}
              </span>
              <span className="cat">{catLabel(product.categoria)}</span>
              <span className="price tnum">{priceDisplay(product)}</span>
              <span className="desc" title={product.descripcion || ''}>
                {product.descripcion || '—'}
              </span>
              <span className="stock">
                <button
                  className="switch"
                  role="switch"
                  aria-checked={product.disponible}
                  aria-label={`Disponibilidad de ${product.nombre}`}
                  title={product.disponible ? 'Marcar como agotado' : 'Marcar como disponible'}
                  onClick={() => handleToggle(product)}
                />
                <span className={`stock-label ${product.disponible ? 'on' : 'off'}`}>
                  {product.disponible ? 'Disponible' : 'Agotado'}
                </span>
              </span>
              <span className="actions">
                <button
                  className="edit-btn"
                  onClick={() => setModalId(product.producto_id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                ><Icon name="expand" size={13} /> Ver</button>
              </span>
            </div>
          ))}
        </div>

        <div className="table-pagination">
          <label className="cp-size">
            Filas por página
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <span className="cp-range">
            {startIdx + 1}–{Math.min(startIdx + pageSize, filtered.length)} de {filtered.length}
          </span>

          <div className="cp-nav">
            <button
              className="cp-btn"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              aria-label="Página anterior"
            ><Icon name="arrow-left" size={14} /></button>
            <span className="cp-page">Página {pageClamped} de {totalPages}</span>
            <button
              className="cp-btn"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              aria-label="Página siguiente"
            ><Icon name="arrow-right" size={14} /></button>
          </div>
        </div>
        </>
      )}

      {modalProduct && (
        <ProductModal
          product={modalProduct}
          onToggle={handleToggle}
          onClose={() => setModalId(null)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
