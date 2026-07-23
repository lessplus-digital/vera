import { useState, useRef, useEffect, useCallback } from 'react'

const TOAST_MS = 4500

// Toast del design system (patrón global .toast en index.css): feedback de
// acciones success/warn/error, abajo a la derecha, auto-dismiss 4.5s.
// Uso: const { toast, showToast } = useToast() + <Toast toast={toast} /> al final de la página.
export function useToast() {
  const [toast, setToast] = useState(null) // null | { type, text }
  const timer = useRef(null)

  const showToast = useCallback((type, text) => {
    clearTimeout(timer.current)
    setToast({ type, text })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  // Evita el setState sobre componente desmontado si se cambia de tab con el toast visible.
  useEffect(() => () => clearTimeout(timer.current), [])

  return { toast, showToast }
}
