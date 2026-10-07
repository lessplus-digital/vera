import { z } from 'zod'

// Lo que el clasificador (LLM, JSON estricto) extrae de un mensaje. Es solo
// LECTURA del mensaje: no decide nada. Qué se hace con esto lo decide
// politica.ts, en código y con pruebas.
//
// Structured Outputs exige que todo campo exista: lo opcional es `nullable`, no `optional`.

export const INTENCIONES = [
  'saludo', //            "hola", "buenas"
  'ver_menu', //          "qué tienen", "mándame la carta"
  'pregunta_producto', // "la hawaiana qué trae", "cuánto vale la mediana"
  'agregar_producto', //  "quiero una hawaiana mediana"
  'quitar_producto', //   "quítale la gaseosa"
  'datos_pedido', //      "a domicilio", "en Niquía", "calle 50 #20-10", "pago en efectivo"
  'ver_carrito', //       "qué llevo", "cuánto va"
  'cancelar_carrito', //  "ya no quiero nada", "cancela todo" (antes de crear el pedido)
  'cobertura', //         "¿llegan a Prado?", "¿hacen domicilios a Bello?"
  'estado_pedido', //     "¿cómo va mi pedido?", "no ha llegado"
  'reserva_nueva', //     "quiero reservar para el sábado"
  'reserva_consultar', // "¿tengo reserva?"
  'reserva_cancelar', //  "cancela mi reserva"
  'info_negocio', //      horario, dirección, medios de pago, promos, FAQ
  'queja', //             algo salió mal con un pedido o la atención
  'respuesta_corta', //   "sí", "dale", "no", "ok", "listo": solo tiene sentido con la última pregunta del bot
  'otro',
] as const
export type Intencion = (typeof INTENCIONES)[number]

const ProductoPedido = z.object({
  /** Tal como lo escribió el cliente ("hawaiana", "la de pollo"); el catálogo lo resuelve después. */
  nombre: z.string(),
  cantidad: z.number().int().min(1).max(50).nullable(),
  tamano: z.string().nullable(),
  /** "mitad hawaiana mitad pepperoni": la otra mitad. */
  mitad_con: z.string().nullable(),
  notas: z.string().nullable(),
})

export const Clasificacion = z.object({
  intencion: z.enum(INTENCIONES),
  /** Otras intenciones del mismo mensaje ("una hawaiana a domicilio en Prado"), en orden. */
  intenciones_extra: z.array(z.enum(INTENCIONES)),
  /** Respuesta a la última pregunta del bot, si el mensaje la contesta. */
  confirma: z.enum(['si', 'no', 'na']),
  productos: z.array(ProductoPedido),
  tipo_pedido: z.enum(['domicilio', 'recoger']).nullable(),
  /** El barrio tal como lo escribió el cliente, con errores incluidos ("niqia", "pardo"). */
  barrio: z.string().nullable(),
  direccion: z.string().nullable(),
  metodo_pago: z.enum(['Efectivo', 'Transferencia']).nullable(),
  /** YYYY-MM-DD ya resuelta ("el sábado" → fecha), hora HH:MM de 24 h. */
  fecha: z.string().nullable(),
  hora: z.string().nullable(),
  personas: z.number().int().min(1).max(50).nullable(),
  nombre_cliente: z.string().nullable(),
  /** Pide hablar con una persona de forma explícita. */
  pide_humano: z.boolean(),
  /** 0 = tranquilo, 1 = molesto, 2 = muy molesto / insultos / amenaza con irse. */
  frustracion: z.number().int().min(0).max(2),
  /** Pide algo ajeno al restaurante (programar, tareas, traducir, consejos…), aunque lo mezcle con un pedido. */
  fuera_de_tema: z.boolean(),
})
export type Clasificacion = z.infer<typeof Clasificacion>

/** Punto de partida para pruebas y para el camino de emergencia (el clasificador falló). */
export const clasificacionVacia = (c: Partial<Clasificacion> = {}): Clasificacion => ({
  intencion: 'otro',
  intenciones_extra: [],
  confirma: 'na',
  productos: [],
  tipo_pedido: null,
  barrio: null,
  direccion: null,
  metodo_pago: null,
  fecha: null,
  hora: null,
  personas: null,
  nombre_cliente: null,
  pide_humano: false,
  frustracion: 0,
  fuera_de_tema: false,
  ...c,
})
