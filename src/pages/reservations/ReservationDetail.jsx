import React, { useState } from 'react'
import { useReservationReasons } from '../../hooks/useReservationReasons'
import { RESERVATION_STATES, MOTIVO_DEFECTO } from '../../utils/constants'
import Icon from '../../components/Icon'

export default function ReservationDetail({ reservation: r, legible, onDelete, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const { reasons } = useReservationReasons()

  // Fallback neutro: antes caía en RESERVATION_STATES[0] y pintaba "Pendiente" en ámbar,
  // un estado que la BD no admite (BUG-044).
  const estado = RESERVATION_STATES.find(s => s.value === r.estado)
    || { value: r.estado, label: r.estado || 'Sin estado', short: r.estado || 'Sin estado', cls: '' }

  // El nombre visible sale de `motivos_reserva`; el costo se lee de la RESERVA
  // (es la foto del precio al crearla), no del catálogo, que pudo haber cambiado.
  // Si el motivo se desactivó del catálogo, la reserva vieja sigue mostrando su clave.
  const reason = reasons.find(m => m.clave === r.motivo) || null
  const costoMotivo = Number(r.costo_motivo || 0)
  const motivoLabel = reason?.nombre || r.motivo || 'Sin ocasión especial'
  const tieneMotivo = r.motivo && r.motivo !== MOTIVO_DEFECTO

  async function handleDelete() {
    setDeleting(true)
    const { error } = await onDelete(r)
    if (error) setDeleting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel rsv-modal" onClick={e => e.stopPropagation()}>

        <div className="rm-head">
          <div>
            <div className="title">{r.nombre_cliente || 'Sin nombre'}</div>
            <div className="sub">#{String(r.reserva_id).slice(0, 18)}</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="rm-body">
          <div className="rd-grid">
            <div className="rd-item">
              <span className="rm-label">Fecha</span>
              <span className="rd-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="calendar" size={13} /> {legible.fecha}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Hora</span>
              <span className="rd-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={13} /> {legible.hora}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Personas</span>
              <span className="rd-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="users" size={13} /> {r.personas}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Estado</span>
              <span className={`rd-badge ${estado.cls}`}>{estado.label}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Teléfono</span>
              <a className="rd-phone" href={`https://wa.me/${r.telefono}`} target="_blank" rel="noreferrer" title="Abrir en WhatsApp">
                {r.telefono}
              </a>
            </div>
            <div className="rd-item">
              <span className="rm-label">Origen</span>
              <span className="rd-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={r.origen === 'dashboard' ? 'desktop' : 'bot'} size={13} /> {r.origen === 'dashboard' ? 'Dashboard' : 'WhatsApp'}</span>
            </div>
            <div className="rd-item wide">
              <span className="rm-label">Ocasión</span>
              <span className="rd-value">
                {tieneMotivo ? '🎉 ' : ''}{motivoLabel}
                {costoMotivo > 0 && (
                  <span className="rd-costo tnum"> · ${costoMotivo.toLocaleString('es-CO')}</span>
                )}
              </span>
              {costoMotivo > 0 && (
                <span className="rm-hint">Montaje — se cobra en el local, no genera pedido</span>
              )}
            </div>
          </div>

          {r.notas && (
            <div className="rd-notes">
              <span className="rm-label">Notas</span>
              <p>{r.notas}</p>
            </div>
          )}

          {confirming && (
            <div className="rd-confirm">
              ¿Eliminar esta reserva? Se notificará al cliente por WhatsApp.
            </div>
          )}
        </div>

        <div className="rm-foot">
          {confirming ? (
            <>
              <button className="cancel" onClick={() => setConfirming(false)} disabled={deleting}>
                No, conservar
              </button>
              <button className="delete confirm" onClick={handleDelete} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                {deleting ? 'Eliminando...' : <><Icon name="trash" size={14} /> Sí, eliminar</>}
              </button>
            </>
          ) : (
            <>
              <button className="delete" onClick={() => setConfirming(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Icon name="trash" size={14} /> Eliminar reserva
              </button>
              <button className="cancel" onClick={onClose}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
