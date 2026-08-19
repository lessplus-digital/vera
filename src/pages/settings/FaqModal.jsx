import React, { useState, useMemo } from 'react'
import Icon from '../../components/Icon'
import { validarFaq, LIMITES } from './faqLint'

// Alta/edición de una pregunta frecuente. `faq = null` → crear.
//
// Los avisos de `validarFaq` NO bloquean el guardado (ver faqLint.js): cambian
// el botón a "Guardar de todos modos" para que el admin decida con la
// explicación delante, en vez de pelear con un formulario que no lo deja pasar.
export default function FaqModal({ faq, onSave, onDelete, onClose }) {
  const editando = Boolean(faq)

  const [pregunta,  setPregunta]  = useState(faq?.pregunta  ?? '')
  const [respuesta, setRespuesta] = useState(faq?.respuesta ?? '')
  const [activa,    setActiva]    = useState(faq?.activa ?? true)
  const [intentado, setIntentado] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState(null)

  const { errores, avisos } = useMemo(
    () => validarFaq({ pregunta, respuesta }),
    [pregunta, respuesta]
  )

  async function handleSave() {
    setIntentado(true)
    if (errores.length > 0 || saving) return

    setSaving(true)
    setErrorGuardado(null)
    const { error } = await onSave({
      pregunta: pregunta.trim(),
      respuesta: respuesta.trim(),
      activa,
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
            <div className="title">{editando ? 'Editar pregunta' : 'Nueva pregunta frecuente'}</div>
            <div className="sub">
              {editando ? `#${faq.faq_id} · ` : ''}
              El bot usa esto para responder por WhatsApp.
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="faq-modal-body">

          <label className="field">
            <span className="field-label">Pregunta</span>
            <input
              type="text"
              value={pregunta}
              maxLength={LIMITES.pregunta}
              onChange={e => setPregunta(e.target.value)}
              placeholder="¿Tienen opciones sin gluten?"
              autoFocus
            />
            <span className="field-help">
              Escríbela como la haría un cliente. El bot entiende variaciones, no hace falta
              repetirla de varias formas.
              <span className="faq-counter tnum">{pregunta.length}/{LIMITES.pregunta}</span>
            </span>
          </label>

          <label className="field">
            <span className="field-label">Respuesta</span>
            <textarea
              rows={5}
              value={respuesta}
              maxLength={LIMITES.respuesta}
              onChange={e => setRespuesta(e.target.value)}
              placeholder="Sí, tenemos masa sin gluten en todas las pizzas. Avísanos al pedir."
            />
            <span className="field-help">
              Habla como una persona del restaurante. Sin precios: esos los toma el bot del menú.
              <span className="faq-counter tnum">{respuesta.length}/{LIMITES.respuesta}</span>
            </span>
          </label>

          <div className="faq-toggle-row">
            <div className="faq-toggle-text">
              <span className="faq-toggle-state">{activa ? 'Activa' : 'Inactiva'}</span>
              <span className="faq-toggle-hint">
                {activa
                  ? 'El bot puede usar esta respuesta.'
                  : 'Guardada, pero el bot no la ve.'}
              </span>
            </div>
            <button
              className="switch"
              role="switch"
              aria-checked={activa}
              aria-label="Pregunta activa"
              onClick={() => setActiva(v => !v)}
            />
          </div>

          {intentado && errores.length > 0 && (
            <div className="faq-errors">
              {errores.map(e => <div key={e}>{e}</div>)}
            </div>
          )}

          {avisos.length > 0 && (
            <div className="faq-warnings">
              {avisos.map(a => (
                <div className="faq-warning" key={a.tipo}>
                  <Icon name="alert" size={13} />
                  <span>{a.mensaje}</span>
                </div>
              ))}
            </div>
          )}

          {errorGuardado && <div className="faq-errors">{errorGuardado}</div>}

        </div>

        <div className="faq-modal-foot">
          {confirmDelete ? (
            <div className="faq-confirm-delete">
              <span className="faq-confirm-text">
                ¿Eliminar esta pregunta? El bot deja de responderla.
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
              {editando && (
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
                  {saving
                    ? 'Guardando…'
                    : avisos.length > 0
                      ? 'Guardar de todos modos'
                      : <><Icon name="check" size={14} /> Guardar</>}
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
