// Edge Function: cambiar la contraseña de OTRO usuario del restaurante.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// Poner la contraseña de otra cuenta solo se puede con la Admin API de Supabase,
// que exige la clave `service_role`. Esa clave no puede vivir en el dashboard:
// todo lo que allí empieza por `VITE_` acaba dentro del bundle que descarga el
// navegador (mismo motivo por el que tampoco se crean cuentas desde el panel).
// Aquí el `service_role` se queda en el servidor de Supabase, inyectado como
// secreto de la función, y el navegador solo manda una petición firmada.
//
// El camino barato —`resetPasswordForEmail`— no servía: de los usuarios del
// restaurante, la mayoría (meseros y domiciliarios) tiene un email interno
// inventado, sin bandeja real donde recibir el enlace de recuperación.
//
// ── Autorización (dos barreras) ────────────────────────────────────────────
// 1. `verify_jwt = true` en config.toml: el gateway rechaza sin sesión válida.
// 2. Esta función comprueba que quien llama sea admin ACTIVO — un JWT válido lo
//    tiene también un domiciliario. La comprobación NO se hace leyendo el JWT
//    (el rol no viaja ahí y el cliente no es de fiar): se llama al RPC
//    `mi_rol()` con el token de quien llama, que es la misma fuente que usa la
//    RLS y que devuelve NULL si la cuenta está desactivada.
//
// El `service_role` se usa SOLO para el paso final. Todo lo que decide "¿puede?"
// corre con los permisos de quien llama.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!

// El mismo mínimo que pide la UI. Duplicarlo aquí no es redundante: el navegador
// no es la frontera, y Supabase Auth por defecto acepta desde 6 caracteres.
const MIN_PASSWORD = 8

// El dashboard es una SPA servida desde otro origen, así que el preflight es
// obligatorio. `*` porque el panel se sirve desde varios sitios (dev, preview,
// producción) y la autorización real la hace el JWT, no el origen.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Método no permitido' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Falta la sesión.' }, 401)

  // Cliente con la identidad de QUIEN LLAMA: hereda su RLS y su rol.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })

  const { data: userData, error: userError } = await comoUsuario.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Sesión no válida.' }, 401)
  }
  const quienLlama = userData.user

  // Barrera 2: rol real, leído de la BD con el token de quien llama.
  const { data: rol, error: rolError } = await comoUsuario.rpc('mi_rol')
  if (rolError) {
    console.error('No se pudo leer el rol de quien llama:', rolError)
    return json({ error: 'No se pudo verificar tu rol.' }, 500)
  }
  if (rol !== 'admin') {
    return json({ error: 'Solo un administrador puede cambiar contraseñas.' }, 403)
  }

  let body: { usuario_id?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo de la petición inválido.' }, 400)
  }

  const usuarioId = body.usuario_id?.trim()
  const password  = body.password

  if (!usuarioId) return json({ error: 'Falta el usuario.' }, 400)
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // El destinatario tiene que ser personal del restaurante. Sin esto, un admin
  // podría cambiarle la contraseña a cualquier cuenta de `auth.users` pasando
  // su UUID a mano — hoy no hay otras, pero la función no debería depender de eso.
  const { data: destino, error: destinoError } = await admin
    .from('perfiles')
    .select('usuario_id, nombre')
    .eq('usuario_id', usuarioId)
    .maybeSingle()

  if (destinoError) {
    console.error('Error buscando el perfil destino:', destinoError)
    return json({ error: 'No se pudo verificar el usuario.' }, 500)
  }
  if (!destino) {
    return json({ error: 'Ese usuario no pertenece al restaurante.' }, 404)
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(usuarioId, { password })
  if (updateError) {
    console.error('Error cambiando la contraseña:', updateError)
    return json({ error: updateError.message || 'No se pudo cambiar la contraseña.' }, 400)
  }

  // Nada de contraseñas ni de tokens en el log; solo quién tocó a quién.
  console.log(`Contraseña cambiada: admin ${quienLlama.id} → usuario ${usuarioId}`)

  return json({ ok: true })
})
