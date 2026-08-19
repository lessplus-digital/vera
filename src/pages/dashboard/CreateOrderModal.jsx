import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendWhatsAppTemplate } from '../../lib/whatsapp'
import { WA_TEMPLATES } from '../../utils/constants'
import Icon from '../../components/Icon'
import MenuPicker from './MenuPicker'
import { useBarrioOptions } from '../../hooks/useDeliveryZones'

// El costo del domicilio ya no es una constante: sale de la zona del barrio
// (`zonas_entrega.costo`). Lo que se calcula aquí es SOLO el preview — el total
// real lo sigue escribiendo el trigger, y el barrio lo resuelve la BD, así que
// un barrio escrito a mano que no esté en el catálogo cae en la tarifa base.
const OTRO_BARRIO = '__otro__'

export default function CreateOrderModal({ onClose, onUpdated }) {
  // Cliente
  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)

  // Datos del pedido
  const [tipoPedido, setTipoPedido] = useState('domicilio')
  const [metodoPago, setMetodoPago] = useState('Efectivo')
  const [direccion, setDireccion] = useState('')
  const [barrioClave, setBarrioClave] = useState('')   // '' | clave | OTRO_BARRIO
  const [barrioLibre, setBarrioLibre] = useState('')
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState([])

  const { barrios, tarifaBase, loading: barriosLoading } = useBarrioOptions()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [waWarning, setWaWarning] = useState(null)

  useEffect(() => {
    async function fetchClients() {
      const { data, error: clientsError } = await supabase
        .from('clientes')
        .select('cliente_id, nombre, telefono, direccion_principal, barrio')
        .order('nombre')
      if (clientsError) console.error('Error cargando clientes:', clientsError)
      else setClients(data || [])
      setClientsLoading(false)
    }
    fetchClients()
  }, [])

  const itemsTotal = items.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0)

  // Barrio elegido del catálogo → tarifa de su zona. Cualquier otra cosa
  // (escrito a mano, o todavía sin elegir) → tarifa base, que es exactamente
  // lo que hará el trigger.
  const barrioSel = barrios.find(b => b.clave === barrioClave) || null
  // El nombre que se manda a la BD: el canónico si vino del catálogo.
  const barrioTexto = barrioSel ? barrioSel.nombre : barrioLibre.trim()
  const domicilioFee = tipoPedido !== 'domicilio'
    ? 0
    : barrioSel ? barrioSel.costo : (tarifaBase ?? 0)
  const total = itemsTotal + domicilioFee

  function selectClient(client) {
    setSelectedClient(client)
    setClientSearch('')
    if (client.direccion_principal && !direccion) setDireccion(client.direccion_principal)

    // El barrio guardado del cliente se preselecciona si está en el catálogo;
    // si no, entra como texto libre para no perderlo.
    if (client.barrio && !barrioClave) {
      const match = barrios.find(b => b.nombre.toLowerCase() === String(client.barrio).toLowerCase())
      if (match) {
        setBarrioClave(match.clave)
      } else {
        setBarrioClave(OTRO_BARRIO)
        setBarrioLibre(client.barrio)
      }
    }
  }

  const updateItemQty = useCallback((key, delta) => {
    setItems(prev =>
      prev.map(item => {
        if (item.key !== key) return item
        return { ...item, cantidad: Math.max(1, item.cantidad + delta) }
      })
    )
  }, [])

  const removeItem = useCallback((key) => {
    setItems(prev => prev.filter(item => item.key !== key))
  }, [])

  const addItem = useCallback((item) => {
    setError(null)
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setItems(prev => [...prev, { key, ...item }])
  }, [])

  // Params de la plantilla `resumen_pedido`, EN ORDEN:
  //   {{1}} nombre · {{2}} pedido_id · {{3}} items · {{4}} total · {{5}} entrega
  // Meta rechaza params con saltos de línea, tabs o 4+ espacios seguidos, así que la
  // lista de items va en UNA sola línea separada por comas (no como las viñetas del
  // texto libre que esto reemplazó).
  function buildResumenParams(pedidoId, totalFinal, feeFinal) {
    const nombre = selectedClient.nombre && selectedClient.nombre !== 'Pendiente'
      ? selectedClient.nombre.split(' ')[0]
      : 'Cliente'

    const partes = items.map(item => {
      const variante = item.variante && item.variante !== 'Estándar' ? ` (${item.variante})` : ''
      return `${item.cantidad}x ${item.nombre_producto}${variante}`
    })
    if (feeFinal > 0) partes.push(`domicilio $${feeFinal.toLocaleString('es-CO')}`)

    const entrega = tipoPedido === 'domicilio'
      ? `Entrega en ${direccion.trim()}`
      : 'Para recoger en el local'

    const pago = metodoPago === 'Transferencia'
      ? ' (pago por transferencia — envíanos el comprobante por este chat)'
      : ' (pago en efectivo)'

    return [
      nombre,
      `#${pedidoId}`,
      partes.join(', '),
      `$${totalFinal.toLocaleString('es-CO')}`,
      entrega + pago,
    ]
  }

  async function handleSave() {
    if (!selectedClient) { setError('Selecciona un cliente.'); return }
    if (items.length === 0) { setError('El pedido debe tener al menos un item.'); return }
    if (tipoPedido === 'domicilio' && !direccion.trim()) { setError('Ingresa la dirección de entrega.'); return }

    setSaving(true)
    setError(null)

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({
        cliente_id: selectedClient.cliente_id,
        telefono: selectedClient.telefono,
        tipo_pedido: tipoPedido,
        metodo_pago: metodoPago,
        direccion_entrega: tipoPedido === 'domicilio' ? direccion.trim() : null,
        // La BD lo normaliza contra el catálogo y de ahí saca costo_domicilio.
        barrio: tipoPedido === 'domicilio' ? (barrioTexto || null) : null,
        estado: 'pendiente',
        estado_pago: 'pendiente',
        notas: notas.trim() || null,
        total: 0,
        fecha_pedido: new Date().toISOString(),
      })
      .select('pedido_id')
      .single()

    if (pedidoError) {
      setSaving(false)
      console.error('Error creando pedido:', pedidoError)
      setError('Error al crear el pedido. Intenta de nuevo.')
      return
    }

    const detalles = items.map((item, i) => ({
      detalle_id: `DET-M${pedido.pedido_id}-${i + 1}`,
      pedido_id: pedido.pedido_id,
      producto_id: item.producto_id,
      nombre_producto: item.nombre_producto,
      variante: item.variante,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      // null en productos normales; las 2 mitades en una pizza mitad y mitad
      mitades: item.mitades || null,
    }))

    const { error: detalleError } = await supabase.from('detalle_pedidos').insert(detalles)

    if (detalleError) {
      // Rollback best-effort: no dejar un pedido vacío en el Kanban
      await supabase.from('pedidos').delete().eq('pedido_id', pedido.pedido_id)
      setSaving(false)
      console.error('Error creando items:', detalleError)
      setError('Error al guardar los items del pedido. Intenta de nuevo.')
      return
    }

    // El total y el costo de envío reales los escribieron los triggers — se
    // releen para que el resumen de WhatsApp diga lo mismo que la BD, aunque el
    // barrio se haya resuelto a una zona distinta de la del preview.
    const { data: pedidoFinal } = await supabase
      .from('pedidos')
      .select('total, costo_domicilio')
      .eq('pedido_id', pedido.pedido_id)
      .single()

    const totalFinal = Number(pedidoFinal?.total ?? total)
    const feeFinal = Number(pedidoFinal?.costo_domicilio ?? domicilioFee)

    // Best-effort, igual que el envío de WhatsApp: si falla, el pedido ya está
    // hecho y no vale la pena frenar al cajero por la ficha del cliente.
    if (tipoPedido === 'domicilio' && barrioTexto && barrioTexto !== selectedClient.barrio) {
      const { error: clienteError } = await supabase
        .from('clientes')
        .update({ barrio: barrioTexto })
        .eq('cliente_id', selectedClient.cliente_id)
      if (clienteError) console.error('No se pudo guardar el barrio del cliente:', clienteError)
    }

    onUpdated()

    try {
      const { name, lang } = WA_TEMPLATES.resumenPedido
      await sendWhatsAppTemplate(
        String(selectedClient.telefono || '').replace(/\D/g, ''),
        name,
        lang,
        buildResumenParams(pedido.pedido_id, totalFinal, feeFinal),
      )
    } catch (waError) {
      console.error('Error enviando WhatsApp:', waError)
      setSaving(false)
      setWaWarning(`El pedido se creó correctamente, pero no se pudo notificar por WhatsApp: ${waError.message}`)
      return
    }

    setSaving(false)
    onClose()
  }

  const clientQuery = clientSearch.trim().toLowerCase()
  const clientDigits = clientSearch.replace(/[^\d]/g, '')
  const filteredClients = clients.filter(c =>
    !clientQuery ||
    (c.nombre || '').toLowerCase().includes(clientQuery) ||
    (clientDigits && (c.telefono || '').includes(clientDigits))
  )

  const canSave = !saving && !waWarning && selectedClient && items.length > 0 &&
    (tipoPedido !== 'domicilio' || direccion.trim().length > 0)

  return (
    <div className="modal-overlay" onClick={waWarning ? undefined : onClose}>
      <div className="modal-panel edit-modal create-order-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="m-head">
          <div>
            <div className="title">Crear pedido manual</div>
            <div className="sub">Se registra en "Por aprobar" y se notifica al cliente</div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        {/* Scrollable body */}
        <div className="em-body">

          {/* Cliente */}
          <div className="em-label">Cliente</div>
          {selectedClient ? (
            <div className="co-client-selected">
              <div className="info">
                <div className="name">{selectedClient.nombre || 'Sin nombre'}</div>
                <div className="phone">{selectedClient.telefono}</div>
              </div>
              <button className="change" onClick={() => setSelectedClient(null)}>Cambiar</button>
            </div>
          ) : (
            <div className="co-client-picker">
              <input
                className="search"
                type="text"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar por nombre o teléfono..."
                autoFocus
              />
              <div className="list">
                {clientsLoading ? (
                  <div className="msg">Cargando clientes...</div>
                ) : filteredClients.length === 0 ? (
                  <div className="msg">No se encontraron clientes</div>
                ) : (
                  filteredClients.slice(0, 30).map(c => (
                    <button key={c.cliente_id} className="client" onClick={() => selectClient(c)}>
                      <span className="name">{c.nombre || 'Sin nombre'}</span>
                      <span className="phone">{c.telefono}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tipo y método de pago */}
          <div className="co-fields">
            <div className="co-field">
              <div className="em-label">Tipo de pedido</div>
              <div className="co-toggle">
                <button
                  className={`opt${tipoPedido === 'domicilio' ? ' active' : ''}`}
                  onClick={() => setTipoPedido('domicilio')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="scooter" size={14} /> Domicilio</button>
                <button
                  className={`opt${tipoPedido === 'recoger' ? ' active' : ''}`}
                  onClick={() => setTipoPedido('recoger')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="bag" size={14} /> Recoger</button>
              </div>
            </div>

            <div className="co-field">
              <div className="em-label">Método de pago</div>
              <div className="co-toggle">
                <button
                  className={`opt${metodoPago === 'Efectivo' ? ' active' : ''}`}
                  onClick={() => setMetodoPago('Efectivo')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="cash" size={14} /> Efectivo</button>
                <button
                  className={`opt${metodoPago === 'Transferencia' ? ' active' : ''}`}
                  onClick={() => setMetodoPago('Transferencia')}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Icon name="bank" size={14} /> Transfer.</button>
              </div>
            </div>
          </div>

          {/* Dirección y barrio (solo domicilio). El barrio es lo que fija la
              tarifa, así que va al lado de la dirección y no escondido en ella. */}
          {tipoPedido === 'domicilio' && (
            <>
              <div className="co-field co-address">
                <div className="em-label">Dirección de entrega</div>
                <input
                  type="text"
                  value={direccion}
                  onChange={e => setDireccion(e.target.value)}
                  placeholder="Ej: Calle 10 # 5-23"
                />
              </div>

              <div className="co-field co-address">
                <div className="em-label">Barrio</div>
                <select
                  className="co-barrio-select"
                  value={barrioClave}
                  onChange={e => setBarrioClave(e.target.value)}
                  disabled={barriosLoading}
                >
                  <option value="">
                    {barriosLoading
                      ? 'Cargando barrios…'
                      : barrios.length === 0
                        ? 'Sin barrios configurados — tarifa base'
                        : 'Sin especificar — tarifa base'}
                  </option>
                  {barrios.map(b => (
                    <option key={b.clave} value={b.clave}>
                      {b.nombre} · {b.zona} · ${b.costo.toLocaleString('es-CO')}
                    </option>
                  ))}
                  <option value={OTRO_BARRIO}>Otro barrio…</option>
                </select>

                {barrioClave === OTRO_BARRIO && (
                  <input
                    type="text"
                    style={{ marginTop: 8 }}
                    value={barrioLibre}
                    onChange={e => setBarrioLibre(e.target.value)}
                    placeholder="Nombre del barrio"
                  />
                )}

                {!barrioSel && (
                  <div className="co-barrio-hint">
                    Sin un barrio del catálogo se cobra la tarifa base
                    {tarifaBase !== null && <> de <strong>${tarifaBase.toLocaleString('es-CO')}</strong></>}.
                    Agrégalo en Configuración → Zonas de domicilio para cobrar lo que corresponde.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Items */}
          <div className="em-label">Items del pedido</div>
          {items.length === 0 ? (
            <div className="co-no-items">Aún no hay productos en el pedido</div>
          ) : (
            <div className="em-items">
              {items.map((item) => (
                <div key={item.key} className="em-item">
                  <div className="info">
                    <div className="name">
                      {item.mitades && <span className="mm-tag">½+½</span>}
                      {item.nombre_producto}
                    </div>
                    {item.variante && item.variante !== 'Estándar' && (
                      <div className="variant">{item.variante}</div>
                    )}
                  </div>

                  <div className="qty-ctrl">
                    <button className="q-btn" onClick={() => updateItemQty(item.key, -1)} disabled={item.cantidad <= 1}>−</button>
                    <span className="q-val">{item.cantidad}</span>
                    <button className="q-btn" onClick={() => updateItemQty(item.key, 1)}>+</button>
                  </div>

                  <div className="subtotal">${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}</div>

                  <button className="del-btn" onClick={() => removeItem(item.key)}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Selector de productos del menú (compartido con EditOrderModal) */}
          <MenuPicker onAddItem={addItem} />

          {/* Notas */}
          <div className="em-notes-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="note" size={13} /> Notas para cocina</div>
          <textarea
            className="em-notes"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Ej: Adición de tocineta para la Hawaiana, sin cebolla en la Margarita..."
            rows={3}
          />

          {error && <div className="em-error">{error}</div>}
          {waWarning && <div className="co-warning" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={14} /> {waWarning}</div>}
        </div>

        {/* Footer */}
        <div className="em-foot">
          <div className="total">
            <div className="lbl">Total estimado</div>
            <div className="amount">${total.toLocaleString('es-CO')}</div>
            {tipoPedido === 'domicilio' && (
              <div className="breakdown">
                Items: ${itemsTotal.toLocaleString('es-CO')} + Domicilio: ${domicilioFee.toLocaleString('es-CO')}
                {barrioSel ? ` (${barrioSel.zona})` : ' (tarifa base)'}
              </div>
            )}
          </div>

          <div className="actions">
            {waWarning ? (
              <button className="save ready" onClick={onClose}>Cerrar</button>
            ) : (
              <>
                <button className="cancel" onClick={onClose}>Cancelar</button>
                <button
                  className={`save${canSave ? ' ready' : ''}`}
                  onClick={handleSave}
                  disabled={!canSave}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                  {saving ? 'Creando...' : <><Icon name="check" size={14} /> Crear pedido</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
