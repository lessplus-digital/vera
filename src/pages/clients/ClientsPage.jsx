import React, { useState, useMemo, useEffect } from 'react'
import { useClients } from '../../hooks/useClients'
import { CLIENT_MODES } from '../../utils/constants'
import { parseDb } from '../../utils/dateRanges'
import ClientModal from './ClientModal'
import Icon from '../../components/Icon'

const PAGE_SIZES = [25, 50, 100]

export default function ClientsPage() {
  const { clients, loading, error, saveClient } = useClients()
  const [search, setSearch] = useState('')
  const [sortAsc, setSortAsc] = useState(true)
  const [modal, setModal] = useState(null) // null | 'new' | objeto cliente
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/[^\d]/g, '')

    const result = clients.filter(c => {
      if (!q) return true
      const byName = (c.nombre || '').toLowerCase().includes(q)
      const byPhone = qDigits.length > 0 && (c.telefono || '').includes(qDigits)
      return byName || byPhone
    })

    return result.sort((a, b) => {
      const cmp = (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
      return sortAsc ? cmp : -cmp
    })
  }, [clients, search, sortAsc])

  // Paginación client-side (los datos ya viven en memoria vía useClients).
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const startIdx = (pageClamped - 1) * pageSize
  const paged = filtered.slice(startIdx, startIdx + pageSize)

  // Volver a la primera página cuando cambia el resultado o el tamaño de página.
  useEffect(() => { setPage(1) }, [search, sortAsc, pageSize])

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

        <button className="clients-sort" onClick={() => setSortAsc(v => !v)} title="Cambiar orden alfabético">
          {sortAsc ? 'A → Z' : 'Z → A'}
        </button>

        <span className="clients-count">
          {filtered.length} {filtered.length === 1 ? 'cliente' : 'clientes'}
          {search && ` de ${clients.length}`}
        </span>

        <button className="clients-new" onClick={() => setModal('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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
            <span>Nombre</span>
            <span>Teléfono</span>
            <span>Dirección</span>
            <span>Modo</span>
            <span>Registrado</span>
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
          onSave={saveClient}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
