export default function ImageLightbox({ src, onClose }) {
  if (!src) return null

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-btns">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="lb-btn"
          onClick={e => e.stopPropagation()}
        >
          ↗ Abrir original
        </a>
        <button className="lb-btn close" onClick={onClose}>✕ Cerrar</button>
      </div>
      <img
        src={src}
        alt="Imagen ampliada"
        className="lb-img"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}
