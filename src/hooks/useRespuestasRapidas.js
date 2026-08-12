import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const COLUMNS = 'respuesta_id, atajo, texto, activa, orden'

// Respuestas rápidas del chat de soporte (tabla `respuestas_rapidas`).
//
// Diferencia clave con `useFaq`, aunque el CRUD sea idéntico: esto NO lo lee el
// bot. Es texto enlatado que el admin inserta en el input de soporte y edita
// antes de enviar, así que no pasa por `faqLint` — nunca entra al contexto de un
// agente. Lo único que se valida es longitud y que el atajo no se repita.
//
// Sin realtime a propósito (mismo criterio que `useFaq`/`useBusinessInfo`): el
// único escritor es este dashboard y las mutaciones ya refrescan la lista.
export function useRespuestasRapidas() {
  const [respuestas, setRespuestas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchRespuestas = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('respuestas_rapidas')
      .select(COLUMNS)
      .order('orden', { ascending: true })
      .order('respuesta_id', { ascending: true })

    if (fetchError) {
      console.error('Error cargando respuestas rápidas:', fetchError)
      setError(fetchError.message)
    } else {
      setRespuestas(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRespuestas() }, [fetchRespuestas])

  // Nueva respuesta: entra al final de la lista.
  async function createRespuesta({ atajo, texto, activa = true }) {
    const orden = respuestas.length ? Math.max(...respuestas.map(r => r.orden)) + 1 : 0

    const { error: insertError } = await supabase
      .from('respuestas_rapidas')
      .insert({ atajo, texto, activa, orden })

    if (insertError) {
      console.error('Error creando respuesta rápida:', insertError)
      return { error: mensajeDeError(insertError) }
    }
    await fetchRespuestas()
    return { error: null }
  }

  async function updateRespuesta(respuesta_id, patch) {
    const { error: updateError } = await supabase
      .from('respuestas_rapidas')
      .update(patch)
      .eq('respuesta_id', respuesta_id)

    if (updateError) {
      console.error('Error actualizando respuesta rápida:', updateError)
      return { error: mensajeDeError(updateError) }
    }
    await fetchRespuestas()
    return { error: null }
  }

  async function deleteRespuesta(respuesta_id) {
    const { error: deleteError } = await supabase
      .from('respuestas_rapidas')
      .delete()
      .eq('respuesta_id', respuesta_id)

    if (deleteError) {
      console.error('Error eliminando respuesta rápida:', deleteError)
      return { error: 'No se pudo eliminar la respuesta. Intenta de nuevo.' }
    }
    await fetchRespuestas()
    return { error: null }
  }

  // Update optimista: el toggle responde al instante y se revierte si la BD falla.
  async function setActiva(respuesta_id, activa) {
    const prev = respuestas
    setRespuestas(rs => rs.map(r => (r.respuesta_id === respuesta_id ? { ...r, activa } : r)))

    const { error: updateError } = await supabase
      .from('respuestas_rapidas')
      .update({ activa })
      .eq('respuesta_id', respuesta_id)

    if (updateError) {
      console.error('Error actualizando respuesta rápida:', updateError)
      setRespuestas(prev)
      return { error: 'No se pudo cambiar el estado de la respuesta. Intenta de nuevo.' }
    }
    return { error: null }
  }

  // Mueve una respuesta una posición (dir = -1 arriba, +1 abajo) y renumera
  // `orden` como 0..n-1. Renumerar todo (en vez de intercambiar dos valores)
  // deja la lista consistente aunque la BD traiga órdenes repetidos o con
  // huecos — que es el estado normal tras varios borrados.
  async function moveRespuesta(respuesta_id, dir) {
    const idx = respuestas.findIndex(r => r.respuesta_id === respuesta_id)
    const target = idx + dir
    if (idx === -1 || target < 0 || target >= respuestas.length) return { error: null }

    const reordered = [...respuestas]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]

    const renumbered = reordered.map((r, i) => ({ ...r, orden: i }))
    const changed = renumbered.filter(r => {
      const before = respuestas.find(o => o.respuesta_id === r.respuesta_id)
      return before && before.orden !== r.orden
    })

    const prev = respuestas
    setRespuestas(renumbered)

    const results = await Promise.all(
      changed.map(r =>
        supabase.from('respuestas_rapidas').update({ orden: r.orden }).eq('respuesta_id', r.respuesta_id)
      )
    )

    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      console.error('Error reordenando respuestas rápidas:', failed.map(f => f.error))
      setRespuestas(prev)
      return { error: 'No se pudo guardar el nuevo orden. Intenta de nuevo.' }
    }
    return { error: null }
  }

  return {
    respuestas,
    loading,
    error,
    createRespuesta,
    updateRespuesta,
    deleteRespuesta,
    setActiva,
    moveRespuesta,
    refetch: fetchRespuestas,
  }
}

// Los CHECK y el índice único de la tabla son la última línea de defensa: el
// formulario ya valida lo mismo antes de enviar. Si aun así rebota, traducimos
// el error de Postgres en vez de mostrar el mensaje crudo.
function mensajeDeError(err) {
  const detalle = `${err?.message || ''} ${err?.details || ''}`
  if (detalle.includes('respuestas_rapidas_atajo_uniq')) {
    return 'Ya existe una respuesta con ese nombre. Usa otro para distinguirlas en el chat.'
  }
  if (detalle.includes('respuestas_rapidas_atajo_len')) {
    return 'El nombre debe tener entre 2 y 30 caracteres.'
  }
  if (detalle.includes('respuestas_rapidas_texto_len')) {
    return 'El mensaje debe tener entre 3 y 600 caracteres.'
  }
  return 'No se pudo guardar la respuesta. Intenta de nuevo.'
}
