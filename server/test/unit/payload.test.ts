import { describe, expect, it } from 'vitest'
import { parsearWebhook, remapearBoton } from '../../src/whatsapp/payload.js'
import { payloadBoton, payloadEstado, payloadImagen, payloadTexto, payloadTipo } from '../../src/sim/meta.js'

const tel = '573113298122'

describe('parsearWebhook', () => {
  it('texto: teléfono, nombre del perfil, wamid y cuerpo', () => {
    const [m, ...resto] = parsearWebhook(payloadTexto({ telefono: tel, nombre: 'Juan', texto: 'hola', wamid: 'w1', timestamp: 100 }))
    expect(resto).toHaveLength(0)
    expect(m).toEqual({ wamid: 'w1', telefono: tel, nombre: 'Juan', timestamp: 100, tipo: 'texto', texto: 'hola' })
  })

  it('imagen: id, mime y caption', () => {
    const [m] = parsearWebhook(payloadImagen({ telefono: tel, imagenId: 'img9', mime: 'image/png', caption: 'comprobante' }))
    expect(m).toMatchObject({ tipo: 'imagen', imagenId: 'img9', mime: 'image/png', caption: 'comprobante' })
  })

  it('botón de plantilla: remapea Confirmar/Cancelar y deja pasar el resto', () => {
    expect(parsearWebhook(payloadBoton({ telefono: tel, texto: 'Confirmar' }))[0]).toMatchObject({ tipo: 'boton', texto: 'Confirmar mi reserva' })
    expect(parsearWebhook(payloadBoton({ telefono: tel, texto: 'Cancelar' }))[0]).toMatchObject({ texto: 'Cancelar mi reserva' })
    expect(parsearWebhook(payloadBoton({ telefono: tel, texto: 'Quiero pedir' }))[0]).toMatchObject({ texto: 'Quiero pedir' })
  })

  it('interactive (button_reply y list_reply) se trata como botón', () => {
    const base = payloadTexto({ telefono: tel, texto: 'x' }) as any
    const msg = base.entry[0].changes[0].value.messages[0]
    delete msg.text
    msg.type = 'interactive'
    msg.interactive = { type: 'button_reply', button_reply: { id: 'b1', title: 'Cancelar' } }
    expect(parsearWebhook(base)[0]).toMatchObject({ tipo: 'boton', texto: 'Cancelar mi reserva' })
    msg.interactive = { type: 'list_reply', list_reply: { id: 'l1', title: 'Pizza hawaiana' } }
    expect(parsearWebhook(base)[0]).toMatchObject({ tipo: 'boton', texto: 'Pizza hawaiana' })
  })

  it('audio, ubicación, sticker → no_soportado (no se descartan en silencio)', () => {
    for (const tipo of ['audio', 'location', 'sticker', 'video', 'document']) {
      expect(parsearWebhook(payloadTipo({ telefono: tel, tipo }))[0]).toMatchObject({ tipo: 'no_soportado', tipoOriginal: tipo })
    }
  })

  it('acuses de entrega/lectura y basura → nada', () => {
    expect(parsearWebhook(payloadEstado(tel))).toEqual([])
    expect(parsearWebhook({})).toEqual([])
    expect(parsearWebhook(null)).toEqual([])
    expect(parsearWebhook({ object: 'page', entry: [] })).toEqual([])
  })

  it('sin contacts → nombre vacío, no revienta', () => {
    const p = payloadTexto({ telefono: tel, texto: 'hola' }) as any
    delete p.entry[0].changes[0].value.contacts
    expect(parsearWebhook(p)[0]).toMatchObject({ nombre: '', texto: 'hola' })
  })

  it('remapearBoton recorta espacios', () => {
    expect(remapearBoton('  Confirmar ')).toBe('Confirmar mi reserva')
  })
})
