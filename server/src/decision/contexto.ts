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
}

/**
 * Qué preguntó el bot por última vez. Es lo que le da sentido a un "sí" o un
 * "dale": el mismo "dale" tras "¿te agrego una hawaiana?" y tras el resumen del
 * pedido son acciones distintas (BUG-061/062). Se guarda en `conversaciones`.
 */
export type UltimaPregunta =
  | { tipo: 'confirmar_pedido' } //                 el resumen: "¿confirmas tu pedido?"
  | { tipo: 'dato_pedido'; dato: Exclude<Faltante, 'carrito' | 'cobertura'> }
  | { tipo: 'sugerir_barrio'; barrio: string } //    "¿quisiste decir Niquía?"
  | { tipo: 'agregar_producto'; producto: string } // "¿te agrego una hawaiana mediana?"
  | { tipo: 'algo_mas' } //                          "¿algo más?"
  | { tipo: 'confirmar_reserva' }
  | { tipo: 'cancelar_reserva'; reserva_id: string }

/** Los cuatro agentes de n8n. Saludos, despedidas e info del local son de Soporte. */
export type Handler = 'menu' | 'pedidos' | 'soporte' | 'reservas'

export type Conversacion = {
  handler: Handler | null
  ultima_pregunta: UltimaPregunta | null
}

export type ContextoDecision = {
  estado: EstadoPedido | null
  conversacion: Conversacion
  /** El texto del cliente, para las reglas que no deben depender del clasificador. */
  texto: string
}
