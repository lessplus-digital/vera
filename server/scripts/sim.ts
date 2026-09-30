// Simulador de WhatsApp: corre los escenarios de test/escenarios/*.yaml contra
// el bot en memoria y reporta SOLO lo que falla.
//
//   npm run sim                  → todos, 5 corridas cada uno
//   npm run sim -- eco           → los que contengan "eco" en el nombre del archivo
//   npm run sim -- --veces 1     → una corrida (rápido, para iterar)
//   npm run sim -- --json        → salida JSON (para el subagente bot-sim)

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarEscenario, correrEscenario, veredicto, type Veredicto } from '../src/sim/escenario.js'
import { llmDelEntorno } from '../src/llm/openai.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'escenarios')

const args = process.argv.slice(2)
const json = args.includes('--json')
const iVeces = args.indexOf('--veces')
const veces = iVeces >= 0 ? Number(args[iVeces + 1]) : 5
const filtros = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--veces')

if (!Number.isInteger(veces) || veces < 1) {
  console.error('--veces debe ser un entero ≥ 1')
  process.exit(2)
}

const archivos = readdirSync(dir)
  .filter((f) => f.endsWith('.yaml'))
  .filter((f) => filtros.length === 0 || filtros.some((x) => f.includes(x)))
  .sort()

if (archivos.length === 0) {
  console.error(`No hay escenarios que coincidan con: ${filtros.join(', ') || '(todos)'}`)
  process.exit(2)
}

const llm = llmDelEntorno()
const veredictos: (Veredicto & { archivo: string })[] = []
for (const archivo of archivos) {
  const escenario = cargarEscenario(join(dir, archivo))
  if (escenario.bot === 'decision' && !llm) {
    console.error(`⏭  ${archivo}: saltado (usa el LLM y falta OPENAI_API_KEY en server/.env)`)
    continue
  }
  const corridas = []
  for (let i = 0; i < veces; i++) corridas.push(await correrEscenario(escenario, llm ? { llm } : {}))
  veredictos.push({ archivo, ...veredicto(escenario, corridas) })
}

const fallidos = veredictos.filter((v) => !v.ok)

if (json) {
  console.log(
    JSON.stringify(
      {
        total: veredictos.length,
        fallidos: fallidos.length,
        escenarios: veredictos.map((v) => ({
          archivo: v.archivo,
          critico: v.escenario.critico,
          aprobadas: v.aprobadas,
          corridas: v.corridas.length,
          ok: v.ok,
          // Solo el detalle de las corridas que fallaron.
          fallos: v.corridas.flatMap((c, n) =>
            c.pasos.filter((p) => p.fallos.length).map((p) => ({ corrida: n + 1, ...p })),
          ),
        })),
      },
      null,
      2,
    ),
  )
} else {
  for (const v of veredictos) {
    const marca = v.ok ? '✅' : '❌'
    const tipo = v.escenario.critico ? ' [crítico]' : ''
    console.log(`${marca} ${v.archivo.padEnd(34)} ${v.aprobadas}/${v.corridas.length}${tipo}  ${v.escenario.nombre}`)
    if (!v.ok) {
      v.corridas.forEach((c, n) => {
        for (const p of c.pasos.filter((p) => p.fallos.length)) {
          console.log(`     corrida ${n + 1} · paso ${p.indice} · envió: ${p.enviado}`)
          for (const f of p.fallos) console.log(`       ✗ ${f}`)
          for (const r of p.respuestas) console.log(`       bot: ${r.replace(/\n/g, ' ⏎ ')}`)
        }
      })
    }
  }
  console.log(`\n${veredictos.length - fallidos.length}/${veredictos.length} escenarios en verde`)
}

process.exit(fallidos.length ? 1 : 0)
