import React, { useState } from 'react'
import { useDeliveryZones } from '../../hooks/useDeliveryZones'
import Icon from '../../components/Icon'
import ZoneModal from './ZoneModal'

const money = n => `$${Number(n || 0).toLocaleString('es-CO')}`

export default function DeliveryZonesSection({ showToast }) {
  const {
    zonas, sinClasificar, loading, error,
    createZona, updateZona, deleteZona, setZonaActiva,
    addBarrios, moveBarrio, deleteBarrio,
  } = useDeliveryZones()

  const [modal, setModal] = useState(null)     // null | { zona } | { zona: null }
  const [nuevoBarrio, setNuevoBarrio] = useState({})  // { [zonaClave]: texto }
  const [asignando, setAsignando] = useState({})      // { [nombreBarrio]: zonaClave }

  const zonaBase = zonas.find(z => z.es_base)
  const zonasReales = zonas.filter(z => !z.es_base)
  const totalBarrios = zonas.reduce((n, z) => n + z.barrios.length, 0)

  async function handleSave(datos) {
    const editando = Boolean(modal?.zona)
    const result = editando
      ? await updateZona(modal.zona.clave, datos)
      : await createZona(datos)

    if (!result.error) {
      showToast('success', editando
        ? '✓ Zona actualizada — el bot ya cobra la nueva tarifa'
        : '✓ Zona creada — agrégale los barrios que cubre')
    }
    return result
  }

  async function handleDelete() {
    const result = await deleteZona(modal.zona.clave)
    if (!result.error) showToast('success', 'Zona eliminada')
    return result
  }

  async function handleToggle(zona) {
    const next = !zona.activo
    const { error: toggleError } = await setZonaActiva(zona.clave, next)
    if (toggleError) {
      showToast('error', toggleError)
    } else {
      showToast('success', next
        ? '✓ Zona activada — el bot vuelve a cubrir estos barrios'
        : 'Zona desactivada — sus barrios pasan a cobrar la tarifa base')
    }
  }

  async function handleAddBarrio(zonaClave, e) {
    e.preventDefault()
    const texto = nuevoBarrio[zonaClave] || ''
    if (!texto.trim()) return

    const { error: addError, agregados, repetidos } = await addBarrios(zonaClave, texto)
    if (addError) {
      showToast('error', addError)
      return
    }

    setNuevoBarrio(v => ({ ...v, [zonaClave]: '' }))

    // Agregar UN barrio no avisa nada: el chip aparece solo y el toast sobra.
    // Los lotes sí, porque ahí no se ve de un vistazo qué entró y qué no.
    if (agregados === 0) {
      showToast('error', repetidos === 1
        ? 'Ese barrio ya está en una zona.'
        : `Esos ${repetidos} barrios ya están en alguna zona.`)
    } else if (repetidos > 0) {
      showToast('success', `✓ ${agregados} ${agregados === 1 ? 'barrio agregado' : 'barrios agregados'} · ${repetidos} ya ${repetidos === 1 ? 'estaba' : 'estaban'}`)
    } else if (agregados > 1) {
      showToast('success', `✓ ${agregados} barrios agregados`)
    }
  }

  async function handleDeleteBarrio(barrio) {
    const { error: delError } = await deleteBarrio(barrio.clave)
    if (delError) showToast('error', delError)
  }

  // Barrio suelto (llegó por WhatsApp sin estar en el catálogo) → se crea ya
  // dentro de la zona elegida y desaparece de la lista de pendientes.
  async function handleClasificar(nombre) {
    const zona = asignando[nombre]
    if (!zona) return

    const { error: addError, agregados } = await addBarrios(zona, nombre)
    if (addError) {
      showToast('error', addError)
    } else if (!agregados) {
      showToast('error', `"${nombre}" ya está en otra zona. Muévelo desde ahí.`)
    } else {
      setAsignando(v => ({ ...v, [nombre]: undefined }))
      showToast('success', `✓ "${nombre}" quedó en ${zonas.find(z => z.clave === zona)?.nombre}`)
    }
  }

  function renderZona(zona) {
    return (
      <div className={`zn-card${zona.activo ? '' : ' off'}${zona.es_base ? ' base' : ''}`} key={zona.clave}>

        <div className="zn-card-head">
          <div className="zn-id">
            <div className="zn-name">
              {zona.nombre}
              {zona.es_base && <span className="zn-badge">Tarifa base</span>}
            </div>
            <div className="zn-meta">
              <span className="zn-price tnum">{money(zona.costo)}</span>
              {zona.tiempo_estimado && <span className="zn-time"><Icon name="clock" size={12} /> {zona.tiempo_estimado}</span>}
              <span className="zn-count tnum">
                {zona.es_base
                  ? 'cualquier barrio sin zona'
                  : `${zona.barrios.length} ${zona.barrios.length === 1 ? 'barrio' : 'barrios'}`}
              </span>
            </div>
            {zona.descripcion && <div className="zn-desc">{zona.descripcion}</div>}
          </div>

          <div className="zn-actions">
            {!zona.es_base && (
              <button
                className="switch"
                role="switch"
                aria-checked={zona.activo}
                aria-label={`Estado de la zona ${zona.nombre}`}
                title={zona.activo ? 'Desactivar' : 'Activar'}
                onClick={() => handleToggle(zona)}
              />
            )}
            <button className="faq-edit" onClick={() => setModal({ zona })} aria-label={`Editar ${zona.nombre}`}>
              <Icon name="edit" size={13} /> Editar
            </button>
          </div>
        </div>

        {!zona.es_base && (
          <div className="zn-barrios">
            {zona.barrios.map(b => (
              <span className="zn-chip" key={b.clave}>
                {b.nombre}
                <button
                  className="zn-chip-x"
                  onClick={() => handleDeleteBarrio(b)}
                  aria-label={`Quitar ${b.nombre}`}
                  title="Quitar de la zona"
                ><Icon name="x" size={10} /></button>
              </span>
            ))}

            <form className="zn-add" onSubmit={e => handleAddBarrio(zona.clave, e)}>
              <input
                type="text"
                value={nuevoBarrio[zona.clave] || ''}
                onChange={e => setNuevoBarrio(v => ({ ...v, [zona.clave]: e.target.value }))}
                placeholder="Agregar barrios (sepáralos por coma)…"
                maxLength={600}
              />
              <button type="submit" disabled={!(nuevoBarrio[zona.clave] || '').trim()} aria-label="Agregar barrios">
                <Icon name="plus" size={12} />
              </button>
            </form>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="settings-toolbar">
        <div className="settings-intro">
          <div className="settings-title">Zonas de domicilio</div>
          <div className="settings-sub">
            Agrupa barrios en zonas y ponle una tarifa a cada una. El bot pregunta el barrio
            antes de cerrar un domicilio y cobra lo que digas aquí — aplica apenas guardes.
          </div>
        </div>

        <div className="settings-actions">
          {zonasReales.length > 0 && (
            <span className="faq-count tnum">
              {zonasReales.length} {zonasReales.length === 1 ? 'zona' : 'zonas'} · {totalBarrios} {totalBarrios === 1 ? 'barrio' : 'barrios'}
            </span>
          )}
          <button className="btn primary" onClick={() => setModal({ zona: null })}>
            <Icon name="plus" size={14} /> Nueva zona
          </button>
        </div>
      </div>

      {error && <div className="settings-error">Error cargando las zonas: {error}</div>}

      {loading ? (
        <div className="loading-state"><div className="spinner" />Cargando zonas…</div>
      ) : (
        <>
          {zonasReales.length === 0 ? (
            <div className="faq-empty">
              <div className="faq-empty-title">Todavía no has dividido la ciudad en zonas</div>
              <p className="faq-empty-text">
                Mientras tanto, todo domicilio cobra la tarifa base de {money(zonaBase?.costo)}, sin
                importar a dónde vaya. Crea una zona por cada tarifa distinta que manejes —
                “Cerca” y “Lejos” ya es suficiente para empezar — y mete en cada una los barrios
                que cubre.
              </p>
            </div>
          ) : (
            <div className="zn-list">{zonasReales.map(renderZona)}</div>
          )}

          {/* Barrios que llegaron por WhatsApp y no están en ninguna zona. Son
              justo los que falta cargar, y ya se están cobrando a tarifa base. */}
          {sinClasificar.length > 0 && zonasReales.length > 0 && (
            <div className="zn-pending">
              <div className="zn-pending-head">
                <Icon name="alert" size={14} />
                <div>
                  <div className="zn-pending-title">Barrios sin zona</div>
                  <div className="zn-pending-sub">
                    Clientes pidieron a estos barrios y no están en ninguna zona, así que se les
                    cobró la tarifa base de {money(zonaBase?.costo)}. Asígnalos para cobrar lo que
                    corresponde.
                  </div>
                </div>
              </div>

              <div className="zn-pending-list">
                {sinClasificar.map(b => (
                  <div className="zn-pending-row" key={b.nombre}>
                    <span className="zn-pending-name">{b.nombre}</span>
                    <span className="zn-pending-count tnum">
                      {b.pedidos} {b.pedidos === 1 ? 'pedido' : 'pedidos'}
                    </span>
                    <select
                      value={asignando[b.nombre] || ''}
                      onChange={e => setAsignando(v => ({ ...v, [b.nombre]: e.target.value }))}
                      aria-label={`Zona para ${b.nombre}`}
                    >
                      <option value="">Elegir zona…</option>
                      {zonasReales.map(z => (
                        <option key={z.clave} value={z.clave}>{z.nombre} · {money(z.costo)}</option>
                      ))}
                    </select>
                    <button
                      className="btn secondary"
                      onClick={() => handleClasificar(b.nombre)}
                      disabled={!asignando[b.nombre]}
                    >
                      Asignar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* La zona base va al final: no es una zona más, es la red de seguridad. */}
          {zonaBase && <div className="zn-list zn-base-slot">{renderZona(zonaBase)}</div>}
        </>
      )}

      {modal && (
        <ZoneModal
          zona={modal.zona}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
