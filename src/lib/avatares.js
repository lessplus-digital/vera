import { supabase } from './supabase'

const BUCKET = 'avatares'

// Los mismos límites que trae el bucket en la BD (`file_size_limit` y
// `allowed_mime_types`). Duplicarlos aquí NO es la validación de verdad: sirve
// para dar un mensaje claro antes de gastar la subida. Quien llame a la Storage
// API directo choca igual contra los del servidor.
export const LIMITE_BYTES = 2 * 1024 * 1024
export const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp']

const EXT_POR_TIPO = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
}

export function validarAvatar(file) {
  if (!file) return 'Elige una imagen.'
  if (!TIPOS_OK.includes(file.type)) return 'La foto debe ser JPG, PNG o WebP.'
  if (file.size > LIMITE_BYTES) {
    return `La foto pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es 2 MB.`
  }
  return null
}

/**
 * Sube el avatar de un usuario y devuelve su URL pública.
 *
 * La ruta es `<usuario_id>/<timestamp>.<ext>` porque la carpeta ES el permiso:
 * las políticas de `storage.objects` comparan `foldername(name)[1]` contra
 * `auth.uid()` **o** aceptan `es_admin()`. Cambiar esta convención rompe la
 * seguridad, no solo el orden.
 *
 * Ese `OR es_admin()` es lo que permite pasar un `usuarioId` que no es el
 * propio: un admin sube la foto de un mesero desde la pantalla de Usuarios y
 * el archivo cae igual en la carpeta del dueño. Para cualquier otro rol la
 * política rebota la subida.
 *
 * El timestamp en el nombre evita el caché: reusar `<uid>/avatar.jpg` deja al
 * navegador (y al CDN) mostrando la foto vieja tras cambiarla.
 */
export async function subirAvatar(usuarioId, file) {
  const problema = validarAvatar(file)
  if (problema) return { url: null, error: problema }

  const ext  = EXT_POR_TIPO[file.type] || 'jpg'
  const ruta = `${usuarioId}/${Date.now()}.${ext}`

  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, file, { contentType: file.type, upsert: false })

  if (upError) {
    console.error('Error subiendo el avatar:', upError)
    if (upError.message?.includes('exceeded the maximum allowed size')) {
      return { url: null, error: 'La foto supera el máximo de 2 MB.' }
    }
    return { url: null, error: 'No se pudo subir la foto. Intenta de nuevo.' }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  return { url: data.publicUrl, error: null }
}

/**
 * Borra el avatar anterior tras subir uno nuevo.
 *
 * Best-effort a propósito: si falla, el perfil ya apunta al nuevo y lo único
 * que queda es un archivo huérfano. Bloquear el guardado por esto sería
 * cambiar un problema de limpieza por uno de usabilidad.
 */
export async function borrarAvatarAnterior(url) {
  if (!url) return
  // .../object/public/avatares/<uid>/<archivo>
  const marca = `/${BUCKET}/`
  const i = url.indexOf(marca)
  if (i === -1) return

  const ruta = url.slice(i + marca.length).split('?')[0]
  const { error } = await supabase.storage.from(BUCKET).remove([ruta])
  if (error) console.warn('No se pudo borrar el avatar anterior:', error)
}
