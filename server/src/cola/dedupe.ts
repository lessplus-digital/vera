import type { Logger } from '../log.js'
import { UNIQUE_VIOLATION, type ErrorBD, type SupabaseClient } from '../bd/supabase.js'

// Meta reintenta un webhook si no recibe 200 a tiempo, así que el mismo mensaje
// (mismo `wamid`) puede llegar dos veces. Esto garantiza que se procese una.

export interface Dedupe {
  /** true la primera vez que se ve este wamid; false si ya se había visto. */
  primeraVez(wamid: string, telefono: string): Promise<boolean>
}

/** En memoria: rápida, pero se olvida al reiniciar el proceso. */
export class DedupeMemoria implements Dedupe {
  private readonly vistos = new Map<string, number>()

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly max = 50_000,
    private readonly ahora: () => number = Date.now,
  ) {}

  async primeraVez(wamid: string): Promise<boolean> {
    const t = this.ahora()
    const visto = this.vistos.get(wamid)
    if (visto !== undefined && t - visto < this.ttlMs) return false
    this.vistos.set(wamid, t)
    if (this.vistos.size > this.max) {
      // Map conserva el orden de inserción: el primero es el más viejo.
      const masViejo = this.vistos.keys().next().value
      if (masViejo !== undefined) this.vistos.delete(masViejo)
    }
    return true
  }
}

/** Inserta en `wa_eventos` (PK wamid); sobrevive a reinicios y despliegues. */
export type InsertarWaEvento = (fila: { wamid: string; telefono: string }) => Promise<{ error: ErrorBD | null }>

export function insertarWaEventoSupabase(sb: SupabaseClient): InsertarWaEvento {
  return async (fila) => {
    const { error } = await sb.from('wa_eventos').insert(fila)
    return { error }
  }
}

export class DedupeBD implements Dedupe {
  constructor(
    private readonly insertar: InsertarWaEvento,
    private readonly log: Logger,
  ) {}

  async primeraVez(wamid: string, telefono: string): Promise<boolean> {
    try {
      const { error } = await this.insertar({ wamid, telefono })
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      this.log.error({ wamid, error }, 'dedupe en BD falló: se procesa igual')
    } catch (err) {
      this.log.error({ wamid, err }, 'dedupe en BD falló: se procesa igual')
    }
    // Si la BD no responde se prefiere procesar un posible duplicado antes que
    // perder el mensaje de un cliente. La capa en memoria sigue filtrando los
    // reintentos inmediatos de Meta.
    return true
  }
}

/** Memoria primero (barata, corta los reintentos inmediatos) y luego BD. */
export class DedupeEnCapas implements Dedupe {
  constructor(private readonly capas: Dedupe[]) {}

  async primeraVez(wamid: string, telefono: string): Promise<boolean> {
    for (const c of this.capas) {
      if (!(await c.primeraVez(wamid, telefono))) return false
    }
    return true
  }
}
