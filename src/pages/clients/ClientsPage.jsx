import React, { useState, useMemo, useEffect } from 'react'
import { useClients } from '../../hooks/useClients'
import { CLIENT_MODES } from '../../utils/constants'
import { parseDb } from '../../utils/dateRanges'
import ClientModal from './ClientModal'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'
import { playDeleted } from '../../utils/audio'

const PAGE_SIZES = [25, 50, 100]

// Orden de los modos al ordenar por columna: el índice en CLIENT_MODES (bot → humano → feedback).
const MODE_ORDER = CLIENT_MODES.map(m => m.value)
const modeIdx = modo => {
  const i = MODE_ORDER.indexOf(modo)
  return i === -1 ? 0 : i // desconocido cae en 'bot', igual que el render del badge
}

const byName = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })

// Encabezado de columna ordenable: siempre muestra un indicador (⇅ atenuado si está
// inactiva, flecha ↑/↓ si es la columna activa) para que se note que es clickeable.
function SortHeader({ label, colKey, sortKey, sortAsc, onSort, defaultAsc = true }) {
  const active = sortKey === colKey
  return (
    <span
      className={`sortable ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      title={`Ordenar por ${label.toLowerCase()}`}
      onClick={() => onSort(colKey, defaultAsc)}
      onKeyDown={e => e.key === 'Enter' && onSort(colKey, defaultAsc)}
    >
      {label}
      <Icon
        name={active ? (sortAsc ? 'arrow-up' : 'arrow-down') : 'sort'}
        size={11}
        className={active ? undefined : 'sort-hint'}
      />
    </span>
  )
}

export default function ClientsPage() {
  const { clients, loading, error, saveClient, deleteClient } = useClients()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('nombre') // 'nombre' | 'modo' | 'fecha_registro'
  const [sortAsc, setSortAsc] = useState(true)
  const [modal, setModal] = useState(null) // null | 'new' | objeto cliente
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const { toast, showToast } = useToast()

  // Wrappers sobre el hook: la mutación es del hook, el feedback (toast/sonido) es de la página.
  async function handleSave(form) {
    const isNew = !form.cliente_id
    const result = await saveClient(form)
    if (!result.error) showToast('success', isNew ? '✓ Cliente creado' : '✓ Cambios guardados')
    return result
  }

  async function handleDelete(cliente_id) {
    const result = await deleteClient(cliente_id)
    if (!result.error) {
      showToast('success', '✓ Cliente eliminado junto con sus pedidos, reservas y feedback')
      playDeleted()
    }
    return result
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
    const qDigits = q.replace(/[^\d]/g, '')

    const result = clients.filter(c => {
      if (!q) return true
      const byNameMatch = (c.nombre || '').toLowerCase().includes(q)
      const byPhone = qDigits.length > 0 && (c.telefono || '').includes(qDigits)
      return byNameMatch || byPhone
    })

    return result.sort((a, b) => {
      let cmp
      if (sortKey === 'modo') {
        cmp = modeIdx(a.modo) - modeIdx(b.modo)
      } else if (sortKey === 'fecha_registro') {
        // fecha_registro es 'YYYY-MM-DD': el orden lexicográfico es el cronológico.
        cmp = (a.fecha_registro || '').localeCompare(b.fecha_registro || '')
      } else {
        cmp = byName(a, b)
      }
      if (cmp === 0) cmp = byName(a, b) // desempate estable por nombre
      return sortAsc ? cmp : -cmp
    })
  }, [clients, search, sortKey, sortAsc])

  // Paginación client-side (los datos ya viven en memoria vía useClients).
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const startIdx = (pageClamped - 1) * pageSize
  const paged = filtered.slice(startIdx, startIdx + pageSize)

  // Volver a la primera página cuando cambia el resultado o el tamaño de página.
  useEffect(() => { setPage(1) }, [search, sortKey, sortAsc, pageSize])

  return (
    <div className="clients-page">

      <div className="clients-toolbar">
        <input
          className="clients-search"
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
        />

        <button className="clients-sort" onClick={() => sortBy('nombre')} title="Ordenar alfabéticamente por nombre">
          {sortKey === 'nombre' && !sortAsc ? 'Z → A' : 'A → Z'}
        </button>

        <span className="clients-count">
          {filtered.length} {filtered.length === 1 ? 'cliente' : 'clientes'}
          {search && ` de ${clients.length}`}
        </span>

        <button className="btn primary clients-new" onClick={() => setModal('new')}>
          <Icon name="plus" size={14} /> Nuevo cliente
        </button>
      </div>

      {error && <div className="clients-error">Error cargando clientes: {error}</div>}

      {loading ? (
        <div className="clients-empty">Cargando clientes…</div>
      ) : filtered.length === 0 ? (
        <div className="clients-empty">
          {search ? 'No se encontraron clientes con esa búsqueda' : 'Aún no hay clientes registrados'}
        </div>
      ) : (
        <>
        <div className="clients-table">
          <div className="clients-row head">
            <SortHeader label="Nombre" colKey="nombre" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <span>Teléfono</span>
            <span>Dirección</span>
            <SortHeader label="Modo" colKey="modo" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} />
            <SortHeader label="Registrado" colKey="fecha_registro" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} defaultAsc={false} />
            <span></span>
          </div>

          {paged.map(client => (
            <div key={client.cliente_id} className="clients-row">
              <span className="name">{client.nombre || 'Pendiente'}</span>
              <span className="phone">
                <a href={`https://wa.me/${client.telefono}`} target="_blank" rel="noreferrer" title="Abrir en WhatsApp">
                  {client.telefono}
                </a>
              </span>
              <span className="address" title={client.direccion_principal || ''}>
                {client.direccion_principal || '—'}
              </span>
              <span>
                {(() => {
                  const mode = CLIENT_MODES.find(m => m.value === client.modo) || CLIENT_MODES[0]
                  return <span className={`mode-badge ${mode.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={mode.icon} size={12} /> {mode.label}</span>
                })()}
              </span>
              <span className="date">
                {client.fecha_registro
                  ? parseDb(client.fecha_registro).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'}
              </span>
              <span className="actions">
                <button className="edit-btn" onClick={() => setModal(client)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="edit" size={13} /> Editar</button>
              </span>
            </div>
          ))}
        </div>

        <div className="clients-pagination">
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

      {modal && (
        <ClientModal
          client={modal === 'new' ? null : modal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
