import React from 'react'
import Icon from '../../components/Icon'
import { useAuth } from '../../hooks/useAuth'
import { puede } from '../../utils/permisos'

// Acciones de estado de una tarjeta, según el rol.
//
// El rol se toma del contexto en vez de bajarlo por props desde App: son cuatro
// niveles de anidamiento (App → DashboardPage → Column → OrderCard) y el rol lo
// necesitan solo las hojas.
//
// Que un botón no aparezca NO es lo que impide la acción: aprobar o cancelar es
// un UPDATE sobre `pedidos`, y el domiciliario no tiene política de UPDATE — la
// llamada volvería con 0 filas afectadas. Esto evita ofrecer un botón que
// fallaría en silencio.
export default function OrderActions({ order, loading, onUpdate, onEntregar, onRejectClick }) {
  const { rol } = useAuth()

  const puedeCambiarEstado = puede(rol, 'cambiarEstadoPedido')
  const puedeEntregar      = puede(rol, 'marcarEntregado')

  const btn = (icon, text, onClick, cls) => (
    <button
      onClick={onClick}
      disabled={loading}
      className={`act-btn ${cls}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
    >
      {loading ? '...' : <><Icon name={icon} size={13} /> {text}</>}
    </button>
  )

  if (order.estado === 'pendiente') {
    if (!puedeCambiarEstado) return null
    return (
      <div className="order-actions">
        {btn('x', 'Rechazar', onRejectClick, 'red')}
        {btn('check', 'Aprobar', () => onUpdate('en_cocina', 'confirmado'), 'green')}
      </div>
    )
  }

  if (order.estado === 'en_cocina') {
    if (!puedeCambiarEstado) return null
    return (
      <div className="order-actions">
        {order.tipo_pedido === 'domicilio'
          ? btn('scooter', 'Enviar a domicilio', () => onUpdate('en_camino'), 'purple')
          : btn('check', 'Listo para recoger', () => onUpdate('recoger'), 'blue')
        }
      </div>
    )
  }

  if (order.estado === 'en_camino') {
    if (!puedeEntregar) return null
    return (
      <div className="order-actions">
        {btn('check', 'Marcar entregado', onEntregar, 'green')}
      </div>
    )
  }

  if (order.estado === 'recoger') {
    if (!puedeEntregar) return null
    return (
      <div className="order-actions">
        {btn('check', 'Cliente recogió', onEntregar, 'green')}
      </div>
    )
  }

  return null
}
