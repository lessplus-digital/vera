import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

  async function createReservation({ nombre_cliente, telefono, fecha, hora, personas, estado, notas }) {
    // Si el teléfono pertenece a un cliente registrado, enlazar la reserva
    const { data: clientMatch } = await supabase
      .from('clientes')
      .select('cliente_id')
      .eq('telefono', telefono.trim())
      .maybeSingle()

    const reservation = {
      reserva_id:     `RSV-M${Date.now()}`,
      cliente_id:     clientMatch?.cliente_id || null,
      telefono:       telefono.trim(),
      nombre_cliente: nombre_cliente.trim(),
      fecha,
      hora,
      personas:       Number(personas),
      estado,
      origen:         'dashboard',
      notas:          notas.trim() || null,
      created_at:     new Date().toISOString(),
    }

    const { error: insertError } = await supabase.from('reservas').insert(reservation)

    if (insertError) {
      if (insertError.code === '23505') return { error: 'Ya existe una reserva con ese ID. Intenta de nuevo.' }
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
