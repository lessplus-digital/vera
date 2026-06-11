import React, { useState } from 'react'
import { CLIENT_MODES } from '../../utils/constants'

export default function ClientModal({ client, onSave, onClose }) {
  const isNew = !client
  const [nombre,    setNombre]    = useState(client?.nombre || '')
  const [telefono,  setTelefono]  = useState(client?.telefono || '')
  const [direccion, setDireccion] = useState(client?.direccion_principal || '')
  const [modo,      setModo]      = useState(client?.modo || 'bot')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)

  const canSave = !saving && nombre.trim().length > 0 && telefono.trim().length >= 7

  async function handleSave() {
    if (!canSave) return

    if (!/^\d+$/.test(telefono.trim())) {
      setError('El teléfono solo debe contener números, con código de país (ej: 573001234567).')
      return
    }

    setSaving(true)
    setError(null)

    const { error: saveError } = await onSave({
      cliente_id: client?.cliente_id,
      nombre,
      telefono,
      direccion,
      modo,
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
      <div className="modal-panel client-modal" onClick={e => e.stopPropagation()}>

        <div className="cm-head">
          <div>
            <div className="title">{isNew ? 'Nuevo cliente' : 'Editar cliente'}</div>
            {!isNew && (
              <div className="sub">#{String(client.cliente_id).slice(0, 8)}</div>
            )}
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="cm-body">
          <label className="cm-field">
            <span className="cm-label">Nombre *</span>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: María Rodríguez"
              autoFocus
            />
          </label>

          <label className="cm-field">
            <span className="cm-label">Teléfono * <span className="cm-hint">(con código de país, sin + ni espacios)</span></span>
            <input
              type="tel"
              value={telefono}
              onChange={e => setTelefono(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="573001234567"
            />
          </label>

          <label className="cm-field">
            <span className="cm-label">Dirección</span>
            <input
              type="text"
              value={direccion}
              onChange={e => setDireccion(e.target.value)}
              placeholder="Ej: Calle 10 # 5-23, Barrio Centro"
            />
          </label>

          <label className="cm-field">
            <span className="cm-label">Modo <span className="cm-hint">(quién atiende los mensajes del cliente)</span></span>
            <select value={modo} onChange={e => setModo(e.target.value)}>
              {CLIENT_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          {error && <div className="cm-error">{error}</div>}
        </div>

        <div className="cm-foot">
          <button className="cancel" onClick={onClose}>Cancelar</button>
          <button className={`save${canSave ? ' ready' : ''}`} onClick={handleSave} disabled={!canSave}>
            {saving ? 'Guardando...' : isNew ? '✓ Crear cliente' : '✓ Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
