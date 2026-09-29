import type {
  AccionFeedback,
  Cliente,
  MensajeHistorial,
  ModoCliente,
  PedidoFeedback,
  Repo,
} from '../bd/repo.js'

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
  private n = 0

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
}
