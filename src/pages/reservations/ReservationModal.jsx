import React, { useState } from 'react'
import { useClients } from '../../hooks/useClients'
import { RESERVATION_STATES } from '../../utils/constants'

export default function ReservationModal({ initial, onSave, onClose }) {
  const { clients, loading: clientsLoading } = useClients()
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)

  const [fecha,    setFecha]    = useState(initial?.fecha || '')
  const [hora,     setHora]     = useState(initial?.hora || '')
  const [personas, setPersonas] = useState(2)
  const [estado,   setEstado]   = useState('confirmada')
  const [notas,    setNotas]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  const MAX_RESULTS = 8
  const clientQuery = clientSearch.trim().toLowerCase()
  const clientDigits = clientSearch.replace(/[^\d]/g, '')
  const filteredClients = clientQuery
    ? clients.filter(c =>
        (c.nombre || '').toLowerCase().includes(clientQuery) ||
        (clientDigits && (c.telefono || '').includes(clientDigits))
      )
    : []
  const visibleClients = filteredClients.slice(0, MAX_RESULTS)
  const hiddenCount = filteredClients.length - visibleClients.length

  const canSave = !saving
    && selectedClient
    && fecha && hora
    && Number(personas) >= 1

  async function handleSave() {
    if (!canSave) return

    if (new Date(`${fecha}T${hora}`) < new Date()) {
      setError('La fecha y hora de la reserva ya pasaron. Elige un horario futuro.')
      return
    }

    setSaving(true)
    setError(null)

    const { error: saveError } = await onSave({
      cliente_id:     selectedClient.cliente_id,
      nombre_cliente: selectedClient.nombre || 'Sin nombre',
      telefono:       selectedClient.telefono,
      fecha,
      hora,
      personas,
      estado,
      notas,
    })

    if (saveError) {
      setSaving(false)
      setError(saveError)
      return
    }

    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel rsv-modal" onClick={e => e.stopPropagation()}>

        <div className="rm-head">
          <div>
            <div className="title">Nueva reserva</div>
            <div className="sub">Se notificará al cliente por WhatsApp</div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="rm-body">
          <div className="rm-field">
            <span className="rm-label">Cliente * <span className="rm-hint">(debe estar registrado — créalo en la tab Clientes)</span></span>
            {selectedClient ? (
              <div className="rm-client-selected">
                <div className="info">
                  <div className="name">{selectedClient.nombre || 'Sin nombre'}</div>
                  <div className="phone">{selectedClient.telefono}</div>
                </div>
                <button className="change" onClick={() => setSelectedClient(null)}>Cambiar</button>
              </div>
            ) : (
              <div className="rm-client-picker">
                <input
                  className="search"
                  type="text"
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="🔍 Buscar por nombre o teléfono..."
                  autoFocus
                />
                {clientsLoading ? (
                  <div className="list"><div className="msg">Cargando clientes...</div></div>
                ) : !clientQuery ? (
                  <div className="placeholder">
                    Escribe para buscar entre {clients.length} {clients.length === 1 ? 'cliente' : 'clientes'}
                  </div>
                ) : (
                  <div className="list">
                    {filteredClients.length === 0 ? (
                      <div className="msg">No se encontraron clientes con "{clientSearch.trim()}"</div>
                    ) : (
                      <>
                        {visibleClients.map(c => (
                          <button key={c.cliente_id} className="client" onClick={() => { setSelectedClient(c); setClientSearch('') }}>
                            <span className="name">{c.nombre || 'Sin nombre'}</span>
                            <span className="phone">{c.telefono}</span>
                          </button>
                        ))}
                        {hiddenCount > 0 && (
                          <div className="more">+{hiddenCount} más — sigue escribiendo para afinar la búsqueda</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rm-row">
            <label className="rm-field">
              <span className="rm-label">Fecha *</span>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </label>

            <label className="rm-field">
              <span className="rm-label">Hora *</span>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)} />
            </label>

            <label className="rm-field personas">
              <span className="rm-label">Personas *</span>
              <input
                type="number"
                min={1}
                max={30}
                value={personas}
                onChange={e => setPersonas(e.target.value)}
              />
            </label>
          </div>

          <label className="rm-field">
            <span className="rm-label">Estado</span>
            <select value={estado} onChange={e => setEstado(e.target.value)}>
              {RESERVATION_STATES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          <label className="rm-field">
            <span className="rm-label">Notas <span className="rm-hint">(opcional)</span></span>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: Mesa cerca de la ventana, cumpleaños..."
            />
          </label>

          {error && <div className="rm-error">{error}</div>}
        </div>

        <div className="rm-foot">
          <button className="cancel" onClick={onClose}>Cancelar</button>
          <button className={`save${canSave ? ' ready' : ''}`} onClick={handleSave} disabled={!canSave}>
            {saving ? 'Guardando...' : '✓ Crear reserva'}
          </button>
        </div>
      </div>
    </div>
  )
}
