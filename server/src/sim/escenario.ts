import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { EntornoSim, type OpcionesEntorno } from './entorno.js'
import { correrFeedback } from '../cron/feedback.js'
import { loggerMudo } from '../log.js'
import { usarDatosReales } from './datos-reales.js'

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
        /** decision.accion (p. ej. lo que devolvió procesar_respuesta_feedback). */
        accion: z.string().optional(),
      })
      .strict()
      .optional(),
    /** Lo que quedó en la BD (en memoria) al terminar el paso: la fila, no lo que el bot dijo. */
    bd: z
      .object({
        modo: z.enum(['bot', 'humano', 'esperando_feedback']).optional(),
        /** Las calificaciones guardadas, completas y en orden (comentario null = sin comentario). */
        feedback: z
          .array(z.object({ pedido_id: z.string(), nota: z.number().int(), comentario: z.string().nullable().default(null) }).strict())
          .optional(),
        /** true = queda una calificación pendiente en la cola (feedback_pendiente). */
        feedback_pendiente: z.boolean().optional(),
        /** El carrito exacto: un nombre de producto por línea, en orden ([] = vacío). */
        carrito: z.array(z.string()).optional(),
        /** Ninguna línea del carrito puede ser un producto fuera de esta lista (G1: nunca otro producto). */
        carrito_solo: z.array(z.string()).optional(),
        /** Suma de las líneas del carrito. */
        carrito_total: z.number().optional(),
        /** Cada texto debe estar en algún mensaje del chat de Soporte (mensajes_soporte). */
        soporte_contiene: z.array(z.string()).optional(),
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
    /** Simula un pedido entregado y corre el job de calificaciones (el cron de cada 15 min). */
    pide_calificacion: z.object({ pedido_id: z.string() }).strict().optional(),
    debe: esquemaDebe.default({ contiene: [], no_contiene: [] }),
  })
  .strict()
  .refine(
    (p) => [p.envia, p.envia_boton, p.envia_imagen, p.envia_tipo, p.pide_calificacion].filter((x) => x !== undefined).length === 1,
    'cada paso debe tener exactamente uno de: envia, envia_boton, envia_imagen, envia_tipo, pide_calificacion',
  )

export const esquemaEscenario = z
  .object({
    nombre: z.string(),
    descripcion: z.string().optional(),
    /** Crítico = invariante de negocio: tiene que pasar en TODAS las corridas. */
    critico: z.boolean().default(false),
    telefono: z.string().default('573000000901'),
    nombre_cliente: z.string().default('Cliente Sim'),
    /** true = el cliente ya existe con nombre_cliente (no es su primer mensaje): no se le pregunta el nombre. */
    cliente_registrado: z.boolean().default(false),
    /** eco = núcleo determinista (Fases 1–3) · decision = clasificador + política + guardia (necesita OPENAI_API_KEY). */
    bot: z.enum(['eco', 'decision']).default('eco'),
    /**
     * sim = catálogo inventado (sin red) · real = menú, cobertura, info del local y FAQ de
     * Supabase, solo lectura (sim/datos-reales.ts; necesita SUPABASE_* en server/.env).
     */
    datos: z.enum(['sim', 'real']).default('sim'),
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

export type ResultadoPaso = {
  indice: number
  enviado: string
  respuestas: string[]
  fallos: string[]
  /** Herramientas que corrieron en los turnos del paso, con sus argumentos (para depurar con --ver). */
  herramientas: string[]
  /** Tokens del modelo que gastaron los turnos del paso (entrada + salida). */
  tokens: number
}
export type ResultadoCorrida = { ok: boolean; pasos: ResultadoPaso[] }

/** Lo que `debe.bd` compara: una foto de la BD en memoria al terminar el paso. */
export type FotoBd = {
  modo: string | undefined
  feedback: { pedido_id: string; nota: number; comentario: string | null }[]
  feedback_pendiente: boolean
  carrito: { nombre: string; subtotal: number }[]
  soporte: string[]
}

export function verificar(debe: Paso['debe'], respuestas: string[], decision?: unknown, bd?: FotoBd): string[] {
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
    const d = (decision ?? {}) as { handler?: string; regla?: string; accion?: string; acciones?: { tipo: string }[] }
    const tipos = (d.acciones ?? []).map((a) => a.tipo)
    if (debe.turno.handler && d.handler !== debe.turno.handler) fallos.push(`handler ${d.handler}, esperaba ${debe.turno.handler}`)
    if (debe.turno.regla && d.regla !== debe.turno.regla) fallos.push(`regla ${d.regla}, esperaba ${debe.turno.regla}`)
    for (const a of debe.turno.acciones ?? []) if (!tipos.includes(a)) fallos.push(`faltó la acción ${a}`)
    for (const a of debe.turno.sin_acciones ?? []) if (tipos.includes(a)) fallos.push(`NO debía ejecutar ${a}`)
    if (debe.turno.accion && d.accion !== debe.turno.accion) fallos.push(`accion ${d.accion}, esperaba ${debe.turno.accion}`)
  }
  if (debe.bd) {
    const b = bd ?? { modo: undefined, feedback: [], feedback_pendiente: false, carrito: [], soporte: [] }
    for (const t of debe.bd.soporte_contiene ?? []) {
      if (!b.soporte.some((m) => m.toLowerCase().includes(t.toLowerCase()))) fallos.push(`el chat de Soporte no tiene "${t}"`)
    }
    const nombres = b.carrito.map((l) => l.nombre)
    if (debe.bd.carrito && JSON.stringify(nombres) !== JSON.stringify(debe.bd.carrito)) {
      fallos.push(`carrito ${JSON.stringify(nombres)}, esperaba ${JSON.stringify(debe.bd.carrito)}`)
    }
    if (debe.bd.carrito_solo) {
      const permitidos = debe.bd.carrito_solo.map((x) => x.toLowerCase())
      const intrusos = nombres.filter((n) => !permitidos.includes(n.toLowerCase()))
      if (intrusos.length) fallos.push(`el carrito tiene productos que no se pidieron: ${intrusos.join(', ')}`)
    }
    const total = b.carrito.reduce((s, l) => s + l.subtotal, 0)
    if (debe.bd.carrito_total !== undefined && total !== debe.bd.carrito_total) {
      fallos.push(`carrito_total ${total}, esperaba ${debe.bd.carrito_total}`)
    }
    if (debe.bd.modo && b.modo !== debe.bd.modo) fallos.push(`modo ${b.modo}, esperaba ${debe.bd.modo}`)
    if (debe.bd.feedback && JSON.stringify(b.feedback) !== JSON.stringify(debe.bd.feedback)) {
      fallos.push(`feedback ${JSON.stringify(b.feedback)}, esperaba ${JSON.stringify(debe.bd.feedback)}`)
    }
    if (debe.bd.feedback_pendiente !== undefined && b.feedback_pendiente !== debe.bd.feedback_pendiente) {
      fallos.push(`feedback_pendiente ${b.feedback_pendiente}, esperaba ${debe.bd.feedback_pendiente}`)
    }
  }
  return fallos
}

function describir(p: Paso): string {
  if (p.envia !== undefined) return Array.isArray(p.envia) ? p.envia.join(' ⏎ ') : p.envia
  if (p.envia_boton !== undefined) return `[botón] ${p.envia_boton}`
  if (p.envia_imagen) return `[imagen] ${p.envia_imagen.id}`
  if (p.pide_calificacion) return `[job] pedir calificación de ${p.pide_calificacion.pedido_id}`
  return `[${p.envia_tipo}]`
}

/** Corre un escenario una vez, en un entorno limpio. */
export async function correrEscenario(e: Escenario, opciones: OpcionesEntorno = {}): Promise<ResultadoCorrida> {
  if (e.bot === 'decision' && !opciones.llm && !opciones.conversador) {
    throw new Error(`${e.nombre}: usa bot: decision y no hay LLM (falta OPENAI_API_KEY en server/.env)`)
  }
  const sim = new EntornoSim(e.bot === 'eco' ? { ...opciones, llm: undefined } : opciones)
  if (e.datos === 'real' && !usarDatosReales(sim.repo)) {
    throw new Error(`${e.nombre}: usa datos: real y faltan SUPABASE_URL / SUPABASE_SECRET_KEY en server/.env`)
  }
  const pasos: ResultadoPaso[] = []
  if (e.cliente_registrado) {
    const c = await sim.repo.clientePorTelefono(e.telefono)
    await sim.repo.actualizarNombreCliente(c.cliente_id, e.nombre_cliente)
  }

  for (const [indice, p] of e.pasos.entries()) {
    const antes = sim.wa.textosPara(e.telefono).length
    const turnosAntes = sim.registro.turnos.length

    if (p.envia !== undefined) {
      for (const t of Array.isArray(p.envia) ? p.envia : [p.envia]) await sim.enviarTexto(e.telefono, t, e.nombre_cliente)
    } else if (p.envia_boton !== undefined) await sim.enviarBoton(e.telefono, p.envia_boton)
    else if (p.envia_imagen) await sim.enviarImagen(e.telefono, p.envia_imagen.id, p.envia_imagen.mime, p.envia_imagen.caption)
    else if (p.envia_tipo !== undefined) await sim.enviarTipo(e.telefono, p.envia_tipo)
    else if (p.pide_calificacion) {
      const { pedido_id } = p.pide_calificacion
      // Quien recibió un pedido ya dio su nombre al pedirlo.
      const cliente = await sim.repo.clientePorTelefono(e.telefono)
      if (cliente.nombre === 'Pendiente') await sim.repo.actualizarNombreCliente(cliente.cliente_id, e.nombre_cliente)
      sim.repo.agregarPedido({ telefono: e.telefono, pedido_id, estado: 'entregado', metodo_pago: 'Efectivo' })
      sim.repo.porCalificar.push({ pedido_id, cliente_id: cliente.cliente_id, telefono: e.telefono, nombre: e.nombre_cliente })
      await correrFeedback({ repo: sim.repo, wa: sim.wa, log: loggerMudo, esperar: async () => {} })
    }

    await sim.esperar()
    const respuestas = sim.wa.textosPara(e.telefono).slice(antes)
    const decision = sim.registro.turnos.at(-1)?.decision
    const bd: FotoBd = {
      modo: sim.repo.clientes.get(e.telefono)?.modo,
      feedback: sim.repo.feedback.map((f) => ({ ...f })),
      feedback_pendiente: sim.repo.colaFeedback.has(e.telefono),
      carrito: (sim.repo.carritos.get(e.telefono)?.items ?? []).map((i) => ({ nombre: i.nombre, subtotal: i.subtotal })),
      soporte: sim.repo.soporte.filter((m) => m.telefono === e.telefono).map((m) => m.mensaje),
    }
    const herramientas = sim.registro.turnos
      .slice(turnosAntes)
      .flatMap((t) => t.herramientas.map((h) => `${h.nombre}(${JSON.stringify(h.args)})`))
    const tokens = sim.registro.turnos.slice(turnosAntes).reduce((s, t) => {
      const c = t.costo as { tokens_entrada?: number; tokens_salida?: number } | null
      return s + (c?.tokens_entrada ?? 0) + (c?.tokens_salida ?? 0)
    }, 0)
    pasos.push({ indice: indice + 1, enviado: describir(p), respuestas, fallos: verificar(p.debe, respuestas, decision, bd), herramientas, tokens })
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
