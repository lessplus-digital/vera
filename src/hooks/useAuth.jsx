import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/*
 * Sesión de Supabase Auth compartida por toda la app.
 *
 * El cliente JS de Supabase persiste la sesión en localStorage y adjunta
 * automáticamente el JWT a cada petición REST/Realtime. Combinado con RLS
 * activado en todas las tablas (ver docs/database/schema.md, «Modelo de permisos»),
 * esto hace que ninguna consulta del dashboard funcione sin un usuario autenticado.
 */

const AuthContext = createContext(null)

const PERFIL_COLUMNS = 'usuario_id, nombre, rol, telefono, avatar_url, activo'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [perfil, setPerfil] = useState(null)
  const [perfilLoading, setPerfilLoading] = useState(true)

  useEffect(() => {
    // Sesión inicial (puede venir de localStorage tras recargar).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      // Propagar el JWT al socket de Realtime: los eventos postgres_changes de
      // tablas con RLS solo-authenticated (p. ej. `clientes`) se filtran en
      // silencio si el socket quedó con el token anon (BUG-023).
      supabase.realtime.setAuth(data.session?.access_token ?? null)
    })

    // Cambios posteriores: login, logout, refresco de token, otra pestaña.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      supabase.realtime.setAuth(next?.access_token ?? null)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  /*
   * Perfil y rol del usuario.
   *
   * Vive aquí y no en DashboardShell —donde CLAUDE.md manda poner los hooks de
   * datos— porque el rol no es dato de dominio: decide qué pantallas existen,
   * así que tiene que estar resuelto ANTES de montar el shell. La razón de esa
   * regla (no consultar sin sesión, porque RLS lo bloquea todo) se respeta
   * igual: este efecto no hace nada mientras `session` sea null.
   *
   * El rol se lee SIEMPRE de la BD. No se guarda en localStorage ni se deduce
   * del JWT: cualquiera de las dos cosas sería un valor que el cliente puede
   * manipular, y aunque la RLS no se dejaría engañar, la UI mostraría pantallas
   * que luego llegan vacías.
   */
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) {
      setPerfil(null)
      setPerfilLoading(false)
      return
    }

    let cancelado = false
    setPerfilLoading(true)

    async function cargarPerfil() {
      const { data, error } = await supabase
        .from('perfiles')
        .select(PERFIL_COLUMNS)
        .eq('usuario_id', userId)
        .maybeSingle()

      if (cancelado) return
      if (error) {
        console.error('Error cargando el perfil:', error)
        setPerfil(null)         // Falla cerrado: sin perfil no hay acceso.
      } else {
        setPerfil(data ?? null)
      }
      setPerfilLoading(false)
    }

    cargarPerfil()

    // Si un admin cambia tu rol o te desactiva, se refleja sin recargar. Sin
    // esto, un usuario recién desactivado seguiría viendo su UI intacta hasta
    // el próximo refresh (con todas las consultas llegando vacías).
    const channel = supabase
      .channel(`perfil-rt-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'perfiles', filter: `usuario_id=eq.${userId}` },
        payload => {
          if (payload.eventType === 'DELETE') setPerfil(null)
          else setPerfil(payload.new)
        }
      )
      .subscribe()

    return () => {
      cancelado = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  /*
   * Edición del perfil PROPIO: nombre, teléfono y foto.
   *
   * No acepta `rol` ni `activo` aunque se los pasen: cambiarlos es cosa del
   * admin. La barrera real es `trigger_proteger_perfil` en la BD —esto solo
   * evita mandar una petición que va a rebotar—, pero dejar la puerta abierta
   * aquí invitaría a usarla desde otro punto de la app.
   */
  async function actualizarPerfil({ nombre, telefono, avatar_url }) {
    if (!userId) return { error: 'No hay sesión activa.' }

    const patch = {}
    if (nombre     !== undefined) patch.nombre     = nombre
    if (telefono   !== undefined) patch.telefono   = telefono
    if (avatar_url !== undefined) patch.avatar_url = avatar_url

    const { data, error } = await supabase
      .from('perfiles')
      .update(patch)
      .eq('usuario_id', userId)
      .select(PERFIL_COLUMNS)
      .single()

    if (error) {
      console.error('Error actualizando el perfil:', error)
      return { error: 'No se pudo guardar tu perfil. Intenta de nuevo.' }
    }

    // El realtime también lo traería, pero llega un instante después y el
    // modal se cerraría con la foto vieja todavía en pantalla.
    setPerfil(data)
    return { error: null }
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    perfil,
    // Un perfil inactivo equivale a no tener rol — igual que `mi_rol()` en la
    // BD, que devuelve NULL cuando `activo` es false.
    rol: perfil?.activo ? perfil.rol : null,
    perfilLoading,
    signIn,
    signOut,
    actualizarPerfil,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
