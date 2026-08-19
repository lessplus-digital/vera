import React, { useState } from 'react'
import { useFaq } from '../../hooks/useFaq'
import Icon from '../../components/Icon'
import FaqModal from './FaqModal'

// Ejemplos para el estado vacío. Son solo PREGUNTAS (sin respuesta): la
// respuesta la escribe el restaurante. Sembrar respuestas de ejemplo sería
// inventar afirmaciones del negocio que el bot le diría a clientes reales.
const EJEMPLOS = [
  '¿Tienen parqueadero?',
  '¿Aceptan mascotas?',
  '¿Hacen eventos o reservas para grupos grandes?',
  '¿Tienen opciones vegetarianas o sin gluten?',
]

// Preview de la respuesta en la fila: una línea, sin saltos.
const resumir = txt => String(txt || '').replace(/\s+/g, ' ').trim()

export default function FaqSection({ showToast }) {
  const { faqs, loading, error, createFaq, updateFaq, deleteFaq, setActiva, moveFaq } = useFaq()
  const [modal, setModal] = useState(null) // null | { faq } | { faq: null } (crear)

  const activas = faqs.filter(f => f.activa).length

  async function handleToggle(faq) {
    const next = !faq.activa
    const { error: toggleError } = await setActiva(faq.faq_id, next)
    if (toggleError) {
      showToast('error', toggleError)
    } else {
      showToast('success', next
        ? '✓ Pregunta activada — el bot ya puede responderla'
        : 'Pregunta desactivada — el bot deja de responderla')
    }
  }

  async function handleMove(faq, dir) {
    const { error: moveError } = await moveFaq(faq.faq_id, dir)
    if (moveError) showToast('error', moveError)
  }

  async function handleSave(datos) {
    const editando = Boolean(modal?.faq)
    const result = editando
      ? await updateFaq(modal.faq.faq_id, datos)
      : await createFaq(datos)

    if (!result.error) {
      showToast('success', editando
        ? '✓ Pregunta actualizada — el bot ya responde con el nuevo texto'
        : '✓ Pregunta agregada — el bot ya puede responderla')
    }
    return result
  }

  async function handleDelete() {
    const result = await deleteFaq(modal.faq.faq_id)
    if (!result.error) showToast('success', 'Pregunta eliminada')
    return result
  }

  return (
    <>
      <div className="settings-toolbar">
        <div className="settings-intro">
          <div className="settings-title">Preguntas frecuentes</div>
          <div className="settings-sub">
            Lo que el bot responde cuando le preguntan algo que no es el menú ni un pedido.
            Agrega aquí lo que más te preguntan por WhatsApp — aplica apenas guardes.
          </div>
        </div>

        <div className="settings-actions">
          {faqs.length > 0 && (
            <span className="faq-count tnum">
              {faqs.length} {faqs.length === 1 ? 'pregunta' : 'preguntas'} · {activas} {activas === 1 ? 'activa' : 'activas'}
            </span>
          )}
          <button className="btn primary" onClick={() => setModal({ faq: null })}>
            <Icon name="plus" size={14} /> Nueva pregunta
          </button>
        </div>
      </div>

      {error && <div className="settings-error">Error cargando las preguntas: {error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando preguntas…</div>
      ) : faqs.length === 0 ? (
        <div className="faq-empty">
          <div className="faq-empty-title">Todavía no hay preguntas frecuentes</div>
          <p className="faq-empty-text">
            Cuando un cliente pregunta algo que el bot no sabe, responde que no tiene esa
            información y ofrece pasar a una persona. Cada pregunta que agregues aquí es una
            conversación menos que tienes que atender a mano.
          </p>
          <div className="faq-empty-examples">
            <span className="faq-empty-label">Las típicas:</span>
            {EJEMPLOS.map(e => <span className="faq-chip" key={e}>{e}</span>)}
          </div>
        </div>
      ) : (
        <div className="faq-list">
          {faqs.map((faq, i) => (
            <div className={`faq-row${faq.activa ? '' : ' off'}`} key={faq.faq_id}>

              <div className="faq-order">
                <button
                  className="faq-move"
                  onClick={() => handleMove(faq, -1)}
                  disabled={i === 0}
                  aria-label="Subir"
                  title="Subir"
                ><Icon name="arrow-up" size={12} /></button>
                <button
                  className="faq-move"
                  onClick={() => handleMove(faq, 1)}
                  disabled={i === faqs.length - 1}
                  aria-label="Bajar"
                  title="Bajar"
                ><Icon name="arrow-down" size={12} /></button>
              </div>

              <button className="faq-text" onClick={() => setModal({ faq })}>
                <span className="faq-q">{faq.pregunta}</span>
                <span className="faq-a">{resumir(faq.respuesta)}</span>
              </button>

              <div className="faq-state">
                <button
                  className="switch"
                  role="switch"
                  aria-checked={faq.activa}
                  aria-label={`Estado de: ${faq.pregunta}`}
                  title={faq.activa ? 'Desactivar' : 'Activar'}
                  onClick={() => handleToggle(faq)}
                />
                <span className={`faq-state-label ${faq.activa ? 'on' : 'off'}`}>
                  {faq.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>

              <button
                className="faq-edit"
                onClick={() => setModal({ faq })}
                aria-label={`Editar: ${faq.pregunta}`}
              ><Icon name="edit" size={13} /> Editar</button>

            </div>
          ))}
        </div>
      )}

      {modal && (
        <FaqModal
          faq={modal.faq}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
