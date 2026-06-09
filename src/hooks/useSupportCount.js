import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
      .channel('clientes-modo-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => getCount())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  return count
}
