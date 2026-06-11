import React, { useState } from 'react'
import { RESERVATION_STATES } from '../../utils/constants'

export default function ReservationDetail({ reservation: r, legible, onDelete, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  const estado = RESERVATION_STATES.find(s => s.value === r.estado) || RESERVATION_STATES[0]

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
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="rm-body">
          <div className="rd-grid">
            <div className="rd-item">
              <span className="rm-label">Fecha</span>
              <span className="rd-value">📅 {legible.fecha}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Hora</span>
              <span className="rd-value">🕗 {legible.hora}</span>
            </div>
            <div className="rd-item">
              <span className="rm-label">Personas</span>
              <span className="rd-value">👥 {r.personas}</span>
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
              <span className="rd-value">{r.origen === 'dashboard' ? '🖥️ Dashboard' : '🤖 WhatsApp'}</span>
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
              <button className="delete confirm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Eliminando...' : '🗑 Sí, eliminar'}
              </button>
            </>
          ) : (
            <>
              <button className="delete" onClick={() => setConfirming(true)}>
                🗑 Eliminar reserva
              </button>
              <button className="cancel" onClick={onClose}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
