import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { crearSupabase } from '../../src/bd/supabase.js'
import { DedupeBD, insertarWaEventoSupabase } from '../../src/cola/dedupe.js'
import { RegistroBD, Turno } from '../../src/log/turnos.js'
import { loggerMudo } from '../../src/log.js'

// Pruebas contra la Supabase REAL. Solo corren si server/.env tiene
// SUPABASE_URL y SUPABASE_SECRET_KEY; si no, se saltan (no fallan).
// Usan el teléfono de prueba 573000000990 y borran lo que escriben.

if (existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL
const clave = process.env.SUPABASE_SECRET_KEY
const TEL = '573000000990'

describe.skipIf(!url || !clave)('integración con Supabase', () => {
  // skipIf no evita que se arme el bloque: el cliente solo se crea si hay credenciales.
  const sb = url && clave ? crearSupabase(url, clave) : (null as never)
  const wamid = `wamid.PRUEBA.${Date.now()}`

  afterAll(async () => {
    await sb.from('wa_eventos').delete().eq('telefono', TEL)
    await sb.from('bot_turnos').delete().eq('telefono', TEL)
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
