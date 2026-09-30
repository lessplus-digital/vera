// Chat por terminal con el bot, sin WhatsApp: escribes como cliente y ves lo que
// el bot contestaría. Usa el mismo código que producción (EntornoSim).
//
//   npm run chat                     → teléfono de prueba por defecto
//   npm run chat -- 573113298122     → otro teléfono
//
// Comandos: /imagen · /audio · /boton <texto> · /salir

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { EntornoSim } from '../src/sim/entorno.js'
import { llmDelEntorno } from '../src/llm/openai.js'

const telefono = process.argv[2] ?? '573000000999'
const llm = llmDelEntorno()
const sim = new EntornoSim({ bufferMs: 300, ...(llm ? { llm } : {}) })
console.log(llm ? 'Bot con decisión (clasificador + política + guardia) sobre BD en memoria.' : 'Sin OPENAI_API_KEY: bot en modo eco.')
const rl = createInterface({ input: stdin, output: stdout })

console.log(`Chat con el bot como ${telefono}. /imagen · /audio · /boton <texto> · /salir\n`)

for (;;) {
  const linea = (await rl.question('tú  › ')).trim()
  if (!linea) continue
  if (linea === '/salir') break

  const antes = sim.wa.textosPara(telefono).length
  if (linea === '/imagen') await sim.enviarImagen(telefono, 'img-chat')
  else if (linea === '/audio') await sim.enviarTipo(telefono, 'audio')
  else if (linea.startsWith('/boton ')) await sim.enviarBoton(telefono, linea.slice(7))
  else await sim.enviarTexto(telefono, linea)

  await sim.esperar()
  for (const r of sim.wa.textosPara(telefono).slice(antes)) console.log(`bot › ${r}\n`)
}

rl.close()
