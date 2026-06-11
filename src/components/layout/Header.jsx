import React from 'react'
import { timeAgoShort } from '../../utils/formatters'

export default function Header({ theme, onToggleTheme, activeTab, onTabChange, stats, supportCount, lastUpdate }) {
  return (
    <header style={{
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>🍕</span>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Vera Pizzería
        </span>
        <span style={{
          background: 'var(--amber-dim)',
          color: 'var(--amber)',
          border: '1px solid var(--amber-border)',
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 500,
        }}>
          Admin
        </span>

        <nav style={{ display: 'flex', gap: 2, marginLeft: 20 }}>
          <TabButton
            active={activeTab === 'dashboard'}
            onClick={() => onTabChange('dashboard')}
            label="Pedidos"
            emoji="📋"
          />
          <TabButton
            active={activeTab === 'soporte'}
            onClick={() => onTabChange('soporte')}
            label="Soporte"
            emoji="💬"
            badge={supportCount}
          />
          <TabButton
            active={activeTab === 'estadisticas'}
            onClick={() => onTabChange('estadisticas')}
            label="Estadísticas"
            emoji="📊"
          />
          <TabButton
            active={activeTab === 'clientes'}
            onClick={() => onTabChange('clientes')}
            label="Clientes"
            emoji="👥"
          />
        </nav>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <button
          onClick={onToggleTheme}
          style={{
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>

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

function TabButton({ active, onClick, label, emoji, badge }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        background: active ? 'var(--bg-card)' : 'transparent',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: 8,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        transition: 'all 0.15s ease',
      }}
    >
      <span style={{ fontSize: 13 }}>{emoji}</span>
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
