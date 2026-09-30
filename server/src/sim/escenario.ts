import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { EntornoSim, type OpcionesEntorno } from './entorno.js'

// Escenarios de conversación: el reemplazo automatizado de qa/guiones-bot.md.
// Cada paso manda uno o varios mensajes y verifica lo que el bot contestó.
// Las verificaciones de BD y del log de turnos (`bd:`, `turno:`) se añaden en
// las fases siguientes; el esquema es estricto para que un typo en el YAML
// falle en vez de "pasar" sin verificar nada.

const esquemaDebe = z
  .object({
    /** Cada texto debe aparecer en ALGUNA respuesta del paso (sin distinguir mayúsculas). */
    contiene: z.array(z.string()).default([]),
    /** Ningún texto puede aparecer en NINGUNA respuesta del paso. */
    no_contiene: z.array(z.string()).default([]),
    /** Regex (flags i) que debe cumplir alguna respuesta. */
    coincide: z.string().optional(),
    /** Número exacto de mensajes que manda el bot en este paso. */
    respuestas: z.number().int().min(0).optional(),
    /** Lo que decidió la política en el ÚLTIMO turno del paso (bot: decision). */
    turno: z
      .object({
        handler: z.string().optional(),
        regla: z.string().optional(),
        /** Tipos de acción que DEBEN estar (p. ej. [crear_pedido]). */
        acciones: z.array(z.string()).optional(),
        /** Tipos de acción que NO pueden estar. Úsalo para los invariantes críticos. */
        sin_acciones: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const esquemaPaso = z
  .object({
    /** Un texto, o varios seguidos (el buffer los junta en un turno). */
    envia: z.union([z.string(), z.array(z.string())]).optional(),
    envia_boton: z.string().optional(),
    envia_imagen: z.object({ id: z.string(), mime: z.string().optional(), caption: z.string().optional() }).strict().optional(),
    envia_tipo: z.string().optional(),
    debe: esquemaDebe.default({ contiene: [], no_contiene: [] }),
  })
  .strict()
  .refine(
    (p) => [p.envia, p.envia_boton, p.envia_imagen, p.envia_tipo].filter((x) => x !== undefined).length === 1,
    'cada paso debe tener exactamente uno de: envia, envia_boton, envia_imagen, envia_tipo',
  )

export const esquemaEscenario = z
  .object({
    nombre: z.string(),
    descripcion: z.string().optional(),
    /** Crítico = invariante de negocio: tiene que pasar en TODAS las corridas. */
    critico: z.boolean().default(false),
    telefono: z.string().default('573000000901'),
    nombre_cliente: z.string().default('Cliente Sim'),
    /** eco = núcleo determinista (Fases 1–3) · decision = clasificador + política + guardia (necesita OPENAI_API_KEY). */
    bot: z.enum(['eco', 'decision']).default('eco'),
    pasos: z.array(esquemaPaso).min(1),
  })
  .strict()

export type Escenario = z.infer<typeof esquemaEscenario>
export type Paso = Escenario['pasos'][number]

export function cargarEscenario(ruta: string): Escenario {
  const r = esquemaEscenario.safeParse(parseYaml(readFileSync(ruta, 'utf8')))
  if (!r.success) {
    throw new Error(`${ruta}: escenario inválido\n${r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`)
  }
  return r.data
}

export type ResultadoPaso = { indice: number; enviado: string; respuestas: string[]; fallos: string[] }
export type ResultadoCorrida = { ok: boolean; pasos: ResultadoPaso[] }

export function verificar(debe: Paso['debe'], respuestas: string[], decision?: unknown): string[] {
  const fallos: string[] = []
  const todo = respuestas.map((r) => r.toLowerCase())
  for (const t of debe.contiene) {
    if (!todo.some((r) => r.includes(t.toLowerCase()))) fallos.push(`falta "${t}"`)
  }
  for (const t of debe.no_contiene) {
    if (todo.some((r) => r.includes(t.toLowerCase()))) fallos.push(`no debía decir "${t}"`)
  }
  if (debe.coincide && !respuestas.some((r) => new RegExp(debe.coincide!, 'i').test(r))) {
    fallos.push(`ninguna respuesta cumple /${debe.coincide}/i`)
  }
  if (debe.respuestas !== undefined && respuestas.length !== debe.respuestas) {
    fallos.push(`esperaba ${debe.respuestas} respuesta(s), llegaron ${respuestas.length}`)
  }
  if (debe.turno) {
    const d = (decision ?? {}) as { handler?: string; regla?: string; acciones?: { tipo: string }[] }
    const tipos = (d.acciones ?? []).map((a) => a.tipo)
    if (debe.turno.handler && d.handler !== debe.turno.handler) fallos.push(`handler ${d.handler}, esperaba ${debe.turno.handler}`)
    if (debe.turno.regla && d.regla !== debe.turno.regla) fallos.push(`regla ${d.regla}, esperaba ${debe.turno.regla}`)
    for (const a of debe.turno.acciones ?? []) if (!tipos.includes(a)) fallos.push(`faltó la acción ${a}`)
    for (const a of debe.turno.sin_acciones ?? []) if (tipos.includes(a)) fallos.push(`NO debía ejecutar ${a}`)
  }
  return fallos
}

function describir(p: Paso): string {
  if (p.envia !== undefined) return Array.isArray(p.envia) ? p.envia.join(' ⏎ ') : p.envia
  if (p.envia_boton !== undefined) return `[botón] ${p.envia_boton}`
  if (p.envia_imagen) return `[imagen] ${p.envia_imagen.id}`
  return `[${p.envia_tipo}]`
}

/** Corre un escenario una vez, en un entorno limpio. */
export async function correrEscenario(e: Escenario, opciones: OpcionesEntorno = {}): Promise<ResultadoCorrida> {
  if (e.bot === 'decision' && !opciones.llm && !opciones.conversador) {
    throw new Error(`${e.nombre}: usa bot: decision y no hay LLM (falta OPENAI_API_KEY en server/.env)`)
  }
  const sim = new EntornoSim(e.bot === 'eco' ? { ...opciones, llm: undefined } : opciones)
  const pasos: ResultadoPaso[] = []

  for (const [indice, p] of e.pasos.entries()) {
    const antes = sim.wa.textosPara(e.telefono).length

    if (p.envia !== undefined) {
      for (const t of Array.isArray(p.envia) ? p.envia : [p.envia]) await sim.enviarTexto(e.telefono, t, e.nombre_cliente)
    } else if (p.envia_boton !== undefined) await sim.enviarBoton(e.telefono, p.envia_boton)
    else if (p.envia_imagen) await sim.enviarImagen(e.telefono, p.envia_imagen.id, p.envia_imagen.mime, p.envia_imagen.caption)
    else if (p.envia_tipo !== undefined) await sim.enviarTipo(e.telefono, p.envia_tipo)

    await sim.esperar()
    const respuestas = sim.wa.textosPara(e.telefono).slice(antes)
    const decision = sim.registro.turnos.at(-1)?.decision
    pasos.push({ indice: indice + 1, enviado: describir(p), respuestas, fallos: verificar(p.debe, respuestas, decision) })
  }

  return { ok: pasos.every((p) => p.fallos.length === 0), pasos }
}

export type Veredicto = { escenario: Escenario; corridas: ResultadoCorrida[]; aprobadas: number; ok: boolean }

/** Umbral: crítico = todas las corridas; normal = al menos 90%. */
export function veredicto(escenario: Escenario, corridas: ResultadoCorrida[]): Veredicto {
  const aprobadas = corridas.filter((c) => c.ok).length
  const ok = escenario.critico ? aprobadas === corridas.length : aprobadas / corridas.length >= 0.9
  return { escenario, corridas, aprobadas, ok }
}
