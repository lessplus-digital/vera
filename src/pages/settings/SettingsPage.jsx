import React, { useState, useMemo, useEffect } from 'react'
import { useBusinessInfo } from '../../hooks/useBusinessInfo'
import Icon from '../../components/Icon'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

// Registro de campos conocidos de `info_negocio`: orden, agrupación y textos de la
// UI. Las claves que existan en la BD y no estén aquí caen en la sección "Otros"
// (render genérico) para que nada quede invisible ni se pierda al guardar.
const SECTIONS = [
  {
    id: 'identidad',
    title: 'Identidad',
    icon: 'pizza',
    fields: [
      { clave: 'nombre_negocio', label: 'Nombre del negocio', help: 'Así se presenta el bot ante los clientes.' },
      { clave: 'slogan', label: 'Eslogan' },
      { clave: 'descripcion_general', label: 'Descripción general', multiline: true },
    ],
  },
  {
    id: 'contacto',
    title: 'Contacto y ubicación',
    icon: 'pin',
    fields: [
      { clave: 'direccion', label: 'Dirección', help: 'La sede única del negocio, como la dicta el bot.' },
      { clave: 'telefono_principal', label: 'Teléfono principal' },
      { clave: 'whatsapp', label: 'WhatsApp' },
      { clave: 'instagram', label: 'Instagram', placeholder: '@verapizzeria' },
      { clave: 'link_menu', label: 'Link al menú', help: 'URL pública del menú (Drive, PDF, página web).', placeholder: 'https://…' },
    ],
  },
  {
    id: 'horarios',
    title: 'Horarios',
    icon: 'clock',
    fields: [
      { clave: 'horario_semana', label: 'Entre semana', placeholder: 'Lunes a Viernes 11:00am - 10:00pm' },
      { clave: 'horario_finsemana', label: 'Fin de semana', placeholder: 'Sábados y Domingos 12:00pm - 11:00pm' },
      { clave: 'horario_feriados', label: 'Feriados' },
    ],
  },
  {
    id: 'operacion',
    title: 'Operación y domicilios',
    icon: 'scooter',
    fields: [
      { clave: 'metodos_pago', label: 'Métodos de pago' },
      { clave: 'datos_transferencia', label: 'Datos de transferencia', multiline: true, help: 'Banco, número de cuenta y titular para pagos por transferencia.' },
      { clave: 'zona_delivery', label: 'Zona de domicilios' },
      { clave: 'costo_delivery', label: 'Costo del domicilio' },
      { clave: 'tiempo_entrega_delivery', label: 'Tiempo de entrega' },
      { clave: 'politica_cancelacion', label: 'Política de cancelación', multiline: true },
    ],
  },
]

const KNOWN_KEYS = new Set(SECTIONS.flatMap(s => s.fields.map(f => f.clave)))
const SECTION_BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]))

// Reparto en dos stacks balanceados por altura (DS §7): izquierda quién es y dónde
// está, derecha cuándo abre y cómo opera. "Otros" cae en la izquierda (la más corta).
const COLUMN_LAYOUT = [
  ['identidad', 'contacto'],
  ['horarios', 'operacion'],
]

const humanize = clave => {
  const txt = String(clave).replace(/_/g, ' ')
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

export default function SettingsPage() {
  const { info, loading, error, saveInfo } = useBusinessInfo()
  const [draft, setDraft] = useState(null) // { clave: valor } — null hasta cargar
  const [saving, setSaving] = useState(false)
  const { toast, showToast } = useToast()

  // Valores originales por clave (para calcular qué cambió).
  const original = useMemo(() => {
    const map = {}
    for (const row of info) map[row.clave] = row.valor ?? ''
    return map
  }, [info])

  // Inicializa el borrador cuando llega la data (y lo re-sincroniza tras guardar,
  // cuando ya no hay cambios pendientes).
  useEffect(() => {
    if (!loading) setDraft(d => (d === null ? { ...original } : d))
  }, [loading, original])

  const changes = useMemo(() => {
    if (!draft) return {}
    const diff = {}
    for (const [clave, valor] of Object.entries(draft)) {
      if ((valor ?? '').trim() !== (original[clave] ?? '').trim()) diff[clave] = valor
    }
    return diff
  }, [draft, original])

  const dirtyCount = Object.keys(changes).length

  // Claves de la BD que no están en el registro → sección genérica "Otros".
  const extraFields = useMemo(
    () => info.filter(row => !KNOWN_KEYS.has(row.clave)).map(row => ({ clave: row.clave, label: humanize(row.clave) })),
    [info]
  )

  function setValue(clave, valor) {
    setDraft(d => ({ ...d, [clave]: valor }))
  }

  function discard() {
    setDraft({ ...original })
  }

  async function handleSave() {
    if (dirtyCount === 0 || saving) return
    setSaving(true)
    const { error: saveError } = await saveInfo(changes)
    setSaving(false)
    if (saveError) {
      showToast('error', saveError)
    } else {
      setDraft(null) // se re-sincroniza desde la BD en el useEffect
      showToast('success', '✓ Configuración guardada — el bot ya responde con los nuevos datos')
    }
  }

  function renderSection(section) {
    const fields = section.fields.filter(f => draft?.[f.clave] !== undefined)
    if (fields.length === 0) return null
    return (
      <div className="settings-card" key={section.id}>
        <div className="settings-card-head">
          <span className="settings-card-icon"><Icon name={section.icon} size={15} /></span>
          {section.title}
        </div>
        <div className="settings-card-body">
          {fields.map(renderField)}
        </div>
      </div>
    )
  }

  function renderField(field) {
    const value = draft?.[field.clave]
    if (value === undefined) return null // la clave no existe en la BD
    return (
      <label className="field" key={field.clave}>
        <span className="field-label">{field.label}</span>
        {field.multiline ? (
          <textarea
            rows={3}
            value={value}
            onChange={e => setValue(field.clave, e.target.value)}
            placeholder={field.placeholder || ''}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={e => setValue(field.clave, e.target.value)}
            placeholder={field.placeholder || ''}
          />
        )}
        {field.help && <span className="field-help">{field.help}</span>}
      </label>
    )
  }

  return (
    <div className="settings-page">

      <div className="settings-toolbar">
        <div className="settings-intro">
          <div className="settings-title">Información del negocio</div>
          <div className="settings-sub">
            Estos datos los usa el bot para responder por WhatsApp (horarios, dirección,
            pagos…). Los cambios aplican apenas guardes.
          </div>
        </div>

        <div className="settings-actions">
          {dirtyCount > 0 && (
            <>
              <span className="settings-dirty">
                {dirtyCount} {dirtyCount === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
              </span>
              <button className="btn ghost" onClick={discard} disabled={saving}>
                Descartar
              </button>
            </>
          )}
          <button className="btn primary" onClick={handleSave} disabled={dirtyCount === 0 || saving}>
            {saving ? 'Guardando…' : <><Icon name="check" size={14} /> Guardar cambios</>}
          </button>
        </div>
      </div>

      {error && <div className="settings-error">Error cargando la configuración: {error}</div>}

      {loading || draft === null ? (
        <div className="loading-state"><div className="spinner" />Cargando configuración…</div>
      ) : (
        <div className="settings-grid">
          {COLUMN_LAYOUT.map((colIds, i) => (
            <div className="settings-col" key={i}>
              {colIds.map(id => renderSection(SECTION_BY_ID[id]))}

              {i === 0 && extraFields.length > 0 && (
                <div className="settings-card">
                  <div className="settings-card-head">
                    <span className="settings-card-icon"><Icon name="note" size={15} /></span>
                    Otros
                  </div>
                  <div className="settings-card-body">
                    {extraFields.map(renderField)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
