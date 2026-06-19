import React, { useState, useEffect, useRef } from 'react'
import { timeAgoShort } from '../../utils/formatters'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import Icon from '../Icon'

export default function Header({
  theme,
  activeTab,
  stats,
  lastUpdate,
  onToggleSidebar,
  showHamburger,
}) {
  const hideStats = useMediaQuery('(max-width: 900px)')
  const compact   = useMediaQuery('(max-width: 560px)')

  return (
    <header className="app-topbar" style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--shadow-card), inset 0 1px 0 var(--glass-edge)',
      padding: compact ? '0 10px' : '0 16px 0 18px',
      height: 60,
      margin: '14px 16px 0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      position: 'sticky',
      top: 14,
      zIndex: 100,
    }}>
      {/* ─── Izquierda: hamburguesa + saludo ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
        {showHamburger && (
          <button className="topbar-burger" onClick={onToggleSidebar} aria-label="Abrir menú">
            <BurgerIcon />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: compact ? 14 : 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            Bienvenido de nuevo 👋
          </div>
          {!compact && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {SECTION_LABELS[activeTab] || 'Panel'}
            </div>
          )}
        </div>
      </div>

      {/* ─── Derecha: stats + en vivo + admin ─── */}
      <div style={{ display: 'flex', gap: compact ? 10 : 18, alignItems: 'center', flexShrink: 0 }}>
        {activeTab === 'dashboard' && !hideStats && (
          <>
            <Stat label="Pedidos hoy" value={stats.total} color="var(--text-secondary)" />
            <Stat label="Entregados" value={stats.entregados} color="var(--green)" />
            <Stat label="Ingresos" value={`$${stats.ingresos.toLocaleString('es-CO')}`} color="var(--amber)" />
            <Divider />
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            flexShrink: 0,
            background: 'var(--green)',
            animation: 'pulse-dot 2s infinite',
          }} />
          {!compact && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              En vivo · {timeAgoShort(lastUpdate)}
            </span>
          )}
        </div>

        <Divider />
        <AdminMenu compact={compact} />
      </div>
    </header>
  )
}

const SECTION_LABELS = {
  dashboard:    'Gestión de pedidos',
  soporte:      'Soporte en vivo',
  estadisticas: 'Estadísticas y reportes',
  clientes:     'Base de clientes',
  reservas:     'Reservas',
}

/* ─── Menú de administrador (placeholder de login) ─── */
function AdminMenu({ compact }) {
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
    <div className="admin-menu" ref={ref}>
      <button
        className="admin-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="admin-avatar">A</span>
        {!compact && (
          <span className="admin-id">
            <span className="admin-name">Administrador</span>
            <span className="admin-role">Vera Pizzería</span>
          </span>
        )}
        <span className={`admin-caret${open ? ' open' : ''}`}><Icon name="arrow-down" size={14} /></span>
      </button>

      {open && (
        <div className="admin-dropdown" role="menu">
          <div className="ad-header">
            <span className="admin-avatar lg">A</span>
            <div>
              <div className="ad-greet">Hola, Administrador</div>
              <div className="ad-sub">Sesión de invitado</div>
            </div>
          </div>

          <div className="ad-divider" />

          <button className="ad-item" disabled>
            <Icon name="lock" size={15} />
            <span>Iniciar sesión</span>
            <span className="ad-soon">Próximamente</span>
          </button>
          <button className="ad-item" disabled>
            <Icon name="users" size={15} />
            <span>Mi perfil</span>
            <span className="ad-soon">Próximamente</span>
          </button>
          <button className="ad-item" disabled>
            <Icon name="desktop" size={15} />
            <span>Configuración</span>
            <span className="ad-soon">Próximamente</span>
          </button>

          <div className="ad-divider" />

          <div className="ad-note">
            El inicio de sesión estará disponible próximamente.
          </div>
        </div>
      )}
    </div>
  )
}

function BurgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

function Divider() {
  return <span style={{ width: 1, height: 26, background: 'var(--border)', flexShrink: 0 }} />
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color, fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
        {label}
      </div>
    </div>
  )
}
