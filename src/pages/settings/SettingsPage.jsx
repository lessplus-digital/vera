import React, { useState } from 'react'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'
import BusinessInfoSection from './BusinessInfoSection'
import FaqSection from './FaqSection'
import QuickRepliesSection from './QuickRepliesSection'
import UsersSection from './UsersSection'

// Tab Configuración — lo que el restaurante administra por su cuenta, sin
// tocarnos a nosotros.
//
// Las tres primeras vistas son la misma idea: el texto que sale a los clientes
// vive en la BD (`info_negocio`, `faq`, `respuestas_rapidas`), no quemado en el
// prompt del agente ni en el código. De esas, las dos primeras alimentan al
// BOT; "Respuestas rápidas" no — es texto que escribe y envía una persona desde
// el chat de soporte.
//
// "Usuarios" no configura texto: reparte permisos. Va aquí igualmente porque
// para el restaurante la tab es "lo que administro yo", y la pantalla solo
// existe de hecho para el admin (ni la RLS de `perfiles` ni el RPC
// `listar_usuarios` le devuelven nada a nadie más).
//
// Sub-vistas en vez de tabs del sidebar: así cada una conserva SU único botón
// primary (DS §3), que es la razón por la que no pueden convivir en una sola
// pantalla.
const VISTAS = [
  { id: 'negocio',    label: 'Información del negocio' },
  { id: 'faq',        label: 'Preguntas frecuentes' },
  { id: 'respuestas', label: 'Respuestas rápidas' },
  { id: 'usuarios',   label: 'Usuarios' },
]

export default function SettingsPage() {
  const [vista, setVista] = useState('negocio')
  const { toast, showToast } = useToast()

  return (
    <div className="settings-page">

      <div className="settings-segmented">
        {VISTAS.map(v => (
          <button
            key={v.id}
            className={`settings-seg${vista === v.id ? ' active' : ''}`}
            onClick={() => setVista(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vista === 'negocio' && <BusinessInfoSection showToast={showToast} />}
      {vista === 'faq'     && <FaqSection showToast={showToast} />}
      {vista === 'respuestas' && <QuickRepliesSection showToast={showToast} />}
      {vista === 'usuarios'   && <UsersSection showToast={showToast} />}

      <Toast toast={toast} />
    </div>
  )
}
