// Meta reintenta un webhook si no recibe 200 a tiempo, así que el mismo mensaje
// (mismo `wamid`) puede llegar dos veces. Esto garantiza que se procese una.
//
// Fase 1: en memoria (vale para un solo proceso). Fase 2 añade una
// implementación sobre la tabla `wa_eventos` (UNIQUE wamid) para sobrevivir a
// reinicios.

export interface Dedupe {
  /** true la primera vez que se ve este wamid; false si ya se había visto. */
  primeraVez(wamid: string): Promise<boolean>
}

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
