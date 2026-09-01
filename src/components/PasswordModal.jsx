import React, { useState } from 'react'
import Icon from './Icon'
import { MIN_PASSWORD, validarPassword } from '../lib/passwords'

/*
 * Cambio de contraseña — el mismo modal para los dos casos.
 *
 * Quien lo abre decide QUÉ hace el botón pasándole `onSubmit`: en "Mi perfil"
 * es `cambiarMiPassword` (sesión propia, sale directo del navegador); en la
 * pantalla de Usuarios es `cambiarPassword` del hook, que pasa por la Edge
 * Function. El formulario es idéntico, así que compartirlo evita que las reglas
 * de longitud y confirmación se dupliquen y se desincronicen.
 *
 * No pide la contraseña actual. En el caso del admin no la sabe (ese es el
 * motivo de la pantalla) y en el propio la sesión ya la acredita: quien tiene
 * el panel abierto se autenticó hace poco.
 */
export default function PasswordModal({ titulo, descripcion, onSubmit, onClose, showToast }) {
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // `problema` bloquea el botón; los dos `*Visible` deciden qué se le dice al
  // usuario. Son distintos a propósito: con la confirmación vacía el formulario
  // NO es válido (por eso `problema` la compara siempre), pero tampoco se marca
  // en rojo — avisar de un campo que aún no ha tocado convierte el formulario
  // en una alarma constante.
  const problema = validarPassword(password, confirmacion)
  const cortaVisible    = password.length > 0 && password.length < MIN_PASSWORD
  const distintaVisible = confirmacion.length > 0 && password !== confirmacion

  async function guardar() {
    if (problema || saving) return

    setSaving(true)
    setError(null)

    const { error: submitError } = await onSubmit(password)

    if (submitError) {
      setSaving(false)
      setError(submitError)
      return
    }

    setSaving(false)
    showToast?.('success', '✓ Contraseña actualizada')
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel pw-modal" onClick={e => e.stopPropagation()}>

        <div className="pw-head">
          <div style={{ minWidth: 0 }}>
            <div className="title">{titulo}</div>
            {descripcion && <div className="sub">{descripcion}</div>}
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="pw-body">
          <label className="field">
            <span className="field-label">Nueva contraseña</span>
            <div className="pw-input">
              <input
                type={visible ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
              <button
                type="button"
                className="pw-ojo"
                onClick={() => setVisible(v => !v)}
                aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={visible ? 'Ocultar' : 'Mostrar'}
              >
                <Icon name={visible ? 'eye-off' : 'eye'} size={15} />
              </button>
            </div>
            <span className={`field-help${cortaVisible ? ' pw-mal' : ''}`}>
              {cortaVisible
                ? `Le faltan ${MIN_PASSWORD - password.length} caracteres.`
                : `Al menos ${MIN_PASSWORD} caracteres.`}
            </span>
          </label>

          <label className="field">
            <span className="field-label">Confirmar contraseña</span>
            <input
              type={visible ? 'text' : 'password'}
              value={confirmacion}
              autoComplete="new-password"
              onChange={e => setConfirmacion(e.target.value)}
              placeholder="Escríbela otra vez"
            />
            <span className={`field-help${distintaVisible ? ' pw-mal' : ''}`}>
              {distintaVisible ? 'Las dos contraseñas no coinciden.' : 'Para descartar un error de tecleo.'}
            </span>
          </label>

          {error && <div className="pw-error">{error}</div>}
        </div>

        <div className="pw-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || Boolean(problema)}>
            {saving ? 'Guardando…' : <><Icon name="key" size={14} /> Cambiar contraseña</>}
          </button>
        </div>

      </div>
    </div>
  )
}
