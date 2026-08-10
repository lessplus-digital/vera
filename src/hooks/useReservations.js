import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { MOTIVO_DEFECTO } from '../utils/constants'

export function useReservations() {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchReservations = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('reservas')
      .select('*')
      .order('fecha', { ascending: true })
      .order('hora',  { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setReservations(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  // Realtime: el bot también crea reservas por WhatsApp
  useEffect(() => {
    const channel = supabase
      .channel('reservas-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => fetchReservations())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchReservations])

  async function createReservation({ cliente_id, nombre_cliente, telefono, fecha, hora, personas, estado, motivo, notas }) {
    // `reserva_id` lo genera la BD por default (`generar_reserva_id()`); no lo enviamos
    // para evitar colisiones. Leemos la fila de vuelta para tener el id real generado.
    // `costo_motivo` tampoco se envía: lo escribe el trigger `trigger_costo_motivo`
    // desde `motivos_reserva`, así que el precio nunca depende del frontend.
    const { data: reservation, error: insertError } = await supabase
      .from('reservas')
      .insert({
        cliente_id,
        telefono,
        nombre_cliente,
        fecha,
        hora,
        personas:   Number(personas),
        estado,
        origen:     'dashboard',
        motivo:     motivo || MOTIVO_DEFECTO,
        notas:      notas.trim() || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creando reserva:', insertError)
      return { error: 'Error al crear la reserva. Intenta de nuevo.' }
    }

    await fetchReservations()
    return { error: null, reservation }
  }

  async function deleteReservation(reserva_id) {
    const { error: deleteError } = await supabase
      .from('reservas')
      .delete()
      .eq('reserva_id', reserva_id)

    if (deleteError) {
      console.error('Error eliminando reserva:', deleteError)
      return { error: 'Error al eliminar la reserva. Intenta de nuevo.' }
    }

    await fetchReservations()
    return { error: null }
  }

  return { reservations, loading, error, createReservation, deleteReservation }
}
