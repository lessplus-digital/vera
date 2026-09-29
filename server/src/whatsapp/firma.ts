import { createHmac, timingSafeEqual } from 'node:crypto'

// Meta firma cada POST del webhook con HMAC-SHA256 del cuerpo CRUDO usando la
// clave secreta de la app, en la cabecera `X-Hub-Signature-256: sha256=<hex>`.
// Sin esta verificación, cualquiera que conozca la URL podría hacerse pasar por
// un cliente y crear pedidos.

export function firmar(cuerpo: string | Uint8Array, secreto: string): string {
  return 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex')
}

export function firmaValida(cuerpo: string | Uint8Array, cabecera: string | undefined, secreto: string): boolean {
  if (!cabecera || !cabecera.startsWith('sha256=')) return false
  const esperada = Buffer.from(firmar(cuerpo, secreto))
  const recibida = Buffer.from(cabecera)
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
}
