import { describe, expect, it } from 'vitest'
import { firmar, firmaValida } from '../../src/whatsapp/firma.js'

describe('firma X-Hub-Signature-256', () => {
  const cuerpo = '{"object":"whatsapp_business_account"}'

  it('acepta la firma correcta', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, 's3cr3t'), 's3cr3t')).toBe(true)
  })

  it('coincide con un HMAC-SHA256 conocido', () => {
    // echo -n 'abc' | openssl dgst -sha256 -hmac 'key'
    expect(firmar('abc', 'key')).toBe('sha256=9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab')
  })

  it('rechaza firma con otro secreto, cuerpo alterado, sin prefijo o ausente', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, 'otro'), 's3cr3t')).toBe(false)
    expect(firmaValida(cuerpo + ' ', firmar(cuerpo, 's3cr3t'), 's3cr3t')).toBe(false)
    expect(firmaValida(cuerpo, firmar(cuerpo, 's3cr3t').slice(7), 's3cr3t')).toBe(false)
    expect(firmaValida(cuerpo, undefined, 's3cr3t')).toBe(false)
    expect(firmaValida(cuerpo, 'sha256=corta', 's3cr3t')).toBe(false)
  })

  it('funciona con bytes y con texto no ASCII', () => {
    const texto = '{"t":"¿llegan a Niquía? 🍕"}'
    const bytes = new TextEncoder().encode(texto)
    expect(firmaValida(bytes, firmar(texto, 'k'), 'k')).toBe(true)
  })
})
