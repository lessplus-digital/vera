import OpenAI from 'openai'
import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import {
  ejecutarHerramienta,
  type LlamadaLLM,
  type LLM,
  type MensajeLLM,
  type PeticionConHerramientas,
  type PeticionEstructurada,
  type UsoLLM,
} from './llm.js'

// Structured Outputs de OpenAI: el modelo queda obligado a devolver JSON que
// cumple el esquema (strict). Aun así se valida con zod al volver: la garantía
// del proveedor no reemplaza la nuestra.

const entrada = (mensajes: MensajeLLM[]): ResponseInputItem[] =>
  mensajes.map((m) => ({ role: m.rol === 'system' ? 'developer' : m.rol, content: m.texto }))

export class LLMOpenAI implements LLM {
  private readonly cliente: OpenAI

  constructor(
    apiKey: string,
    private readonly modelo: string,
    opciones: { timeoutMs?: number } = {},
  ) {
    // Un reintento: el turno ya tiene su propia respuesta de emergencia si esto falla.
    this.cliente = new OpenAI({ apiKey, timeout: opciones.timeoutMs ?? 30_000, maxRetries: 1 })
  }

  async estructurado<T>(p: PeticionEstructurada<T>) {
    const inicio = Date.now()
    const r = await this.cliente.responses.parse({
      model: this.modelo,
      input: entrada(p.mensajes),
      text: { format: zodTextFormat(p.esquema, p.nombre) },
      store: false,
    })
    if (r.output_parsed == null) throw new Error(`${p.nombre}: el modelo no devolvió JSON (${r.status})`)
    return {
      datos: p.esquema.parse(r.output_parsed),
      uso: { modelo: r.model, tokens_entrada: r.usage?.input_tokens ?? 0, tokens_salida: r.usage?.output_tokens ?? 0, ms: Date.now() - inicio },
    }
  }

  async conHerramientas<T>(p: PeticionConHerramientas<T>) {
    const inicio = Date.now()
    const uso: UsoLLM = { modelo: this.modelo, tokens_entrada: 0, tokens_salida: 0, ms: 0 }
    const tools = p.herramientas.map((h) => zodResponsesFunction({ name: h.nombre, description: h.descripcion, parameters: h.esquema }))
    const input: ResponseInputItem[] = entrada(p.mensajes)
    const llamadas: LlamadaLLM[] = []
    const maxPasos = p.maxPasos ?? 6

    for (let paso = 0; ; paso++) {
      const ultimo = paso >= maxPasos
      const r = await this.cliente.responses.parse({
        model: this.modelo,
        input,
        tools,
        // En el último paso se le quitan las herramientas: tiene que responder.
        tool_choice: ultimo ? 'none' : 'auto',
        text: { format: zodTextFormat(p.esquema, p.nombre) },
        store: false,
        // Sin `store`, el razonamiento se devuelve cifrado para reenviarlo en el siguiente paso.
        include: ['reasoning.encrypted_content'],
      })
      uso.modelo = r.model
      uso.tokens_entrada += r.usage?.input_tokens ?? 0
      uso.tokens_salida += r.usage?.output_tokens ?? 0

      const pedidas = r.output.filter((o) => o.type === 'function_call')
      if (!pedidas.length) {
        if (r.output_parsed == null) throw new Error(`${p.nombre}: el modelo no devolvió JSON (${r.status})`)
        uso.ms = Date.now() - inicio
        return { datos: p.esquema.parse(r.output_parsed), uso, llamadas }
      }
      if (ultimo) throw new Error(`${p.nombre}: sigue pidiendo herramientas tras ${maxPasos} pasos`)

      // El SDK decora las salidas con `parsed_arguments`/`parsed`, que la API no acepta de vuelta.
      input.push(
        ...r.output.map((o) => {
          const { parsed_arguments: _a, parsed: _p, ...limpio } = o as unknown as Record<string, unknown>
          return limpio as unknown as ResponseInputItem
        }),
      )
      for (const f of pedidas) {
        let args: unknown
        try {
          args = JSON.parse(f.arguments)
        } catch {
          args = null
        }
        const resultado = await ejecutarHerramienta(
          p.herramientas.find((h) => h.nombre === f.name),
          args,
        )
        llamadas.push({ nombre: f.name, args, resultado })
        input.push({ type: 'function_call_output', call_id: f.call_id, output: JSON.stringify(resultado) })
      }
    }
  }
}

/** Para el simulador y el chat de terminal: el LLM real si hay clave en el entorno. */
export function llmDelEntorno(env: NodeJS.ProcessEnv = process.env): LLMOpenAI | undefined {
  return env.OPENAI_API_KEY ? new LLMOpenAI(env.OPENAI_API_KEY, env.OPENAI_MODEL || 'gpt-5.1') : undefined
}
