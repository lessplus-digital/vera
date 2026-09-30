import type {
  AccionFeedback,
  Cliente,
  MensajeHistorial,
  ModoCliente,
  PedidoFeedback,
  Repo,
} from '../bd/repo.js'
import type { Carrito, Cobertura, DatosFlujo, LineaCarrito, PedidoCreado, ResultadoMenu, RespuestaRPC } from '../bd/repo.js'
import { buscarMenuSim, cotizarMitadSim, masaSim, MENU_SIM, precioSim } from './menu-memoria.js'
import type { Conversacion, EstadoPedido, Faltante, PasoFlujo } from '../decision/contexto.js'

/** Una línea del carrito tal como la guardan las RPC carrito_agregar_*. */
export type ItemMem = {
  producto_id: string
  nombre: string
  variante: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
  notas?: string | null
  mitades?: { producto_id: string; nombre: string; variante: string | null; precio: number }[]
}

/** Carrito en memoria: items + el estado del flujo, como la fila de `carritos`. */
export type CarritoMem = {
  items: ItemMem[]
  tipo_pedido: 'domicilio' | 'recoger' | null
  barrio: string | null
  direccion_entrega: string | null
  metodo_pago: 'Efectivo' | 'Transferencia' | null
  costo_domicilio: number | null
  cobertura_ok: boolean | null
  paso_flujo: PasoFlujo
}

/** Catálogo mínimo de barrios del simulador (el real vive en `barrios`/`zonas_entrega`). */
export const BARRIOS_SIM: Record<string, { nombre: string; zona: string; costo: number; tiempo: string }> = {
  prado: { nombre: 'Prado', zona: 'Centro', costo: 5000, tiempo: '20 a 30 minutos' },
  'niquía': { nombre: 'Niquía', zona: 'Norte', costo: 7500, tiempo: '30 a 45 minutos' },
  niquia: { nombre: 'Niquía', zona: 'Norte', costo: 7500, tiempo: '30 a 45 minutos' },
}
const ERRATAS_SIM: Record<string, string> = { niqia: 'Niquía', pardo: 'Prado', prdo: 'Prado' }

// Misma regla que la vista estado_pedido (docs/database.md).
export const subtotalDe = (c: CarritoMem) => c.items.reduce((s, i) => s + i.subtotal, 0)

export function faltantesDe(c: CarritoMem): Faltante[] {
  if (c.items.length === 0) return ['carrito']
  const f: Faltante[] = []
  const dom = c.tipo_pedido === 'domicilio'
  if (!c.tipo_pedido) f.push('tipo_pedido')
  if (dom && !c.barrio) f.push('barrio')
  if (dom && c.barrio && c.cobertura_ok !== true) f.push('cobertura')
  if (dom && !c.direccion_entrega) f.push('direccion_entrega')
  if (!c.metodo_pago) f.push('metodo_pago')
  return f
}

// BD falsa en memoria para pruebas y simulador. Imita el comportamiento que
// importa de las tablas y RPC reales (cubiertas por qa/sql/), no su SQL.

type PedidoMem = {
  pedido_id: string
  telefono: string
  estado: string
  metodo_pago: string
  estado_pago: string
  comprobante_url: string | null
  orden: number
}

type ColaFeedback = { pedido_id: string; estado: 'esperando_nota' | 'esperando_comentario' }

export class RepoMemoria implements Repo {
  readonly clientes = new Map<string, Cliente>()
  readonly soporte: { telefono: string; mensaje: string; tipo_contenido: string; imagen_url: string | null }[] = []
  readonly pedidos: PedidoMem[] = []
  readonly archivos = new Map<string, { bytes: Uint8Array; mime: string }>()
  readonly historial = new Map<string, MensajeHistorial[]>()
  readonly feedback: { pedido_id: string; nota: number; comentario: string | null }[] = []
  readonly colaFeedback = new Map<string, ColaFeedback>()
  /** Pedidos entregados que el job de feedback todavía no pidió calificar. */
  readonly porCalificar: PedidoFeedback[] = []
  readonly carritos = new Map<string, CarritoMem>()
  readonly conversaciones = new Map<string, Conversacion>()
  /** Pedidos creados desde el carrito (crear_orden_desde_carrito). */
  readonly ordenes: { pedido_id: string; telefono: string; total: number; carrito: CarritoMem }[] = []
  private n = 0

  // ── Ayudas de carrito para escenarios ────────────────────────────────────
  /**
   * Monta un carrito para una prueba. Con `n_items` + `subtotal` (atajo) crea
   * líneas genéricas que suman ese subtotal; con `items`, las usa tal cual.
   */
  ponerCarrito(
    telefono: string,
    c: Partial<Omit<CarritoMem, 'items'>> & ({ items: ItemMem[] } | { n_items: number; subtotal: number }),
  ) {
    const { n_items = 0, subtotal = 0, ...resto } = c as Partial<CarritoMem> & { n_items?: number; subtotal?: number }
    const generica = (k: number): ItemMem => {
      const base = Math.floor(subtotal / n_items)
      const monto = k === 0 ? subtotal - base * (n_items - 1) : base // la primera se lleva el resto
      return { producto_id: 'PROD-090', nombre: `Producto ${k + 1}`, variante: null, cantidad: 1, precio_unitario: monto, subtotal: monto }
    }
    const items = 'items' in c ? c.items : Array.from({ length: n_items }, (_, k) => generica(k))
    this.carritos.set(telefono, {
      tipo_pedido: null,
      barrio: null,
      direccion_entrega: null,
      metodo_pago: null,
      costo_domicilio: null,
      cobertura_ok: null,
      paso_flujo: items.length > 0 ? 'datos' : 'armando',
      ...resto,
      items,
    })
  }

  // ── Ayudas para montar escenarios ────────────────────────────────────────
  ponerModo(telefono: string, modo: ModoCliente) {
    const c = this.clientes.get(telefono)
    if (c) c.modo = modo
  }
  agregarPedido(p: Partial<PedidoMem> & { telefono: string }): string {
    const orden = ++this.n // siempre avanza: define cuál pedido es más reciente
    const pedido_id = p.pedido_id ?? `PED-M${orden}`
    this.pedidos.push({
      pedido_id,
      estado: 'pendiente',
      metodo_pago: 'Transferencia',
      estado_pago: 'pendiente',
      comprobante_url: null,
      orden,
      ...p,
    })
    return pedido_id
  }

  // ── Repo ─────────────────────────────────────────────────────────────────
  async clientePorTelefono(telefono: string): Promise<Cliente> {
    let c = this.clientes.get(telefono)
    if (!c) {
      c = { cliente_id: `CLI-M${++this.n}`, telefono, nombre: 'Pendiente', modo: 'bot', direccion_principal: null, barrio: null }
      this.clientes.set(telefono, c)
    }
    return { ...c }
  }

  async guardarMensajeSoporte(m: { telefono: string; mensaje: string; tipo_contenido: 'texto' | 'imagen'; imagen_url?: string | null }) {
    this.soporte.push({ ...m, imagen_url: m.imagen_url ?? null })
  }

  // Misma máquina de estados que procesar_respuesta_feedback (qa/sql/10-resenas.sql).
  async procesarRespuestaFeedback(telefono: string, mensaje: string): Promise<AccionFeedback> {
    const cola = this.colaFeedback.get(telefono)
    const volverABot = () => {
      this.colaFeedback.delete(telefono)
      this.ponerModo(telefono, 'bot')
    }
    if (!cola) {
      this.ponerModo(telefono, 'bot')
      return 'sin_pendiente'
    }
    const texto = mensaje.trim().toLowerCase()
    if (cola.estado === 'esperando_nota') {
      const palabras: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 }
      const nota = /^[1-5]$/.test(texto) ? Number(texto) : palabras[texto]
      if (!nota) return 'nota_invalida'
      this.feedback.push({ pedido_id: cola.pedido_id, nota, comentario: null })
      if (nota >= 4) {
        volverABot()
        return 'positiva'
      }
      cola.estado = 'esperando_comentario'
      return 'pedir_comentario'
    }
    if (texto !== 'saltar') {
      const f = this.feedback.find((x) => x.pedido_id === cola.pedido_id)
      if (f) f.comentario = mensaje.trim()
    }
    volverABot()
    return 'agradecer'
  }

  async solicitarFeedbackLote(limite: number): Promise<PedidoFeedback[]> {
    const lote = this.porCalificar.splice(0, limite).filter((p) => (this.clientes.get(p.telefono)?.modo ?? 'bot') === 'bot')
    for (const p of lote) {
      this.colaFeedback.set(p.telefono, { pedido_id: p.pedido_id, estado: 'esperando_nota' })
      this.ponerModo(p.telefono, 'esperando_feedback')
    }
    return lote
  }

  async pedidoPendienteDeComprobante(telefono: string) {
    const p = this.pedidos
      .filter(
        (x) =>
          x.telefono === telefono &&
          x.estado === 'pendiente' &&
          x.metodo_pago === 'Transferencia' &&
          x.estado_pago === 'pendiente' &&
          !x.comprobante_url,
      )
      .sort((a, b) => b.orden - a.orden)[0]
    return p ? { pedido_id: p.pedido_id } : null
  }

  async adjuntarComprobante(pedidoId: string, url: string) {
    const p = this.pedidos.find((x) => x.pedido_id === pedidoId)
    if (p) p.comprobante_url = url
  }

  async subirImagen(ruta: string, bytes: Uint8Array, mime: string) {
    this.archivos.set(ruta, { bytes, mime })
    return `https://storage.sim/comprobantes/${ruta}`
  }

  async pasarAHumano(clienteId: string) {
    for (const c of this.clientes.values()) if (c.cliente_id === clienteId) c.modo = 'humano'
  }

  async agregarHistorial(telefono: string, m: MensajeHistorial) {
    const h = this.historial.get(telefono) ?? []
    h.push(m)
    this.historial.set(telefono, h)
  }

  async leerHistorial(telefono: string, limite: number) {
    return (this.historial.get(telefono) ?? []).slice(-limite)
  }

  // ── Decisión (Fase 4) ────────────────────────────────────────────────────
  async estadoPedido(telefono: string): Promise<EstadoPedido | null> {
    const c = this.carritos.get(telefono)
    if (!c) return null
    return {
      n_items: c.items.length,
      paso_flujo: c.paso_flujo,
      faltantes: faltantesDe(c),
      tipo_pedido: c.tipo_pedido,
      barrio: c.barrio,
      cobertura_ok: c.cobertura_ok,
    }
  }

  async leerConversacion(telefono: string): Promise<Conversacion> {
    return this.conversaciones.get(telefono) ?? { handler: null, ultima_pregunta: null }
  }

  async guardarConversacion(telefono: string, c: Conversacion) {
    this.conversaciones.set(telefono, structuredClone(c))
  }

  async consultarCobertura(barrio: string): Promise<Cobertura> {
    const clave = barrio.trim().toLowerCase().replace(/^(estoy en|en|el|la)\s+/, '')
    const b = BARRIOS_SIM[clave]
    if (b) return { cubierto: true, barrio: b.nombre, zona: b.zona, costo_domicilio: b.costo, tiempo_estimado: b.tiempo, sugerencias: [] }
    const sug = ERRATAS_SIM[clave]
    return { cubierto: false, barrio, zona: null, costo_domicilio: null, tiempo_estimado: null, sugerencias: sug ? [sug] : [] }
  }

  // COALESCE por campo, como guardar_datos_pedido; con el trigger de coherencia de carritos.
  async guardarDatosPedido(telefono: string, d: DatosFlujo): Promise<RespuestaRPC> {
    let c = this.carritos.get(telefono)
    if (!Object.values(d).some((v) => v !== undefined)) return { ok: true, guardo: false }
    if (!c) {
      this.ponerCarrito(telefono, { items: [] })
      c = this.carritos.get(telefono)!
    }
    const cambiaBarrio = d.barrio !== undefined && d.barrio !== c.barrio
    const antes = structuredClone(c)
    Object.assign(c, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)))
    // Migración 20260930120000: cambiar un dato con el resumen a la vista lo saca del resumen.
    const campos = ['tipo_pedido', 'barrio', 'direccion_entrega', 'metodo_pago', 'costo_domicilio'] as const
    if (antes.paso_flujo === 'resumen' && c.paso_flujo === 'resumen' && campos.some((k) => c[k] !== antes[k])) {
      c.paso_flujo = 'datos'
    }
    if (cambiaBarrio && d.cobertura_ok === undefined) {
      c.cobertura_ok = null
      c.costo_domicilio = null
    }
    if (c.tipo_pedido === 'recoger') Object.assign(c, { barrio: null, direccion_entrega: null, costo_domicilio: null, cobertura_ok: null })
    return { ok: true, guardo: true }
  }

  async carritoVaciar(telefono: string): Promise<RespuestaRPC> {
    const c = this.carritos.get(telefono)
    if (c) Object.assign(c, { items: [], paso_flujo: 'armando' })
    return { ok: true }
  }

  async crearOrdenDesdeCarrito(telefono: string, _clienteId: string): Promise<PedidoCreado | (RespuestaRPC & { ok: false })> {
    const c = this.carritos.get(telefono)
    if (!c || c.items.length === 0) return { ok: false, error: 'CARRITO_VACIO' }
    if (faltantesDe(c).length) return { ok: false, error: 'DATOS_INCOMPLETOS' }
    if (c.paso_flujo !== 'resumen') return { ok: false, error: 'SIN_RESUMEN' }
    const pedido_id = `PED-M${++this.n}`
    const costo = c.tipo_pedido === 'domicilio' ? (c.costo_domicilio ?? 0) : 0
    const total = subtotalDe(c) + costo
    this.ordenes.push({ pedido_id, telefono, total, carrito: structuredClone(c) })
    this.carritos.delete(telefono)
    return { ok: true, pedido_id, total, costo_domicilio: costo, tipo_pedido: c.tipo_pedido!, metodo_pago: c.metodo_pago! }
  }

  // ── Menú y carrito (Fase 5) ──────────────────────────────────────────────
  async buscarMenu(termino: string): Promise<ResultadoMenu> {
    return buscarMenuSim(termino)
  }

  async carrito(telefono: string): Promise<Carrito> {
    const c = this.carritos.get(telefono)
    const lineas: LineaCarrito[] = (c?.items ?? []).map((i, n) => ({
      linea: n + 1,
      producto_id: i.producto_id,
      nombre: i.nombre,
      variante: i.variante,
      masa: i.mitades ? (i.mitades[0]?.variante ?? null) : masaSim(i.producto_id),
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
      notas: i.notas ?? null,
      mitades: i.mitades?.map((m) => ({ nombre: m.nombre, variante: m.variante })) ?? null,
    }))
    return { lineas, total: c ? subtotalDe(c) : 0 }
  }

  private carritoDe(telefono: string): CarritoMem {
    if (!this.carritos.has(telefono)) this.ponerCarrito(telefono, { items: [] })
    return this.carritos.get(telefono)!
  }

  /** Agregar o quitar productos saca al cliente del resumen: vuelve a datos. */
  private tocado(c: CarritoMem) {
    c.paso_flujo = c.items.length ? 'datos' : 'armando'
    return { ok: true, estado: { n_items: c.items.length, total: subtotalDe(c), faltantes: faltantesDe(c) } }
  }

  async carritoAgregarItem(telefono: string, i: { producto_id: string; tamano?: string | null; cantidad: number; notas?: string | null }) {
    if (!Number.isInteger(i.cantidad) || i.cantidad < 1 || i.cantidad > 50) return { ok: false, error: 'CANTIDAD_INVALIDA' }
    const p = precioSim(i.producto_id, i.tamano)
    if (!p.ok) return p
    const c = this.carritoDe(telefono)
    const nombre = MENU_NOMBRE(i.producto_id)
    const igual = c.items.find((x) => !x.mitades && x.producto_id === i.producto_id && x.variante === p.variante && (x.notas ?? null) === (i.notas ?? null))
    if (igual) {
      igual.cantidad += i.cantidad
      igual.subtotal = igual.cantidad * igual.precio_unitario
    } else {
      c.items.push({ producto_id: i.producto_id, nombre, variante: p.variante ?? null, cantidad: i.cantidad, precio_unitario: p.precio!, subtotal: p.precio! * i.cantidad, notas: i.notas ?? null })
    }
    return { ...this.tocado(c), agregado: { nombre, variante: p.variante ?? null, cantidad: i.cantidad, precio_unitario: p.precio } }
  }

  async carritoAgregarMitad(telefono: string, m: { producto_a: string; producto_b: string; tamano: string; cantidad: number; notas?: string | null }) {
    const r = cotizarMitadSim(m.producto_a, m.producto_b, m.tamano)
    if (!r.ok) return r
    const c = this.carritoDe(telefono)
    const precio = r.precio_unitario as number
    c.items.push({
      producto_id: String(r.producto_id),
      nombre: String(r.nombre_producto),
      variante: String(r.variante),
      cantidad: m.cantidad,
      precio_unitario: precio,
      subtotal: precio * m.cantidad,
      notas: m.notas ?? null,
      mitades: r.mitades as ItemMem['mitades'],
    })
    return { ...this.tocado(c), agregado: { nombre: r.nombre_producto, variante: r.variante, cantidad: m.cantidad, precio_unitario: precio } }
  }

  async carritoQuitarItem(telefono: string, linea: number, cantidad?: number | null) {
    const c = this.carritos.get(telefono)
    if (!c?.items.length) return { ok: false, error: 'CARRITO_VACIO' }
    const item = c.items[linea - 1]
    if (!item) return { ok: false, error: 'LINEA_INVALIDA' }
    if (cantidad == null || cantidad >= item.cantidad) c.items.splice(linea - 1, 1)
    else {
      item.cantidad -= cantidad
      item.subtotal = item.cantidad * item.precio_unitario
    }
    return this.tocado(c)
  }

  async cotizarMitad(productoA: string, productoB: string, tamano: string) {
    return cotizarMitadSim(productoA, productoB, tamano)
  }
}

const MENU_NOMBRE = (id: string) => MENU_SIM.find((p) => p.producto_id === id)?.nombre ?? id
