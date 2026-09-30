import type { SupabaseClient } from './supabase.js'
import { UNIQUE_VIOLATION } from './supabase.js'
import {
  hoyColombia,
  type AccionFeedback,
  type Cliente,
  type Carrito,
  type Cobertura,
  type LineaCarrito,
  type ProductoMenu,
  type ResultadoMenu,
  type DatosFlujo,
  type PedidoCreado,
  type RespuestaRPC,
  type MensajeHistorial,
  type PedidoFeedback,
  type Repo,
} from './repo.js'
import type { Conversacion, EstadoPedido, UltimaPregunta } from '../decision/contexto.js'

const BUCKET = 'comprobantes'
const COLUMNAS_CLIENTE = 'cliente_id, telefono, nombre, modo, direccion_principal, barrio'

/** Lanza con contexto: los errores de PostgREST no son excepciones por sí solos. */
function exigir<T>(r: { data: T; error: { message: string; code?: string } | null }, que: string): T {
  if (r.error) throw new Error(`${que}: ${r.error.message}${r.error.code ? ` (${r.error.code})` : ''}`)
  return r.data
}

export class RepoSupabase implements Repo {
  constructor(private readonly sb: SupabaseClient) {}

  async clientePorTelefono(telefono: string): Promise<Cliente> {
    const existente = exigir(
      await this.sb.from('clientes').select(COLUMNAS_CLIENTE).eq('telefono', telefono).maybeSingle(),
      'leer cliente',
    )
    if (existente) return normalizarCliente(existente)

    const r = await this.sb
      .from('clientes')
      .insert({ telefono, nombre: 'Pendiente', modo: 'bot', fecha_registro: hoyColombia() })
      .select(COLUMNAS_CLIENTE)
      .single()
    // Carrera improbable (el buffer serializa por teléfono), pero si otro proceso
    // lo creó en medio, se lee el que quedó.
    if (r.error?.code === UNIQUE_VIOLATION) return this.clientePorTelefono(telefono)
    const creado = exigir(r, 'crear cliente')
    if (!creado) throw new Error('crear cliente: la BD no devolvió la fila')
    return normalizarCliente(creado)
  }

  async guardarMensajeSoporte(m: {
    telefono: string
    mensaje: string
    tipo_contenido: 'texto' | 'imagen'
    imagen_url?: string | null
  }) {
    exigir(
      await this.sb.from('mensajes_soporte').insert({
        telefono: m.telefono,
        origen: 'cliente',
        mensaje: m.mensaje,
        tipo_contenido: m.tipo_contenido,
        imagen_url: m.imagen_url ?? null,
      }),
      'guardar mensaje de soporte',
    )
  }

  async procesarRespuestaFeedback(telefono: string, mensaje: string): Promise<AccionFeedback> {
    const data = exigir(
      await this.sb.rpc('procesar_respuesta_feedback', { p_telefono: telefono, p_mensaje: mensaje }),
      'procesar_respuesta_feedback',
    ) as { accion?: AccionFeedback } | null
    return data?.accion ?? 'sin_pendiente'
  }

  async solicitarFeedbackLote(limite: number): Promise<PedidoFeedback[]> {
    return (exigir(await this.sb.rpc('solicitar_feedback_lote', { p_limite: limite }), 'solicitar_feedback_lote') ??
      []) as PedidoFeedback[]
  }

  async pedidoPendienteDeComprobante(telefono: string) {
    // Puede haber varios: se toma el más reciente sin comprobante (edge-case 18).
    return exigir(
      await this.sb
        .from('pedidos')
        .select('pedido_id')
        .eq('telefono', telefono)
        .eq('estado', 'pendiente')
        .eq('metodo_pago', 'Transferencia')
        .eq('estado_pago', 'pendiente')
        .is('comprobante_url', null)
        .order('fecha_pedido', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'buscar pedido para comprobante',
    )
  }

  async adjuntarComprobante(pedidoId: string, url: string) {
    exigir(
      await this.sb.from('pedidos').update({ comprobante_url: url }).eq('pedido_id', pedidoId),
      'adjuntar comprobante',
    )
  }

  async subirImagen(ruta: string, bytes: Uint8Array, mime: string): Promise<string> {
    exigir(
      await this.sb.storage.from(BUCKET).upload(ruta, bytes, { contentType: mime, upsert: true }),
      'subir imagen',
    )
    return this.sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
  }

  async pasarAHumano(clienteId: string) {
    exigir(await this.sb.from('clientes').update({ modo: 'humano' }).eq('cliente_id', clienteId), 'pasar a humano')
  }

  async agregarHistorial(telefono: string, m: MensajeHistorial) {
    exigir(
      await this.sb.from('n8n_chat_histories').insert({
        session_id: telefono,
        message: { type: m.tipo, content: m.texto, additional_kwargs: {}, response_metadata: {} },
      }),
      'guardar historial',
    )
  }

  async leerHistorial(telefono: string, limite: number): Promise<MensajeHistorial[]> {
    const filas = exigir(
      await this.sb
        .from('n8n_chat_histories')
        .select('message')
        .eq('session_id', telefono)
        .order('id', { ascending: false })
        .limit(limite),
      'leer historial',
    ) as { message: { type?: string; content?: unknown } }[]
    return filas
      .reverse()
      .filter((f) => (f.message.type === 'human' || f.message.type === 'ai') && typeof f.message.content === 'string')
      .map((f) => ({ tipo: f.message.type as 'human' | 'ai', texto: f.message.content as string }))
  }

  // ── Decisión (Fase 4) ────────────────────────────────────────────────────
  async estadoPedido(telefono: string): Promise<EstadoPedido | null> {
    const e = exigir(
      await this.sb
        .from('estado_pedido')
        .select('n_items, paso_flujo, faltantes, tipo_pedido, barrio, cobertura_ok')
        .eq('telefono', telefono)
        .maybeSingle(),
      'leer estado_pedido',
    )
    return e ? { ...e, faltantes: Array.isArray(e.faltantes) ? e.faltantes : [] } as EstadoPedido : null
  }

  async leerConversacion(telefono: string): Promise<Conversacion> {
    const c = exigir(
      await this.sb.from('conversaciones').select('handler, pendiente').eq('telefono', telefono).maybeSingle(),
      'leer conversación',
    )
    return leerFilaConversacion(c)
  }

  async guardarConversacion(telefono: string, c: Conversacion) {
    exigir(
      await this.sb.from('conversaciones').upsert({
        telefono,
        handler: c.handler,
        // `ultima_pregunta` (texto) es para leer a ojo en el dashboard; la pregunta completa va en `pendiente`.
        ultima_pregunta: c.ultima_pregunta?.tipo ?? null,
        pendiente: c.ultima_pregunta,
        actualizado_el: new Date().toISOString(),
      }),
      'guardar conversación',
    )
  }

  async consultarCobertura(barrio: string): Promise<Cobertura> {
    const r = exigir(await this.sb.rpc('consultar_cobertura', { p_barrio: barrio }), 'consultar_cobertura') as Record<string, unknown>
    return {
      cubierto: r.cubierto === true,
      barrio: String(r.barrio ?? barrio),
      zona: (r.zona as string | null) ?? null,
      costo_domicilio: r.cubierto === true && r.costo_domicilio != null ? Number(r.costo_domicilio) : null,
      tiempo_estimado: r.cubierto === true ? ((r.tiempo_estimado as string | null) ?? null) : null,
      sugerencias: Array.isArray(r.sugerencias) ? r.sugerencias.map(String) : [],
    }
  }

  async guardarDatosPedido(telefono: string, d: DatosFlujo): Promise<RespuestaRPC> {
    return exigir(
      await this.sb.rpc('guardar_datos_pedido', {
        p_telefono: telefono,
        p_tipo_pedido: d.tipo_pedido ?? null,
        p_barrio: d.barrio ?? null,
        p_direccion_entrega: d.direccion_entrega ?? null,
        p_metodo_pago: d.metodo_pago ?? null,
        p_costo_domicilio: d.costo_domicilio ?? null,
        p_cobertura_ok: d.cobertura_ok ?? null,
        p_paso_flujo: d.paso_flujo ?? null,
      }),
      'guardar_datos_pedido',
    ) as RespuestaRPC
  }

  async carritoVaciar(telefono: string): Promise<RespuestaRPC> {
    return exigir(await this.sb.rpc('carrito_vaciar', { p_telefono: telefono }), 'carrito_vaciar') as RespuestaRPC
  }

  async crearOrdenDesdeCarrito(telefono: string, clienteId: string) {
    const r = exigir(
      await this.sb.rpc('crear_orden_desde_carrito', { p_telefono: telefono, p_cliente_id: clienteId }),
      'crear_orden_desde_carrito',
    ) as RespuestaRPC
    if (!r.ok) return r as RespuestaRPC & { ok: false }
    return { ...r, ok: true, pedido_id: String(r.pedido_id), total: Number(r.total), costo_domicilio: Number(r.costo_domicilio ?? 0) } as PedidoCreado
  }

  // ── Menú y carrito (Fase 5) ──────────────────────────────────────────────
  async buscarMenu(termino: string): Promise<ResultadoMenu> {
    // solo_disponibles=false: los agotados también vuelven, para decir "hoy se agotó"
    // en vez de "no lo manejamos".
    const filas = exigir(
      await this.sb.rpc('buscar_menu', { termino, umbral: 0.2, limite: 15, solo_disponibles: false }),
      'buscar_menu',
    ) as Record<string, unknown>[]
    const r: ResultadoMenu = { disponibles: [], agotados: [] }
    for (const f of filas ?? []) (f.disponible ? r.disponibles : r.agotados).push(aProducto(f))
    return r
  }

  async carrito(telefono: string): Promise<Carrito> {
    const fila = exigir(
      await this.sb.from('carritos').select('items, total').eq('telefono', telefono).maybeSingle(),
      'leer carrito',
    ) as { items: unknown; total: unknown } | null
    const items = Array.isArray(fila?.items) ? (fila.items as Record<string, unknown>[]) : []
    if (!items.length) return { lineas: [], total: 0 }
    const ids = [...new Set(items.map((i) => String(i.producto_id)))]
    const menu = exigir(await this.sb.from('menu').select('producto_id, variante').in('producto_id', ids), 'leer masas') as {
      producto_id: string
      variante: string | null
    }[]
    const masa = new Map(menu.map((m) => [m.producto_id, m.variante]))
    return { lineas: items.map((i, n) => aLinea(i, n + 1, masa)), total: Number(fila?.total ?? 0) }
  }

  async carritoAgregarItem(telefono: string, i: { producto_id: string; tamano?: string | null; cantidad: number; notas?: string | null }) {
    return exigir(
      await this.sb.rpc('carrito_agregar_item', {
        p_telefono: telefono,
        p_producto_id: i.producto_id,
        p_tamano: i.tamano ?? null,
        p_cantidad: i.cantidad,
        p_notas: i.notas ?? null,
      }),
      'carrito_agregar_item',
    ) as RespuestaRPC
  }

  async carritoAgregarMitad(
    telefono: string,
    m: { producto_a: string; producto_b: string; tamano: string; cantidad: number; notas?: string | null },
  ) {
    return exigir(
      await this.sb.rpc('carrito_agregar_mitad', {
        p_telefono: telefono,
        p_producto_a: m.producto_a,
        p_producto_b: m.producto_b,
        p_tamano: m.tamano,
        p_cantidad: m.cantidad,
        p_notas: m.notas ?? null,
      }),
      'carrito_agregar_mitad',
    ) as RespuestaRPC
  }

  async carritoQuitarItem(telefono: string, linea: number, cantidad?: number | null) {
    return exigir(
      await this.sb.rpc('carrito_quitar_item', { p_telefono: telefono, p_linea: linea, p_cantidad: cantidad ?? null }),
      'carrito_quitar_item',
    ) as RespuestaRPC
  }

  async cotizarMitad(productoA: string, productoB: string, tamano: string) {
    return exigir(
      await this.sb.rpc('cotizar_mitad_y_mitad', { p_producto_a: productoA, p_producto_b: productoB, p_tamano: tamano }),
      'cotizar_mitad_y_mitad',
    ) as RespuestaRPC
  }
}

function aProducto(f: Record<string, unknown>): ProductoMenu {
  let tamanos: Record<string, number> | null = null
  const t = f['tamaño']
  if (t) {
    try {
      const obj = (typeof t === 'string' ? JSON.parse(t) : t) as Record<string, unknown>
      tamanos = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v)]))
    } catch {
      tamanos = null
    }
  }
  return {
    producto_id: String(f.producto_id),
    nombre: String(f.nombre),
    categoria: String(f.categoria ?? ''),
    variante: (f.variante as string | null) || null,
    descripcion: (f.descripcion as string | null) ?? null,
    precio: Number(f.precio),
    tamanos,
    similitud: Math.round(Number(f.similitud ?? 0) * 100) / 100,
  }
}

export function aLinea(i: Record<string, unknown>, linea: number, masa: Map<string, string | null>): LineaCarrito {
  const mitades = Array.isArray(i.mitades)
    ? (i.mitades as Record<string, unknown>[]).map((m) => ({ nombre: String(m.nombre), variante: (m.variante as string | null) ?? null }))
    : null
  return {
    linea,
    producto_id: String(i.producto_id),
    nombre: String(i.nombre),
    variante: (i.variante as string | null) ?? null,
    masa: mitades ? (mitades[0]?.variante ?? null) : (masa.get(String(i.producto_id)) ?? null),
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    subtotal: Number(i.subtotal),
    notas: (i.notas as string | null) ?? null,
    mitades,
  }
}

const PREGUNTAS = new Set(['confirmar_pedido', 'dato_pedido', 'sugerir_barrio', 'agregar_producto', 'algo_mas', 'confirmar_reserva', 'cancelar_reserva'])
const HANDLERS = new Set(['menu', 'pedidos', 'soporte', 'reservas'])

/** La fila puede venir de una versión anterior del bot: lo que no se reconoce se ignora. */
export function leerFilaConversacion(c: { handler?: unknown; pendiente?: unknown } | null): Conversacion {
  const p = c?.pendiente as { tipo?: unknown } | null | undefined
  return {
    handler: HANDLERS.has(String(c?.handler)) ? (c!.handler as Conversacion['handler']) : null,
    ultima_pregunta: p && typeof p === 'object' && PREGUNTAS.has(String(p.tipo)) ? (p as UltimaPregunta) : null,
  }
}

function normalizarCliente(c: Record<string, unknown>): Cliente {
  const modo = c.modo === 'humano' || c.modo === 'esperando_feedback' ? c.modo : 'bot'
  return {
    cliente_id: String(c.cliente_id),
    telefono: String(c.telefono),
    nombre: (c.nombre as string | null) ?? null,
    modo,
    direccion_principal: (c.direccion_principal as string | null) ?? null,
    barrio: (c.barrio as string | null) ?? null,
  }
}
