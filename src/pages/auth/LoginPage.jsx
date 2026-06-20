import React, { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Icon from '../../components/Icon'

/* Traduce los mensajes de error de Supabase Auth al español. */
function traducirError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.'
  if (m.includes('email not confirmed'))       return 'Tu correo aún no ha sido confirmado.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera un momento.'
  if (m.includes('network') || m.includes('fetch')) return 'Sin conexión con el servidor. Revisa tu internet.'
  return 'No pudimos iniciar sesión. Inténtalo de nuevo.'
}

export default function LoginPage({ theme, onToggleTheme }) {
  const { signIn } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    if (error) {
      setError(traducirError(error.message))
      setBusy(false)
    }
    // En éxito, onAuthStateChange desmonta esta pantalla — no tocamos busy.
  }

  return (
    <div className="login-screen">
      <button
        className="login-theme"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        aria-label="Cambiar tema"
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>

      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="login-logo"><Icon name="pizza" size={24} /></span>
          <div className="login-brand-text">
            <span className="login-brand-name">Vera Pizzería</span>
            <span className="login-brand-tag">Panel de administración</span>
          </div>
        </div>

        <h1 className="login-title">Inicia sesión</h1>
        <p className="login-sub">Ingresa con tu cuenta para gestionar el negocio.</p>

        <label className="login-field">
          <span>Correo</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="login-field">
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        {error && (
          <div className="login-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="login-submit" disabled={busy || !email || !password}>
          {busy ? 'Ingresando…' : 'Iniciar sesión'}
        </button>

        <div className="login-foot">
          <Icon name="lock" size={12} />
          <span>Conexión segura · Vera Pizzería</span>
        </div>
      </form>
    </div>
  )
}
