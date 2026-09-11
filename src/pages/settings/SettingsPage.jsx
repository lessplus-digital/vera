import React, { useState } from 'react'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'
import BusinessInfoSection from './BusinessInfoSection'
import DeliveryZonesSection from './DeliveryZonesSection'
import FaqSection from './FaqSection'
import QuickRepliesSection from './QuickRepliesSection'

// Tab Configuración — lo que el restaurante administra por su cuenta, sin
// tocarnos a nosotros.
//
// Las cuatro vistas son la misma idea: lo que sale a los clientes vive en la BD
// (`info_negocio`, `zonas_entrega`+`barrios`, `faq`, `respuestas_rapidas`), no
// quemado en el prompt del agente ni en el código. De esas, las tres primeras
// alimentan al BOT; "Respuestas rápidas" no — es texto que escribe y envía una
// persona desde el chat de soporte.
//
// "Zonas de domicilio" es la única que además mueve DINERO: su tarifa entra en
// el total del pedido vía trigger. Por eso no es un campo de texto más dentro de
// "Información del negocio" (donde vivía antes como `zona_delivery`/
// `costo_delivery`, dos strings que el bot solo podía recitar).
//
// "Usuarios" vivía aquí y se fue a su propia tab (`src/pages/users/`): no
// configura texto que el bot recite, reparte accesos y cambia contraseñas.
// Escondida detrás de este sub-selector, la operación más delicada del panel
// era la más difícil de encontrar.
//
// Sub-vistas en vez de tabs del sidebar: así cada una conserva SU único botón
// primary (DS §3), que es la razón por la que no pueden convivir en una sola
// pantalla.
const VISTAS = [
  { id: 'negocio',    label: 'Información del negocio' },
  { id: 'zonas',      label: 'Zonas de domicilio' },
  { id: 'faq',        label: 'Preguntas frecuentes' },
  { id: 'respuestas', label: 'Respuestas rápidas' },
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

      {vista === 'negocio' && <BusinessInfoSection showToast={showToast} onIrA={setVista} />}
      {vista === 'zonas'   && <DeliveryZonesSection showToast={showToast} />}
      {vista === 'faq'     && <FaqSection showToast={showToast} />}
      {vista === 'respuestas' && <QuickRepliesSection showToast={showToast} />}

      <Toast toast={toast} />
    </div>
  )
}
