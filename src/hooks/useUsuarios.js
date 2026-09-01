import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { subirAvatar, borrarAvatarAnterior } from '../lib/avatares'
import { cambiarPasswordDeUsuario } from '../lib/passwords'

// Usuarios del restaurante, para la pantalla de administración.
//
// La lista viene del RPC `listar_usuarios()` y no de un select a `perfiles`
// porque el email vive en `auth.users`, que PostgREST no expone. El RPC es
// SECURITY DEFINER y autoriza por su cuenta: a un no-admin le responde 42501.
//
// Las mutaciones de perfil van directo a `perfiles` — ahí la RLS ya alcanza
// (`perfiles_update` acepta `es_admin()` sobre cualquier fila), y
// `trigger_proteger_perfil` cubre lo que la RLS no puede (que solo un admin
// cambie `rol`/`activo`, y que no quede el sistema sin admin).
//
// La contraseña es la excepción: no es una columna de `perfiles` sino un dato
// de `auth.users`, y ninguna política llega ahí. Ese camino sale del navegador
// hacia la Edge Function `admin-password` (ver `src/lib/passwords.js`).
export function useUsuarios() {
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchUsuarios = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('listar_usuarios')

    if (rpcError) {
      console.error('Error cargando usuarios:', rpcError)
      setError(
        rpcError.message?.includes('Solo un administrador')
          ? 'Solo un administrador puede ver los usuarios.'
          : rpcError.message
      )
      setUsuarios([])
    } else {
      setUsuarios(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsuarios() }, [fetchUsuarios])

  async function cambiarRol(usuarioId, rol) {
    return aplicar(usuarioId, { rol })
  }

  async function setActivo(usuarioId, activo) {
    return aplicar(usuarioId, { activo })
  }

  async function actualizarDatos(usuarioId, { nombre, telefono }) {
    return aplicar(usuarioId, {
      nombre:   nombre?.trim()   || null,
      telefono: telefono?.trim() || null,
    })
  }

  /**
   * Sube la foto de un usuario y la deja apuntada en su perfil.
   *
   * Mismo orden que en "Mi perfil": primero se sube, luego se guarda la URL y
   * SOLO entonces se borra la anterior. Al revés, un guardado fallido dejaría
   * al usuario sin ninguna foto.
   */
  async function actualizarAvatar(usuarioId, file) {
    const { url, error: upError } = await subirAvatar(usuarioId, file)
    if (upError) return { error: upError }

    const anterior = usuarios.find(u => u.usuario_id === usuarioId)?.avatar_url
    const { error: saveError } = await aplicar(usuarioId, { avatar_url: url })
    if (saveError) return { error: saveError }

    if (anterior) await borrarAvatarAnterior(anterior)
    return { error: null }
  }

  /** Quita la foto: primero se desapunta del perfil, luego se borra el archivo. */
  async function quitarAvatar(usuarioId) {
    const anterior = usuarios.find(u => u.usuario_id === usuarioId)?.avatar_url
    if (!anterior) return { error: null }

    const { error: saveError } = await aplicar(usuarioId, { avatar_url: null })
    if (saveError) return { error: saveError }

    await borrarAvatarAnterior(anterior)
    return { error: null }
  }

  /**
   * Contraseña de otro usuario. No refresca la lista a propósito: no cambia
   * ninguna columna que esta pantalla muestre.
   */
  async function cambiarPassword(usuarioId, password) {
    return cambiarPasswordDeUsuario(usuarioId, password)
  }

  async function aplicar(usuarioId, patch) {
    const { error: updateError } = await supabase
      .from('perfiles')
      .update(patch)
      .eq('usuario_id', usuarioId)

    if (updateError) {
      console.error('Error actualizando usuario:', updateError)
      return { error: mensajeDeError(updateError) }
    }
    await fetchUsuarios()
    return { error: null }
  }

  return {
    usuarios,
    loading,
    error,
    cambiarRol,
    setActivo,
    actualizarDatos,
    actualizarAvatar,
    quitarAvatar,
    cambiarPassword,
    refetch: fetchUsuarios,
  }
}

// Los triggers de `perfiles` son la frontera real; aquí solo se traduce lo que
// devuelven para que el admin lea una frase y no un error de Postgres.
function mensajeDeError(err) {
  const detalle = `${err?.message || ''} ${err?.details || ''}`
  if (detalle.includes('sin ningún administrador')) {
    return 'No puedes dejar el restaurante sin ningún administrador activo.'
  }
  if (detalle.includes('Solo un administrador')) {
    return 'Solo un administrador puede cambiar el rol o el estado de un usuario.'
  }
  if (detalle.includes('perfiles_nombre_len')) {
    return 'El nombre debe tener entre 2 y 80 caracteres.'
  }
  return 'No se pudo guardar el cambio. Intenta de nuevo.'
}
