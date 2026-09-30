// Lo que la política necesita saber del estado de la conversación, leído de la
// BD al empezar el turno (no de la memoria del chat, que se pierde: ver
// docs/database.md §carritos).

export type PasoFlujo = 'armando' | 'datos' | 'resumen' | 'confirmado'

export type Faltante = 'carrito' | 'tipo_pedido' | 'barrio' | 'cobertura' | 'direccion_entrega' | 'metodo_pago'

/** Fila de la vista `estado_pedido` (solo lo que usa la política). null = no hay carrito. */
export type EstadoPedido = {
  n_items: number
  paso_flujo: PasoFlujo
  faltantes: Faltante[]
  tipo_pedido: 'domicilio' | 'recoger' | null
  barrio: string | null
  cobertura_ok: boolean | null
  direccion_entrega: string | null
  metodo_pago: 'Efectivo' | 'Transferencia' | null
  costo_domicilio: number | null
}

/**
 * Qué preguntó el bot por última vez. Es lo que le da sentido a un "sí" o un
 * "dale": el mismo "dale" tras "¿te agrego una hawaiana?" y tras el resumen del
 * pedido son acciones distintas (BUG-061/062). Se guarda en `conversaciones`.
 */
export type UltimaPregunta =
  | { tipo: 'confirmar_pedido' } //                 el resumen: "¿confirmas tu pedido?"
  | { tipo: 'dato_pedido'; dato: Exclude<Faltante, 'carrito' | 'cobertura'> }
  | { tipo: 'sugerir_barrio'; barrio: string } //    "¿quisiste decir Niquía?" / "¿sigues por Niquía?"
  | { tipo: 'usar_direccion'; direccion: string } // "¿te lo enviamos a Cra 50 #40-20?" (la registrada)
  | { tipo: 'ofrecer_recoger' } //                   "no llegamos a Copacabana, ¿lo recoges en el local?"
  | { tipo: 'agregar_producto'; producto: string } // "¿te agrego una hawaiana mediana?"
  | { tipo: 'algo_mas' } //                          "¿algo más?"
  | { tipo: 'ofrecer_humano' } //                    "¿quieres que te conecte con alguien del equipo?"
  | { tipo: 'nombre' } //                            "¿con quién tengo el gusto?"
  | { tipo: 'dato_reserva'; dato: DatoReserva } //   "¿para cuántas personas?", "¿qué día?"…
  | { tipo: 'confirmar_reserva' } //                el resumen de la reserva (lo que dice `Conversacion.reserva`)
  | { tipo: 'elegir_reserva' } //                   tiene varias y quiere cancelar: "¿cuál?"
  | { tipo: 'cancelar_reserva'; reserva_id: string }

export type DatoReserva = 'personas' | 'fecha' | 'hora' | 'motivo'

/**
 * Lo que va respondiendo el cliente de una reserva nueva (columna
 * `conversaciones.reserva`). El "sí" al resumen crea ESTO, no lo que el LLM recuerde.
 */
export type BorradorReserva = {
  personas?: number
  /** YYYY-MM-DD */
  fecha?: string
  /** HH:MM, 24 h */
  hora?: string
  /** Clave de motivos_reserva ('sin_ocasion' = reserva normal). */
  motivo?: string
  /** 'fecha|hora|personas' de la última consulta de disponibilidad que dio cupo. */
  verificado?: string
}

/** Los cuatro agentes de n8n. Saludos, despedidas e info del local son de Soporte. */
export type Handler = 'menu' | 'pedidos' | 'soporte' | 'reservas'

export type Conversacion = {
  handler: Handler | null
  ultima_pregunta: UltimaPregunta | null
  /** Reserva nueva a medio armar; null/ausente = ninguna. */
  reserva?: BorradorReserva | null
}

export type ContextoDecision = {
  estado: EstadoPedido | null
  conversacion: Conversacion
  /** El texto del cliente, para las reglas que no deben depender del clasificador. */
  texto: string
  /** El cliente todavía no tiene nombre registrado (nace como 'Pendiente'): el que diga se guarda. */
  sin_nombre?: boolean
}
