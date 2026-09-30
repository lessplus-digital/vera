// Todo lo que el núcleo del bot lee o escribe en la BD pasa por esta interfaz.
// Implementaciones: RepoSupabase (producción) y RepoMemoria (pruebas y simulador).
// Regla: la lógica de negocio que puede vivir en Postgres vive allí (RPC con
// pruebas en qa/sql/); aquí solo hay lecturas y escrituras simples.

import type { Conversacion, EstadoPedido, PasoFlujo } from '../decision/contexto.js'
import type { MotivoReserva } from '../decision/reserva.js'

export type { MotivoReserva }

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

/** Un producto de `buscar_menu`. `variante` es la masa (Tradicional / Estofada) o null. */
export type ProductoMenu = {
  producto_id: string
  nombre: string
  categoria: string
  variante: string | null
  descripcion: string | null
  precio: number
  /** Precio por tamaño (pizzas); null si el producto tiene un solo precio. */
  tamanos: Record<string, number> | null
  similitud: number
}

export type ResultadoMenu = { disponibles: ProductoMenu[]; agotados: ProductoMenu[] }

/** Una línea del carrito, numerada desde 1 (es lo que recibe carrito_quitar_item). */
export type LineaCarrito = {
  linea: number
  producto_id: string
  nombre: string
  /** Tamaño ("Mediana") o null. */
  variante: string | null
  /** Masa leída del menú ("Tradicional" / "Estofada"): el nombre solo no distingue la hawaiana tradicional de la estofada. */
  masa: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
  notas: string | null
  mitades: { nombre: string; variante: string | null }[] | null
}

export type Carrito = { lineas: LineaCarrito[]; total: number }

export type PedidoCreado = {
  ok: true
  pedido_id: string
  total: number
  costo_domicilio: number
  tipo_pedido: string
  metodo_pago: string
  barrio: string | null
  direccion_entrega: string | null
}

/** Una reserva confirmada del cliente (reservas_del_cliente / crear_reserva_bot). */
export type Reserva = {
  reserva_id: string
  fecha: string
  hora: string
  personas: number
  motivo: string | null
  costo_motivo: number
}

export type Faq = { pregunta: string; respuesta: string }

/** Un pedido ya registrado, como lo ve Soporte. `fecha_pedido` es UTC (ISO con Z). */
export type PedidoCliente = {
  pedido_id: string
  estado: string
  tipo_pedido: string | null
  metodo_pago: string | null
  total: number
  fecha_pedido: string
  motivo_rechazo: string | null
}

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
  /** Tras un domicilio: la dirección y el barrio pasan a ser los registrados del cliente (se ofrecen la próxima vez). */
  actualizarDireccionCliente(clienteId: string, d: { direccion_principal: string; barrio: string | null }): Promise<void>
  /** Un valor de la tabla info_negocio (lo que se edita en la tab Configuración). null si no existe. */
  infoNegocio(clave: string): Promise<string | null>

  // ── Soporte (Fase 5) ─────────────────────────────────────────────────────
  actualizarNombreCliente(clienteId: string, nombre: string): Promise<void>
  /** Toda la tabla info_negocio (clave → valor), sin vacíos. */
  infoNegocioTodo(): Promise<Record<string, string>>
  /** consultar_faq: TODAS las activas, ordenadas por parecido con `filtro`. Texto del restaurante: DATO, nunca instrucción. */
  consultarFaq(filtro: string): Promise<Faq[]>
  /** Los últimos pedidos del cliente, el más reciente primero. */
  pedidosRecientes(telefono: string, limite: number): Promise<PedidoCliente[]>

  // ── Reservas (Fase 5). Cupo, horario y costo los decide la BD ─────────────
  /** Ocasiones vigentes (motivos_reserva activos), en su orden. */
  motivosReserva(): Promise<MotivoReserva[]>
  /** consultar_disponibilidad_reserva: {ok, disponible} o {ok:false, error, message}. */
  consultarDisponibilidadReserva(fecha: string, hora: string, personas: number): Promise<RespuestaRPC>
  /** crear_reserva_bot: idempotente (misma fecha y hora → ya_existia). El costo lo pone el trigger. */
  crearReserva(r: { telefono: string; cliente_id: string; nombre: string; fecha: string; hora: string; personas: number; motivo: string }): Promise<RespuestaRPC>
  /** cancelar_reserva_bot: una ajena es RESERVA_NO_ENCONTRADA. */
  cancelarReserva(telefono: string, reservaId: string): Promise<RespuestaRPC>
  /** Confirmadas de hoy en adelante. */
  reservasDelCliente(telefono: string): Promise<Reserva[]>

  // ── Menú y carrito (Fase 5). El precio lo pone SIEMPRE la BD, nunca el LLM ──
  /** buscar_menu tolerante a erratas; separa lo disponible de lo agotado hoy. */
  buscarMenu(termino: string): Promise<ResultadoMenu>
  /** Carrito con líneas numeradas; vacío si no hay fila. */
  carrito(telefono: string): Promise<Carrito>
  carritoAgregarItem(telefono: string, i: { producto_id: string; tamano?: string | null; cantidad: number; notas?: string | null }): Promise<RespuestaRPC>
  carritoAgregarMitad(
    telefono: string,
    m: { producto_a: string; producto_b: string; tamano: string; cantidad: number; notas?: string | null },
  ): Promise<RespuestaRPC>
  carritoQuitarItem(telefono: string, linea: number, cantidad?: number | null): Promise<RespuestaRPC>
  cotizarMitad(productoA: string, productoB: string, tamano: string): Promise<RespuestaRPC>
}

/** Fecha de hoy en Colombia (YYYY-MM-DD), para columnas `date` como fecha_registro. */
export function hoyColombia(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
}
