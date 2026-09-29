import type { MensajeEntrante } from '../whatsapp/payload.js'

// Buffer por teléfono. Dos garantías:
//
// 1. Agrupar: la gente escribe "hola" / "quiero una pizza" / "hawaiana" en tres
//    mensajes seguidos. Se espera `esperaMs` desde el ÚLTIMO mensaje y se
//    procesa todo junto como un solo turno.
// 2. Serializar: nunca corren dos turnos del mismo teléfono a la vez. Si llegan
//    mensajes mientras un turno está en curso, se acumulan y forman el turno
//    siguiente. (En n8n dos ejecuciones paralelas podían pisarse el carrito.)
//
// Teléfonos distintos sí se procesan en paralelo.

export type ProcesadorTurno = (telefono: string, mensajes: MensajeEntrante[]) => Promise<void>

type Estado = {
  pendientes: MensajeEntrante[]
  timer: ReturnType<typeof setTimeout> | null
  enCurso: Promise<void> | null
}

export class BufferPorTelefono {
  private readonly estados = new Map<string, Estado>()
  private readonly activos = new Set<Promise<void>>()

  constructor(
    private readonly esperaMs: number,
    private readonly procesar: ProcesadorTurno,
    private readonly alFallar: (telefono: string, error: unknown) => void = () => {},
  ) {}

  agregar(m: MensajeEntrante): void {
    const e = this.estado(m.telefono)
    e.pendientes.push(m)
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => this.disparar(m.telefono), this.esperaMs)
  }

  /** Resuelve cuando no queda nada pendiente ni en curso. Para pruebas, simulador y apagado ordenado. */
  async esperarInactivo(): Promise<void> {
    for (;;) {
      const hayTimers = [...this.estados.values()].some((e) => e.timer !== null)
      if (!hayTimers && this.activos.size === 0) return
      if (this.activos.size > 0) await Promise.allSettled([...this.activos])
      else await new Promise((r) => setTimeout(r, Math.max(5, Math.min(this.esperaMs, 50))))
    }
  }

  private estado(telefono: string): Estado {
    let e = this.estados.get(telefono)
    if (!e) {
      e = { pendientes: [], timer: null, enCurso: null }
      this.estados.set(telefono, e)
    }
    return e
  }

  private disparar(telefono: string): void {
    const e = this.estado(telefono)
    e.timer = null
    // Si hay un turno en curso, al terminar vuelve a mirar los pendientes.
    if (e.enCurso) return
    this.correr(telefono, e)
  }

  private correr(telefono: string, e: Estado): void {
    const lote = e.pendientes.splice(0)
    if (lote.length === 0) {
      if (!e.timer) this.estados.delete(telefono)
      return
    }
    const p = this.procesar(telefono, lote)
      .catch((err) => this.alFallar(telefono, err))
      .finally(() => {
        e.enCurso = null
        this.activos.delete(p)
        // Llegaron mensajes durante el turno y su espera ya venció → siguiente turno.
        if (!e.timer) this.correr(telefono, e)
      })
    e.enCurso = p
    this.activos.add(p)
  }
}
