import { describe, expect, it } from 'vitest'
import { clasificacionVacia, type Clasificacion } from '../../src/decision/clasificacion.js'
import type { ContextoDecision, EstadoPedido, UltimaPregunta } from '../../src/decision/contexto.js'
import { decidir } from '../../src/decision/politica.js'

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
  ...e,
})
const enResumen = carrito({ paso_flujo: 'resumen', faltantes: [], tipo_pedido: 'domicilio', barrio: 'Niquía', cobertura_ok: true })

function ctx(
  texto: string,
  o: { estado?: EstadoPedido | null; ultima?: UltimaPregunta; handler?: ContextoDecision['conversacion']['handler'] } = {},
): ContextoDecision {
  return { texto, estado: o.estado ?? null, conversacion: { handler: o.handler ?? null, ultima_pregunta: o.ultima ?? null } }
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
    ctx: ctx('sí', { ultima: { tipo: 'confirmar_reserva' } }),
    handler: 'reservas',
    acciones: [{ tipo: 'crear_reserva' }],
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
    { tipo: 'confirmar_reserva' },
  ]
  const estados = [null, carrito(), enResumen, carrito({ paso_flujo: 'resumen', faltantes: ['metodo_pago'] })]
  const combinaciones = intenciones.flatMap((intencion) =>
    confirmas.flatMap((confirma) => ultimas.flatMap((ultima) => estados.map((estado) => ({ intencion, confirma, ultima, estado })))),
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

  it('INVARIANTE: crear_reserva solo con "sí" a "¿confirmo la reserva?"', () => {
    for (const k of combinaciones) {
      const d = decidir(clasificacionVacia({ intencion: k.intencion, confirma: k.confirma }), ctx('x', k))
      const crea = d.acciones.some((a) => a.tipo === 'crear_reserva')
      expect(crea, JSON.stringify(k)).toBe(k.ultima?.tipo === 'confirmar_reserva' && k.confirma === 'si')
    }
  })
})
