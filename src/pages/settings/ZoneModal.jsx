import React, { useState } from 'react'
import Icon from '../../components/Icon'

// Alta/edición de una zona de domicilio. `zona = null` → crear.
//
// La zona base (`es_base`) es la tarifa comodín: la que se cobra cuando el
// barrio del cliente todavía no está en el catálogo. La BD impide borrarla o
// desactivarla (`proteger_zona_base`), así que aquí ni se ofrece.
export default function ZoneModal({ zona, onSave, onDelete, onClose }) {
  const editando = Boolean(zona)
  const esBase = Boolean(zona?.es_base)

  const [nombre, setNombre] = useState(zona?.nombre ?? '')
  const [costo, setCosto] = useState(zona ? String(zona.costo ?? 0) : '')
  const [tiempo, setTiempo] = useState(zona?.tiempo_estimado ?? '')
  const [descripcion, setDescripcion] = useState(zona?.descripcion ?? '')
  const [intentado, setIntentado] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState(null)

  // El input es texto para no pelear con el separador de miles; el número sale
  // de aquí. Vacío → NaN → error de validación, nunca un 0 silencioso.
  const costoNum = costo.trim() === '' ? NaN : Number(costo.replace(/[^\d]/g, ''))

  const errores = []
  if (nombre.trim().length < 3) errores.push('El nombre de la zona debe tener al menos 3 caracteres.')
  if (!Number.isFinite(costoNum)) errores.push('Escribe la tarifa del domicilio para esta zona.')
  else if (costoNum < 0) errores.push('La tarifa no puede ser negativa.')

  async function handleSave() {
    setIntentado(true)
    if (errores.length > 0 || saving) return

    setSaving(true)
    setErrorGuardado(null)
    const { error } = await onSave({
      nombre: nombre.replace(/\s+/g, ' ').trim(),
      costo: costoNum,
      tiempo_estimado: tiempo.trim() || null,
      descripcion: descripcion.trim() || null,
    })
    setSaving(false)

    if (error) setErrorGuardado(error)
    else onClose()
  }

  async function handleDelete() {
    setSaving(true)
    const { error } = await onDelete()
    setSaving(false)
    if (error) {
      setErrorGuardado(error)
      setConfirmDelete(false)
    } else {
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel faq-modal" onClick={e => e.stopPropagation()}>

        <div className="faq-modal-head">
          <div>
            <div className="title">{editando ? 'Editar zona' : 'Nueva zona de domicilio'}</div>
            <div className="sub">
              {esBase
                ? 'Tarifa comodín — se cobra cuando el barrio no está en ninguna zona.'
                : 'Todos los barrios de esta zona pagan la misma tarifa.'}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="faq-modal-body">

          <label className="field">
            <span className="field-label">Nombre de la zona</span>
            <input
              type="text"
              value={nombre}
              maxLength={60}
              onChange={e => setNombre(e.target.value)}
              placeholder="Zona Centro"
              autoFocus={!editando}
            />
            <span className="field-help">
              Para uso interno y para que el bot sepa nombrarla. Los clientes preguntan por
              barrio, no por zona.
            </span>
          </label>

          <label className="field">
            <span className="field-label">Tarifa del domicilio</span>
            <div className="zn-money">
              <span className="zn-money-sign">$</span>
              <input
                type="text"
                inputMode="numeric"
                className="tnum"
                value={costo}
                onChange={e => setCosto(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="5000"
              />
            </div>
            <span className="field-help">
              Se le suma al total del pedido. Cambiarla afecta solo a los pedidos
              <strong> nuevos</strong>: los ya registrados conservan lo que se les cobró.
            </span>
          </label>

          <label className="field">
            <span className="field-label">Tiempo estimado <span className="zn-opt">(opcional)</span></span>
            <input
              type="text"
              value={tiempo}
              maxLength={60}
              onChange={e => setTiempo(e.target.value)}
              placeholder="30 a 45 minutos"
            />
            <span className="field-help">Lo que el bot le dice al cliente que se demora el envío a esta zona.</span>
          </label>

          <label className="field">
            <span className="field-label">Nota interna <span className="zn-opt">(opcional)</span></span>
            <textarea
              rows={2}
              value={descripcion}
              maxLength={200}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Al otro lado del río — solo hasta las 9pm."
            />
          </label>

          {intentado && errores.length > 0 && (
            <div className="faq-errors">
              {errores.map(e => <div key={e}>{e}</div>)}
            </div>
          )}

          {esBase && (
            <div className="faq-warnings">
              <div className="faq-warning">
                <Icon name="alert" size={13} />
                <span>
                  Esta zona no se puede borrar ni desactivar: es la red de seguridad. Sin ella,
                  un barrio que no tengas cargado se cobraría en $0.
                </span>
              </div>
            </div>
          )}

          {errorGuardado && <div className="faq-errors">{errorGuardado}</div>}

        </div>

        <div className="faq-modal-foot">
          {confirmDelete ? (
            <div className="faq-confirm-delete">
              <span className="faq-confirm-text">
                ¿Eliminar la zona “{zona.nombre}”? Solo se puede si no le quedan barrios.
              </span>
              <div className="faq-confirm-actions">
                <button className="btn ghost" onClick={() => setConfirmDelete(false)} disabled={saving}>
                  Cancelar
                </button>
                <button className="btn danger" onClick={handleDelete} disabled={saving}>
                  {saving ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {editando && !esBase && (
                <button className="btn danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  <Icon name="trash" size={13} /> Eliminar
                </button>
              )}
              <div className="faq-foot-right">
                <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
                <button
                  className="btn primary"
                  onClick={handleSave}
                  disabled={saving || (intentado && errores.length > 0)}
                >
                  {saving ? 'Guardando…' : <><Icon name="check" size={14} /> Guardar</>}
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
