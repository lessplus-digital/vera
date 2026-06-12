import React, { useState } from 'react'
import { timeAgoShort } from '../../utils/formatters'
import Icon from '../Icon'

export default function Header({ theme, onToggleTheme, activeTab, onTabChange, stats, supportCount, lastUpdate }) {
  return (
    <header className="app-topbar" style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--shadow-card), inset 0 1px 0 var(--glass-edge)',
      padding: '0 16px 0 18px',
      height: 60,
      margin: '14px 16px 0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 14,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 34, height: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--amber-dim)',
          color: 'var(--amber)',
          borderRadius: '50%',
        }}><Icon name="pizza" size={18} /></span>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Vera Pizzería
        </span>
        <span style={{
          background: 'var(--amber-dim)',
          color: 'var(--amber)',
          border: '1px solid var(--amber-border)',
          borderRadius: 'var(--radius-pill)',
          padding: '2px 9px',
          fontSize: 11,
          fontWeight: 500,
        }}>
          Admin
        </span>

        <nav style={{
          display: 'flex',
          gap: 2,
          marginLeft: 18,
          background: 'var(--bg-base)',
          borderRadius: 'var(--radius-pill)',
          padding: 4,
        }}>
          <TabButton
            active={activeTab === 'dashboard'}
            onClick={() => onTabChange('dashboard')}
            label="Pedidos"
            icon="clipboard"
          />
          <TabButton
            active={activeTab === 'soporte'}
            onClick={() => onTabChange('soporte')}
            label="Soporte"
            icon="message"
            badge={supportCount}
          />
          <TabButton
            active={activeTab === 'estadisticas'}
            onClick={() => onTabChange('estadisticas')}
            label="Estadísticas"
            icon="chart"
          />
          <TabButton
            active={activeTab === 'clientes'}
            onClick={() => onTabChange('clientes')}
            label="Clientes"
            icon="users"
          />
          <TabButton
            active={activeTab === 'reservas'}
            onClick={() => onTabChange('reservas')}
            label="Reservas"
            icon="calendar"
          />
        </nav>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />

        {activeTab === 'dashboard' && (
          <>
            <Stat label="Pedidos hoy" value={stats.total} color="var(--text-secondary)" />
            <Stat label="Entregados" value={stats.entregados} color="var(--green)" />
            <Stat label="Ingresos" value={`$${stats.ingresos.toLocaleString('es-CO')}`} color="var(--amber)" />
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--green)',
            animation: 'pulse-dot 2s infinite',
          }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            En vivo · {timeAgoShort(lastUpdate)}
          </span>
        </div>
      </div>
    </header>
  )
}

function ThemeToggle({ theme, onToggle }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius-pill)',
        padding: '7px 13px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        boxShadow: hover ? '0 0 16px color-mix(in srgb, var(--amber) 28%, transparent)' : 'none',
        borderColor: hover ? 'var(--amber-border)' : 'var(--border)',
        transition: 'all 0.18s ease',
      }}
      title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        {theme === 'dark' ? 'Light' : 'Dark'}
      </span>
    </button>
  )
}

function TabButton({ active, onClick, label, icon, badge }) {
  const [hover, setHover] = useState(false)
  const glow = '0 0 16px color-mix(in srgb, var(--amber) 28%, transparent)'
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 15px',
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: active || hover ? 'var(--text-primary)' : 'var(--text-muted)',
        background: active ? 'var(--bg-surface)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        boxShadow: hover ? glow : active ? 'var(--shadow-card)' : 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        transition: 'all 0.18s ease',
      }}
    >
      <Icon name={icon} size={15} />
      {label}
      {badge > 0 && (
        <span style={{
          background: 'var(--red)',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          borderRadius: 10,
          padding: '1px 6px',
          minWidth: 18,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          lineHeight: '16px',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
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
