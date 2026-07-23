import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getRange, getPreviousRange } from '../utils/dateRanges'
import {
  computeKpis, computeDelta, groupByBucket, topProducts, topClients,
  cancellationReasons, avgRating,
  deliveryStats, revenueByCategory, hourWeekMatrix, riskClients,
} from '../utils/statsAggregations'

export function useStatistics() {
  const [preset, setPreset] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [granularity, setGranularity] = useState('dia')
  const [categoria, setCategoria] = useState('todas')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [orders, setOrders] = useState([])
  const [prevOrders, setPrevOrders] = useState([])
  const [feedback, setFeedback] = useState([])
  const [clients, setClients] = useState([])
  const [atRisk, setAtRisk] = useState([])
  const [menu, setMenu] = useState([])

  const range = useMemo(
    () => getRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  // Menú y top clientes: una sola vez al montar.
  // Clientes fieles se agrega desde pedidos (histórico) porque los
  // contadores clientes.total_pedidos/gasto_total no se mantienen en la BD.
  useEffect(() => {
    const PEDIDOS_LIMIT = 10000

    supabase
      .from('menu')
      .select('producto_id, nombre, categoria, variante, disponible')
      .then(({ data, error }) => {
        if (error) console.error('Error cargando menú (estadísticas):', error)
        setMenu(data || [])
      })

    Promise.all([
      supabase
        .from('pedidos')
        .select('cliente_id, telefono, total, estado, fecha_pedido')
        .limit(PEDIDOS_LIMIT),
      supabase
        .from('clientes')
        .select('cliente_id, nombre'),
    ]).then(([orders, clientes]) => {
      if (orders.error) console.error('Error cargando pedidos (clientes fieles/riesgo):', orders.error)
      if (clientes.error) console.error('Error cargando clientes (estadísticas):', clientes.error)
      if (orders.data && orders.data.length >= PEDIDOS_LIMIT) {
        console.warn(`useStatistics: la query de pedidos alcanzó el límite de ${PEDIDOS_LIMIT} filas; los agregados de clientes fieles/riesgo pueden estar truncados.`)
      }
      setClients(topClients(orders.data || [], clientes.data || []))
      setAtRisk(riskClients(orders.data || [], clientes.data || []))
    })
  }, [])

  // Pedidos + feedback del rango seleccionado
  useEffect(() => {
    if (!range) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const prev = getPreviousRange(range)

    Promise.all([
      supabase
        .from('pedidos')
        .select(`
          pedido_id, cliente_id, telefono, tipo_pedido, estado, total,
          fecha_pedido, fecha_entrega, motivo_rechazo,
          detalle_pedidos ( producto_id, nombre_producto, variante, cantidad, subtotal )
        `)
        .gte('fecha_pedido', range.from.toISOString())
        .lt('fecha_pedido', range.to.toISOString())
        .order('fecha_pedido', { ascending: true })
        .limit(5000),
      supabase
        .from('pedidos')
        .select('pedido_id, estado, total')
        .gte('fecha_pedido', prev.from.toISOString())
        .lt('fecha_pedido', prev.to.toISOString())
        .limit(5000),
      supabase
        .from('feedback')
        .select('calificacion_general, fecha')
        .gte('fecha', range.from.toISOString())
        .lt('fecha', range.to.toISOString()),
    ]).then(([curr, prevRes, fb]) => {
      if (cancelled) return
      const err = curr.error || prevRes.error || fb.error
      if (err) {
        setError(err.message)
      } else {
        setOrders(curr.data || [])
        setPrevOrders(prevRes.data || [])
        setFeedback(fb.data || [])
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [range])

  const categorias = useMemo(
    () => [...new Set(menu.map(m => m.categoria).filter(Boolean))].sort(),
    [menu]
  )

  const aggregates = useMemo(() => {
    if (!range) return null
    const kpis = computeKpis(orders)
    const prevKpis = computeKpis(prevOrders)
    return {
      kpis,
      deltas: {
        pedidos: computeDelta(kpis.pedidos, prevKpis.pedidos),
        ingresos: computeDelta(kpis.ingresos, prevKpis.ingresos),
        ticketPromedio: computeDelta(kpis.ticketPromedio, prevKpis.ticketPromedio),
      },
      series: groupByBucket(orders, granularity, range),
      topProductos: topProducts(orders, menu, { categoria, direction: 'top' }),
      bottomProductos: topProducts(orders, menu, { categoria, direction: 'bottom' }),
      heatmap: hourWeekMatrix(orders),
      entrega: deliveryStats(orders),
      ingresosPorCategoria: revenueByCategory(orders, menu),
      motivosCancelacion: cancellationReasons(orders),
      rating: avgRating(feedback),
    }
  }, [orders, prevOrders, feedback, menu, granularity, categoria, range])

  return {
    loading, error, aggregates, clients, atRisk, categorias, range,
    filters: { preset, customFrom, customTo, granularity, categoria },
    setPreset, setCustomFrom, setCustomTo, setGranularity, setCategoria,
  }
}
