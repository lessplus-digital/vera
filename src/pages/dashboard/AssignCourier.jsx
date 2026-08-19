import React, { useState } from 'react'
import Icon from '../../components/Icon'
import { asignarDomiciliario } from '../../hooks/useDomiciliarios'

// Selector de domiciliario dentro de la tarjeta del kanban.
//
// Solo lo monta OrderCard cuando el rol puede asignar (admin) y el pedido es a
// domicilio y sigue vivo. La asignación es lo que decide qué ve el repartidor:
// escribir `domiciliario_id` es literalmente lo que hace aparecer el pedido en
// SU pantalla, porque la política RLS filtra por esa columna.
export default function AssignCourier({ order, domiciliarios, onUpdated }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const asignado = domiciliarios.find(d => d.usuario_id === order.domiciliario_id)

  async function handleChange(e) {
    const valor = e.target.value || null
    if (valor === (order.domiciliario_id ?? null)) return

    setSaving(true)
    setError(null)
    const { error: asignError } = await asignarDomiciliario(order.pedido_id, valor)
    setSaving(false)

    if (asignError) setError(asignError)
    else onUpdated()
  }

  if (domiciliarios.length === 0) {
    return (
      <div className="assign-empty">
        <Icon name="scooter" size={13} />
        <span>No hay domiciliarios activos. Créalos en Supabase y asígnales el rol en Configuración.</span>
      </div>
    )
  }

  return (
    <div className={`assign${order.domiciliario_id ? ' asignado' : ''}`}>
      <span className="assign-icon"><Icon name="scooter" size={13} /></span>

      <select
        className="assign-select"
        value={order.domiciliario_id ?? ''}
        onChange={handleChange}
        disabled={saving}
        aria-label={`Domiciliario del pedido ${order.pedido_id}`}
      >
        <option value="">Sin asignar</option>
        {domiciliarios.map(d => (
          <option key={d.usuario_id} value={d.usuario_id}>
            {d.nombre || 'Sin nombre'}
          </option>
        ))}
      </select>

      {saving && <span className="assign-state">Guardando…</span>}
      {!saving && asignado && <span className="assign-state ok">Asignado</span>}

      {error && <div className="assign-error">{error}</div>}
    </div>
  )
}
