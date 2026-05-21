import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './lib/supabase'
import Column from './components/Column'
import SupportPanel from './components/SupportPanel'

const COLUMNS = [
  {
    key: 'pendiente',
    title: 'Por aprobar',
    emoji: '⏳',
    color: 'var(--amber)',
    colorDim: 'var(--amber-dim)',
    colorBorder: 'var(--amber-border)',
  },
  {
    key: 'en_cocina',
    title: 'En cocina',
    emoji: '👨‍🍳',
    color: 'var(--purple)',
    colorDim: 'var(--purple-dim)',
    colorBorder: 'var(--purple-border)',
  },
  {
    key: ['en_camino', 'recoger'],
    title: 'En camino / Recoger',
    emoji: '🛵',
    color: 'var(--green)',
    colorDim: 'var(--green-dim)',
    colorBorder: 'var(--green-border)',
  },
]

function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch (_) { }
}

function timeAgoShort(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

export default function App() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [newIds, setNewIds] = useState(new Set())
  const [stats, setStats] = useState({ total: 0, ingresos: 0, entregados: 0 })
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [activeTab, setActiveTab] = useState('dashboard')
  const [supportCount, setSupportCount] = useState(0)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  const knownIds = useRef(new Set())
  const isFirstLoad = useRef(true)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // ─── Support badge count ─────────────────────────────
  useEffect(() => {
    async function getCount() {
      const { count, error } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true })
        .eq('modo', 'humano')

      if (!error && count !== null) setSupportCount(count)
    }
    getCount()

    const channel = supabase
      .channel('clientes-modo-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes' },
        () => { getCount() }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const fetchOrders = useCallback(async () => {
    const today = new Date()
    today.setUTCHours(5, 0, 0, 0)

    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        pedido_id,
        telefono,
        tipo_pedido,
        direccion_entrega,
        metodo_pago,
        total,
        estado,
        estado_pago,
        comprobante_url,
        motivo_rechazo,
        notas,
        fecha_pedido,
        detalle_pedidos (
          producto_id,
          nombre_producto,
          variante,
          cantidad,
          precio_unitario
        )
      `)
      .gte('fecha_pedido', today.toISOString())
      .in('estado', ['pendiente', 'en_cocina', 'en_camino', 'recoger'])
      .order('fecha_pedido', { ascending: false })

    if (error) return

    // Detectar pedidos nuevos
    if (!isFirstLoad.current) {
      const incoming = data || []
      const newOnes = incoming.filter(o => !knownIds.current.has(o.pedido_id))
      if (newOnes.length > 0) {
        playNotification()
        const ids = new Set(newOnes.map(o => o.pedido_id))
        setNewIds(prev => new Set([...prev, ...ids]))
        setTimeout(() => {
          setNewIds(prev => {
            const next = new Set(prev)
            ids.forEach(id => next.delete(id))
            return next
          })
        }, 8000)
      }
    }

    isFirstLoad.current = false
    knownIds.current = new Set((data || []).map(o => o.pedido_id))
    setOrders(data || [])
    setLastUpdate(new Date())
    setLoading(false)

    // Stats del día
    const { data: statsData } = await supabase
      .from('pedidos')
      .select('total, estado')
      .gte('fecha_pedido', today.toISOString())

    if (statsData) {
      const total = statsData.length
      const ingresos = statsData
        .filter(o => o.estado !== 'cancelado')
        .reduce((sum, o) => sum + Number(o.total || 0), 0)
      const entregados = statsData.filter(o => o.estado === 'entregado').length
      setStats({ total, ingresos, entregados })
    }
  }, [])

  useEffect(() => {
    fetchOrders()

    const channel = supabase
      .channel('pedidos-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        () => { fetchOrders() }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const getColumnOrders = (col) => {
    const keys = Array.isArray(col.key) ? col.key : [col.key]
    return orders.filter(o => keys.includes(o.estado))
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>

      {/* Header */}
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

          {/* ─── Tab Navigation ─── */}
          <nav style={{ display: 'flex', gap: 2, marginLeft: 20 }}>
            <TabButton
              active={activeTab === 'dashboard'}
              onClick={() => setActiveTab('dashboard')}
              label="Pedidos"
              emoji="📋"
            />
            <TabButton
              active={activeTab === 'soporte'}
              onClick={() => setActiveTab('soporte')}
              label="Soporte"
              emoji="💬"
              badge={supportCount}
            />
          </nav>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
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

      {/* ─── Tab Content ─── */}
      {activeTab === 'dashboard' ? (
        <main style={{ padding: '20px 24px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🍕</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando pedidos...</div>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              alignItems: 'start',
            }}>
              {COLUMNS.map(col => (
                <Column
                  key={Array.isArray(col.key) ? col.key.join('-') : col.key}
                  title={col.title}
                  emoji={col.emoji}
                  color={col.color}
                  colorDim={col.colorDim}
                  colorBorder={col.colorBorder}
                  orders={getColumnOrders(col)}
                  newIds={newIds}
                  onUpdated={fetchOrders}
                />
              ))}
            </div>
          )}
        </main>
      ) : (
        <SupportPanel />
      )}

    </div>
  )
}

/* ─── Sub-components ─── */

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