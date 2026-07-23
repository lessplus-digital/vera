import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getRange } from '../utils/dateRanges'

// Historial de pedidos 100% server-side: paginación (range + count exact),
// filtros (estado/tipo/búsqueda) y orden viajan como parámetros de la query —
// el historial crece sin límite y nunca bajamos más de una página a memoria.
// La línea de resumen (entregados/cancelados/ingresos) agrega sobre TODO el
// conjunto filtrado vía el RPC `historial_resumen` (mismos filtros que la lista).
//
// Búsqueda: pedido_id (ilike) + teléfono (solo dígitos) + nombre de cliente —
// el nombre vive en `clientes`, así que primero se resuelven los cliente_id que
// matchean y se agregan al or() de la lista y al RPC.
const SORT_COLUMNS = { fecha: 'fecha_pedido', total: 'total' }

const SELECT_PEDIDO = `
  pedido_id, cliente_id, telefono, tipo_pedido, direccion_entrega,
  fecha_pedido, fecha_entrega, estado, metodo_pago, estado_pago,
  comprobante_url, total, repartidor, notas, motivo_rechazo,
  clientes ( nombre ),
  detalle_pedidos ( detalle_id, nombre_producto, variante, cantidad, precio_unitario, subtotal, notas_item )
`

// Tope del export (una sola bajada). Si se alcanza, se avisa: acortar el rango.
const EXPORT_CAP = 10000

export function useOrderHistory({
  preset, customFrom, customTo,
  estado, tipo, search,
  sortKey, sortAsc,
  page, pageSize,
}) {
  const [orders, setOrders] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [summary, setSummary] = useState({ total: 0, entregados: 0, cancelados: 0, ingresos: 0 })
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const range = useMemo(
    () => getRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  // Resuelve el término de búsqueda: saneo (comas/paréntesis/porcentajes romperían
  // el or()) + lookup de nombres → cliente_id (clientes es chica; solo al buscar).
  const buildSearchParts = useCallback(async () => {
    const q = search.trim().replace(/[,()%]/g, '')
    const qDigits = q.replace(/[^\d]/g, '')
    let clienteIds = []
    if (q) {
      const { data: matches } = await supabase
        .from('clientes')
        .select('cliente_id')
        .ilike('nombre', `%${q}%`)
        .limit(200)
      clienteIds = (matches || []).map(c => c.cliente_id)
    }
    return { q, qDigits, clienteIds }
  }, [search])

  // Aplica rango + filtros a una query de `pedidos` (compartido: página y export).
  const applyFilters = useCallback((query, { q, qDigits, clienteIds }) => {
    query = query
      .gte('fecha_pedido', range.from.toISOString())
      .lt('fecha_pedido', range.to.toISOString())

    if (estado !== 'todos') query = query.eq('estado', estado)
    if (tipo !== 'todos')   query = query.eq('tipo_pedido', tipo)
    if (q) {
      const ors = [`pedido_id.ilike.%${q}%`]
      if (qDigits) ors.push(`telefono.like.%${qDigits}%`)
      if (clienteIds.length > 0) ors.push(`cliente_id.in.(${clienteIds.join(',')})`)
      query = query.or(ors.join(','))
    }
    return query
  }, [range, estado, tipo])

  const fetchPage = useCallback(async () => {
    if (!range) return // custom incompleto

    const parts = await buildSearchParts()
    const startIdx = (page - 1) * pageSize

    const query = applyFilters(
      supabase.from('pedidos').select(SELECT_PEDIDO, { count: 'exact' }),
      parts
    )
      .order(SORT_COLUMNS[sortKey] || 'fecha_pedido', { ascending: sortAsc })
      .order('fecha_pedido', { ascending: false }) // desempate estable
      .range(startIdx, startIdx + pageSize - 1)

    const [list, resumen] = await Promise.all([
      query,
      supabase.rpc('historial_resumen', {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
        p_estado: estado !== 'todos' ? estado : null,
        p_tipo: tipo !== 'todos' ? tipo : null,
        p_search: parts.q || null,
        p_search_digits: parts.qDigits || null,
        p_cliente_ids: parts.clienteIds.length > 0 ? parts.clienteIds : null,
      }),
    ])

    if (list.error) {
      // PGRST103: la página quedó fuera de rango (p.ej. borrado en vivo); la
      // página se re-clampa desde HistoryPage con totalCount y refetchea.
      if (list.error.code !== 'PGRST103') setError(list.error.message)
      setLoading(false)
      return
    }

    setOrders(list.data || [])
    setTotalCount(list.count ?? 0)
    setError(null)
    if (!resumen.error && resumen.data) {
      const s = resumen.data
      setSummary({
        total: Number(s.total || 0),
        entregados: Number(s.entregados || 0),
        cancelados: Number(s.cancelados || 0),
        ingresos: Number(s.ingresos || 0),
      })
    }
    setLoading(false)
  }, [range, estado, tipo, sortKey, sortAsc, page, pageSize, buildSearchParts, applyFilters])

  useEffect(() => {
    setLoading(true)
    fetchPage()
  }, [fetchPage])

  // Realtime: los pedidos de hoy cambian de estado mientras el historial está
  // abierto (kanban / bot); refetch de la página visible.
  useEffect(() => {
    const channel = supabase
      .channel('pedidos-historial-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => fetchPage())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchPage])

  // ── Export: TODO el conjunto filtrado (no solo la página), en una bajada.
  async function fetchAllFiltered() {
    if (!range) return { data: [], error: null, truncated: false }

    const parts = await buildSearchParts()
    const { data, error: fetchError } = await applyFilters(
      supabase.from('pedidos').select(SELECT_PEDIDO),
      parts
    )
      .order('fecha_pedido', { ascending: false })
      .limit(EXPORT_CAP)

    if (fetchError) {
      console.error('Error exportando historial:', fetchError)
      return { data: [], error: 'No se pudo descargar el historial para exportar.', truncated: false }
    }
    return { data: data || [], error: null, truncated: (data || []).length >= EXPORT_CAP }
  }

  // ── Correcciones de estado desde el historial (pedidos que quedaron colgados
  // en un estado intermedio). OJO: el trigger de BD `notificar-estado-pedido`
  // dispara el webhook de n8n en CADA update → el cliente SIEMPRE recibe el
  // WhatsApp del nuevo estado (entregado/cancelado); la UI lo advierte antes.
  async function applyUpdate(pedido_id, updates) {
    const { error: updateError } = await supabase
      .from('pedidos')
      .update(updates)
      .eq('pedido_id', pedido_id)

    if (updateError) {
      console.error('Error actualizando pedido:', updateError)
      return { error: 'No se pudo actualizar el pedido. Intenta de nuevo.' }
    }
    await fetchPage()
    return { error: null }
  }

  function marcarEntregado(pedido_id) {
    // fecha_entrega NO se envía: la fija el trigger set_fecha_entrega (BEFORE
    // UPDATE, pisa cualquier valor del cliente al transicionar a entregado).
    return applyUpdate(pedido_id, { estado: 'entregado' })
  }

  function cancelarPedido(pedido_id, motivo) {
    // Misma semántica que el rechazo del kanban (OrderCard.handleReject); el
    // motivo es obligatorio porque n8n lo interpola en el mensaje al cliente.
    return applyUpdate(pedido_id, {
      estado: 'cancelado',
      estado_pago: 'rechazado',
      motivo_rechazo: motivo,
    })
  }

  return {
    orders, totalCount, summary, loading, error, range,
    marcarEntregado, cancelarPedido, fetchAllFiltered,
  }
}
