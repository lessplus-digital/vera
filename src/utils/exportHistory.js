// Export del historial de pedidos a CSV (plano, para CRM/importaciones) y a
// Excel con formato (exceljs, cargado bajo demanda para no engordar el bundle).
// Ambos formatos salen de las mismas filas aplanadas (buildRows).

import { parseDb } from './dateRanges'
import { ORDER_STATES } from './constants'

const TIPO_LABEL = { domicilio: 'Domicilio', recoger: 'Recoger' }

// 'sv-SE' produce YYYY-MM-DD HH:mm — ordenable y sin ambigüedad para CRMs.
function colombiaDateTime(d) {
  if (!d) return ''
  return parseDb(d).toLocaleString('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function colombiaDateISO(d) {
  return parseDb(d).toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' })
}

// Mismo criterio ≤3h que Estadísticas y el modal de detalle.
function minutosEntrega(order) {
  if (order.estado !== 'entregado' || !order.fecha_entrega) return ''
  const mins = (parseDb(order.fecha_entrega) - parseDb(order.fecha_pedido)) / 60000
  return mins > 0 && mins <= 180 ? Math.round(mins) : ''
}

function productosResumen(order) {
  return (order.detalle_pedidos || [])
    .map(it => {
      const variante = it.variante && it.variante !== 'Estándar' ? ` (${it.variante})` : ''
      return `${it.cantidad}× ${it.nombre_producto}${variante}`
    })
    .join(' | ')
}

const COLUMNS = [
  { key: 'pedido_id',       header: '# Pedido',        width: 13 },
  { key: 'fecha',           header: 'Fecha',           width: 17 },
  { key: 'cliente',         header: 'Cliente',         width: 22 },
  { key: 'telefono',        header: 'Teléfono',        width: 15 },
  { key: 'tipo',            header: 'Tipo',            width: 11 },
  { key: 'metodo_pago',     header: 'Método de pago',  width: 15 },
  { key: 'estado_pago',     header: 'Estado del pago', width: 14 },
  { key: 'estado',          header: 'Estado',          width: 13 },
  { key: 'productos',       header: 'Productos',       width: 46 },
  { key: 'total',           header: 'Total',           width: 12 },
  { key: 'minutos_entrega', header: 'Entrega (min)',   width: 13 },
  { key: 'fecha_entrega',   header: 'Entregado el',    width: 17 },
  { key: 'direccion',       header: 'Dirección',       width: 30 },
  { key: 'notas',           header: 'Notas',           width: 30 },
  { key: 'motivo_rechazo',  header: 'Motivo cancelación', width: 30 },
]

function buildRows(orders) {
  return orders.map(o => ({
    pedido_id: o.pedido_id,
    fecha: colombiaDateTime(o.fecha_pedido),
    cliente: o.clientes?.nombre || '',
    telefono: o.telefono || '',
    tipo: TIPO_LABEL[o.tipo_pedido] || o.tipo_pedido || '',
    metodo_pago: o.metodo_pago || '',
    estado_pago: o.estado_pago || '',
    estado: ORDER_STATES[o.estado]?.label || o.estado,
    _estadoKey: o.estado,
    productos: productosResumen(o),
    total: Number(o.total || 0),
    minutos_entrega: minutosEntrega(o),
    fecha_entrega: colombiaDateTime(o.fecha_entrega),
    direccion: o.direccion_entrega || '',
    notas: o.notas || '',
    motivo_rechazo: o.motivo_rechazo || '',
  }))
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ── CSV — plano, coma estándar, BOM UTF-8 para que Excel respete las tildes ── */

export function exportCsv(orders, filename) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = buildRows(orders)
  const lines = [
    COLUMNS.map(c => esc(c.header)).join(','),
    ...rows.map(r => COLUMNS.map(c => esc(r[c.key])).join(',')),
  ]

  // El primer string es U+FEFF (BOM, invisible en el editor): sin él, Excel
  // abre el CSV como ANSI y daña las tildes.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, filename)
}

/* ── Excel — hoja con diseño: título, resumen, encabezado de marca, banding,
      moneda, estados coloreados, autofiltro y panel congelado ── */

// Paleta del archivo (ARGB). Alineada al DS en modo claro.
const XL = {
  brand:   'FFEA580C', // naranja de marca (--chart-1 light)
  ink:     'FF0F172A',
  muted:   'FF64748B',
  band:    'FFF8FAFC', // fila alterna
  border:  'FFE2E8F0',
  white:   'FFFFFFFF',
  estado: {
    entregado: 'FF047857',
    cancelado: 'FFDC2626',
    pendiente: 'FFB45309',
    en_cocina: 'FF7C3AED',
    en_camino: 'FF1D4ED8',
    recoger:   'FF1D4ED8',
  },
}

export async function exportExcel({ orders, summary, rangeLabel }, filename) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Vera Pizzería — Dashboard'
  wb.created = new Date()

  const HEADER_ROW = 5
  const ws = wb.addWorksheet('Historial', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
  })

  ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }))

  // ── Encabezado del documento ──
  const lastCol = ws.getColumn(COLUMNS.length).letter

  ws.mergeCells(`A1:${lastCol}1`)
  const title = ws.getCell('A1')
  title.value = 'Vera Pizzería — Historial de pedidos'
  title.font = { name: 'Calibri', size: 15, bold: true, color: { argb: XL.ink } }
  ws.getRow(1).height = 24

  ws.mergeCells(`A2:${lastCol}2`)
  const sub = ws.getCell('A2')
  sub.value = `Periodo: ${rangeLabel} · Generado: ${colombiaDateTime(new Date())} (hora Colombia)`
  sub.font = { name: 'Calibri', size: 10, color: { argb: XL.muted } }

  ws.mergeCells(`A3:${lastCol}3`)
  const res = ws.getCell('A3')
  res.value = `${summary.total} pedidos · ${summary.entregados} entregados · ${summary.cancelados} cancelados · Ingresos (sin cancelados): $${Number(summary.ingresos).toLocaleString('es-CO')}`
  res.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL.brand } }

  // ── Encabezados de la tabla ──
  const headerRow = ws.getRow(HEADER_ROW)
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.brand } }
    cell.alignment = { vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: XL.border } } }
  })
  headerRow.height = 20

  // ── Filas de datos ──
  const rows = buildRows(orders)
  rows.forEach((r, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx)
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = r[c.key]
      cell.font = { name: 'Calibri', size: 10, color: { argb: XL.ink } }
      cell.alignment = { vertical: 'middle', wrapText: c.key === 'productos' || c.key === 'notas' || c.key === 'motivo_rechazo' }
      cell.border = { bottom: { style: 'thin', color: { argb: XL.border } } }
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.band } }
      }
      if (c.key === 'total') {
        cell.numFmt = '"$"#,##0'
        cell.alignment = { vertical: 'middle', horizontal: 'right' }
      }
      if (c.key === 'minutos_entrega') {
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      }
      if (c.key === 'estado') {
        cell.font = {
          name: 'Calibri', size: 10, bold: true,
          color: { argb: XL.estado[r._estadoKey] || XL.ink },
        }
      }
    })
  })

  // Autofiltro sobre la tabla completa
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW + rows.length, column: COLUMNS.length },
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, filename)
}
