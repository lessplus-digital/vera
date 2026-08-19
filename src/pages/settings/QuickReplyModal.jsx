import React, { useState, useRef, useMemo } from 'react'
import Icon from '../../components/Icon'
import { MARCADOR_NOMBRE, aplicarNombre, usaNombre } from '../../utils/quickReplies'

// Alta/edición de una respuesta rápida. `respuesta = null` → crear.
//
// A diferencia de FaqModal no hay avisos de redacción (`faqLint`): este texto no
// lo lee ningún agente, lo envía una persona que además puede editarlo en el
// chat antes de mandarlo. Lo único que se bloquea es lo que la BD también
// rechaza (longitudes), para mostrar un mensaje claro en vez de un error crudo.
export const LIMITES = { atajo: 30, texto: 600 }
const MINIMO_ATAJO = 2
const MINIMO_TEXTO = 3

// Nombre de ejemplo para el preview. Que sea evidentemente ficticio evita que
// el admin crea que está viendo un cliente real.
const NOMBRE_EJEMPLO = 'María'

export default function QuickReplyModal({ respuesta, onSave, onDelete, onClose }) {
  const editando = Boolean(respuesta)

  const [atajo,  setAtajo]  = useState(respuesta?.atajo  ?? '')
  const [texto,  setTexto]  = useState(respuesta?.texto  ?? '')
  const [activa, setActiva] = useState(respuesta?.activa ?? true)
  const [intentado,     setIntentado]     = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState(null)

  const textoRef = useRef(null)

  const errores = useMemo(() => {
    const errs = []
    const a = atajo.trim()
    const t = texto.trim()

    if (a.length < MINIMO_ATAJO) errs.push('Ponle un nombre corto para reconocerla en el chat.')
    else if (a.length > LIMITES.atajo) errs.push(`El nombre no puede pasar de ${LIMITES.atajo} caracteres.`)

    if (t.length < MINIMO_TEXTO) errs.push('Escribe el mensaje que se va a insertar.')
    else if (t.length > LIMITES.texto) errs.push(`El mensaje no puede pasar de ${LIMITES.texto} caracteres.`)

    return errs
  }, [atajo, texto])

  // Inserta {nombre} donde está el cursor (no al final): el marcador casi
  // siempre va en mitad del saludo.
  function insertarNombre() {
    const el = textoRef.current
    if (!el) return

    const ini = el.selectionStart ?? texto.length
    const fin = el.selectionEnd   ?? texto.length
    const siguiente = texto.slice(0, ini) + MARCADOR_NOMBRE + texto.slice(fin)

    if (siguiente.length > LIMITES.texto) return

    setTexto(siguiente)
    // El estado de React aún no llegó al DOM: reposicionar el cursor en el
    // siguiente frame, ya con el valor nuevo pintado.
    requestAnimationFrame(() => {
      el.focus()
      const pos = ini + MARCADOR_NOMBRE.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function handleSave() {
    setIntentado(true)
    if (errores.length > 0 || saving) return

    setSaving(true)
    setErrorGuardado(null)
    const { error } = await onSave({
      atajo: atajo.trim(),
      texto: texto.trim(),
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
      <div className="modal-panel rr-modal" onClick={e => e.stopPropagation()}>

        <div className="rr-modal-head">
          <div>
            <div className="title">{editando ? 'Editar respuesta rápida' : 'Nueva respuesta rápida'}</div>
            <div className="sub">
              {editando ? `#${respuesta.respuesta_id} · ` : ''}
              Se inserta en el chat de soporte; la envías tú.
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="rr-modal-body">

          <label className="field">
            <span className="field-label">Nombre</span>
            <input
              type="text"
              value={atajo}
              maxLength={LIMITES.atajo}
              onChange={e => setAtajo(e.target.value)}
              placeholder="Demora en cocina"
              autoFocus
            />
            <span className="field-help">
              Lo que vas a leer en el botón dentro del chat. Corto y reconocible de un vistazo.
              <span className="rr-counter tnum">{atajo.length}/{LIMITES.atajo}</span>
            </span>
          </label>

          <label className="field">
            <span className="field-label">Mensaje</span>
            <textarea
              ref={textoRef}
              rows={5}
              value={texto}
              maxLength={LIMITES.texto}
              onChange={e => setTexto(e.target.value)}
              placeholder={`Hola ${MARCADOR_NOMBRE}, tu pedido está en cocina y sale en unos 15 minutos. Gracias por la paciencia 🍕`}
            />
            <span className="field-help">
              Se escribe en el campo de texto y lo puedes ajustar antes de enviar.
              <span className="rr-counter tnum">{texto.length}/{LIMITES.texto}</span>
            </span>
          </label>

          <div className="rr-marcador">
            <button type="button" className="rr-marcador-btn" onClick={insertarNombre}>
              <Icon name="plus" size={12} /> {MARCADOR_NOMBRE}
            </button>
            <span className="rr-marcador-hint">
              Insertar el nombre del cliente. Si no lo tenemos registrado, el marcador se borra solo
              y el mensaje sigue leyéndose bien.
            </span>
          </div>

          {texto.trim() && (
            <div className="rr-preview">
              <span className="rr-preview-label">
                Así se ve{usaNombre(texto) ? ` con un cliente llamado ${NOMBRE_EJEMPLO}` : ''}
              </span>
              <div className="rr-preview-bubble">{aplicarNombre(texto, NOMBRE_EJEMPLO)}</div>
            </div>
          )}

          <div className="rr-toggle-row">
            <div className="rr-toggle-text">
              <span className="rr-toggle-state">{activa ? 'Activa' : 'Inactiva'}</span>
              <span className="rr-toggle-hint">
                {activa
                  ? 'Aparece como botón en el chat de soporte.'
                  : 'Guardada, pero no aparece en el chat.'}
              </span>
            </div>
            <button
              className="switch"
              role="switch"
              aria-checked={activa}
              aria-label="Respuesta activa"
              onClick={() => setActiva(v => !v)}
            />
          </div>

          {intentado && errores.length > 0 && (
            <div className="rr-errors">
              {errores.map(e => <div key={e}>{e}</div>)}
            </div>
          )}

          {errorGuardado && <div className="rr-errors">{errorGuardado}</div>}

        </div>

        <div className="rr-modal-foot">
          {confirmDelete ? (
            <div className="rr-confirm-delete">
              <span className="rr-confirm-text">
                ¿Eliminar esta respuesta? Deja de aparecer en el chat.
              </span>
              <div className="rr-confirm-actions">
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
              <div className="rr-foot-right">
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
