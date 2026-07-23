import React from 'react'
import { categoryLabel } from '../../utils/constants'
import { getProductOptions } from '../dashboard/MenuPicker'
import { formatPrice } from '../../utils/formatters'
import Icon from '../../components/Icon'

// Detalle de un producto del menú (solo lectura + switch de disponibilidad).
// El toggle aplica al instante (mismo handler que el switch de la tabla); el
// producto llega derivado de la lista, así que el realtime lo mantiene fresco.
export default function ProductModal({ product, onToggle, onClose }) {
  const opts = getProductOptions(product)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel product-modal" onClick={e => e.stopPropagation()}>

        <div className="pm-head">
          <div>
            <div className="title">
              {product.nombre}
              {product.variante && product.variante !== 'Estándar' && (
                <span className="variant"> · {product.variante}</span>
              )}
            </div>
            <div className="sub">
              #{product.producto_id} · {categoryLabel(product.categoria)}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="pm-body">
          <div className={`pm-stock ${product.disponible ? 'on' : 'off'}`}>
            <div className="pm-stock-text">
              <span className="pm-stock-state">{product.disponible ? 'Disponible' : 'Agotado'}</span>
              <span className="pm-stock-hint">
                {product.disponible
                  ? 'El bot lo ofrece en el menú de WhatsApp.'
                  : 'El bot no lo ofrece hasta que vuelva a estar disponible.'}
              </span>
            </div>
            <button
              className="switch"
              role="switch"
              aria-checked={product.disponible}
              aria-label={`Disponibilidad de ${product.nombre}`}
              onClick={() => onToggle(product)}
            />
          </div>

          <div className="pm-section">
            <div className="pm-label">{opts.length > 1 ? 'Precios por tamaño' : 'Precio'}</div>
            {opts.length === 0 ? (
              <div className="pm-price-row"><span>—</span></div>
            ) : (
              opts.map(opt => (
                <div className="pm-price-row" key={opt.variante}>
                  <span>{opt.variante}</span>
                  <span className="tnum">{formatPrice(opt.precio)}</span>
                </div>
              ))
            )}
          </div>

          {product.descripcion && (
            <div className="pm-section">
              <div className="pm-label">Descripción</div>
              <p className="pm-desc">{product.descripcion}</p>
            </div>
          )}
        </div>

        <div className="pm-foot">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
