import { AsyncLocalStorage } from 'node:async_hooks'
import type { z } from 'zod'

// El bot habla con el modelo solo a través de esta interfaz. Implementaciones:
// LLMOpenAI (producción y simulador) y FakeLLM (pruebas unitarias, sin red).
// Así la política y la guardia se prueban sin gastar tokens, y cambiar de
// proveedor (o de Decisor, p. ej. Jev) no toca el resto del bot.

export type MensajeLLM = { rol: 'system' | 'user' | 'assistant'; texto: string }

export type UsoLLM = { modelo: string; tokens_entrada: number; tokens_salida: number; ms: number }

// ── Consumo por turno ──────────────────────────────────────────────────────
// Cada llamada al modelo anota su uso en el turno en curso, sin pasar el turno
// por todos los agentes: el conversador abre una "caja" (medirConsumo) y lo que
// pase dentro de ella —clasificador, agente, reescritura— cae ahí. Sirve para
// saber cuánto cuesta atender a un cliente, no solo lo del clasificador.

export type ConsumoLLM = { nombre: string } & UsoLLM
const cajaConsumo = new AsyncLocalStorage<ConsumoLLM[]>()

/** La implementación del LLM lo llama tras cada petición. Fuera de una caja no hace nada. */
export function anotarConsumo(nombre: string, uso: UsoLLM) {
  cajaConsumo.getStore()?.push({ nombre, ...uso })
}

export type ResumenConsumo = { tokens_entrada: number; tokens_salida: number; ms: number; llamadas: ConsumoLLM[] }

/** Corre `fn` dentro de una caja de consumo; `registrar` recibe el resumen aunque `fn` falle. */
export async function medirConsumo<T>(fn: () => Promise<T>, registrar: (c: ResumenConsumo) => void): Promise<T> {
  const llamadas: ConsumoLLM[] = []
  try {
    return await cajaConsumo.run(llamadas, fn)
  } finally {
    const sumar = (k: 'tokens_entrada' | 'tokens_salida' | 'ms') => llamadas.reduce((s, l) => s + l[k], 0)
    if (llamadas.length) registrar({ tokens_entrada: sumar('tokens_entrada'), tokens_salida: sumar('tokens_salida'), ms: sumar('ms'), llamadas })
  }
}

export type PeticionEstructurada<T> = {
  /** Nombre del formato (aparece en el log y en la petición a OpenAI). */
  nombre: string
  esquema: z.ZodType<T>
  mensajes: MensajeLLM[]
}

/**
 * Una herramienta que el modelo puede llamar. `ejecutar` recibe los argumentos
 * ya validados con `esquema`; lo que devuelve se le entrega al modelo como JSON.
 * Nunca debe lanzar: los errores se devuelven como `{ok:false, error}`.
 */
export type Herramienta<A = any> = {
  nombre: string
  descripcion: string
  esquema: z.ZodType<A>
  ejecutar: (args: A) => Promise<unknown>
}

export type LlamadaLLM = { nombre: string; args: unknown; resultado: unknown }

export type PeticionConHerramientas<T> = PeticionEstructurada<T> & {
  herramientas: Herramienta[]
  /** Rondas de herramientas antes de exigir la respuesta final. */
  maxPasos?: number
}

export interface LLM {
  /** Respuesta en JSON estricto que cumple `esquema`; si no lo cumple, lanza. */
  estructurado<T>(p: PeticionEstructurada<T>): Promise<{ datos: T; uso: UsoLLM }>
  /** Igual, pero el modelo puede llamar herramientas antes de responder. */
  conHerramientas<T>(p: PeticionConHerramientas<T>): Promise<{ datos: T; uso: UsoLLM; llamadas: LlamadaLLM[] }>
}

/** Ejecuta una herramienta con argumentos crudos del modelo, sin lanzar nunca. */
export async function ejecutarHerramienta(h: Herramienta | undefined, crudos: unknown): Promise<unknown> {
  if (!h) return { ok: false, error: 'HERRAMIENTA_DESCONOCIDA' }
  const args = h.esquema.safeParse(crudos)
  if (!args.success) return { ok: false, error: 'ARGUMENTOS_INVALIDOS', detalle: args.error.issues.map((i) => i.message) }
  try {
    return await h.ejecutar(args.data)
  } catch (err) {
    return { ok: false, error: 'ERROR_INTERNO', detalle: String(err) }
  }
}

/** Lo que devuelve un guion de FakeLLM en cada paso: llamar herramientas, o responder. */
export type PasoFake = { llamar: { nombre: string; args: unknown }[] } | { final: unknown }

/**
 * LLM de mentira: `responder` recibe el nombre del formato, los mensajes y las
 * llamadas hechas hasta ahora en esta petición, y devuelve el objeto crudo (o,
 * con herramientas, un `PasoFake`). Se valida con el mismo esquema que en
 * producción, así una prueba con datos imposibles falla igual que fallaría el modelo real.
 */
export class FakeLLM implements LLM {
  readonly llamadas: { nombre: string; mensajes: MensajeLLM[] }[] = []

  constructor(private readonly responder: (nombre: string, mensajes: MensajeLLM[], previas: LlamadaLLM[]) => unknown) {}

  private readonly uso = { modelo: 'fake', tokens_entrada: 0, tokens_salida: 0, ms: 0 }

  async estructurado<T>(p: PeticionEstructurada<T>) {
    this.llamadas.push({ nombre: p.nombre, mensajes: p.mensajes })
    const datos = p.esquema.parse(await this.responder(p.nombre, p.mensajes, []))
    return { datos, uso: this.uso }
  }

  async conHerramientas<T>(p: PeticionConHerramientas<T>) {
    this.llamadas.push({ nombre: p.nombre, mensajes: p.mensajes })
    const hechas: LlamadaLLM[] = []
    for (let paso = 0; paso <= (p.maxPasos ?? 6); paso++) {
      const r = (await this.responder(p.nombre, p.mensajes, hechas)) as PasoFake
      if ('final' in r) return { datos: p.esquema.parse(r.final), uso: this.uso, llamadas: hechas }
      for (const l of r.llamar) {
        const h = p.herramientas.find((x) => x.nombre === l.nombre)
        hechas.push({ nombre: l.nombre, args: l.args, resultado: await ejecutarHerramienta(h, l.args) })
      }
    }
    throw new Error(`${p.nombre}: el guion no terminó en ${p.maxPasos ?? 6} pasos`)
  }
}
