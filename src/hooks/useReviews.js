import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Reseñas de la tab Reseñas. La tabla `feedback` la escribe el bot
// (workflow n8n "Sub — Feedback Pendiente"): tras un pedido entregado pide
// una nota 1–5 y, SOLO si la nota es ≤3, pide además un comentario (las de
// 4–5 se invitan a dejar reseña en Google). Por eso los comentarios que
// llegan aquí son casi siempre negativos/neutros → esta tab es la cola de
// clientes a recuperar, no un muro de elogios.
//
// Una fila por pedido (feedback.pedido_id es UNIQUE). Se cargan todas y se
// filtran/agregan en cliente: el volumen es acotado (subconjunto de pedidos
// que calificaron), no crece como `pedidos`. Si algún día se acerca al límite,
// migrar a server-side como el Historial.
const SELECT = `
  feedback_id, cliente_id, pedido_id, fecha, calificacion_general, comentario, resuelta_at,
  clientes ( nombre, telefono ),
  pedidos ( total, tipo_pedido )
`

function normalize(row) {
  return {
    feedback_id: row.feedback_id,
    pedido_id:   row.pedido_id,
    cliente_id:  row.cliente_id,
    fecha:       row.fecha,
    nota:        row.calificacion_general,
    comentario:  row.comentario,
    resueltaAt:  row.resuelta_at,
    nombre:      row.clientes?.nombre || null,
    telefono:    row.clientes?.telefono || null,
    total:       row.pedidos?.total ?? null,
    tipo_pedido: row.pedidos?.tipo_pedido || null,
  }
}

export function useReviews() {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchReviews = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('feedback')
      .select(SELECT)
      .order('fecha', { ascending: false })
      .limit(2000)

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setReviews((data || []).map(normalize))
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  // Realtime: una reseña nueva (la deja el bot al cerrar el pedido) aparece
  // sin recargar. `feedback` está en la publicación supabase_realtime desde la
  // migración feedback_add_to_realtime_publication (2026-07-23).
  useEffect(() => {
    const channel = supabase
      .channel('feedback-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => fetchReviews())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchReviews])

  // Handoff: pone al cliente en modo 'humano' para que su conversación pase a
  // la tab Soporte (el bot deja de responderle). Reversible: al resolver en
  // Soporte vuelve a 'bot' (useSupportConversations). Mismo mecanismo que el
  // handoff del bot; no altera la ventana de 24h de Meta (eso lo maneja el envío).
  async function handoffToSupport(cliente_id) {
    if (!cliente_id) return { error: 'La reseña no tiene cliente asociado.' }
    const { error: updateError } = await supabase
      .from('clientes')
      .update({ modo: 'humano' })
      .eq('cliente_id', cliente_id)
    if (updateError) {
      console.error('Error en handoff a soporte:', updateError)
      return { error: 'No se pudo pasar el cliente a Soporte. Intenta de nuevo.' }
    }
    return { error: null }
  }

  // Marca la reseña como resuelta (se contactó al cliente). A partir de ahí ya
  // no se puede volver a responder. El realtime refresca la tarjeta.
  async function marcarResuelta(feedback_id) {
    if (!feedback_id) return { error: 'Reseña inválida.' }
    const { error: updateError } = await supabase
      .from('feedback')
      .update({ resuelta_at: new Date().toISOString() })
      .eq('feedback_id', feedback_id)
    if (updateError) {
      console.error('Error marcando reseña como resuelta:', updateError)
      return { error: 'No se pudo marcar la reseña como resuelta.' }
    }
    return { error: null }
  }

  return { reviews, loading, error, refetch: fetchReviews, handoffToSupport, marcarResuelta }
}
