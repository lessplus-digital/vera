import React, { useState, useRef } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'
import { useAuth } from '../hooks/useAuth'
import { ROL_LABEL } from '../utils/permisos'
import { subirAvatar, borrarAvatarAnterior, validarAvatar } from '../lib/avatares'
import { cambiarMiPassword } from '../lib/passwords'
import PasswordModal from './PasswordModal'

const LIMITES = { nombre: 80, telefono: 20 }

/*
 * "Mi perfil" — lo abre cualquier rol desde el menú de la barra superior.
 *
 * Va en el menú de usuario y no en una tab porque el mesero y el domiciliario
 * NO tienen la tab Usuarios (esa es solo del admin) y también necesitan poner
 * su nombre, su foto y su contraseña. El menú superior es el único sitio que
 * todos comparten.
 *
 * Aquí no se edita el rol: eso es de la pantalla de Usuarios, y la BD lo
 * rechazaría igual (`trigger_proteger_perfil`).
 */
export default function ProfileModal({ onClose, showToast }) {
  const { user, perfil, rol, actualizarPerfil } = useAuth()

  const [nombre,   setNombre]   = useState(perfil?.nombre   ?? '')
  const [telefono, setTelefono] = useState(perfil?.telefono ?? '')
  const [preview,  setPreview]  = useState(null)   // object URL local, antes de subir
  const [archivo,  setArchivo]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [cambiandoPassword, setCambiandoPassword] = useState(false)

  const fileRef = useRef(null)

  const nombreLimpio = nombre.trim()
  const nombreInvalido = nombreLimpio.length > 0 && nombreLimpio.length < 2

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
    // usuario para saber si eligió la foto correcta.
    setPreview(URL.createObjectURL(file))
  }

  async function guardar() {
    if (nombreInvalido || saving) return

    setSaving(true)
    setError(null)

    let avatarUrl
    if (archivo) {
      const { url, error: upError } = await subirAvatar(user.id, archivo)
      if (upError) {
        setSaving(false)
        setError(upError)
        return
      }
      avatarUrl = url
    }

    const anterior = perfil?.avatar_url
    const { error: saveError } = await actualizarPerfil({
      nombre:   nombreLimpio || null,
      telefono: telefono.trim() || null,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })

    if (saveError) {
      setSaving(false)
      setError(saveError)
      return
    }

    // Solo cuando el perfil ya apunta a la nueva: si se borrara antes y el
    // guardado fallara, el usuario se quedaría sin foto ninguna.
    if (avatarUrl && anterior) await borrarAvatarAnterior(anterior)

    setSaving(false)
    showToast?.('success', '✓ Perfil actualizado')
    onClose()
  }

  const fotoActual = preview || perfil?.avatar_url

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel perfil-modal" onClick={e => e.stopPropagation()}>

        <div className="perfil-head">
          <div>
            <div className="title">Mi perfil</div>
            <div className="sub">{user?.email}</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="perfil-body">

          <div className="perfil-foto">
            <Avatar src={fotoActual} nombre={nombreLimpio || user?.email} size={72} />
            <div className="perfil-foto-acciones">
              <button
                type="button"
                className="btn secondary"
                onClick={() => fileRef.current?.click()}
                disabled={saving}
              >
                <Icon name="camera" size={14} /> {fotoActual ? 'Cambiar foto' : 'Subir foto'}
              </button>
              <span className="perfil-foto-hint">JPG, PNG o WebP · máximo 2 MB</span>
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
              Es el nombre que ven tus compañeros en el panel.
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
              Para que puedan contactarte durante el turno.
            </span>
          </label>

          <div className="perfil-rol">
            <span className="perfil-rol-label">Tu rol</span>
            <span className="perfil-rol-valor">{ROL_LABEL[rol] ?? 'Sin rol'}</span>
            <span className="perfil-rol-hint">Solo un administrador puede cambiarlo.</span>
          </div>

          {/*
            La contraseña no es un campo más del formulario: se aplica sola, al
            instante, sin pasar por "Guardar". Por eso abre su propio modal —
            con un campo aquí, escribirla y cerrar con "Cancelar" haría creer
            que quedó cambiada. Y el botón es secondary: el primary de esta
            pantalla ya es "Guardar" (DS §3).
          */}
          <div className="perfil-clave">
            <div className="perfil-clave-texto">
              <span className="perfil-clave-label">Contraseña</span>
              <span className="perfil-clave-hint">
                Cámbiala si crees que alguien más la conoce.
              </span>
            </div>
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => setCambiandoPassword(true)}
              disabled={saving}
            >
              <Icon name="key" size={14} /> Cambiar
            </button>
          </div>

          {nombreInvalido && (
            <div className="perfil-error">El nombre debe tener al menos 2 caracteres.</div>
          )}
          {error && <div className="perfil-error">{error}</div>}

        </div>

        <div className="perfil-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || nombreInvalido}>
            {saving ? 'Guardando…' : <><Icon name="check" size={14} /> Guardar</>}
          </button>
        </div>

      </div>
    </div>

    {/*
      Fuera del overlay de "Mi perfil", no dentro: el overlay cierra al hacer
      clic y un modal anidado heredaría ese click, cerrando los dos de golpe.
    */}
    {cambiandoPassword && (
      <PasswordModal
        titulo="Cambiar mi contraseña"
        descripcion="Tu sesión sigue abierta; solo tendrás que usar la nueva la próxima vez que entres."
        onSubmit={cambiarMiPassword}
        onClose={() => setCambiandoPassword(false)}
        showToast={showToast}
      />
    )}
    </>
  )
}
