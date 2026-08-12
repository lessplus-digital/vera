import React, { useState } from 'react'
import Column from './Column'
import CreateOrderModal from './CreateOrderModal'
import { COLUMNS } from '../../utils/constants'
import Icon from '../../components/Icon'
import { useAuth } from '../../hooks/useAuth'
import { useDomiciliarios } from '../../hooks/useDomiciliarios'
import { puede } from '../../utils/permisos'

export default function DashboardPage({ loading, orders, newIds, onUpdated }) {
  const { rol } = useAuth()
  const [showCreate, setShowCreate] = useState(false)

  // La lista se carga UNA vez para todo el kanban y se baja a las tarjetas: si
  // cada `OrderCard` la pidiera por su cuenta serían N consultas idénticas en
  // el rush. Para quien no puede asignar, el hook devuelve vacío (la RLS solo
  // le deja ver su propio perfil) y `AssignCourier` ni se monta.
  const { domiciliarios } = useDomiciliarios()
  const puedeAsignar = puede(rol, 'asignarDomiciliario')

  if (loading) {
    return (
      <div className="page-loading">
        <div className="inner">
          <div className="icon" style={{ color: 'var(--amber)' }}><Icon name="pizza" size={32} /></div>
          <div className="msg">Cargando pedidos...</div>
        </div>
      </div>
    )
  }

  function getColumnOrders(col) {
    const keys = Array.isArray(col.key) ? col.key : [col.key]
    return orders.filter(o => keys.includes(o.estado))
  }

  return (
    <main className="kanban">
      {COLUMNS.map(col => (
        <Column
          key={Array.isArray(col.key) ? col.key.join('-') : col.key}
          title={col.title}
          icon={col.icon}
          cls={col.cls}
          orders={getColumnOrders(col)}
          newIds={newIds}
          onUpdated={onUpdated}
          domiciliarios={domiciliarios}
          onCreate={col.key === 'pendiente' && puede(rol, 'crearPedido') ? () => setShowCreate(true) : undefined}
        />
      ))}

      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onUpdated={onUpdated}
        />
      )}
    </main>
  )
}
