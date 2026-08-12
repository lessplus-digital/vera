import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Domiciliarios activos, para el selector de asignación del kanban.
//
// Solo devuelve algo para un admin: la política `perfiles_select` deja que
// mesero y domiciliario vean únicamente SU propia fila. No es un caso de error
// —la lista simplemente llega vacía— y por eso el selector se monta solo cuando
// el rol puede asignar (`puede(rol, 'asignarDomiciliario')`).
export function useDomiciliarios() {
  const [domiciliarios, setDomiciliarios] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchDomiciliarios = useCallback(async () => {
    const { data, error } = await supabase
      .from('perfiles')
      .select('usuario_id, nombre, telefono, avatar_url')
      .eq('rol', 'domiciliario')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    if (error) {
      console.error('Error cargando domiciliarios:', error)
      setDomiciliarios([])
    } else {
      setDomiciliarios(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchDomiciliarios() }, [fetchDomiciliarios])

  return { domiciliarios, loading, refetch: fetchDomiciliarios }
}

// Asigna (o desasigna, con `null`) un domiciliario a un pedido.
//
// La validación de verdad está en la BD: `trigger_validar_asignacion` rechaza
// asignar a alguien que no sea domiciliario activo, o a un pedido que no sea a
// domicilio. Aquí solo se traduce ese error a algo legible.
export async function asignarDomiciliario(pedidoId, domiciliarioId) {
  const { error } = await supabase
    .from('pedidos')
    .update({ domiciliario_id: domiciliarioId })
    .eq('pedido_id', pedidoId)

  if (!error) return { error: null }

  console.error('Error asignando domiciliario:', error)

  const detalle = `${error.message || ''} ${error.details || ''}`
  if (detalle.includes('no es un domiciliario activo')) {
    return { error: 'Ese usuario ya no es un domiciliario activo. Recarga la lista.' }
  }
  if (detalle.includes('pedido a domicilio')) {
    return { error: 'Solo se puede asignar domiciliario a un pedido a domicilio.' }
  }
  return { error: 'No se pudo asignar el domiciliario. Intenta de nuevo.' }
}
