import React from 'react'
import Icon from '../../components/Icon'

// Fila de 5 estrellas. Las llenas se pintan con `fill: currentColor` (el estilo
// inline gana sobre el atributo fill="none" del <svg> de Icon); las vacías
// quedan en contorno. El color lo pone la clase padre (.rev-stars → amber).
export default function Stars({ value = 0, size = 15, className = '' }) {
  const filled = Math.round(value)
  return (
    <span className={`rev-stars ${className}`.trim()} aria-label={`${value} de 5 estrellas`}>
      {[0, 1, 2, 3, 4].map(i => (
        <Icon
          key={i}
          name="star"
          size={size}
          className={i < filled ? 'star-on' : 'star-off'}
          style={{ fill: i < filled ? 'currentColor' : 'none' }}
        />
      ))}
    </span>
  )
}
