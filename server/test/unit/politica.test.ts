import { describe, expect, it } from 'vitest'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { BorradorReserva, ContextoDecision, EstadoPedido, UltimaPregunta } from '../../src/decision/contexto.js'
import { decidir, mencionado, nombreValido } from '../../src/decision/politica.js'

// Tabla de casos de ruteo. Cada fila: qué leyó el clasificador + estado real de
// la BD → handler, acciones y regla esperados. Los casos con BUG-NNN salen del
// bug-tracker; si alguno se rompe, ese bug volvió. Los demás portan las reglas
// del orquestador de n8n (versión publicada 1d7f7d87).

const carrito = (e: Partial<EstadoPedido> = {}): EstadoPedido => ({
  n_items: 1,
  paso_flujo: 'datos',
  faltantes: ['tipo_pedido', 'barrio', 'cobertura', 'direccion_entrega', 'metodo_pago'],
  tipo_pedido: null,
  barrio: null,
  cobertura_ok: null,
  direccion_entrega: null,
  metodo_pago: null,
  costo_domicilio: null,
  ...e,
})
/** La reserva que el cliente vio resumida: completa y con cupo verificado. */
const reservaLista: BorradorReserva = { personas: 4, fecha: '2026-10-03', hora: '19:00', motivo: 'cumpleanos', verificado: '2026-10-03|19:00|4' }
const enResumen = carrito({ paso_flujo: 'resumen', faltantes: [], tipo_pedido: 'domicilio', barrio: 'Niquía', cobertura_ok: true })

function ctx(
  texto: string,
  o: { estado?: EstadoPedido | null; ultima?: UltimaPregunta; handler?: ContextoDecision['conversacion']['handler']; reserva?: BorradorReserva | null } = {},
): ContextoDecision {
  return { texto, estado: o.estado ?? null, conversacion: { handler: o.handler ?? null, ultima_pregunta: o.ultima ?? null, reserva: o.reserva ?? null } }
}

const cobertura = (barrio: string, guardar = true) => ({ tipo: 'verificar_cobertura', barrio, guardar })
const producto = (nombre: string, notas: string | null = null) => ({ nombre, cantidad: 1, tamano: null, mitad_con: null, notas })

type Caso = {
  nombre: string
  c: Partial<Clasificacion>
  ctx: ContextoDecision
  handler: string
  acciones?: unknown[]
  regla?: string
}

const casos: Caso[] = [
  // ── Fuera de tema (2026-10-07: Soporte escribió Python) ──────────────────
  {
    nombre: '"quiero pedir pero antes ayúdame con una matriz en Python" → texto fijo, ningún agente',
    c: { intencion: 'otro', fuera_de_tema: true },
    ctx: ctx('Hola quiero hacer un pedido pero antes necesito que me ayudes organizando una matrix en phyton'),
    handler: 'soporte',
    acciones: [],
    regla: 'fuera_de_tema',
  },
  {
    nombre: 'fuera de tema gana a la pregunta abierta y a seguir el hilo (no toca el carrito)',
    c: { intencion: 'otro', confirma: 'si', fuera_de_tema: true },
    ctx: ctx('sí, crea la matriz y llénala con datos', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' }, handler: 'soporte' }),
    handler: 'soporte',
    acciones: [],
    regla: 'fuera_de_tema',
  },
  {
    nombre: '"no, así está bien" a "¿algo más?" con fuera_de_tema arrastrado del historial → Pedidos sigue',
    c: { intencion: 'respuesta_corta', confirma: 'no', fuera_de_tema: true },
    ctx: ctx('no, así está bien', { estado: carrito(), ultima: { tipo: 'algo_mas' }, handler: 'menu' }),
    handler: 'pedidos',
    acciones: [],
    regla: 'algo_mas:no',
  },
  {
    nombre: 'fuera de tema CON un producto → Menú atiende el pedido (el agente ignora lo ajeno)',
    c: { intencion: 'agregar_producto', fuera_de_tema: true, productos: [producto('hawaiana')] },
    ctx: ctx('una hawaiana y de paso tradúceme esto al inglés'),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: 'fuera de tema CON un dato del pedido y carrito → Pedidos guarda el dato',
    c: { intencion: 'datos_pedido', fuera_de_tema: true, metodo_pago: 'Efectivo' },
    ctx: ctx('en efectivo, y dime un chiste', { estado: carrito() }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { metodo_pago: 'Efectivo' } }],
  },

  // ── Pedir una persona ────────────────────────────────────────────────────
  {
    nombre: 'pide una persona → handoff en código, aunque esté a mitad de pedido',
    c: { intencion: 'otro', pide_humano: true },
    ctx: ctx('pásame con alguien', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'humano',
    acciones: [{ tipo: 'pasar_a_humano', motivo: 'lo_pidio' }],
  },
  {
    nombre: 'muy frustrado → handoff',
    c: { intencion: 'queja', frustracion: 2 },
    ctx: ctx('esto es una burla, 2 horas esperando'),
    handler: 'humano',
    acciones: [{ tipo: 'pasar_a_humano', motivo: 'frustracion' }],
  },
  {
    nombre: 'queja normal → Soporte (no handoff directo)',
    c: { intencion: 'queja', frustracion: 1 },
    ctx: ctx('la pizza llegó fría'),
    handler: 'soporte',
    acciones: [],
  },

  // ── Crear el pedido: el invariante crítico ───────────────────────────────
  {
    nombre: '"sí" al resumen, con la BD en resumen y nada faltante → crea el pedido',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'crear_pedido' }],
    regla: 'resumen:si',
  },
  {
    nombre: '"sí" al resumen pero la BD ya no está en resumen → NO crea, vuelve a mostrarlo',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: carrito({ paso_flujo: 'datos', faltantes: ['metodo_pago'] }), ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [],
    regla: 'resumen:si_sin_resumen_valido',
  },
  {
    nombre: '"sí" al resumen sin carrito (expiró) → NO crea, Menú lo rearma',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: null, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'menu',
    acciones: [],
    regla: 'resumen:si_sin_carrito',
  },
  {
    nombre: '"sí, pero la hawaiana sin cebolla" al resumen → NO crea: Menú hace el cambio',
    c: { intencion: 'agregar_producto', confirma: 'si', productos: [producto('hawaiana', 'sin cebolla')] },
    ctx: ctx('sí pero la hawaiana sin cebolla', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"sí, pero a otra dirección" → guarda el dato, NO crea',
    c: { intencion: 'datos_pedido', confirma: 'si', direccion: 'calle 50 # 20-10' },
    ctx: ctx('sí pero a la calle 50 # 20-10', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: 'calle 50 # 20-10' } }],
  },
  {
    nombre: '"no" al resumen → Pedidos pregunta qué cambiar',
    c: { intencion: 'respuesta_corta', confirma: 'no' },
    ctx: ctx('no', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [],
    regla: 'resumen:no',
  },
  {
    nombre: '"sí" sin ninguna pregunta pendiente → nunca crea el pedido',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: enResumen, handler: 'pedidos' }),
    handler: 'pedidos',
    acciones: [],
    regla: 'sigue_el_hilo',
  },

  // ── "Dale" tras el Menú vs. tras el resumen ──────────────────────────────
  {
    nombre: '"dale" tras "¿te agrego una hawaiana?" → Menú agrega ESE producto, no crea pedido',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('dale', { estado: null, ultima: { tipo: 'agregar_producto', producto: 'hawaiana mediana' } }),
    handler: 'menu',
    acciones: [],
    regla: 'sugerencia_producto:si',
  },
  {
    nombre: '"dale" tras el resumen → crea el pedido',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('dale', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'crear_pedido' }],
  },
  {
    nombre: '"eso es todo" a "¿algo más?" con carrito → Pedidos sigue con lo que falte',
    c: { intencion: 'respuesta_corta', confirma: 'no' },
    ctx: ctx('eso es todo', { estado: carrito(), ultima: { tipo: 'algo_mas' } }),
    handler: 'pedidos',
    acciones: [],
    regla: 'algo_mas:no',
  },
  {
    nombre: '"no así está bien" a "¿algo más?" con un quitar_producto extra inventado → Pedidos, no Menú (2026-10-06)',
    c: { intencion: 'respuesta_corta', confirma: 'no', intenciones_extra: ['quitar_producto'] },
    ctx: ctx('No así esta bien', { estado: carrito({ n_items: 2 }), ultima: { tipo: 'algo_mas' }, handler: 'menu' }),
    handler: 'pedidos',
    acciones: [],
    regla: 'algo_mas:no',
  },
  {
    nombre: '"no, quítale la lasaña" a "¿algo más?" → Menú quita (el quitar extra sí cuenta)',
    c: { intencion: 'respuesta_corta', confirma: 'no', intenciones_extra: ['quitar_producto'] },
    ctx: ctx('no, quítale la lasaña', { estado: carrito({ n_items: 2 }), ultima: { tipo: 'algo_mas' }, handler: 'menu' }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"no" al resumen con un quitar_producto extra inventado → Pedidos pregunta qué cambiar',
    c: { intencion: 'respuesta_corta', confirma: 'no', intenciones_extra: ['quitar_producto'] },
    ctx: ctx('no', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [],
    regla: 'resumen:no',
  },
  {
    nombre: '"y una coca cola" a "¿algo más?" aunque el clasificador diga "no" → Menú agrega (visto con gpt-5.1)',
    c: { intencion: 'agregar_producto', confirma: 'no', productos: [producto('coca cola')] },
    ctx: ctx('y una coca cola', { estado: carrito(), ultima: { tipo: 'algo_mas' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"entonces una mitad y mitad" a "¿algo más?" con confirma "no" y sin productos leídos → Menú',
    c: { intencion: 'agregar_producto', confirma: 'no' },
    ctx: ctx('entonces una mitad hawaiana mitad pepperoni', { estado: carrito(), ultima: { tipo: 'algo_mas' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"¿y la pizza m&m?" a "¿algo más?" leído como "no" → Menú, no cierra (visto con gpt-5.1)',
    c: { intencion: 'pregunta_producto', confirma: 'no' },
    ctx: ctx('¿y la pizza m&m?', { estado: carrito(), ultima: { tipo: 'algo_mas' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"dale" sin pregunta registrada y sin carrito → sigue el hilo (Menú)',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('dale', { handler: 'menu' }),
    handler: 'menu',
    acciones: [],
  },

  // ── Barrio y cobertura (BUG-061 / BUG-062) ───────────────────────────────
  {
    nombre: 'BUG-061: "estoy en niqia" con carrito → cobertura en código con el texto crudo',
    c: { intencion: 'datos_pedido', barrio: 'niqia' },
    ctx: ctx('estoy en niqia', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'pedidos',
    acciones: [cobertura('niqia')],
  },
  {
    nombre: 'BUG-062: "pardo" leído como pregunta de producto, tras "¿en qué barrio?" → es el barrio',
    c: { intencion: 'pregunta_producto' },
    ctx: ctx('pardo', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'pedidos',
    acciones: [cobertura('pardo')],
  },
  {
    nombre: 'BUG-062: "pardo" como "otro", sin pregunta registrada pero con barrio faltante → es el barrio',
    c: { intencion: 'otro' },
    ctx: ctx('pardo', {
      estado: carrito({ faltantes: ['barrio', 'cobertura', 'direccion_entrega', 'metodo_pago'], tipo_pedido: 'domicilio' }),
    }),
    handler: 'pedidos',
    acciones: [cobertura('pardo')],
  },
  {
    nombre: 'BUG-062: "pardo" suelto SIN carrito, con barrio capturado → Soporte (tiene cobertura), no Menú',
    c: { intencion: 'pregunta_producto', barrio: 'pardo' },
    ctx: ctx('pardo'),
    handler: 'soporte',
    acciones: [cobertura('pardo')],
  },
  {
    nombre: 'tras "¿en qué barrio?", pedir el menú sigue siendo pedir el menú',
    c: { intencion: 'ver_menu' },
    ctx: ctx('primero mándame el menú', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: 'tras "¿en qué barrio?", una pregunta de producto con "?" no es un barrio',
    c: { intencion: 'pregunta_producto' },
    ctx: ctx('la hawaiana qué trae?', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: 'tras "¿en qué barrio?", un "sí" suelto no se guarda como barrio',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' }, handler: 'pedidos' }),
    handler: 'pedidos',
    acciones: [],
  },
  {
    nombre: '"sí" a "¿quisiste decir Niquía?" → verifica y guarda el barrio sugerido',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: carrito(), ultima: { tipo: 'sugerir_barrio', barrio: 'Niquía' } }),
    handler: 'pedidos',
    acciones: [cobertura('Niquía')],
    regla: 'sugerencia_barrio:si',
  },
  {
    nombre: '"niqia" suelto leído como cobertura, tras "¿en qué barrio?" → es la respuesta: se guarda (f5 corrida 5)',
    c: { intencion: 'cobertura', barrio: 'niqia' },
    ctx: ctx('niqia', { estado: carrito({ tipo_pedido: 'domicilio' }), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'pedidos',
    acciones: [cobertura('niqia')],
  },
  {
    nombre: 'barrio + pregunta ajena tras "¿en qué barrio?" → el barrio se guarda (2026-10-09, clima)',
    c: { intencion: 'cobertura', barrio: 'la milagrosa de Bello', fuera_de_tema: true },
    ctx: ctx('En la milagrosa de Bello, Que clima hace mañana?', {
      estado: carrito({ tipo_pedido: 'domicilio' }),
      ultima: { tipo: 'dato_pedido', dato: 'barrio' },
    }),
    handler: 'pedidos',
    acciones: [cobertura('la milagrosa de Bello')],
  },
  {
    nombre: 'tras "¿en qué barrio?", "¿llegan a la milagrosa?" sigue siendo pregunta: no se guarda',
    c: { intencion: 'cobertura', barrio: 'la milagrosa' },
    ctx: ctx('¿llegan a la milagrosa?', {
      estado: carrito({ tipo_pedido: 'domicilio' }),
      ultima: { tipo: 'dato_pedido', dato: 'barrio' },
    }),
    handler: 'pedidos',
    acciones: [cobertura('la milagrosa', false)],
  },
  {
    nombre: '"por transferencia" tras "¿en qué barrio?" → es el pago, no un barrio (f5 corrida 5)',
    c: { intencion: 'datos_pedido', metodo_pago: 'Transferencia' },
    ctx: ctx('por transferencia', { estado: carrito({ tipo_pedido: 'domicilio' }), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { metodo_pago: 'Transferencia' } }],
  },
  {
    nombre: '"¿llegan a Prado?" tras "¿en qué barrio?" → sigue siendo pregunta: NO se guarda',
    c: { intencion: 'cobertura', barrio: 'Prado' },
    ctx: ctx('¿llegan a Prado?', { estado: carrito({ tipo_pedido: 'domicilio' }), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'pedidos',
    acciones: [cobertura('Prado', false)],
  },
  {
    nombre: '"¿llegan a Prado?" sin carrito → Soporte; se verifica pero NO se guarda (es pregunta)',
    c: { intencion: 'cobertura', barrio: 'Prado' },
    ctx: ctx('¿llegan a Prado?'),
    handler: 'soporte',
    acciones: [cobertura('Prado', false)],
  },
  {
    nombre: '"¿hacen domicilios?" no guarda tipo_pedido (pregunta, no decisión)',
    c: { intencion: 'cobertura', tipo_pedido: 'domicilio' },
    ctx: ctx('¿hacen domicilios?'),
    handler: 'soporte',
    acciones: [],
  },
  {
    nombre: '"¿llegan a Prado?" con carrito → Pedidos',
    c: { intencion: 'cobertura', barrio: 'Prado' },
    ctx: ctx('¿llegan a Prado?', { estado: carrito() }),
    handler: 'pedidos',
    acciones: [cobertura('Prado', false)],
  },
  {
    nombre: 'para recoger con barrio → no se verifica cobertura',
    c: { intencion: 'datos_pedido', tipo_pedido: 'recoger', barrio: 'Prado' },
    ctx: ctx('paso a recoger, vivo en Prado', { estado: carrito() }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { tipo_pedido: 'recoger' } }],
  },

  // ── Datos del pedido ─────────────────────────────────────────────────────
  {
    nombre: 'tras "¿dirección?", la dirección suelta se guarda',
    c: { intencion: 'otro' },
    ctx: ctx('cra 45 # 52-10 apto 301', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'direccion_entrega' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: 'cra 45 # 52-10 apto 301' } }],
  },
  {
    nombre: '"pago en efectivo" con carrito, leído como info del negocio → dato del pedido',
    c: { intencion: 'info_negocio', metodo_pago: 'Efectivo' },
    ctx: ctx('pago en efectivo', { estado: carrito() }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { metodo_pago: 'Efectivo' } }],
  },
  {
    nombre: '"¿aceptan transferencia?" sin carrito → Soporte, no guarda nada',
    c: { intencion: 'info_negocio', metodo_pago: 'Transferencia' },
    ctx: ctx('¿aceptan transferencia?'),
    handler: 'soporte',
    acciones: [],
  },
  {
    nombre: '"hola, para pedir a domicilio" sin carrito → guarda domicilio y va a Menú',
    c: { intencion: 'datos_pedido', tipo_pedido: 'domicilio' },
    ctx: ctx('hola, para pedir una pizza a domicilio'),
    handler: 'menu',
    acciones: [{ tipo: 'guardar_datos', datos: { tipo_pedido: 'domicilio' } }],
  },
  {
    nombre: 'todo en un mensaje: producto + domicilio + barrio → Menú, con datos y cobertura',
    c: {
      intencion: 'agregar_producto',
      intenciones_extra: ['datos_pedido'],
      productos: [producto('hawaiana')],
      tipo_pedido: 'domicilio',
      barrio: 'Prado',
    },
    ctx: ctx('una hawaiana mediana a domicilio en Prado'),
    handler: 'menu',
    acciones: [{ tipo: 'guardar_datos', datos: { tipo_pedido: 'domicilio' } }, cobertura('Prado')],
  },
  {
    nombre: 'con datos pendientes, nombrar un producto va a Menú (la "única excepción" de n8n)',
    c: { intencion: 'agregar_producto', productos: [producto('coca cola')] },
    ctx: ctx('agrégame una coca cola', { estado: carrito(), ultima: { tipo: 'dato_pedido', dato: 'barrio' } }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: 'cancelar con carrito → lo vacía el código',
    c: { intencion: 'cancelar_carrito' },
    ctx: ctx('ya no quiero nada', { estado: carrito() }),
    handler: 'menu',
    acciones: [{ tipo: 'vaciar_carrito' }],
  },
  {
    nombre: '"ya no lo quiero" sin carrito → habla de un pedido registrado: Soporte',
    c: { intencion: 'cancelar_carrito' },
    ctx: ctx('ya no lo quiero'),
    handler: 'soporte',
    acciones: [],
  },

  // ── Intenciones simples ──────────────────────────────────────────────────
  { nombre: 'saludo → Soporte', c: { intencion: 'saludo' }, ctx: ctx('hola'), handler: 'soporte', acciones: [] },
  { nombre: 'ver el menú', c: { intencion: 'ver_menu' }, ctx: ctx('qué tienen'), handler: 'menu', acciones: [] },
  { nombre: 'ver el carrito', c: { intencion: 'ver_carrito' }, ctx: ctx('qué llevo', { estado: carrito() }), handler: 'pedidos', acciones: [] },
  { nombre: 'estado del pedido', c: { intencion: 'estado_pedido' }, ctx: ctx('cómo va mi pedido'), handler: 'soporte', acciones: [] },
  { nombre: 'reservar', c: { intencion: 'reserva_nueva' }, ctx: ctx('quiero reservar el sábado'), handler: 'reservas', acciones: [] },
  {
    nombre: '"sí" a "¿confirmo la reserva?" → la crea el código',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { ultima: { tipo: 'confirmar_reserva' }, reserva: reservaLista }),
    handler: 'reservas',
    acciones: [{ tipo: 'crear_reserva' }],
  },
  {
    nombre: '"sí" al resumen de reserva sin borrador completo (se perdió) → NO crea; Reservas vuelve a armarla',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { ultima: { tipo: 'confirmar_reserva' }, reserva: { personas: 4, fecha: '2026-10-03', hora: '19:00' } }),
    handler: 'reservas',
    acciones: [],
    regla: 'reserva:si_sin_borrador',
  },
  {
    nombre: '"sí, pero a las 8" al resumen de reserva → NO crea: es un cambio',
    c: { intencion: 'respuesta_corta', confirma: 'si', hora: '20:00' },
    ctx: ctx('sí, pero a las 8', { ultima: { tipo: 'confirmar_reserva' }, reserva: reservaLista, handler: 'reservas' }),
    handler: 'reservas',
    acciones: [],
    regla: 'dato_reserva',
  },
  {
    nombre: '"sí" que repite la misma hora ("sí, a las 7") → crea: no es un cambio',
    c: { intencion: 'respuesta_corta', confirma: 'si', hora: '07:00' },
    ctx: ctx('sí, a las 7', { ultima: { tipo: 'confirmar_reserva' }, reserva: reservaLista }),
    handler: 'reservas',
    acciones: [{ tipo: 'crear_reserva' }],
  },
  {
    nombre: 'respuesta suelta a "¿para cuántas personas?" → Reservas, aunque haya carrito',
    c: { intencion: 'datos_pedido', personas: 4 },
    ctx: ctx('somos 4', { ultima: { tipo: 'dato_reserva', dato: 'personas' }, estado: carrito(), handler: 'reservas' }),
    handler: 'reservas',
    acciones: [],
    regla: 'dato_reserva',
  },
  {
    nombre: 'a mitad de reserva, pedir el menú es pedir el menú (el borrador queda)',
    c: { intencion: 'ver_menu' },
    ctx: ctx('mándame la carta', { ultima: { tipo: 'dato_reserva', dato: 'hora' }, handler: 'reservas' }),
    handler: 'menu',
    acciones: [],
  },
  {
    nombre: '"no" a "¿alguna ocasión especial?" → Reservas (es la respuesta: sin ocasión)',
    c: { intencion: 'respuesta_corta', confirma: 'no' },
    ctx: ctx('no, normal', { ultima: { tipo: 'dato_reserva', dato: 'motivo' }, handler: 'reservas' }),
    handler: 'reservas',
    acciones: [],
  },
  {
    nombre: '"sí" a "¿cancelo la reserva RES-9?" → la cancela el código',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { ultima: { tipo: 'cancelar_reserva', reserva_id: 'RES-9' } }),
    handler: 'reservas',
    acciones: [{ tipo: 'cancelar_reserva', reserva_id: 'RES-9' }],
  },
  { nombre: 'mensaje raro sin hilo ni carrito → Soporte', c: { intencion: 'otro' }, ctx: ctx('jajaja'), handler: 'soporte', acciones: [] },
  {
    nombre: 'mensaje raro con hilo → sigue quien lo llevaba',
    c: { intencion: 'otro' },
    ctx: ctx('jajaja', { handler: 'reservas' }),
    handler: 'reservas',
    acciones: [],
  },
  {
    nombre: 'el hilo era Pedidos pero ya no hay carrito → Menú (nunca Pedidos sin carrito)',
    c: { intencion: 'otro' },
    ctx: ctx('jajaja', { handler: 'pedidos' }),
    handler: 'menu',
    acciones: [],
  },

  // ── Agente Pedidos (Fase 5): preguntas con dato registrado ───────────────
  {
    nombre: '"sí" a "¿sigues por el barrio Prado?" → cobertura de Prado y se guarda',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: carrito({ tipo_pedido: 'domicilio', faltantes: ['barrio'] }), ultima: { tipo: 'sugerir_barrio', barrio: 'Prado' } }),
    handler: 'pedidos',
    acciones: [cobertura('Prado')],
  },
  {
    nombre: '"no, estoy en Niquía" a "¿sigues por Prado?" → cobertura del barrio NUEVO',
    c: { intencion: 'datos_pedido', confirma: 'no', barrio: 'Niquía' },
    ctx: ctx('no, estoy en Niquía', { estado: carrito({ tipo_pedido: 'domicilio', faltantes: ['barrio'] }), ultima: { tipo: 'sugerir_barrio', barrio: 'Prado' } }),
    handler: 'pedidos',
    acciones: [cobertura('Niquía')],
  },
  {
    nombre: '"Niquía" suelto tras "¿sigues por Prado?" → es el barrio (aunque el clasificador diga otro)',
    c: { intencion: 'otro' },
    ctx: ctx('Niquía', { estado: carrito({ tipo_pedido: 'domicilio', faltantes: ['barrio'] }), ultima: { tipo: 'sugerir_barrio', barrio: 'Prado' } }),
    handler: 'pedidos',
    acciones: [cobertura('Niquía')],
  },
  {
    nombre: '"sí" a "¿te lo enviamos a Cra 50 # 40-20?" → se guarda la registrada',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('sí', { estado: carrito({ faltantes: ['direccion_entrega'] }), ultima: { tipo: 'usar_direccion', direccion: 'Cra 50 # 40-20' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: 'Cra 50 # 40-20' } }],
    regla: 'usar_direccion:si',
  },
  {
    nombre: '"no" a la dirección registrada → Pedidos pide la nueva, sin guardar nada',
    c: { intencion: 'respuesta_corta', confirma: 'no' },
    ctx: ctx('no', { estado: carrito({ faltantes: ['direccion_entrega'] }), ultima: { tipo: 'usar_direccion', direccion: 'Cra 50 # 40-20' } }),
    handler: 'pedidos',
    acciones: [],
    regla: 'usar_direccion:no',
  },
  {
    nombre: '"no, a la calle 10 # 5-20" a la registrada → se guarda la nueva',
    c: { intencion: 'datos_pedido', confirma: 'no', direccion: 'calle 10 # 5-20' },
    ctx: ctx('no, a la calle 10 # 5-20', { estado: carrito({ faltantes: ['direccion_entrega'] }), ultima: { tipo: 'usar_direccion', direccion: 'Cra 50 # 40-20' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: 'calle 10 # 5-20' } }],
  },
  {
    nombre: 'dirección suelta tras "¿te lo enviamos a…?" → es la dirección',
    c: { intencion: 'otro' },
    ctx: ctx('calle 10 # 5-20', { estado: carrito({ faltantes: ['direccion_entrega'] }), ultima: { tipo: 'usar_direccion', direccion: 'Cra 50 # 40-20' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { direccion_entrega: 'calle 10 # 5-20' } }],
  },
  {
    nombre: 'dirección vaga ("cerca al parque") → NO se guarda y Pedidos la pide con calle y número',
    c: { intencion: 'datos_pedido', direccion: 'cerca al parque' },
    ctx: ctx('cerca al parque', { estado: carrito({ faltantes: ['direccion_entrega'] }), ultima: { tipo: 'dato_pedido', dato: 'direccion_entrega' } }),
    handler: 'pedidos',
    acciones: [],
  },
  {
    nombre: '"sí" a "no llegamos, ¿lo recoges?" → pasa a recoger',
    c: { intencion: 'respuesta_corta', confirma: 'si' },
    ctx: ctx('dale', { estado: carrito({ tipo_pedido: 'domicilio', faltantes: ['barrio'] }), ultima: { tipo: 'ofrecer_recoger' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { tipo_pedido: 'recoger' } }],
    regla: 'ofrecer_recoger:si',
  },
  {
    nombre: '"no, mejor a Prado" a "¿lo recoges?" → cobertura de Prado',
    c: { intencion: 'datos_pedido', confirma: 'no', barrio: 'Prado' },
    ctx: ctx('no, mejor a Prado', { estado: carrito({ tipo_pedido: 'domicilio', faltantes: ['barrio'] }), ultima: { tipo: 'ofrecer_recoger' } }),
    handler: 'pedidos',
    acciones: [cobertura('Prado')],
  },
  {
    nombre: '"sí, confírmalo" con el clasificador repitiendo el pago y el barrio guardados → SÍ crea (gpt-5.1)',
    c: { intencion: 'respuesta_corta', confirma: 'si', metodo_pago: 'Transferencia', barrio: 'niquia' },
    ctx: ctx('sí, confírmalo', { estado: { ...enResumen, metodo_pago: 'Transferencia' }, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'crear_pedido' }],
    regla: 'resumen:si',
  },
  {
    nombre: '"sí, pero en efectivo" con transferencia guardada → es un cambio, NO crea',
    c: { intencion: 'respuesta_corta', confirma: 'si', metodo_pago: 'Efectivo' },
    ctx: ctx('sí, pero en efectivo', { estado: { ...enResumen, metodo_pago: 'Transferencia' }, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [{ tipo: 'guardar_datos', datos: { metodo_pago: 'Efectivo' } }],
  },
  {
    nombre: '"ah no, mejor a Copacabana" al resumen → cobertura del barrio nuevo, no un "no" a secas (gpt-5.1)',
    c: { intencion: 'datos_pedido', confirma: 'no', barrio: 'Copacabana' },
    ctx: ctx('ah no, mejor mándalo a Copacabana', { estado: enResumen, ultima: { tipo: 'confirmar_pedido' } }),
    handler: 'pedidos',
    acciones: [cobertura('Copacabana')],
  },
  {
    nombre: 'barrio guardado sin cobertura confirmada → el código la consulta en este turno',
    c: { intencion: 'otro' },
    ctx: ctx('ok', { estado: carrito({ tipo_pedido: 'domicilio', barrio: 'Niquía', faltantes: ['cobertura', 'direccion_entrega'] }), handler: 'pedidos' }),
    handler: 'pedidos',
    acciones: [cobertura('Niquía')],
  },
]

describe('política de decisión', () => {
  it.each(casos)('$nombre', (k) => {
    const d = decidir(clasificacionVacia(k.c), k.ctx)
    expect(d.handler).toBe(k.handler)
    if (k.acciones) expect(d.acciones).toEqual(k.acciones)
    if (k.regla) expect(d.regla).toBe(k.regla)
  })

  // Barrido: todas las combinaciones de intención × confirma × última pregunta ×
  // estado. Los invariantes críticos se cumplen en TODAS, no solo en los casos de arriba.
  const intenciones = ['respuesta_corta', 'agregar_producto', 'datos_pedido', 'otro', 'saludo', 'cobertura'] as const
  const confirmas = ['si', 'no', 'na'] as const
  const ultimas: (UltimaPregunta | undefined)[] = [
    undefined,
    { tipo: 'confirmar_pedido' },
    { tipo: 'agregar_producto', producto: 'x' },
    { tipo: 'algo_mas' },
    { tipo: 'dato_pedido', dato: 'barrio' },
    { tipo: 'sugerir_barrio', barrio: 'Prado' },
    { tipo: 'usar_direccion', direccion: 'Cra 50 # 40-20' },
    { tipo: 'ofrecer_recoger' },
    { tipo: 'confirmar_reserva' },
    { tipo: 'ofrecer_humano' },
    { tipo: 'nombre' },
    { tipo: 'dato_reserva', dato: 'hora' },
  ]
  const estados = [null, carrito(), enResumen, carrito({ paso_flujo: 'resumen', faltantes: ['metodo_pago'] })]
  const reservas = [null, reservaLista, { personas: 4, fecha: '2026-10-03', hora: '19:00', motivo: 'cumpleanos' }]
  const combinaciones = intenciones.flatMap((intencion) =>
    confirmas.flatMap((confirma) =>
      ultimas.flatMap((ultima) => estados.flatMap((estado) => reservas.map((reserva) => ({ intencion, confirma, ultima, estado, reserva })))),
    ),
  )

  it('INVARIANTE: crear_pedido solo con última pregunta = resumen, confirma = sí y BD en resumen', () => {
    for (const k of combinaciones) {
      const d = decidir(clasificacionVacia({ intencion: k.intencion, confirma: k.confirma }), ctx('x', k))
      const crea = d.acciones.some((a) => a.tipo === 'crear_pedido')
      const debe = k.ultima?.tipo === 'confirmar_pedido' && k.confirma === 'si' && k.estado === enResumen
      expect(crea, JSON.stringify({ ...k, estado: k.estado?.paso_flujo })).toBe(debe)
    }
  })

  it('INVARIANTE: nunca Pedidos sin carrito', () => {
    for (const k of combinaciones) {
      const d = decidir(clasificacionVacia({ intencion: k.intencion, confirma: k.confirma }), ctx('x', k))
      if (!k.estado) expect(d.handler, JSON.stringify(k)).not.toBe('pedidos')
    }
  })

  it('INVARIANTE: crear_reserva solo con "sí" a "¿confirmo la reserva?" y el borrador completo con cupo verificado', () => {
    for (const k of combinaciones) {
      const d = decidir(clasificacionVacia({ intencion: k.intencion, confirma: k.confirma }), ctx('x', k))
      const crea = d.acciones.some((a) => a.tipo === 'crear_reserva')
      expect(crea, JSON.stringify(k)).toBe(k.ultima?.tipo === 'confirmar_reserva' && k.confirma === 'si' && k.reserva === reservaLista)
    }
  })
})

// ── Soporte: nombre del cliente y "¿te conecto con alguien?" ────────────────
describe('nombre del cliente', () => {
  const sinNombre = (texto: string, ultima?: UltimaPregunta): ContextoDecision => ({ ...ctx(texto, { ultima }), sin_nombre: true })
  const guardado = (d: ReturnType<typeof decidir>) => d.acciones.find((a) => a.tipo === 'guardar_nombre')

  it.each([
    ['Juan', true],
    ['María José Rodríguez', true],
    ["D'Angelo", true],
    ['🍕', false],
    ['Dios es amor', false],
    ['Bendiciones', false],
    ['asdfgh', false],
    ['sdfg', false],
    ['test', false],
    ['123', false],
    ['sí, dale', false],
    ['hola', false],
    ['me gustaría una pizza hawaiana grande por favor', false],
  ])('nombreValido(%s) = %s', (n, ok) => {
    expect(nombreValido(n)).toBe(ok)
  })

  it('lo que leyó el clasificador se guarda si no tenía nombre, sea cual sea el handler', () => {
    const d = decidir(clasificacionVacia({ intencion: 'ver_menu', nombre_cliente: 'Juan' }), sinNombre('soy Juan, mándame la carta'))
    expect(d.handler).toBe('menu')
    expect(guardado(d)).toEqual({ tipo: 'guardar_nombre', nombre: 'Juan' })
  })

  it('un nombre ya registrado no se cambia desde el chat', () => {
    const d = decidir(clasificacionVacia({ intencion: 'otro', nombre_cliente: 'Pedro' }), ctx('ahora soy Pedro'))
    expect(guardado(d)).toBeUndefined()
  })

  it('tras "¿con quién tengo el gusto?", la respuesta suelta es el nombre aunque el clasificador no lo lea', () => {
    const d = decidir(clasificacionVacia({ intencion: 'otro' }), sinNombre('me llamo Camila.', { tipo: 'nombre' }))
    expect(guardado(d)).toEqual({ tipo: 'guardar_nombre', nombre: 'Camila' })
  })

  it('tras "¿con quién tengo el gusto?", un "sí, dale" o un emoji no son un nombre', () => {
    expect(guardado(decidir(clasificacionVacia({ intencion: 'respuesta_corta', confirma: 'si' }), sinNombre('sí, dale', { tipo: 'nombre' })))).toBeUndefined()
    expect(guardado(decidir(clasificacionVacia({ intencion: 'otro' }), sinNombre('🙏🙏', { tipo: 'nombre' })))).toBeUndefined()
  })

  it('tras "¿con quién tengo el gusto?", pedir una pizza es pedir una pizza (no un nombre)', () => {
    const d = decidir(
      clasificacionVacia({ intencion: 'agregar_producto', productos: [producto('hawaiana')] }),
      sinNombre('una hawaiana', { tipo: 'nombre' }),
    )
    expect(d.handler).toBe('menu')
    expect(guardado(d)).toBeUndefined()
  })
})

describe('"¿te conecto con alguien del equipo?"', () => {
  it('"sí" → handoff en código', () => {
    const d = decidir(clasificacionVacia({ intencion: 'respuesta_corta', confirma: 'si' }), ctx('sí porfa', { ultima: { tipo: 'ofrecer_humano' } }))
    expect(d).toMatchObject({ handler: 'humano', acciones: [{ tipo: 'pasar_a_humano', motivo: 'lo_pidio' }], regla: 'ofrecer_humano:si' })
  })
  it('"no" → sigue el bot', () => {
    const d = decidir(
      clasificacionVacia({ intencion: 'respuesta_corta', confirma: 'no' }),
      ctx('no, así está bien', { ultima: { tipo: 'ofrecer_humano' }, handler: 'soporte' }),
    )
    expect(d.handler).toBe('soporte')
    expect(d.acciones).toEqual([])
  })
  it('otra intención concreta con confirma:si NO es el "sí" a la oferta (G9: "cancela la reserva RES-001" terminó en handoff)', () => {
    const d = decidir(
      clasificacionVacia({ intencion: 'reserva_cancelar', confirma: 'si' }),
      ctx('cancela la reserva RES-001', { ultima: { tipo: 'ofrecer_humano' }, handler: 'reservas' }),
    )
    expect(d.handler).toBe('reservas')
    expect(d.acciones.map((a) => a.tipo)).not.toContain('pasar_a_humano')
  })
})

describe('barrio del historial', () => {
  it('un barrio que NO está en el mensaje no se consulta (el clasificador lo trajo del historial)', () => {
    const d = decidir(clasificacionVacia({ intencion: 'info_negocio', barrio: 'Niquía' }), ctx('¿puedo celebrar un cumpleaños allá?'))
    expect(d.acciones).toEqual([])
  })
  it.each([
    ['Niquía', 'niqia', true],
    ['niqia', '¿llegan a niqia?', true],
    ['Prado', 'estoy en el prado centro', true],
    ['La Cumbre', 'en la cumbre', true],
    ['Niquía', '¿puedo celebrar allá?', false],
  ])('mencionado(%s, %s) = %s', (b, t, ok) => {
    expect(mencionado(b, t)).toBe(ok)
  })
})
