import React, { useState } from 'react'
import { useUsuarios } from '../../hooks/useUsuarios'
import { useAuth } from '../../hooks/useAuth'
import { ROLES, ROL_LABEL } from '../../utils/permisos'
import { timeAgo } from '../../utils/formatters'
import Avatar from '../../components/Avatar'
import Icon from '../../components/Icon'
import DeliveryHistory from '../deliveries/DeliveryHistory'

const ROLES_ASIGNABLES = [ROLES.ADMIN, ROLES.MESERO, ROLES.DOMICILIARIO]

const ALCANCE = {
  admin:        'Acceso completo. Puede asignar domicilios y gestionar usuarios.',
  mesero:       'Pedidos, historial, clientes, reservas y consulta del menú.',
  domiciliario: 'Solo los domicilios que le asignen, para marcarlos entregados.',
}

export default function UsersSection({ showToast }) {
  const { usuarios, loading, error, cambiarRol, setActivo } = useUsuarios()
  const { user } = useAuth()
  const [historialDe, setHistorialDe] = useState(null)

  const activos = usuarios.filter(u => u.activo).length

  async function handleRol(usuario, rol) {
    if (rol === usuario.rol) return
    const { error: rolError } = await cambiarRol(usuario.usuario_id, rol)
    if (rolError) showToast('error', rolError)
    else showToast('success', `✓ ${nombreDe(usuario)} ahora es ${ROL_LABEL[rol].toLowerCase()}`)
  }

  async function handleActivo(usuario) {
    const next = !usuario.activo
    const { error: activoError } = await setActivo(usuario.usuario_id, next)
    if (activoError) {
      showToast('error', activoError)
    } else {
      showToast('success', next
        ? `✓ ${nombreDe(usuario)} puede volver a entrar`
        : `${nombreDe(usuario)} ya no puede entrar al panel`)
    }
  }

  return (
    <>
      <div className="settings-toolbar">
        <div className="settings-intro">
          <div className="settings-title">Usuarios</div>
          <div className="settings-sub">
            Quién puede entrar al panel y qué alcance tiene. Los cambios de rol aplican al
            instante, incluso si la persona tiene el panel abierto.
          </div>
        </div>

        <div className="settings-actions">
          {usuarios.length > 0 && (
            <span className="us-count tnum">
              {usuarios.length} {usuarios.length === 1 ? 'usuario' : 'usuarios'} · {activos} {activos === 1 ? 'activo' : 'activos'}
            </span>
          )}
        </div>
      </div>

      {/*
        No hay botón "Crear usuario" a propósito: el alta exige la admin API de
        Supabase, que corre con `service_role`. Esa clave no puede viajar en el
        bundle del navegador (mismo motivo que el token de WhatsApp), así que el
        alta se hace en Supabase y aquí solo se reparten permisos.
      */}
      <div className="us-alta">
        <Icon name="lock" size={14} />
        <div>
          <strong>Las cuentas se crean en Supabase</strong> — Authentication → Users → Add user.
          Aparecen aquí al instante como <em>domiciliario</em>, el rol de menor alcance, y desde
          esta pantalla les subes el permiso. Crear cuentas desde el panel exigiría una clave de
          servidor que no puede vivir en el navegador.
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando usuarios…</div>
      ) : (
        <div className="us-list">
          {usuarios.map(u => {
            const soyYo = u.usuario_id === user?.id
            return (
              <div className={`us-row${u.activo ? '' : ' off'}`} key={u.usuario_id}>

                <Avatar src={u.avatar_url} nombre={nombreDe(u)} size={40} />

                <div className="us-id">
                  <span className="us-nombre">
                    {nombreDe(u)}
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
                    aria-label={`Rol de ${nombreDe(u)}`}
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
                    aria-label={`Acceso de ${nombreDe(u)}`}
                    title={soyYo ? 'No puedes desactivarte a ti mismo' : (u.activo ? 'Quitar acceso' : 'Dar acceso')}
                    onClick={() => handleActivo(u)}
                    disabled={soyYo}
                  />
                  <span className={`us-estado-label ${u.activo ? 'on' : 'off'}`}>
                    {u.activo ? 'Activo' : 'Sin acceso'}
                  </span>
                </div>

              </div>
            )
          })}
        </div>
      )}

      {historialDe && (
        <HistorialModal usuario={historialDe} onClose={() => setHistorialDe(null)} />
      )}
    </>
  )
}

function HistorialModal({ usuario, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel us-hist-modal" onClick={e => e.stopPropagation()}>
        <div className="us-hist-head">
          <div className="us-hist-id">
            <Avatar src={usuario.avatar_url} nombre={nombreDe(usuario)} size={40} />
            <div>
              <div className="title">{nombreDe(usuario)}</div>
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

function nombreDe(usuario) {
  return usuario.nombre || usuario.email?.split('@')[0] || 'Usuario'
}
