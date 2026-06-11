import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchClients = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setClients(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])

  // Realtime: la tabla clientes solo publica UPDATE (cambios de modo/datos)
  useEffect(() => {
    const channel = supabase
      .channel('clientes-page-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clientes' }, () => fetchClients())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchClients])

  async function saveClient({ cliente_id, nombre, telefono, direccion, modo }) {
    const payload = {
      nombre:              nombre.trim(),
      telefono:            telefono.trim(),
      direccion_principal: direccion.trim() || null,
      modo,
    }

    const { error: saveError } = cliente_id
      ? await supabase.from('clientes').update(payload).eq('cliente_id', cliente_id)
      : await supabase.from('clientes').insert({ ...payload, fecha_registro: new Date().toISOString() })

    if (saveError) {
      if (saveError.code === '23505') return { error: 'Ya existe un cliente con ese teléfono.' }
      console.error('Error guardando cliente:', saveError)
      return { error: 'Error al guardar el cliente. Intenta de nuevo.' }
    }

    await fetchClients()
    return { error: null }
  }

  return { clients, loading, error, saveClient }
}
