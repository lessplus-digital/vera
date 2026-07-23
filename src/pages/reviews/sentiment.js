// Clasificación de sentimiento de una reseña según su nota, alineada con la
// lógica del bot (Sub — Feedback Pendiente, nodo "¿Nota > 3?"):
//   4–5 → positiva (se invita a dejar reseña en Google)
//   3   → neutra
//   1–2 → negativa (el bot pide comentario → hay que recuperar al cliente)
// Sin nota se trata como neutra para no inflar ni positivas ni negativas.
export function sentimentOf(nota) {
  if (nota == null) return 'neu'
  if (nota >= 4) return 'pos'
  if (nota === 3) return 'neu'
  return 'neg'
}

// tone reutiliza los tokens de estado (green/amber/red) del design system.
export const SENTIMENT_META = {
  pos: { label: 'Positiva', tone: 'green' },
  neu: { label: 'Neutra',   tone: 'amber' },
  neg: { label: 'Negativa',  tone: 'red'   },
}
