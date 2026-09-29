import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type { SupabaseClient }

// Cliente con la clave secreta: salta RLS, por eso nunca sale del servidor.
// Sin sesión persistente: es un backend, no un navegador.
export function crearSupabase(url: string, claveSecreta: string): SupabaseClient {
  return createClient(url, claveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Error de PostgREST / Postgres tal como lo devuelve supabase-js. */
export type ErrorBD = { code?: string; message: string }

/** SQLSTATE de violación de unicidad. */
export const UNIQUE_VIOLATION = '23505'
