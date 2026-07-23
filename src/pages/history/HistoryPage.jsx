import React, { useState, useEffect, useRef } from 'react'
import { useOrderHistory } from '../../hooks/useOrderHistory'
import { ORDER_STATES } from '../../utils/constants'
import { PRESETS, parseDb } from '../../utils/dateRanges'
import { formatPrice } from '../../utils/formatters'
import { exportCsv, exportExcel, colombiaDateISO } from '../../utils/exportHistory'
import SortHeader from '../../components/SortHeader'
import OrderDetailModal from './OrderDetailModal'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

const PAGE_SIZES = [25, 50, 100]
const STATE_ORDER = Object.keys(ORDER_STATES)

// Botón "Exportar" con menú (Excel con formato / CSV plano). Cierra con click
// afuera o Escape; muestra spinner mientras genera el archivo.
function ExportMenu({ disabled, busy, onExport }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="hist-export" ref={ref}>
      <button
        className="btn secondary"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {busy
          ? <><span className="spinner sm" /> Exportando…</>
          : <><Icon name="download" size={14} /> Exportar</>}
      </button>

      {open && (
        <div className="hist-export-menu" role="menu">
          <button className="hx-item" onClick={() => { setOpen(false); onExport('xlsx') }}>
            <span className="hx-title">Excel (.xlsx)</span>
            <span className="hx-sub">Hoja con formato, lista para leer</span>
          </button>
          <button className="hx-item" onClick={() => { setOpen(false); onExport('csv') }}>
            <span className="hx-title">CSV (.csv)</span>
            <span className="hx-sub">Plano, para CRM o importaciones</span>
          </button>
        </div>
      )}
    </div>
  )
}

// Fecha + hora en hora Colombia, compacta para la tabla.
function fmtDateTime(d) {
  const date = parseDb(d)
  const day = date.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' })
  const time = date.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} · ${time}`
}

export default function HistoryPage() {
  // Todo el estado de filtros/orden/página vive aquí y viaja al hook como
  // parámetros de la query — el filtrado y la paginación son server-side.
  const [preset, setPreset] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('') // searchInput con debounce
  const [estado, setEstado] = useState('todos')
  const [tipo, setTipo] = useState('todos')
  const [sortKey, setSortKey] = useState('fecha') // 'fecha' | 'total'
  const [sortAsc, setSortAsc] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modalId, setModalId] = useState(null)

  // Debounce de la búsqueda: cada tecla no dispara una query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const [exporting, setExporting] = useState(false)

  const { orders, totalCount, summary, loading, error, range, marcarEntregado, cancelarPedido, fetchAllFiltered } = useOrderHistory({
    preset, customFrom, customTo, estado, tipo, search, sortKey, sortAsc, page, pageSize,
  })
  const { toast, showToast } = useToast()

  // Exporta TODO el conjunto filtrado (no solo la página visible).
  async function handleExport(format) {
    if (!range) return
    setExporting(true)
    try {
      const { data, error: expError, truncated } = await fetchAllFiltered()
      if (expError) {
        showToast('error', expError)
        return
      }
      if (data.length === 0) {
        showToast('warn', 'No hay pedidos para exportar con estos filtros')
        return
      }

      // `to` es exclusivo: el último día incluido es to - 1ms.
      const desde = colombiaDateISO(range.from)
      const hasta = colombiaDateISO(new Date(range.to.getTime() - 1))
      const filename = `historial-pedidos_${desde}_${hasta}.${format}`

      if (format === 'csv') {
        exportCsv(data, filename)
      } else {
        await exportExcel(
          { orders: data, summary, rangeLabel: `${desde} – ${hasta}` },
          filename
        )
      }
      showToast('success', `✓ ${data.length} pedidos exportados${truncated ? ' (tope de 10.000 — acorta el rango para el resto)' : ''}`)
    } catch (e) {
      console.error('Error generando el export:', e)
      showToast('error', 'No se pudo generar el archivo. Intenta de nuevo.')
    } finally {
      setExporting(false)
    }
  }

  // El pedido del modal se deriva de la página cargada: el realtime lo mantiene fresco.
  const modalOrder = modalId ? orders.find(o => o.pedido_id === modalId) : null

  // Wrappers sobre el hook: la mutación es del hook, el feedback (toast) es de la página.
  async function handleMarkDelivered(pedido_id) {
    const result = await marcarEntregado(pedido_id)
    if (!result.error) showToast('success', `✓ #${pedido_id} entregado — el cliente recibe la confirmación por WhatsApp`)
    return result
  }

  async function handleCancelOrder(pedido_id, motivo) {
    const result = await cancelarPedido(pedido_id, motivo)
    if (!result.error) showToast('success', `#${pedido_id} cancelado — el motivo se envió al cliente por WhatsApp`)
    return result
  }

  function sortBy(key, defaultAsc = true) {
    if (sortKey === key) {
      setSortAsc(v => !v)
    } else {
      setSortKey(key)
      setSortAsc(defaultAsc)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const startIdx = (page - 1) * pageSize

  // Primera página al cambiar cualquier filtro; clamp si el total se achica en vivo.
  useEffect(() => { setPage(1) }, [preset, customFrom, customTo, search, estado, tipo, sortKey, sortAsc, pageSize])
  useEffect(() => {
    if (!loading && page > totalPages) setPage(totalPages)
  }, [loading, page, totalPages])

  const hasFilters = search || estado !== 'todos' || tipo !== 'todos'

  return (
    <div className="history-page">

      {/* ── Periodo ── */}
      <div className="hist-toolbar">
        <div className="hist-presets">
          {PRESETS.map(p => (
            <button
              key={p.key}
              className={`hist-chip${preset === p.key ? ' active' : ''}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="hist-custom">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="hist-custom-sep">→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="hist-filters">
        <input
          className="hist-search"
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Buscar por # de pedido, cliente o teléfono..."
        />

        <select value={estado} onChange={e => setEstado(e.target.value)} title="Filtrar por estado">
          <option value="todos">Todos los estados</option>
          {STATE_ORDER.map(key => <option key={key} value={key}>{ORDER_STATES[key].label}</option>)}
        </select>

        <select value={tipo} onChange={e => setTipo(e.target.value)} title="Filtrar por tipo">
          <option value="todos">Domicilio y recoger</option>
          <option value="domicilio">Domicilio</option>
          <option value="recoger">Recoger</option>
        </select>

        <span className="hist-count">
          {summary.total} {summary.total === 1 ? 'pedido' : 'pedidos'}
          {' · '}<span className="ok">{summary.entregados} entregados</span>
          {summary.cancelados > 0 && <> · <span className="bad">{summary.cancelados} cancelados</span></>}
          {' · '}<span className="money tnum">{formatPrice(summary.ingresos)}</span>
        </span>

        <ExportMenu
          disabled={loading || totalCount === 0}
          busy={exporting}
          onExport={handleExport}
        />
      </div>

      {error && <div className="hist-error">Error cargando el historial: {error}</div>}

      {loading && orders.length === 0 ? (
        <div className="loading-state"><div className="spinner" />Cargando historial…</div>
      ) : totalCount === 0 ? (
        <div className="hist-empty">
          {hasFilters
            ? 'No hay pedidos con esos filtros en este periodo'
            : 'No hay pedidos en este periodo'}
        </div>
      ) : (
        <>
        <div className={`hist-table-wrap${loading ? ' loading' : ''}`}>
        <div className="hist-table">
          <div className="hist-row head">
            <span>Pedido</span>
            <SortHeader label="Fecha" colKey="fecha" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} defaultAsc={false} />
            <span>Cliente</span>
            <span>Tipo</span>
            <SortHeader label="Total" colKey="total" sortKey={sortKey} sortAsc={sortAsc} onSort={sortBy} defaultAsc={false} />
            <span>Estado</span>
            <span></span>
          </div>

          {orders.map(order => {
            const st = ORDER_STATES[order.estado] || { label: order.estado, cls: 'amber' }
            return (
              <div key={order.pedido_id} className="hist-row">
                <span className="oid tnum" title={order.pedido_id}>#{order.pedido_id}</span>
                <span className="date tnum">{fmtDateTime(order.fecha_pedido)}</span>
                <span className="client">
                  <span className="cname">{order.clientes?.nombre || 'Sin nombre'}</span>
                  <span className="cphone tnum">{order.telefono}</span>
                </span>
                <span className="type">
                  <Icon name={order.tipo_pedido === 'domicilio' ? 'scooter' : 'bag'} size={13} />
                  {order.tipo_pedido === 'domicilio' ? 'Domicilio' : 'Recoger'}
                </span>
                <span className="total tnum">{formatPrice(order.total)}</span>
                <span><span className={`state-badge ${st.cls}`}>{st.label}</span></span>
                <span className="actions">
                  <button
                    className="edit-btn"
                    onClick={() => setModalId(order.pedido_id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  ><Icon name="expand" size={13} /> Ver</button>
                </span>
              </div>
            )
          })}
        </div>

        {loading && (
          <div className="hist-loading-overlay" aria-label="Cargando">
            <div className="spinner sm" />
          </div>
        )}
        </div>

        <div className="table-pagination">
          <label className="cp-size">
            Filas por página
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <span className="cp-range">
            {startIdx + 1}–{Math.min(startIdx + pageSize, totalCount)} de {totalCount}
          </span>

          <div className="cp-nav">
            <button
              className="cp-btn"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Página anterior"
            ><Icon name="arrow-left" size={14} /></button>
            <span className="cp-page">Página {page} de {totalPages}</span>
            <button
              className="cp-btn"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Página siguiente"
            ><Icon name="arrow-right" size={14} /></button>
          </div>
        </div>
        </>
      )}

      {modalOrder && (
        <OrderDetailModal
          order={modalOrder}
          onMarkDelivered={handleMarkDelivered}
          onCancelOrder={handleCancelOrder}
          onClose={() => setModalId(null)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
