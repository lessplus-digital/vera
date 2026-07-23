import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Tope de clientes traídos a memoria (búsqueda/paginación son client-side). Es explícito
// para no depender del límite por defecto de PostgREST (que puede capar en silencio); si se
// alcanza, es la señal de migrar a búsqueda/paginación server-side.
const CLIENTS_FETCH_CAP = 5000

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchClients = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('clientes')
      .select('cliente_id, nombre, telefono, direccion_principal, modo, fecha_registro')
      .order('nombre', { ascending: true })
      .limit(CLIENTS_FETCH_CAP)

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setClients(data || [])
      setError(null)
      if (data && data.length >= CLIENTS_FETCH_CAP) {
        console.warn(`useClients: se alcanzó el tope de ${CLIENTS_FETCH_CAP} clientes en memoria; es momento de pasar a búsqueda/paginación server-side.`)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])

  // Realtime: escuchamos TODOS los eventos para que también aparezcan los clientes
  // nuevos que crea el bot (INSERT), no solo los cambios de modo/datos (UPDATE).
  // Requiere que la tabla `clientes` esté en la publicación `supabase_realtime`
  // (ver BUG-014 en docs/shared/bug-tracker.md).
  useEffect(() => {
    const channel = supabase
      .channel('clientes-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => fetchClients())
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

  async function deleteClient(cliente_id) {
    const { error: deleteError } = await supabase
      .from('clientes')
      .delete()
      .eq('cliente_id', cliente_id)

    if (deleteError) {
      // 23503 = viola FK: pedidos/reservas/feedback apuntan a este cliente (sin cascade, a propósito:
      // el historial de ventas no se borra junto con el cliente).
      if (deleteError.code === '23503') {
        return { error: 'No se puede eliminar: el cliente tiene pedidos, reservas o feedback asociados.' }
      }
      console.error('Error eliminando cliente:', deleteError)
      return { error: 'Error al eliminar el cliente. Intenta de nuevo.' }
    }

    await fetchClients()
    return { error: null }
  }

  return { clients, loading, error, saveClient, deleteClient }
}
