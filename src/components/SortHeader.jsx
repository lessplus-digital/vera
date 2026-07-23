import React from 'react'
import Icon from './Icon'

// Encabezado de columna ordenable para tablas (patrón .sortable en index.css):
// siempre muestra un indicador (⇅ atenuado si está inactiva, flecha ↑/↓ si es la
// columna activa) para que se note que es clickeable. Compartido por las tablas
// de Clientes y Menú.
export default function SortHeader({ label, colKey, sortKey, sortAsc, onSort, defaultAsc = true }) {
  const active = sortKey === colKey
  return (
    <span
      className={`sortable ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      title={`Ordenar por ${label.toLowerCase()}`}
      onClick={() => onSort(colKey, defaultAsc)}
      onKeyDown={e => e.key === 'Enter' && onSort(colKey, defaultAsc)}
    >
      {label}
      <Icon
        name={active ? (sortAsc ? 'arrow-up' : 'arrow-down') : 'sort'}
        size={11}
        className={active ? undefined : 'sort-hint'}
      />
    </span>
  )
}
