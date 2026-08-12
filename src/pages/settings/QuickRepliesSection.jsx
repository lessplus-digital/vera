import React, { useState } from 'react'
import { useRespuestasRapidas } from '../../hooks/useRespuestasRapidas'
import Icon from '../../components/Icon'
import QuickReplyModal from './QuickReplyModal'

// Ejemplos para el estado vacío. Son solo NOMBRES (sin el mensaje), por el mismo
// criterio que en FaqSection: sembrar textos de ejemplo sería poner palabras en
// boca del restaurante para mensajes que salen a clientes reales.
const EJEMPLOS = ['Demora en cocina', 'Confirmar dirección', 'Ya salió el domicilio', 'Cerrado por hoy']

// Preview del mensaje en la fila: una línea, sin saltos.
const resumir = txt => String(txt || '').replace(/\s+/g, ' ').trim()

export default function QuickRepliesSection({ showToast }) {
  const {
    respuestas, loading, error,
    createRespuesta, updateRespuesta, deleteRespuesta, setActiva, moveRespuesta,
  } = useRespuestasRapidas()

  const [modal, setModal] = useState(null) // null | { respuesta } | { respuesta: null } (crear)

  const activas = respuestas.filter(r => r.activa).length

  async function handleToggle(respuesta) {
    const next = !respuesta.activa
    const { error: toggleError } = await setActiva(respuesta.respuesta_id, next)
    if (toggleError) {
      showToast('error', toggleError)
    } else {
      showToast('success', next
        ? '✓ Respuesta activada — ya aparece en el chat de soporte'
        : 'Respuesta desactivada — deja de aparecer en el chat')
    }
  }

  async function handleMove(respuesta, dir) {
    const { error: moveError } = await moveRespuesta(respuesta.respuesta_id, dir)
    if (moveError) showToast('error', moveError)
  }

  async function handleSave(datos) {
    const editando = Boolean(modal?.respuesta)
    const result = editando
      ? await updateRespuesta(modal.respuesta.respuesta_id, datos)
      : await createRespuesta(datos)

    if (!result.error) {
      showToast('success', editando
        ? '✓ Respuesta actualizada'
        : '✓ Respuesta agregada — ya aparece en el chat de soporte')
    }
    return result
  }

  async function handleDelete() {
    const result = await deleteRespuesta(modal.respuesta.respuesta_id)
    if (!result.error) showToast('success', 'Respuesta eliminada')
    return result
  }

  return (
    <>
      <div className="settings-toolbar">
        <div className="settings-intro">
          <div className="settings-title">Respuestas rápidas</div>
          <div className="settings-sub">
            Mensajes que usas todo el tiempo al atender por chat. Aparecen como botones sobre el
            campo de texto en Soporte: un clic los escribe, y los editas antes de enviar.
          </div>
        </div>

        <div className="settings-actions">
          {respuestas.length > 0 && (
            <span className="rr-count tnum">
              {respuestas.length} {respuestas.length === 1 ? 'respuesta' : 'respuestas'} · {activas} {activas === 1 ? 'activa' : 'activas'}
            </span>
          )}
          <button className="btn primary" onClick={() => setModal({ respuesta: null })}>
            <Icon name="plus" size={14} /> Nueva respuesta
          </button>
        </div>
      </div>

      {error && <div className="settings-error">Error cargando las respuestas: {error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando respuestas…</div>
      ) : respuestas.length === 0 ? (
        <div className="rr-empty">
          <div className="rr-empty-title">Todavía no hay respuestas rápidas</div>
          <p className="rr-empty-text">
            Cuando un cliente pide hablar con una persona, casi siempre terminas escribiendo lo
            mismo. Guarda esos mensajes aquí y respóndelos con un clic en vez de teclearlos otra vez.
          </p>
          <div className="rr-empty-examples">
            <span className="rr-empty-label">Las típicas:</span>
            {EJEMPLOS.map(e => <span className="rr-chip" key={e}>{e}</span>)}
          </div>
        </div>
      ) : (
        <div className="rr-list">
          {respuestas.map((respuesta, i) => (
            <div className={`rr-row${respuesta.activa ? '' : ' off'}`} key={respuesta.respuesta_id}>

              <div className="rr-order">
                <button
                  className="rr-move"
                  onClick={() => handleMove(respuesta, -1)}
                  disabled={i === 0}
                  aria-label="Subir"
                  title="Subir"
                ><Icon name="arrow-up" size={12} /></button>
                <button
                  className="rr-move"
                  onClick={() => handleMove(respuesta, 1)}
                  disabled={i === respuestas.length - 1}
                  aria-label="Bajar"
                  title="Bajar"
                ><Icon name="arrow-down" size={12} /></button>
              </div>

              <button className="rr-text" onClick={() => setModal({ respuesta })}>
                <span className="rr-atajo">{respuesta.atajo}</span>
                <span className="rr-msg">{resumir(respuesta.texto)}</span>
              </button>

              <div className="rr-state">
                <button
                  className="switch"
                  role="switch"
                  aria-checked={respuesta.activa}
                  aria-label={`Estado de: ${respuesta.atajo}`}
                  title={respuesta.activa ? 'Desactivar' : 'Activar'}
                  onClick={() => handleToggle(respuesta)}
                />
                <span className={`rr-state-label ${respuesta.activa ? 'on' : 'off'}`}>
                  {respuesta.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>

              <button
                className="rr-edit"
                onClick={() => setModal({ respuesta })}
                aria-label={`Editar: ${respuesta.atajo}`}
              ><Icon name="edit" size={13} /> Editar</button>

            </div>
          ))}
        </div>
      )}

      {modal && (
        <QuickReplyModal
          respuesta={modal.respuesta}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
