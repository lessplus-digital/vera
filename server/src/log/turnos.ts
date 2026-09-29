import type { Logger } from '../log.js'
import type { SupabaseClient } from '../bd/supabase.js'
import type { MensajeEntrante } from '../whatsapp/payload.js'

// La "caja negra": un registro por turno de conversación en `bot_turnos`.
// Qué entró, qué se decidió, qué herramientas corrieron y qué salió. Es lo que
// reemplaza a "abrir la ejecución de n8n" para depurar, y lo que leen los
// escenarios del simulador para verificar decisiones (no solo textos).

export type LlamadaHerramienta = {
  nombre: string
  args: unknown
  resultado: unknown
  ms: number
}

export type RegistroTurno = {
  telefono: string
  inicio: string
  duracion_ms: number
  entrada: unknown[]
  contexto: unknown
  clasificacion: unknown
  decision: unknown
  herramientas: LlamadaHerramienta[]
  salida: string[]
  guardia: unknown
  error: string | null
  costo: unknown
}

/** Se va llenando durante el turno; `cerrar()` produce el registro final. */
export class Turno {
  private readonly t0: number
  private readonly inicio: string
  contexto: unknown = null
  clasificacion: unknown = null
  decision: unknown = null
  guardia: unknown = null
  costo: unknown = null
  error: string | null = null
  readonly herramientas: LlamadaHerramienta[] = []
  readonly salida: string[] = []

  constructor(
    readonly telefono: string,
    readonly entrada: MensajeEntrante[],
    private readonly ahora: () => number = Date.now,
  ) {
    this.t0 = ahora()
    this.inicio = new Date(this.t0).toISOString()
  }

  /** Ejecuta una herramienta y la deja anotada con su resultado y duración. */
  async herramienta<T>(nombre: string, args: unknown, fn: () => Promise<T>): Promise<T> {
    const t = this.ahora()
    try {
      const resultado = await fn()
      this.herramientas.push({ nombre, args, resultado, ms: this.ahora() - t })
      return resultado
    } catch (err) {
      this.herramientas.push({ nombre, args, resultado: { excepcion: String(err) }, ms: this.ahora() - t })
      throw err
    }
  }

  cerrar(): RegistroTurno {
    return {
      telefono: this.telefono,
      inicio: this.inicio,
      duracion_ms: this.ahora() - this.t0,
      // Sin el nombre del perfil de WhatsApp: no aporta a la depuración.
      entrada: this.entrada.map(({ nombre: _nombre, ...m }) => m),
      contexto: this.contexto,
      clasificacion: this.clasificacion,
      decision: this.decision,
      herramientas: this.herramientas,
      salida: this.salida,
      guardia: this.guardia,
      error: this.error,
      costo: this.costo,
    }
  }
}

export interface RegistroTurnos {
  guardar(r: RegistroTurno): Promise<void>
}

/** Para pruebas y simulador: los turnos quedan en memoria para verificarlos. */
export class RegistroMemoria implements RegistroTurnos {
  readonly turnos: RegistroTurno[] = []
  async guardar(r: RegistroTurno) {
    this.turnos.push(r)
  }
}

/** Solo al log del proceso (desarrollo sin Supabase). */
export class RegistroLog implements RegistroTurnos {
  constructor(private readonly log: Logger) {}
  async guardar(r: RegistroTurno) {
    this.log.debug({ turno: r }, 'turno')
  }
}

export class RegistroBD implements RegistroTurnos {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly log: Logger,
  ) {}

  async guardar(r: RegistroTurno) {
    // Guardar el log nunca puede tumbar un turno ya respondido al cliente.
    try {
      const { error } = await this.sb.from('bot_turnos').insert(r)
      if (error) this.log.error({ error, telefono: r.telefono }, 'no se pudo guardar el turno')
    } catch (err) {
      this.log.error({ err, telefono: r.telefono }, 'no se pudo guardar el turno')
    }
  }
}
