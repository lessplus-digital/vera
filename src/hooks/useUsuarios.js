import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Usuarios del restaurante, para la pantalla de administración.
//
// La lista viene del RPC `listar_usuarios()` y no de un select a `perfiles`
// porque el email vive en `auth.users`, que PostgREST no expone. El RPC es
// SECURITY DEFINER y autoriza por su cuenta: a un no-admin le responde 42501.
//
// Las mutaciones sí van directo a `perfiles` — ahí la RLS ya alcanza para
// filas, y `trigger_proteger_perfil` cubre lo que la RLS no puede (que solo un
// admin cambie `rol`/`activo`, y que no quede el sistema sin admin).
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

  return { usuarios, loading, error, cambiarRol, setActivo, actualizarDatos, refetch: fetchUsuarios }
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
