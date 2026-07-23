import React, { useState } from 'react'
import Icon from '../Icon'

const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Pedidos',      icon: 'clipboard' },
  { id: 'soporte',      label: 'Soporte',      icon: 'message', badgeKey: 'support' },
  { id: 'estadisticas', label: 'Estadísticas', icon: 'chart' },
  { id: 'historial',    label: 'Historial',    icon: 'history' },
  { id: 'clientes',     label: 'Clientes',     icon: 'users' },
  { id: 'reservas',     label: 'Reservas',     icon: 'calendar' },
  { id: 'menu',         label: 'Menú',         icon: 'book' },
  { id: 'resenas',      label: 'Reseñas',      icon: 'star' },
  { id: 'configuracion', label: 'Configuración', icon: 'settings' },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  supportCount,
  theme,
  onToggleTheme,
  collapsed,
  mobileOpen,
  onCloseMobile,
}) {
  const badges = { support: supportCount }

  return (
    <>
      {/* Backdrop para el cajón en móvil */}
      <div
        className={`sidebar-backdrop${mobileOpen ? ' open' : ''}`}
        onClick={onCloseMobile}
      />

      <aside className={`app-sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        {/* ─── Marca ─── */}
        <div className="sb-brand">
          <span className="sb-logo"><Icon name="pizza" size={20} /></span>
          {!collapsed && (
            <span className="sb-brand-text">
              <span className="sb-brand-name">Vera Pizzería</span>
              <span className="sb-brand-tag">Admin</span>
            </span>
          )}
        </div>

        {/* ─── Navegación ─── */}
        <nav className="sb-nav">
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={activeTab === item.id}
              badge={item.badgeKey ? badges[item.badgeKey] : 0}
              collapsed={collapsed}
              onClick={() => {
                onTabChange(item.id)
                onCloseMobile?.()
              }}
            />
          ))}
        </nav>

        {/* ─── Pie: tema ─── */}
        <div className="sb-foot">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} collapsed={collapsed} />
        </div>
      </aside>
    </>
  )
}

function NavItem({ item, active, badge, collapsed, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`sb-item${active ? ' active' : ''}`}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      style={{
        boxShadow: hover && !active ? '0 0 16px color-mix(in srgb, var(--amber) 22%, transparent)' : undefined,
      }}
    >
      <span className="sb-item-icon"><Icon name={item.icon} size={18} /></span>
      {!collapsed && <span className="sb-item-label">{item.label}</span>}
      {badge > 0 && (
        <span className={`sb-badge${collapsed ? ' dot' : ''}`}>{collapsed ? '' : badge}</span>
      )}
    </button>
  )
}

function ThemeToggle({ theme, onToggle, collapsed }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="sb-theme"
      title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      style={{
        boxShadow: hover ? '0 0 16px color-mix(in srgb, var(--amber) 28%, transparent)' : 'none',
        borderColor: hover ? 'var(--amber-border)' : 'var(--border)',
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      {!collapsed && <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  )
}
