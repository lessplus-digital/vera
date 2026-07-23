import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Config del negocio (tabla `info_negocio`, clave/valor/categoria). La consume el
// bot vía la tool `info_local` (getAll sin filtros) — lo que se guarde aquí es lo
// que el bot responde por WhatsApp cuando preguntan horarios, dirección, pagos, etc.
//
// Sin realtime a propósito: es un formulario de edición y un evento entrante
// pisaría lo que el admin está escribiendo. Dos admins editando la config a la
// vez es un caso que no optimizamos; gana el último guardado.
export function useBusinessInfo() {
  const [info, setInfo] = useState([]) // [{ clave, valor, categoria }]
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchInfo = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('info_negocio')
      .select('clave, valor, categoria')
      .order('clave', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setInfo(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchInfo() }, [fetchInfo])

  // Guarda solo las claves que cambiaron. `changes` = { clave: nuevoValor }.
  async function saveInfo(changes) {
    const entries = Object.entries(changes)
    if (entries.length === 0) return { error: null }

    const results = await Promise.all(
      entries.map(([clave, valor]) =>
        supabase.from('info_negocio').update({ valor: valor.trim() }).eq('clave', clave)
      )
    )

    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      console.error('Error guardando info_negocio:', failed.map(f => f.error))
      return { error: `No se pudieron guardar ${failed.length} de ${entries.length} campos. Intenta de nuevo.` }
    }

    await fetchInfo()
    return { error: null }
  }

  return { info, loading, error, saveInfo }
}
