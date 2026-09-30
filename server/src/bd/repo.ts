// Todo lo que el núcleo del bot lee o escribe en la BD pasa por esta interfaz.
// Implementaciones: RepoSupabase (producción) y RepoMemoria (pruebas y simulador).
// Regla: la lógica de negocio que puede vivir en Postgres vive allí (RPC con
// pruebas en qa/sql/); aquí solo hay lecturas y escrituras simples.

import type { Conversacion, EstadoPedido, PasoFlujo } from '../decision/contexto.js'

export type ModoCliente = 'bot' | 'humano' | 'esperando_feedback'

export type Cliente = {
  cliente_id: string
  telefono: string
  nombre: string | null
  modo: ModoCliente
  direccion_principal: string | null
  barrio: string | null
}

/** Lo que devuelve procesar_respuesta_feedback (ver docs/bot/feedback.md). */
export type AccionFeedback = 'positiva' | 'pedir_comentario' | 'agradecer' | 'nota_invalida' | 'sin_pendiente'

export type PedidoFeedback = { pedido_id: string; cliente_id: string; telefono: string; nombre: string | null }

export type MensajeHistorial = { tipo: 'human' | 'ai'; texto: string }

/** consultar_cobertura en modo barrio. Sin cobertura, costo y tiempo vienen en null A PROPÓSITO (BUG-033). */
export type Cobertura = {
  cubierto: boolean
  barrio: string
  zona: string | null
  costo_domicilio: number | null
  tiempo_estimado: string | null
  sugerencias: string[]
}

/** Lo que se puede guardar del flujo del pedido (guardar_datos_pedido, semántica COALESCE por campo). */
export type DatosFlujo = {
  tipo_pedido?: 'domicilio' | 'recoger'
  barrio?: string
  direccion_entrega?: string
  metodo_pago?: 'Efectivo' | 'Transferencia'
  costo_domicilio?: number
  cobertura_ok?: boolean
  paso_flujo?: PasoFlujo
}

/** Respuesta de las RPC del bot: `{ok, error?, message?, …}` con códigos estables. */
export type RespuestaRPC = { ok: boolean; error?: string; message?: string; [k: string]: unknown }

export type PedidoCreado = { ok: true; pedido_id: string; total: number; costo_domicilio: number; tipo_pedido: string; metodo_pago: string }

export interface Repo {
  /** Busca el cliente por teléfono; si no existe lo crea (nombre 'Pendiente', modo 'bot'). */
  clientePorTelefono(telefono: string): Promise<Cliente>

  /** Mensaje del cliente al chat de soporte (modo humano). */
  guardarMensajeSoporte(m: {
    telefono: string
    mensaje: string
    tipo_contenido: 'texto' | 'imagen'
    imagen_url?: string | null
  }): Promise<void>

  procesarRespuestaFeedback(telefono: string, mensaje: string): Promise<AccionFeedback>
  solicitarFeedbackLote(limite: number): Promise<PedidoFeedback[]>

  /** Pedido más reciente pendiente de pago por transferencia y sin comprobante. */
  pedidoPendienteDeComprobante(telefono: string): Promise<{ pedido_id: string } | null>
  adjuntarComprobante(pedidoId: string, url: string): Promise<void>

  /** Sube al bucket `comprobantes` y devuelve la URL pública. */
  subirImagen(ruta: string, bytes: Uint8Array, mime: string): Promise<string>

  /** modo → 'humano'. El trigger trigger_contexto_handoff copia el historial al chat de soporte. */
  pasarAHumano(clienteId: string): Promise<void>

  /** Historial en n8n_chat_histories (mismo formato que lee registrar_contexto_handoff). */
  agregarHistorial(telefono: string, m: MensajeHistorial): Promise<void>
  leerHistorial(telefono: string, limite: number): Promise<MensajeHistorial[]>

  // ── Decisión (Fase 4) ────────────────────────────────────────────────────
  /** Vista estado_pedido. null = no hay fila de carrito. */
  estadoPedido(telefono: string): Promise<EstadoPedido | null>
  /** Tabla conversaciones: quién lleva el hilo y qué preguntó el bot por última vez. */
  leerConversacion(telefono: string): Promise<Conversacion>
  guardarConversacion(telefono: string, c: Conversacion): Promise<void>

  consultarCobertura(barrio: string): Promise<Cobertura>
  guardarDatosPedido(telefono: string, d: DatosFlujo): Promise<RespuestaRPC>
  carritoVaciar(telefono: string): Promise<RespuestaRPC>
  /** Exige paso_flujo='resumen' y faltantes=[] en la BD; si no, {ok:false, error}. */
  crearOrdenDesdeCarrito(telefono: string, clienteId: string): Promise<PedidoCreado | (RespuestaRPC & { ok: false })>
}

/** Fecha de hoy en Colombia (YYYY-MM-DD), para columnas `date` como fecha_registro. */
export function hoyColombia(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
}
