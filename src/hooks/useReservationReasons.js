import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Motivos (ocasiones) por los que se reserva mesa, con su costo de montaje.
// Tabla `motivos_reserva` — la MISMA que lee el bot vía la tool
// `consultar_motivos_reserva`, para que los precios no se dupliquen en dos capas.
// El costo que se guarda en la reserva NO sale de aquí: lo escribe el trigger
// `trigger_costo_motivo` en la BD. Esta lista es solo para mostrar y elegir.
export function useReservationReasons() {
  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchReasons() {
      const { data, error: fetchError } = await supabase
        .from('motivos_reserva')
        .select('clave, nombre, descripcion, costo, orden')
        .eq('activo', true)
        .order('orden')

      if (cancelled) return

      if (fetchError) {
        console.error('Error cargando motivos de reserva:', fetchError)
        setError(fetchError.message)
      } else {
        setReasons(data || [])
        setError(null)
      }
      setLoading(false)
    }

    fetchReasons()
    return () => { cancelled = true }
  }, [])

  return { reasons, loading, error }
}
