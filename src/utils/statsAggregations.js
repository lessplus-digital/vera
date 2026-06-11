// Agregaciones puras para la tab Estadísticas. Sin React.
// Todas operan sobre hora Colombia: las fechas se desplazan -5h
// (toColombia) y se leen con getUTC*() — ver dateRanges.js.

import { toColombia, parseDb } from './dateRanges'

const DAY_MS = 24 * 3600 * 1000

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DIAS_ORDEN = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function validOrders(orders) {
  return orders.filter(o => o.estado !== 'cancelado')
}

// ── KPIs ────────────────────────────────────────────────────

export function computeKpis(orders) {
  const valid = validOrders(orders)
  const ingresos = valid.reduce((sum, o) => sum + Number(o.total || 0), 0)
  const cancelados = orders.length - valid.length
  return {
    pedidos: valid.length,
    ingresos,
    ticketPromedio: valid.length > 0 ? ingresos / valid.length : 0,
    cancelados,
    tasaCancelacion: orders.length > 0 ? (cancelados / orders.length) * 100 : 0,
  }
}

// % de variación con signo; null si no hay base de comparación.
export function computeDelta(curr, prev) {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

// ── Serie temporal ──────────────────────────────────────────

// Lunes (00:00 Colombia, desplazado) de la semana de `shifted`.
function weekStart(shifted) {
  const dow = shifted.getUTCDay() // 0=dom
  const diff = dow === 0 ? 6 : dow - 1
  const d = new Date(shifted.getTime() - diff * DAY_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function bucketKey(shifted, granularity) {
  if (granularity === 'mes') {
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1)
  }
  if (granularity === 'semana') return weekStart(shifted)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

function bucketLabel(key, granularity) {
  const d = new Date(key)
  if (granularity === 'mes') return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  if (granularity === 'semana') return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

function nextBucket(key, granularity) {
  const d = new Date(key)
  if (granularity === 'mes') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  if (granularity === 'semana') return key + 7 * DAY_MS
  return key + DAY_MS
}

// Pedidos e ingresos por bucket, rellenando buckets vacíos del rango.
// range: { from, to } en UTC (to exclusivo). granularity: 'dia'|'semana'|'mes'.
// => [{ bucket, pedidos, ingresos }]
export function groupByBucket(orders, granularity, range) {
  const map = new Map()
  for (const o of validOrders(orders)) {
    const key = bucketKey(toColombia(o.fecha_pedido), granularity)
    const row = map.get(key) || { pedidos: 0, ingresos: 0 }
    row.pedidos += 1
    row.ingresos += Number(o.total || 0)
    map.set(key, row)
  }

  const first = bucketKey(toColombia(range.from), granularity)
  const last = bucketKey(new Date(toColombia(range.to).getTime() - 1), granularity)
  const out = []
  for (let key = first; key <= last; key = nextBucket(key, granularity)) {
    const row = map.get(key) || { pedidos: 0, ingresos: 0 }
    out.push({ bucket: bucketLabel(key, granularity), ...row })
  }
  return out
}

// ── Productos ───────────────────────────────────────────────

// Ranking de productos por cantidad vendida.
// menu: filas de la tabla menu (producto_id, nombre, categoria, variante, disponible).
// opts: { categoria: 'todas'|string, direction: 'top'|'bottom', limit }.
export function topProducts(orders, menu, { categoria = 'todas', direction = 'top', limit = 8 } = {}) {
  const categoriaDe = new Map(menu.map(m => [m.producto_id, m.categoria]))
  const map = new Map()

  for (const o of validOrders(orders)) {
    for (const item of o.detalle_pedidos || []) {
      if (categoria !== 'todas' && categoriaDe.get(item.producto_id) !== categoria) continue
      const key = item.variante
        ? `${item.nombre_producto} (${item.variante})`
        : item.nombre_producto
      const row = map.get(key) || { nombre: key, cantidad: 0, producto_id: item.producto_id }
      row.cantidad += Number(item.cantidad || 0)
      map.set(key, row)
    }
  }

  // Para "menos pedidos": incluir productos disponibles del menú con 0 ventas
  if (direction === 'bottom') {
    const vendidos = new Set([...map.values()].map(r => `${r.producto_id}`))
    for (const m of menu) {
      if (m.disponible === false) continue
      if (categoria !== 'todas' && m.categoria !== categoria) continue
      if (vendidos.has(`${m.producto_id}`)) continue
      const key = m.variante ? `${m.nombre} (${m.variante})` : m.nombre
      if (!map.has(key)) map.set(key, { nombre: key, cantidad: 0, producto_id: m.producto_id })
    }
  }

  const rows = [...map.values()].sort((a, b) =>
    direction === 'top' ? b.cantidad - a.cantidad : a.cantidad - b.cantidad
  )
  return rows.slice(0, limit)
}

// ── Clientes ────────────────────────────────────────────────

// Top clientes agregado desde pedidos (histórico). No usa
// clientes.total_pedidos/gasto_total porque esos contadores no se
// mantienen en la BD; clientes solo aporta el nombre.
export function topClients(allOrders, clientes) {
  const nombreDe = new Map(clientes.map(c => [c.cliente_id, c.nombre]))
  const map = new Map()
  for (const o of validOrders(allOrders)) {
    const key = o.cliente_id || o.telefono
    if (!key) continue
    const row = map.get(key) || {
      cliente_id: key,
      nombre: nombreDe.get(o.cliente_id) || null,
      telefono: o.telefono,
      pedidos: 0,
      gasto: 0,
    }
    row.pedidos += 1
    row.gasto += Number(o.total || 0)
    map.set(key, row)
  }
  return [...map.values()]
}

// ── Tiempo de entrega ───────────────────────────────────────

// Minutos entre fecha_pedido y fecha_entrega de pedidos entregados.
// Descarta duraciones inválidas (≤0 o >3h): hay datos históricos de
// prueba con fecha_entrega incoherente; el dashboard escribe
// fecha_entrega correctamente desde 2026-06-09.
const MAX_ENTREGA_MIN = 180

export function deliveryStats(orders) {
  const samples = []
  for (const o of orders) {
    if (o.estado !== 'entregado' || !o.fecha_entrega) continue
    const min = (parseDb(o.fecha_entrega) - parseDb(o.fecha_pedido)) / 60000
    if (min <= 0 || min > MAX_ENTREGA_MIN) continue
    samples.push({ min, tipo: o.tipo_pedido })
  }

  const avg = arr => (arr.length ? arr.reduce((s, x) => s + x.min, 0) / arr.length : null)
  const buckets = [
    { rango: '< 15 min', max: 15 },
    { rango: '15–30', max: 30 },
    { rango: '30–45', max: 45 },
    { rango: '45–60', max: 60 },
    { rango: '> 60 min', max: Infinity },
  ].map(b => ({ rango: b.rango, pedidos: 0, _max: b.max }))
  for (const s of samples) {
    buckets.find(b => s.min < b._max).pedidos += 1
  }

  return {
    promedio: avg(samples),
    count: samples.length,
    promedioDomicilio: avg(samples.filter(s => s.tipo === 'domicilio')),
    promedioRecoger: avg(samples.filter(s => s.tipo !== 'domicilio')),
    buckets: buckets.map(({ rango, pedidos }) => ({ rango, pedidos })),
  }
}

// ── Ingresos por categoría ──────────────────────────────────

// Suma subtotal de detalle_pedidos por categoría del menú.
export function revenueByCategory(orders, menu) {
  const categoriaDe = new Map(menu.map(m => [m.producto_id, m.categoria]))
  const map = new Map()
  for (const o of validOrders(orders)) {
    for (const item of o.detalle_pedidos || []) {
      const cat = categoriaDe.get(item.producto_id) || 'otros'
      map.set(cat, (map.get(cat) || 0) + Number(item.subtotal || 0))
    }
  }
  return [...map.entries()]
    .map(([categoria, ingresos]) => ({ categoria, ingresos }))
    .sort((a, b) => b.ingresos - a.ingresos)
}

// ── Heatmap hora × día ──────────────────────────────────────

// Matriz 7×24 (Lun..Dom × 0..23) de pedidos en hora Colombia.
// => { rows: [{ dia, horas: [count×24], total }], max }
export function hourWeekMatrix(orders) {
  const rows = DIAS_ORDEN.map(dia => ({ dia, horas: new Array(24).fill(0), total: 0 }))
  let max = 0
  for (const o of validOrders(orders)) {
    const d = toColombia(o.fecha_pedido)
    const dow = d.getUTCDay()
    const row = rows[dow === 0 ? 6 : dow - 1]
    const count = ++row.horas[d.getUTCHours()]
    row.total += 1
    if (count > max) max = count
  }
  return { rows, max }
}

// ── Clientes en riesgo ──────────────────────────────────────

// Clientes recurrentes (minPedidos+) cuyo último pedido fue hace más
// de minDias. Calculado desde el histórico de pedidos.
export function riskClients(allOrders, clientes, { minPedidos = 3, minDias = 30 } = {}) {
  const nombreDe = new Map(clientes.map(c => [c.cliente_id, c.nombre]))
  const map = new Map()
  for (const o of validOrders(allOrders)) {
    const key = o.cliente_id || o.telefono
    if (!key || !o.fecha_pedido) continue
    const row = map.get(key) || {
      nombre: nombreDe.get(o.cliente_id) || null,
      telefono: o.telefono,
      pedidos: 0,
      ultimo: 0,
    }
    row.pedidos += 1
    row.ultimo = Math.max(row.ultimo, parseDb(o.fecha_pedido).getTime())
    map.set(key, row)
  }
  const now = Date.now()
  return [...map.values()]
    .map(c => ({ ...c, diasDesde: Math.floor((now - c.ultimo) / DAY_MS) }))
    .filter(c => c.pedidos >= minPedidos && c.diasDesde > minDias)
    .sort((a, b) => b.pedidos - a.pedidos)
}

// ── Cancelaciones y feedback ────────────────────────────────

export function cancellationReasons(orders) {
  const map = new Map()
  for (const o of orders) {
    if (o.estado !== 'cancelado') continue
    const motivo = o.motivo_rechazo?.trim() || 'Sin motivo'
    map.set(motivo, (map.get(motivo) || 0) + 1)
  }
  return [...map.entries()]
    .map(([motivo, count]) => ({ motivo, count }))
    .sort((a, b) => b.count - a.count)
}

export function avgRating(feedback) {
  const valid = feedback.filter(f => f.calificacion_general != null)
  if (valid.length === 0) return { promedio: null, count: 0 }
  const sum = valid.reduce((s, f) => s + Number(f.calificacion_general), 0)
  return { promedio: sum / valid.length, count: valid.length }
}
