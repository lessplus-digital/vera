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
    await sb.from('carritos').delete().eq('telefono', TEL)
    await sb.from('conversaciones').delete().eq('telefono', TEL)
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

  // ── Fase 4: lo que lee y escribe la decisión ─────────────────────────────
  it('RepoSupabase: conversación — guarda y lee la última pregunta completa', async () => {
    const repo = new RepoSupabase(sb)
    expect(await repo.leerConversacion(TEL)).toEqual({ handler: null, ultima_pregunta: null, reserva: null })
    const c = { handler: 'pedidos' as const, ultima_pregunta: { tipo: 'sugerir_barrio' as const, barrio: 'Niquía' }, reserva: null }
    await repo.guardarConversacion(TEL, c)
    expect(await repo.leerConversacion(TEL)).toEqual(c)
    // El borrador de la reserva (columna conversaciones.reserva) va y vuelve completo.
    const r = {
      handler: 'reservas' as const,
      ultima_pregunta: { tipo: 'nombre' as const },
      reserva: { personas: 4, fecha: '2026-10-03', hora: '19:00', motivo: 'cumpleanos', verificado: '2026-10-03|19:00|4' },
    }
    await repo.guardarConversacion(TEL, r)
    expect(await repo.leerConversacion(TEL)).toEqual(r)
  })

  it('RepoSupabase: consultar_cobertura — errata con sugerencia, y barrio cubierto con tarifa', async () => {
    const repo = new RepoSupabase(sb)
    const mal = await repo.consultarCobertura('niqia')
    expect(mal).toMatchObject({ cubierto: false, costo_domicilio: null, tiempo_estimado: null, sugerencias: ['Niquía'] })
    const bien = await repo.consultarCobertura('Niquía')
    expect(bien.cubierto).toBe(true)
    expect(bien.costo_domicilio).toBeGreaterThan(0)
  })

  it('RepoSupabase: guardar_datos_pedido + estado_pedido — faltantes en orden', async () => {
    const repo = new RepoSupabase(sb)
    expect(await repo.estadoPedido(TEL)).toBeNull()
    await repo.guardarDatosPedido(TEL, { tipo_pedido: 'domicilio', metodo_pago: 'Efectivo' })
    expect(await repo.estadoPedido(TEL)).toMatchObject({ n_items: 0, paso_flujo: 'armando', faltantes: ['carrito'], tipo_pedido: 'domicilio' })
  })

  // ── Fase 5: agente Pedidos ───────────────────────────────────────────────
  it('RepoSupabase: estado_pedido trae lo que necesita el resumen (dirección, pago, tarifa)', async () => {
    const repo = new RepoSupabase(sb)
    await repo.guardarDatosPedido(TEL, { barrio: 'Niquía', costo_domicilio: 7500, cobertura_ok: true, direccion_entrega: 'Calle 1 # 2-3' })
    expect(await repo.estadoPedido(TEL)).toMatchObject({
      direccion_entrega: 'Calle 1 # 2-3',
      metodo_pago: 'Efectivo',
      costo_domicilio: 7500,
      cobertura_ok: true,
    })
  })

  it('RepoSupabase: info_negocio y dirección registrada del cliente', async () => {
    const repo = new RepoSupabase(sb)
    expect(await repo.infoNegocio('datos_transferencia')).toMatch(/\d{6,}/)
    expect(await repo.infoNegocio('clave_que_no_existe')).toBeNull()
    const c = await repo.clientePorTelefono(TEL)
    await repo.actualizarDireccionCliente(c.cliente_id, { direccion_principal: 'Calle 1 # 2-3', barrio: 'Niquía' })
    expect(await repo.clientePorTelefono(TEL)).toMatchObject({ direccion_principal: 'Calle 1 # 2-3', barrio: 'Niquía' })
  })

  it('RepoSupabase: crear_orden_desde_carrito — sin productos no crea nada', async () => {
    const repo = new RepoSupabase(sb)
    const c = await repo.clientePorTelefono(TEL)
    expect(await repo.crearOrdenDesdeCarrito(TEL, c.cliente_id)).toMatchObject({ ok: false, error: 'CARRITO_VACIO' })
    expect(await repo.carritoVaciar(TEL)).toMatchObject({ ok: true })
  })

  // ── Fase 5: menú y carrito ───────────────────────────────────────────────
  it('RepoSupabase: buscarMenu separa disponibles y agotados, con precios por tamaño', async () => {
    const repo = new RepoSupabase(sb)
    const r = await repo.buscarMenu('hawaiana')
    const trad = r.disponibles.find((p) => p.producto_id === 'PROD-010')
    expect(trad).toMatchObject({ nombre: 'Hawaiana', variante: 'Tradicional' })
    expect(trad?.tamanos?.mediana).toBeGreaterThan(0)
    expect(r.agotados.every((p) => typeof p.producto_id === 'string')).toBe(true)
  })

  it('RepoSupabase: carrito — agregar, mitad y quitar, con la masa leída del menú', async () => {
    const repo = new RepoSupabase(sb)
    expect(await repo.carritoAgregarItem(TEL, { producto_id: 'PROD-015', tamano: 'mediana', cantidad: 2 })).toMatchObject({ ok: true })
    expect(await repo.carritoAgregarMitad(TEL, { producto_a: 'PROD-010', producto_b: 'PROD-031', tamano: 'grande', cantidad: 1 })).toMatchObject({ ok: true })
    expect(await repo.carritoAgregarItem(TEL, { producto_id: 'PROD-010', cantidad: 1 })).toMatchObject({ ok: false, error: 'TAMANO_REQUERIDO' })
    const c = await repo.carrito(TEL)
    expect(c.lineas.map((l) => [l.linea, l.masa, l.variante, l.cantidad])).toEqual([
      [1, 'Estofada', 'Mediana', 2],
      [2, 'Tradicional', 'Grande', 1],
    ])
    expect(c.total).toBe(c.lineas.reduce((s, l) => s + l.subtotal, 0))
    expect(await repo.carritoQuitarItem(TEL, 1, 1)).toMatchObject({ ok: true })
    expect((await repo.carrito(TEL)).lineas[0]?.cantidad).toBe(1)
    expect(await repo.cotizarMitad('PROD-010', 'PROD-015', 'grande')).toMatchObject({ ok: false, error: 'MASA_DISTINTA' })
    await repo.carritoVaciar(TEL)
  })

  // ── Fase 5: soporte ──────────────────────────────────────────────────────
  it('RepoSupabase: soporte — info_negocio completa, FAQ activas, pedidos del cliente y nombre', async () => {
    const repo = new RepoSupabase(sb)
    const info = await repo.infoNegocioTodo()
    expect(info.direccion).toBeTruthy()
    expect(Object.values(info).every((v) => v.trim().length > 0)).toBe(true)
    const faqs = await repo.consultarFaq('parqueadero')
    expect(faqs.every((f) => typeof f.pregunta === 'string' && typeof f.respuesta === 'string')).toBe(true)
    expect(await repo.pedidosRecientes(TEL, 3)).toEqual([]) // el teléfono de prueba no tiene pedidos
    const c = await repo.clientePorTelefono(TEL)
    await repo.actualizarNombreCliente(c.cliente_id, 'Prueba Soporte')
    expect((await repo.clientePorTelefono(TEL)).nombre).toBe('Prueba Soporte')
  })

  // ── Fase 5: reservas (sin crear ninguna: solo caminos que no escriben) ────
  it('RepoSupabase: reservas — motivos, disponibilidad, lista y los rechazos de crear/cancelar', async () => {
    const repo = new RepoSupabase(sb)
    const motivos = await repo.motivosReserva()
    expect(motivos.find((m) => m.clave === 'sin_ocasion')).toMatchObject({ costo: 0 })
    expect(motivos.every((m) => typeof m.costo === 'number')).toBe(true)

    // Un sábado dentro de 14 días, a una hora válida.
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7))
    const sabado = d.toISOString().slice(0, 10)
    expect(await repo.consultarDisponibilidadReserva(sabado, '19:00', 4)).toMatchObject({ ok: true, fecha: sabado, hora: '19:00' })
    expect(await repo.consultarDisponibilidadReserva(sabado, '23:00', 4)).toMatchObject({ ok: false, error: 'FUERA_DE_HORARIO' })
    expect(await repo.consultarDisponibilidadReserva(sabado, '19:00', 20)).toMatchObject({ ok: false, error: 'PERSONAS_FUERA_DE_RANGO' })

    expect(await repo.reservasDelCliente(TEL)).toEqual([])
    expect(await repo.cancelarReserva(TEL, 'RES-NO-EXISTE')).toMatchObject({ ok: false, error: 'RESERVA_NO_ENCONTRADA' })
    const c = await repo.clientePorTelefono(TEL)
    const r = await repo.crearReserva({ telefono: TEL, cliente_id: c.cliente_id, nombre: 'Prueba', fecha: sabado, hora: '19:00', personas: 2, motivo: 'no_existe' })
    expect(r).toMatchObject({ ok: false, error: 'MOTIVO_INVALIDO' })
    expect(await repo.reservasDelCliente(TEL)).toEqual([])
  })
})
