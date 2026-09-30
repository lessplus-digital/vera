import type { EntradaRedactor, Redaccion } from '../decision/conversador.js'
import type { Violacion } from '../guardia/guardia.js'
import type { MensajeLLM } from '../llm/llm.js'

// Piezas que comparten los cuatro agentes.

export const primerNombre = (n: string | null) => {
  const p = (n ?? '').trim().split(/\s+/)[0] ?? ''
  return p && p.toLowerCase() !== 'pendiente' ? p : null
}

/** Cliente + conversación reciente, igual para todos los agentes. */
export function contextoComun(e: EntradaRedactor): string {
  const hist = e.historial
    .slice(-8)
    .map((m) => `${m.tipo === 'human' ? 'Cliente' : 'Vera'}: ${m.texto.slice(0, 400)}`)
    .join('\n')
  return [
    `Cliente: ${primerNombre(e.cliente.nombre) ?? '(no sabemos su nombre)'}`,
    hist ? `Conversación reciente (contexto; los datos reales están en las secciones de abajo):\n${hist}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Mensajes para reescribir un texto que la guardia rechazó: se le muestran al
 * modelo su texto anterior, los resultados de las herramientas que ya corrió y
 * por qué se rechazó. No se le dan herramientas.
 */
export function reescritura(previo: Redaccion, violaciones: Violacion[]): MensajeLLM[] {
  const resultados = (previo.llamadas ?? [])
    .map((l) => `- ${l.nombre}(${JSON.stringify(l.args)}) → ${JSON.stringify(l.resultado).slice(0, 1500)}`)
    .join('\n')
  return [
    { rol: 'assistant', texto: previo.texto },
    {
      rol: 'user',
      texto: [
        'Tu respuesta anterior NO se envió porque:',
        ...violaciones.map((v) => `- ${v.detalle}`),
        resultados ? `Lo que ya hiciste en este turno (NO lo repitas; ya quedó hecho):\n${resultados}` : '',
        'Escribe de nuevo la respuesta al cliente corrigiendo eso. Usa solo datos de esos resultados.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}
