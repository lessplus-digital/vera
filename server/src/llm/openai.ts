import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { LLM, PeticionEstructurada } from './llm.js'

// Structured Outputs de OpenAI: el modelo queda obligado a devolver JSON que
// cumple el esquema (strict). Aun así se valida con zod al volver: la garantía
// del proveedor no reemplaza la nuestra.

export class LLMOpenAI implements LLM {
  private readonly cliente: OpenAI

  constructor(
    apiKey: string,
    private readonly modelo: string,
    opciones: { timeoutMs?: number } = {},
  ) {
    // Un reintento: el turno ya tiene su propia respuesta de emergencia si esto falla.
    this.cliente = new OpenAI({ apiKey, timeout: opciones.timeoutMs ?? 20_000, maxRetries: 1 })
  }

  async estructurado<T>(p: PeticionEstructurada<T>) {
    const inicio = Date.now()
    const r = await this.cliente.responses.parse({
      model: this.modelo,
      input: p.mensajes.map((m) => ({ role: m.rol === 'system' ? 'developer' : m.rol, content: m.texto })),
      text: { format: zodTextFormat(p.esquema, p.nombre) },
      store: false,
    })
    if (r.output_parsed == null) throw new Error(`${p.nombre}: el modelo no devolvió JSON (${r.status})`)
    return {
      datos: p.esquema.parse(r.output_parsed),
      uso: {
        modelo: r.model,
        tokens_entrada: r.usage?.input_tokens ?? 0,
        tokens_salida: r.usage?.output_tokens ?? 0,
        ms: Date.now() - inicio,
      },
    }
  }
}

/** Para el simulador y el chat de terminal: el LLM real si hay clave en el entorno. */
export function llmDelEntorno(env: NodeJS.ProcessEnv = process.env): LLMOpenAI | undefined {
  return env.OPENAI_API_KEY ? new LLMOpenAI(env.OPENAI_API_KEY, env.OPENAI_MODEL || 'gpt-5.1') : undefined
}
