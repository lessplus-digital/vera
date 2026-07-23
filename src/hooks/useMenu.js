import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Catálogo completo de la tabla `menu` para la tab Menú. La tab NO crea, edita
// ni elimina productos — solo cambia `disponible` (lo que el bot ofrece o no:
// buscar_menu / buscar_menu_categoria filtran con solo_disponibles=true).
export function useMenu() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchMenu = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('menu')
      .select('producto_id, nombre, categoria, variante, descripcion, precio, disponible, tamaño')
      .order('categoria', { ascending: true })
      .order('nombre', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setProducts(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMenu() }, [fetchMenu])

  // Realtime: el menú casi solo cambia desde este dashboard, pero la suscripción
  // mantiene sincronizados varios dispositivos abiertos a la vez. `menu` está en
  // la publicación supabase_realtime desde la migración
  // menu_add_to_realtime_publication (2026-07-22).
  useEffect(() => {
    const channel = supabase
      .channel('menu-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, () => fetchMenu())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchMenu])

  // Update optimista: el switch responde al instante y se revierte si la BD falla.
  async function setDisponible(producto_id, disponible) {
    const prev = products
    setProducts(ps => ps.map(p => (p.producto_id === producto_id ? { ...p, disponible } : p)))

    const { error: updateError } = await supabase
      .from('menu')
      .update({ disponible })
      .eq('producto_id', producto_id)

    if (updateError) {
      console.error('Error actualizando disponibilidad:', updateError)
      setProducts(prev)
      return { error: 'No se pudo actualizar la disponibilidad. Intenta de nuevo.' }
    }
    return { error: null }
  }

  return { products, loading, error, setDisponible }
}
