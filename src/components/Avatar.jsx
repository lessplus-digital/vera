import React, { useState, useEffect } from 'react'

// Foto de perfil con respaldo a la inicial del nombre.
//
// El fallback no es decorativo: el bucket es público y una URL puede quedar
// rota (foto borrada, CDN caído). Sin `onError` quedaría el icono de imagen
// partida del navegador en la barra superior.
export default function Avatar({ src, nombre, size = 28, className = '' }) {
  const [falló, setFalló] = useState(false)

  // Al cambiar la foto hay que volver a intentar: si no, un error previo deja
  // la inicial pegada aunque la URL nueva sí cargue.
  useEffect(() => { setFalló(false) }, [src])

  const inicial = (String(nombre || '').trim()[0] || 'U').toUpperCase()
  const estilo  = { width: size, height: size, fontSize: Math.round(size * 0.42) }

  if (!src || falló) {
    return (
      <span className={`avatar ${className}`} style={estilo} aria-hidden="true">
        {inicial}
      </span>
    )
  }

  return (
    <img
      className={`avatar img ${className}`}
      style={estilo}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFalló(true)}
    />
  )
}
