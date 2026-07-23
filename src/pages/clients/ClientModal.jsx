import React, { useState } from 'react'
import { CLIENT_MODES } from '../../utils/constants'
import Icon from '../../components/Icon'

export default function ClientModal({ client, onSave, onDelete, onClose }) {
  const isNew = !client
  const [nombre,    setNombre]    = useState(client?.nombre || '')
  const [telefono,  setTelefono]  = useState(client?.telefono || '')
  const [direccion, setDireccion] = useState(client?.direccion_principal || '')
  const [modo,      setModo]      = useState(client?.modo || 'bot')
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error,     setError]     = useState(null)

  const canSave = !saving && !deleting && nombre.trim().length > 0 && telefono.trim().length >= 7

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

  async function handleDelete() {
    // Primer click solo arma la confirmación; el segundo ejecuta.
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setDeleting(true)
    setError(null)

    const { error: deleteError } = await onDelete(client.cliente_id)

    if (deleteError) {
      setDeleting(false)
      setConfirmDelete(false)
      setError(deleteError)
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
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="cm-body">
          <label className="field">
            <span className="field-label">Nombre</span>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: María Rodríguez"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">Teléfono</span>
            <input
              type="tel"
              value={telefono}
              onChange={e => setTelefono(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="573001234567"
            />
            <span className="field-help">Con código de país, sin + ni espacios.</span>
          </label>

          <label className="field">
            <span className="field-label">Dirección <span className="field-optional">Opcional</span></span>
            <input
              type="text"
              value={direccion}
              onChange={e => setDireccion(e.target.value)}
              placeholder="Ej: Calle 10 # 5-23, Barrio Centro"
            />
          </label>

          <label className="field">
            <span className="field-label">Modo <span className="field-optional">Opcional</span></span>
            <select value={modo} onChange={e => setModo(e.target.value)}>
              {CLIENT_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <span className="field-help">Quién atiende los mensajes del cliente.</span>
          </label>

          {error && <div className="cm-error">{error}</div>}
        </div>

        <div className="cm-foot">
          {!isNew && (
            <button
              className="btn danger"
              style={{ marginRight: 'auto' }}
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              disabled={saving || deleting}
            >
              {deleting
                ? 'Eliminando...'
                : confirmDelete
                  ? '¿Seguro? Click para confirmar'
                  : <><Icon name="trash" size={14} /> Eliminar</>}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Guardando...' : <><Icon name="check" size={14} /> {isNew ? 'Crear cliente' : 'Guardar cambios'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
