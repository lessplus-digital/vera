import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/*
 * Conteo para el badge de Soporte del sidebar: clientes en modo 'humano'.
 *
 * Se refresca por dos vías (BUG-023):
 *  - cambios en `clientes` (escalada bot→humano, resolución humano→bot),
 *  - INSERTs en `mensajes_soporte`: toda escalada/resolución va acompañada de
 *    un mensaje, así el badge se actualiza aunque el evento de `clientes`
 *    se pierda (p. ej. socket sin JWT frente a RLS solo-authenticated).
 */
export function useSupportCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    async function getCount() {
      const { count: c, error } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true })
        .eq('modo', 'humano')
      if (!error && c !== null) setCount(c)
    }
    getCount()

    const channel = supabase
      .channel('support-badge-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => getCount())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_soporte' }, () => getCount())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  return count
}
