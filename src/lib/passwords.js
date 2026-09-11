import { supabase } from './supabase'

/*
 * Contraseñas del panel — los dos caminos que existen, en un solo sitio.
 *
 * 1. La PROPIA la cambia el usuario con su sesión: `auth.updateUser` acepta la
 *    clave publicable, así que sale directo del navegador.
 * 2. La de OTRO exige la Admin API, y esa corre con `service_role` — una clave
 *    que no puede viajar en el bundle. Por eso pasa por la Edge Function
 *    `admin-password`, que valida que quien llama sea admin activo antes de
 *    tocar nada. Ver `supabase/functions/admin-password/index.ts`.
 *
 * La regla de longitud vive aquí y también en la función: el navegador da el
 * mensaje temprano, el servidor es el que manda.
 */

export const MIN_PASSWORD = 8

/** Valida el par contraseña/confirmación. Devuelve el problema o null. */
export function validarPassword(password, confirmacion) {
  if (!password) return 'Escribe la nueva contraseña.'
  if (password.length < MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  }
  if (confirmacion !== undefined && password !== confirmacion) {
    return 'Las dos contraseñas no coinciden.'
  }
  return null
}

/** Cambia la contraseña del usuario que tiene la sesión abierta. */
export async function cambiarMiPassword(password) {
  const problema = validarPassword(password)
  if (problema) return { error: problema }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error('Error cambiando la propia contraseña:', error)
    // Auth rechaza reusar la contraseña actual con este mensaje; el resto de
    // fallos no tienen una causa que el usuario pueda accionar.
    if (error.message?.includes('should be different')) {
      return { error: 'La nueva contraseña debe ser distinta de la actual.' }
    }
    return { error: 'No se pudo cambiar tu contraseña. Intenta de nuevo.' }
  }
  return { error: null }
}

/**
 * Cambia la contraseña de otro usuario. Solo funciona para un admin activo —
 * lo comprueba la Edge Function, no esta llamada.
 */
export async function cambiarPasswordDeUsuario(usuarioId, password) {
  const problema = validarPassword(password)
  if (problema) return { error: problema }

  // `invoke` adjunta solo el JWT de la sesión actual; no hay nada que firmar aquí.
  const { data, error } = await supabase.functions.invoke('admin-password', {
    body: { usuario_id: usuarioId, password },
  })

  if (error) {
    console.error('Error llamando a admin-password:', error)
    // `FunctionsHttpError` trae la respuesta real: sin leerla, un 403 legítimo
    // ("no eres admin") se vería igual que una caída de red.
    const detalle = await leerError(error)
    return { error: detalle || 'No se pudo cambiar la contraseña. Intenta de nuevo.' }
  }
  if (data?.error) return { error: data.error }

  return { error: null }
}

async function leerError(error) {
  try {
    const cuerpo = await error.context?.json?.()
    return cuerpo?.error ?? null
  } catch {
    // La función no llegó a responder JSON (no desplegada, timeout, CORS).
    return null
  }
}
