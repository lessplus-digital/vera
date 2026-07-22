import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { sendWhatsAppMessage } from '../lib/whatsapp'
import {
  SUPPORT_TABLES,
  SUPPORT_CHANNELS,
  RESOLVE_MESSAGE,
  RESOLVE_WA_TEXT,
} from '../utils/constants'

export function useSupportConversations() {
  const [conversations,    setConversations]    = useState([])
  const [selectedPhone,    setSelectedPhone]    = useState(null)
  const [messages,         setMessages]         = useState([])
  const [loadingConvos,    setLoadingConvos]    = useState(true)
  const [loadingMessages,  setLoadingMessages]  = useState(false)
  const [sending,          setSending]          = useState(false)
  const [resolving,        setResolving]        = useState(false)
  const [error,            setError]            = useState(null)

  const fetchConversations = useCallback(async () => {
    const { data, error } = await supabase.from(SUPPORT_TABLES.conversations).select('*')
    if (!error && data) setConversations(data)
    setLoadingConvos(false)
  }, [])

  const fetchMessages = useCallback(async (telefono) => {
    if (!telefono) return
    setLoadingMessages(true)
    const { data, error } = await supabase
      .from(SUPPORT_TABLES.messages)
      .select('*')
      .eq('telefono', telefono)
      .order('created_at', { ascending: true })
    if (!error && data) setMessages(data)
    setLoadingMessages(false)
  }, [])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  // Suscripción a mensajes nuevos
  useEffect(() => {
    const channel = supabase
      .channel(SUPPORT_CHANNELS.messages)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: SUPPORT_TABLES.messages }, (payload) => {
        const msg = payload.new
        if (msg.telefono === selectedPhone) setMessages(prev => [...prev, msg])
        fetchConversations()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [selectedPhone, fetchConversations])

  // Suscripción a cambios en clientes (modo bot/humano)
  useEffect(() => {
    const channel = supabase
      .channel(SUPPORT_CHANNELS.clients)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: SUPPORT_TABLES.clients }, () => fetchConversations())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchConversations])

  function selectConversation(telefono) {
    setError(null)
    setSelectedPhone(telefono)
    fetchMessages(telefono)
  }

  async function sendMessage(text) {
    if (!text || !selectedPhone || sending) return

    setSending(true)
    setError(null)

    const { error: dbError } = await supabase
      .from(SUPPORT_TABLES.messages)
      .insert({ telefono: selectedPhone, origen: 'admin', mensaje: text })

    if (dbError) {
      setSending(false)
      setError('No se pudo guardar el mensaje. Intenta de nuevo.')
      return
    }

    try {
      await sendWhatsAppMessage(selectedPhone, text)
    } catch (err) {
      setError(`Mensaje guardado, pero no se pudo enviar por WhatsApp: ${err.message}`)
    }

    setSending(false)
  }

  async function resolveConversation() {
    if (!selectedPhone || resolving) return
    setResolving(true)

    await supabase.from(SUPPORT_TABLES.messages).insert({
      telefono: selectedPhone,
      origen: 'sistema',
      mensaje: RESOLVE_MESSAGE,
    })

    await supabase
      .from(SUPPORT_TABLES.clients)
      .update({ modo: 'bot' })
      .eq('telefono', selectedPhone)

    try {
      await sendWhatsAppMessage(selectedPhone, RESOLVE_WA_TEXT)
    } catch (_) { /* no bloquear el flujo */ }

    setResolving(false)
    setSelectedPhone(null)
    setMessages([])
    fetchConversations()
  }

  const selectedConvo = conversations.find(c => c.telefono === selectedPhone)

  return {
    conversations,
    selectedPhone,
    selectedConvo,
    messages,
    loadingConvos,
    loadingMessages,
    sending,
    resolving,
    error,
    dismissError: () => setError(null),
    selectConversation,
    sendMessage,
    resolveConversation,
  }
}
