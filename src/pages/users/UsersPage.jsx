import React, { useState } from 'react'
import { useUsuarios } from '../../hooks/useUsuarios'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { ROLES, ROL_LABEL } from '../../utils/permisos'
import { timeAgo, nombreDeUsuario } from '../../utils/formatters'
import Avatar from '../../components/Avatar'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import PasswordModal from '../../components/PasswordModal'
import UserModal from './UserModal'
import DeliveryHistory from '../deliveries/DeliveryHistory'

/*
 * Tab Usuarios — quién entra al panel, con qué alcance y con qué credenciales.
 *
 * Vivía dentro de Configuración, junto a la información del negocio y las FAQ.
 * Se sacó porque no es lo mismo: aquellas son textos que el bot recita, esta
 * reparte accesos y toca contraseñas. Mezcladas, la operación más delicada del
 * panel quedaba escondida detrás de un sub-selector.
 *
 * Solo la ve el admin (`permisos.js`), pero eso es cortesía de UI: el RPC
 * `listar_usuarios` responde 42501 a cualquier otro rol, así que la pantalla
 * llegaría vacía igualmente.
 *
 * Reparto de acciones: la FILA lleva lo que se cambia de un golpe y en frío
 * (rol, acceso); los MODALES lo que hay que escribir y confirmar (identidad,
 * contraseña). Así cada modal conserva su único botón primary (DS §3).
 */
const ROLES_ASIGNABLES = [ROLES.ADMIN, ROLES.MESERO, ROLES.DOMICILIARIO]

const ALCANCE = {
  admin:        'Acceso completo. Puede asignar domicilios y gestionar usuarios.',
  mesero:       'Pedidos, historial, clientes, reservas y consulta del menú.',
  domiciliario: 'Solo los domicilios que le asignen, para marcarlos entregados.',
}

export default function UsersPage() {
  const {
    usuarios, loading, error,
    cambiarRol, setActivo, actualizarDatos,
    actualizarAvatar, quitarAvatar, cambiarPassword,
  } = useUsuarios()
  const { user } = useAuth()
  const { toast, showToast } = useToast()

  const [editando,    setEditando]    = useState(null)  // UserModal (usuario_id)
  const [passwordDe,  setPasswordDe]  = useState(null)  // PasswordModal
  const [historialDe, setHistorialDe] = useState(null)  // HistorialModal

  const activos = usuarios.filter(u => u.activo).length

  async function handleRol(usuario, rol) {
    if (rol === usuario.rol) return
    const { error: rolError } = await cambiarRol(usuario.usuario_id, rol)
    if (rolError) showToast('error', rolError)
    else showToast('success', `✓ ${nombreDeUsuario(usuario)} ahora es ${ROL_LABEL[rol].toLowerCase()}`)
  }

  async function handleActivo(usuario) {
    const next = !usuario.activo
    const { error: activoError } = await setActivo(usuario.usuario_id, next)
    if (activoError) {
      showToast('error', activoError)
    } else {
      showToast('success', next
        ? `✓ ${nombreDeUsuario(usuario)} puede volver a entrar`
        : `${nombreDeUsuario(usuario)} ya no puede entrar al panel`)
    }
  }

  // El modal de edición se queda con el usuario FRESCO de la lista, no con la
  // copia con la que se abrió: tras subir una foto el hook refetchea, y si no
  // se derivara aquí el modal seguiría mostrando el avatar viejo.
  const usuarioEditando = editando && usuarios.find(u => u.usuario_id === editando)

  return (
    <div className="us-page">

      <div className="us-toolbar">
        <div className="us-intro">
          <div className="us-page-title">Usuarios y accesos</div>
          <div className="us-page-sub">
            Quién puede entrar al panel y qué alcance tiene. Los cambios de rol y de acceso
            aplican al instante, incluso si la persona tiene el panel abierto.
          </div>
        </div>

        {usuarios.length > 0 && (
          <span className="us-count tnum">
            {usuarios.length} {usuarios.length === 1 ? 'usuario' : 'usuarios'} · {activos} {activos === 1 ? 'activo' : 'activos'}
          </span>
        )}
      </div>

      {/*
        No hay botón "Crear usuario" a propósito: el alta exige la admin API de
        Supabase, que corre con `service_role`. Esa clave no puede viajar en el
        bundle del navegador (mismo motivo que el token de WhatsApp), así que el
        alta se hace en Supabase y aquí solo se reparten permisos.

        La contraseña SÍ se cambia desde aquí, y por eso no contradice lo
        anterior: esa llamada va a la Edge Function `admin-password`, donde el
        `service_role` se queda en el servidor.
      */}
      <div className="us-alta">
        <Icon name="lock" size={14} />
        <div>
          <strong>Las cuentas se crean en Supabase</strong> — Authentication → Users → Add user.
          Aparecen aquí al instante como <em>domiciliario</em>, el rol de menor alcance, y desde
          esta pantalla les subes el permiso, les pones foto y les cambias la contraseña.
        </div>
      </div>

      {error && <div className="us-error">{error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando usuarios…</div>
      ) : (
        <div className="us-list">
          {usuarios.map(u => {
            const soyYo = u.usuario_id === user?.id
            return (
              <div className={`us-row${u.activo ? '' : ' off'}`} key={u.usuario_id}>

                <Avatar src={u.avatar_url} nombre={nombreDeUsuario(u)} size={40} />

                <div className="us-id">
                  <span className="us-nombre">
                    {nombreDeUsuario(u)}
                    {soyYo && <span className="us-tu">tú</span>}
                  </span>
                  <span className="us-email">{u.email}</span>
                  {u.telefono && <span className="us-tel">{u.telefono}</span>}
                </div>

                <div className="us-acceso">
                  <span className="us-acceso-label">Último acceso</span>
                  <span className="us-acceso-valor">
                    {u.ultimo_acceso ? timeAgo(u.ultimo_acceso) : 'Nunca entró'}
                  </span>
                  {/* Solo para domiciliarios: es el único rol con entregas que
                      contar. El componente es el mismo que ve el repartidor. */}
                  {u.rol === ROLES.DOMICILIARIO && (
                    <button className="us-historial" onClick={() => setHistorialDe(u)}>
                      <Icon name="history" size={12} /> Ver entregas
                    </button>
                  )}
                </div>

                <div className="us-rol">
                  {/*
                    Editarse a uno mismo se bloquea aquí, no en la BD: el trigger
                    solo impide quedarse SIN admin, y con dos admins uno podría
                    degradarse y perder el acceso de golpe sin previo aviso.
                  */}
                  <select
                    className="us-rol-select"
                    value={u.rol}
                    onChange={e => handleRol(u, e.target.value)}
                    disabled={soyYo}
                    title={soyYo ? 'No puedes cambiar tu propio rol' : undefined}
                    aria-label={`Rol de ${nombreDeUsuario(u)}`}
                  >
                    {ROLES_ASIGNABLES.map(r => (
                      <option key={r} value={r}>{ROL_LABEL[r]}</option>
                    ))}
                  </select>
                  <span className="us-rol-hint">{ALCANCE[u.rol]}</span>
                </div>

                <div className="us-estado">
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={u.activo}
                    aria-label={`Acceso de ${nombreDeUsuario(u)}`}
                    title={soyYo ? 'No puedes desactivarte a ti mismo' : (u.activo ? 'Quitar acceso' : 'Dar acceso')}
                    onClick={() => handleActivo(u)}
                    disabled={soyYo}
                  />
                  <span className={`us-estado-label ${u.activo ? 'on' : 'off'}`}>
                    {u.activo ? 'Activo' : 'Sin acceso'}
                  </span>
                </div>

                <div className="us-acciones">
                  <button
                    className="us-accion"
                    onClick={() => setEditando(u.usuario_id)}
                    title="Editar foto, nombre y teléfono"
                    aria-label={`Editar el perfil de ${nombreDeUsuario(u)}`}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  {/*
                    La propia se cambia en "Mi perfil", con este mismo modal.
                    Aquí se bloquea para que el admin no se cambie la suya
                    creyendo que toca la de otro en una lista de caras iguales.
                  */}
                  <button
                    className="us-accion"
                    onClick={() => setPasswordDe(u)}
                    disabled={soyYo}
                    title={soyYo ? 'Cambia la tuya desde el menú «Mi perfil»' : 'Cambiar contraseña'}
                    aria-label={`Cambiar la contraseña de ${nombreDeUsuario(u)}`}
                  >
                    <Icon name="key" size={15} />
                  </button>
                </div>

              </div>
            )
          })}
        </div>
      )}

      {usuarioEditando && (
        <UserModal
          usuario={usuarioEditando}
          onGuardar={datos => actualizarDatos(usuarioEditando.usuario_id, datos)}
          onSubirFoto={file => actualizarAvatar(usuarioEditando.usuario_id, file)}
          onQuitarFoto={() => quitarAvatar(usuarioEditando.usuario_id)}
          onClose={() => setEditando(null)}
          showToast={showToast}
        />
      )}

      {passwordDe && (
        <PasswordModal
          titulo={`Contraseña de ${nombreDeUsuario(passwordDe)}`}
          descripcion={`${passwordDe.email} · entrégasela en persona: nadie puede volver a verla.`}
          onSubmit={password => cambiarPassword(passwordDe.usuario_id, password)}
          onClose={() => setPasswordDe(null)}
          showToast={showToast}
        />
      )}

      {historialDe && (
        <HistorialModal usuario={historialDe} onClose={() => setHistorialDe(null)} />
      )}

      <Toast toast={toast} />
    </div>
  )
}

function HistorialModal({ usuario, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel us-hist-modal" onClick={e => e.stopPropagation()}>
        <div className="us-hist-head">
          <div className="us-hist-id">
            <Avatar src={usuario.avatar_url} nombre={nombreDeUsuario(usuario)} size={40} />
            <div>
              <div className="title">{nombreDeUsuario(usuario)}</div>
              <div className="sub">Historial de entregas</div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="us-hist-body">
          <DeliveryHistory domiciliarioId={usuario.usuario_id} compacto />
        </div>
      </div>
    </div>
  )
}

