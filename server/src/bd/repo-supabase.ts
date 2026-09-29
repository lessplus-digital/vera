import type { SupabaseClient } from './supabase.js'
import { UNIQUE_VIOLATION } from './supabase.js'
import {
  hoyColombia,
  type AccionFeedback,
  type Cliente,
  type MensajeHistorial,
  type PedidoFeedback,
  type Repo,
} from './repo.js'

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
