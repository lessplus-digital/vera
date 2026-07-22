import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { playNotification } from '../utils/audio'

export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [newIds, setNewIds] = useState(new Set())
  const [stats, setStats] = useState({ total: 0, ingresos: 0, entregados: 0 })
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const knownIds = useRef(new Set())
  const isFirstLoad = useRef(true)

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

    if (error) {
      console.error('Error cargando pedidos:', error)
      setLoading(false)
      return
    }

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

    const { data: statsData, error: statsError } = await supabase
      .from('pedidos')
      .select('total, estado')
      .gte('fecha_pedido', today.toISOString())

    if (statsError) {
      console.error('Error cargando estadísticas del header:', statsError)
    } else if (statsData) {
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

    let debounce
    const channel = supabase
      .channel('pedidos-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        // Debounce: una ráfaga de eventos realtime (varios INSERT/UPDATE seguidos)
        // colapsa en un solo refetch en vez de encadenar queries en cascada.
        clearTimeout(debounce)
        debounce = setTimeout(() => fetchOrders(), 300)
      })
      .subscribe()

    return () => {
      clearTimeout(debounce)
      supabase.removeChannel(channel)
    }
  }, [])

  return { orders, loading, newIds, stats, lastUpdate, fetchOrders }
}
