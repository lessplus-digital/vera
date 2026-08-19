import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const COLUMNS = 'faq_id, pregunta, respuesta, activa, orden'

// Preguntas frecuentes del negocio (tabla `faq`). Es la MISMA tabla que lee el
// bot vía la tool `consultar_faq`, igual que `motivos_reserva`: lo que se
// escriba aquí es lo que el Agente Soporte responde por WhatsApp.
//
// Sin realtime a propósito (mismo criterio que `useBusinessInfo`): el único
// escritor es este dashboard y las mutaciones ya refrescan la lista. Un evento
// entrante mientras el admin reordena solo causaría saltos visuales.
export function useFaq() {
  const [faqs, setFaqs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchFaqs = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('faq')
      .select(COLUMNS)
      .order('orden', { ascending: true })
      .order('faq_id', { ascending: true })

    if (fetchError) {
      console.error('Error cargando FAQ:', fetchError)
      setError(fetchError.message)
    } else {
      setFaqs(data || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchFaqs() }, [fetchFaqs])

  // Nueva pregunta: entra al final de la lista.
  async function createFaq({ pregunta, respuesta, activa = true }) {
    const orden = faqs.length ? Math.max(...faqs.map(f => f.orden)) + 1 : 0

    const { error: insertError } = await supabase
      .from('faq')
      .insert({ pregunta, respuesta, activa, orden })

    if (insertError) {
      console.error('Error creando FAQ:', insertError)
      return { error: mensajeDeError(insertError) }
    }
    await fetchFaqs()
    return { error: null }
  }

  async function updateFaq(faq_id, patch) {
    const { error: updateError } = await supabase
      .from('faq')
      .update(patch)
      .eq('faq_id', faq_id)

    if (updateError) {
      console.error('Error actualizando FAQ:', updateError)
      return { error: mensajeDeError(updateError) }
    }
    await fetchFaqs()
    return { error: null }
  }

  async function deleteFaq(faq_id) {
    const { error: deleteError } = await supabase.from('faq').delete().eq('faq_id', faq_id)

    if (deleteError) {
      console.error('Error eliminando FAQ:', deleteError)
      return { error: 'No se pudo eliminar la pregunta. Intenta de nuevo.' }
    }
    await fetchFaqs()
    return { error: null }
  }

  // Update optimista (mismo patrón que el switch de disponibilidad del menú):
  // el toggle responde al instante y se revierte si la BD falla.
  async function setActiva(faq_id, activa) {
    const prev = faqs
    setFaqs(fs => fs.map(f => (f.faq_id === faq_id ? { ...f, activa } : f)))

    const { error: updateError } = await supabase
      .from('faq')
      .update({ activa })
      .eq('faq_id', faq_id)

    if (updateError) {
      console.error('Error actualizando FAQ:', updateError)
      setFaqs(prev)
      return { error: 'No se pudo cambiar el estado de la pregunta. Intenta de nuevo.' }
    }
    return { error: null }
  }

  // Mueve una pregunta una posición (dir = -1 arriba, +1 abajo) y renumera
  // `orden` como 0..n-1. Renumerar todo (en vez de intercambiar dos valores)
  // deja la lista consistente aunque la BD traiga órdenes repetidos o con
  // huecos — que es el estado normal tras varios borrados.
  async function moveFaq(faq_id, dir) {
    const idx = faqs.findIndex(f => f.faq_id === faq_id)
    const target = idx + dir
    if (idx === -1 || target < 0 || target >= faqs.length) return { error: null }

    const reordered = [...faqs]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]

    const renumbered = reordered.map((f, i) => ({ ...f, orden: i }))
    const changed = renumbered.filter(f => {
      const before = faqs.find(o => o.faq_id === f.faq_id)
      return before && before.orden !== f.orden
    })

    const prev = faqs
    setFaqs(renumbered)

    const results = await Promise.all(
      changed.map(f => supabase.from('faq').update({ orden: f.orden }).eq('faq_id', f.faq_id))
    )

    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      console.error('Error reordenando FAQ:', failed.map(f => f.error))
      setFaqs(prev)
      return { error: 'No se pudo guardar el nuevo orden. Intenta de nuevo.' }
    }
    return { error: null }
  }

  return { faqs, loading, error, createFaq, updateFaq, deleteFaq, setActiva, moveFaq, refetch: fetchFaqs }
}

// Los CHECK de la tabla (longitud de pregunta/respuesta) son la última línea de
// defensa: el formulario ya valida lo mismo antes de enviar. Si aun así rebota,
// traducimos el error de Postgres en vez de mostrar el mensaje crudo.
function mensajeDeError(err) {
  const detalle = `${err?.message || ''} ${err?.details || ''}`
  if (detalle.includes('faq_pregunta_len')) {
    return 'La pregunta debe tener entre 3 y 200 caracteres.'
  }
  if (detalle.includes('faq_respuesta_len')) {
    return 'La respuesta debe tener entre 3 y 600 caracteres.'
  }
  return 'No se pudo guardar la pregunta. Intenta de nuevo.'
}
