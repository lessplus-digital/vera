import React, { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useDeliveryHistory, PERIODOS } from '../../hooks/useDeliveryHistory'
import { formatPrice } from '../../utils/formatters'
import { toColombia } from '../../utils/dateRanges'
import Icon from '../../components/Icon'

/*
 * Historial de entregas de un domiciliario.
 *
 * Un solo componente para dos pantallas: el repartidor viéndolo en "Mis
 * entregas" y el admin abriéndolo desde Configuración → Usuarios. La diferencia
 * la hace `domiciliarioId` — y la RLS, que decide qué filas existen para quien
 * mira. Por eso aquí no hay ni una comprobación de rol.
 */
export default function DeliveryHistory({ domiciliarioId, compacto = false }) {
  const [periodo, setPeriodo] = useState('7d')
  const { entregas, resumen, loading, cargandoMas, hayMas, error, cargarMas } =
    useDeliveryHistory(domiciliarioId, periodo)

  return (
    <div className={`dh${compacto ? ' compacto' : ''}`}>

      <div className="dh-periodos">
        {PERIODOS.map(p => (
          <button
            key={p.key}
            className={`dh-periodo${periodo === p.key ? ' active' : ''}`}
            onClick={() => setPeriodo(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* El resumen viene del RPC y abarca TODO el período, no solo lo cargado:
          sumar la página visible daría una cifra que crece al hacer scroll. */}
      <div className="dh-resumen">
        <div className="dh-stat">
          <span className="dh-stat-num tnum">{resumen.entregas}</span>
          <span className="dh-stat-label">{resumen.entregas === 1 ? 'Entrega' : 'Entregas'}</span>
        </div>
        <div className="dh-stat">
          <span className="dh-stat-num tnum">{formatPrice(resumen.total)}</span>
          <span className="dh-stat-label">Total repartido</span>
        </div>
        <div className="dh-stat">
          <span className="dh-stat-num tnum">{formatPrice(resumen.efectivo)}</span>
          <span className="dh-stat-label">Cobrado en efectivo</span>
        </div>
      </div>

      {error && <div className="dh-error">{error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando historial…</div>
      ) : entregas.length === 0 ? (
        <div className="dh-empty">
          <Icon name="history" size={28} />
          <span>Sin entregas en este período.</span>
        </div>
      ) : (
        <>
          <ul className="dh-lista">
            {entregas.map(e => <FilaEntrega key={e.pedido_id} entrega={e} />)}
          </ul>

          {hayMas && (
            <button className="btn secondary dh-mas" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? 'Cargando…' : 'Ver más entregas'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function FilaEntrega({ entrega }) {
  const efectivo = entrega.metodo_pago === 'Efectivo'

  // toColombia + getUTC* da la hora local del negocio sin depender del
  // timezone del navegador (el admin podría estar en otro huso).
  const cuando = toColombia(entrega.fecha_entrega)
  const fecha  = format(cuando, "d 'de' MMM", { locale: es })
  const hora   = `${String(cuando.getUTCHours()).padStart(2, '0')}:${String(cuando.getUTCMinutes()).padStart(2, '0')}`

  return (
    <li className="dh-fila">
      <div className="dh-cuando">
        <span className="dh-fecha">{fecha}</span>
        <span className="dh-hora tnum">{hora}</span>
      </div>

      <div className="dh-donde">
        <span className="dh-cliente">{entrega.clientes?.nombre || 'Cliente'}</span>
        <span className="dh-dir">{entrega.direccion_entrega || 'Sin dirección'}</span>
      </div>

      <div className="dh-monto">
        <span className="dh-total tnum">{formatPrice(entrega.total)}</span>
        <span className={`dh-metodo${efectivo ? ' efectivo' : ''}`}>
          {efectivo ? 'Efectivo' : entrega.metodo_pago}
        </span>
      </div>
    </li>
  )
}
