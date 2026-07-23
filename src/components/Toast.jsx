import React from 'react'

// Presentación del toast global (estado vía useToast en src/hooks/useToast.js).
export default function Toast({ toast }) {
  if (!toast) return null
  return <div className={`toast ${toast.type}`}>{toast.text}</div>
}
