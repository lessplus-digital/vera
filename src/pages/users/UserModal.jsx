import React, { useState, useRef } from 'react'
import Icon from '../../components/Icon'
import Avatar from '../../components/Avatar'
import { validarAvatar } from '../../lib/avatares'
import { ROL_LABEL } from '../../utils/permisos'
import { nombreDeUsuario } from '../../utils/formatters'

const LIMITES = { nombre: 80, telefono: 20 }

/*
 * Ficha de OTRO usuario: foto, nombre y teléfono.
 *
 * Es casi el gemelo de ProfileModal, pero no se comparte código a propósito:
 * aquel escribe siempre sobre `auth.uid()` vía `actualizarPerfil`, y este sobre
 * una fila ajena vía el hook `useUsuarios`. Unificarlos exigiría un componente
 * que reciba el destino, y sería demasiado fácil que un cambio en el camino
 * "propio" arrastrara al de admin sin que nadie lo note.
 *
 * Que un admin pueda subir la foto de otro no es un permiso nuevo del panel:
 * las tres políticas de `storage.objects` sobre el bucket `avatares` ya llevan
 * `... OR es_admin()`, así que el archivo cae en la carpeta del dueño
 * (`<usuario_id>/…`) sin romper la convención que ES el permiso.
 *
 * Aquí NO se edita el rol ni el acceso: eso vive en la fila de la lista, donde
 * se ve junto al resto del equipo. Y la contraseña tiene su propio modal.
 */
export default function UserModal({ usuario, onGuardar, onSubirFoto, onQuitarFoto, onClose, showToast }) {
  const [nombre,   setNombre]   = useState(usuario.nombre   ?? '')
  const [telefono, setTelefono] = useState(usuario.telefono ?? '')
  const [preview,  setPreview]  = useState(null)   // object URL local, antes de subir
  const [archivo,  setArchivo]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [quitando, setQuitando] = useState(false)
  const [error,    setError]    = useState(null)

  const fileRef = useRef(null)

  const nombreLimpio = nombre.trim()
  const nombreInvalido = nombreLimpio.length > 0 && nombreLimpio.length < 2
  const ocupado = saving || quitando

  function elegirArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const problema = validarAvatar(file)
    if (problema) {
      setError(problema)
      e.target.value = ''
      return
    }

    setError(null)
    setArchivo(file)
    // Vista previa inmediata: subir primero y luego mostrar haría esperar al
    // admin para saber si eligió la foto correcta.
    setPreview(URL.createObjectURL(file))
  }

  async function quitarFoto() {
    if (ocupado) return
    setQuitando(true)
    setError(null)

    // Descarta también una foto elegida y todavía sin subir: si no, el botón
    // "Quitar" borraría la del servidor y "Guardar" volvería a subir la nueva.
    setArchivo(null)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''

    const { error: quitarError } = await onQuitarFoto()
    setQuitando(false)
    if (quitarError) setError(quitarError)
    else showToast?.('success', `✓ Se quitó la foto de ${nombreDeUsuario(usuario)}`)
  }

  async function guardar() {
    if (nombreInvalido || ocupado) return

    setSaving(true)
    setError(null)

    // La foto va primero y por su cuenta: si falla la subida, el nombre y el
    // teléfono no deberían quedar guardados a medias con un aviso de error.
    if (archivo) {
      const { error: fotoError } = await onSubirFoto(archivo)
      if (fotoError) {
        setSaving(false)
        setError(fotoError)
        return
      }
    }

    const { error: saveError } = await onGuardar({ nombre: nombreLimpio, telefono })
    if (saveError) {
      setSaving(false)
      setError(saveError)
      return
    }

    setSaving(false)
    showToast?.('success', `✓ Perfil de ${nombreLimpio || nombreDeUsuario(usuario)} actualizado`)
    onClose()
  }

  const fotoActual = preview || usuario.avatar_url

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel us-modal" onClick={e => e.stopPropagation()}>

        <div className="us-modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="title">Perfil de {nombreDeUsuario(usuario)}</div>
            <div className="sub">{usuario.email} · {ROL_LABEL[usuario.rol] ?? 'Sin rol'}</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="us-modal-body">

          <div className="us-foto">
            <Avatar src={fotoActual} nombre={nombreLimpio || usuario.email} size={72} />
            <div className="us-foto-acciones">
              <div className="us-foto-botones">
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={ocupado}
                >
                  <Icon name="camera" size={14} /> {fotoActual ? 'Cambiar foto' : 'Subir foto'}
                </button>
                {fotoActual && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={quitarFoto}
                    disabled={ocupado}
                  >
                    {quitando ? 'Quitando…' : 'Quitar'}
                  </button>
                )}
              </div>
              <span className="us-foto-hint">
                JPG, PNG o WebP · máximo 2 MB. La verá todo el equipo en el panel.
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={elegirArchivo}
              hidden
            />
          </div>

          <label className="field">
            <span className="field-label">Nombre</span>
            <input
              type="text"
              value={nombre}
              maxLength={LIMITES.nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Carlos Ramírez"
            />
            <span className="field-help">
              Sin nombre, en el panel aparece la parte del email antes de la arroba.
            </span>
          </label>

          <label className="field">
            <span className="field-label">Teléfono</span>
            <input
              type="tel"
              value={telefono}
              maxLength={LIMITES.telefono}
              onChange={e => setTelefono(e.target.value)}
              placeholder="300 123 4567"
            />
            <span className="field-help">
              Para poder contactarlo durante el turno.
            </span>
          </label>

          {nombreInvalido && (
            <div className="us-modal-error">El nombre debe tener al menos 2 caracteres.</div>
          )}
          {error && <div className="us-modal-error">{error}</div>}

        </div>

        <div className="us-modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={ocupado}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={ocupado || nombreInvalido}>
            {saving ? 'Guardando…' : <><Icon name="check" size={14} /> Guardar</>}
          </button>
        </div>

      </div>
    </div>
  )
}
