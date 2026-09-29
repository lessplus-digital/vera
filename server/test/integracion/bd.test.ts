import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { crearSupabase } from '../../src/bd/supabase.js'
import { DedupeBD, insertarWaEventoSupabase } from '../../src/cola/dedupe.js'
import { RegistroBD, Turno } from '../../src/log/turnos.js'
import { loggerMudo } from '../../src/log.js'
import { RepoSupabase } from '../../src/bd/repo-supabase.js'

// Pruebas contra la Supabase REAL. Solo corren si server/.env tiene
// SUPABASE_URL y SUPABASE_SECRET_KEY; si no, se saltan (no fallan).
// Usan el teléfono de prueba 573000000990 y borran lo que escriben.

if (existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL
const clave = process.env.SUPABASE_SECRET_KEY
const TEL = '573000000990'
// El bucket `comprobantes` solo acepta image/*: se sube un PNG real de 1×1.
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

describe.skipIf(!url || !clave)('integración con Supabase', () => {
  // skipIf no evita que se arme el bloque: el cliente solo se crea si hay credenciales.
  const sb = url && clave ? crearSupabase(url, clave) : (null as never)
  const wamid = `wamid.PRUEBA.${Date.now()}`

  afterAll(async () => {
    await sb.from('wa_eventos').delete().eq('telefono', TEL)
    await sb.from('bot_turnos').delete().eq('telefono', TEL)
    await sb.from('n8n_chat_histories').delete().eq('session_id', TEL)
    await sb.from('mensajes_soporte').delete().eq('telefono', TEL)
    await sb.from('clientes').delete().eq('telefono', TEL) // cascada: sus pedidos
    await sb.storage.from('comprobantes').remove([`soporte/${TEL}/prueba.png`])
  })

  it('RepoSupabase: crea el cliente la primera vez y lo reutiliza después', async () => {
    const repo = new RepoSupabase(sb)
    const a = await repo.clientePorTelefono(TEL)
    const b = await repo.clientePorTelefono(TEL)
    expect(a).toMatchObject({ telefono: TEL, nombre: 'Pendiente', modo: 'bot' })
    expect(b.cliente_id).toBe(a.cliente_id)
  })

  it('RepoSupabase: historial en el formato que lee registrar_contexto_handoff', async () => {
    const repo = new RepoSupabase(sb)
    await repo.agregarHistorial(TEL, { tipo: 'human', texto: 'hola' })
    await repo.agregarHistorial(TEL, { tipo: 'ai', texto: '¡Hola! ¿Qué se te antoja?' })
    expect(await repo.leerHistorial(TEL, 10)).toEqual([
      { tipo: 'human', texto: 'hola' },
      { tipo: 'ai', texto: '¡Hola! ¿Qué se te antoja?' },
    ])
  })

  it('RepoSupabase: mensaje de soporte y subida de archivo al bucket', async () => {
    const repo = new RepoSupabase(sb)
    await repo.guardarMensajeSoporte({ telefono: TEL, mensaje: 'prueba', tipo_contenido: 'texto' })
    const url = await repo.subirImagen(`soporte/${TEL}/prueba.png`, PNG_1X1, 'image/png')
    expect(url).toMatch(new RegExp(`/comprobantes/soporte/${TEL}/prueba\\.png$`))
  })

  it('RepoSupabase: sin pedidos por transferencia → null', async () => {
    expect(await new RepoSupabase(sb).pedidoPendienteDeComprobante(TEL)).toBeNull()
  })

  it('wa_eventos: el mismo wamid solo pasa una vez', async () => {
    const d = new DedupeBD(insertarWaEventoSupabase(sb), loggerMudo)
    expect(await d.primeraVez(wamid, TEL)).toBe(true)
    expect(await d.primeraVez(wamid, TEL)).toBe(false)
  })

  it('bot_turnos: el turno queda guardado y legible', async () => {
    const turno = new Turno(TEL, [])
    turno.salida.push('prueba de integración')
    await new RegistroBD(sb, loggerMudo).guardar(turno.cerrar())
    const { data, error } = await sb.from('bot_turnos').select('salida').eq('telefono', TEL)
    expect(error).toBeNull()
    expect(data).toEqual([{ salida: ['prueba de integración'] }])
  })

  it('las RPC del carrito responden (precio desde el menú)', async () => {
    const { data, error } = await sb.rpc('precio_producto', { p_producto_id: 'PROD-006', p_tamano: 'grande' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true, producto_id: 'PROD-006', tamano: 'grande' })
  })
})
