import type { z } from 'zod'

// El bot habla con el modelo solo a través de esta interfaz. Implementaciones:
// LLMOpenAI (producción y simulador) y FakeLLM (pruebas unitarias, sin red).
// Así la política y la guardia se prueban sin gastar tokens, y cambiar de
// proveedor (o de Decisor, p. ej. Jev) no toca el resto del bot.

export type MensajeLLM = { rol: 'system' | 'user' | 'assistant'; texto: string }

export type UsoLLM = { modelo: string; tokens_entrada: number; tokens_salida: number; ms: number }

export type PeticionEstructurada<T> = {
  /** Nombre del formato (aparece en el log y en la petición a OpenAI). */
  nombre: string
  esquema: z.ZodType<T>
  mensajes: MensajeLLM[]
}

export interface LLM {
  /** Respuesta en JSON estricto que cumple `esquema`; si no lo cumple, lanza. */
  estructurado<T>(p: PeticionEstructurada<T>): Promise<{ datos: T; uso: UsoLLM }>
}

/**
 * LLM de mentira: `responder` recibe el nombre del formato y los mensajes y devuelve
 * el objeto crudo. Se valida con el mismo esquema que en producción, así una prueba
 * con datos imposibles falla igual que fallaría el modelo real.
 */
export class FakeLLM implements LLM {
  readonly llamadas: { nombre: string; mensajes: MensajeLLM[] }[] = []

  constructor(private readonly responder: (nombre: string, mensajes: MensajeLLM[]) => unknown) {}

  async estructurado<T>(p: PeticionEstructurada<T>) {
    this.llamadas.push({ nombre: p.nombre, mensajes: p.mensajes })
    const datos = p.esquema.parse(await this.responder(p.nombre, p.mensajes))
    return { datos, uso: { modelo: 'fake', tokens_entrada: 0, tokens_salida: 0, ms: 0 } }
  }
}
