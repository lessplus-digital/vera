// PostToolUse (Write|Edit) — higiene del fichero recién escrito.
//
// 1. Si es .json y quedó inválido → BLOQUEA. Un settings.json roto deshabilita
//    en silencio TODA la configuración de ese fichero; mejor enterarse aquí.
// 2. Quita espacios en blanco al final de línea y asegura salto final.
//    · Respeta CRLF: el repo tiene ficheros con CRLF y convertirlos a LF
//      produciría un diff de fichero entero por un cambio de una línea.
//    · NO toca .md: `docs/architecture.md` usa el doble espacio final de
//      Markdown como salto de línea duro, y quitarlo cambia el render.
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'

const LIMPIABLES = /\.(js|jsx|ts|tsx|css|less|sql|mjs|cjs|json|sh)$/i

let entrada = ''
process.stdin.on('data', (c) => (entrada += c))
process.stdin.on('end', () => {
  let ruta = ''
  try {
    const ev = JSON.parse(entrada)
    ruta = ev?.tool_response?.filePath || ev?.tool_input?.file_path || ''
  } catch {
    process.exit(0) // stdin raro: no es asunto nuestro
  }
  if (!ruta || !existsSync(ruta) || !statSync(ruta).isFile()) process.exit(0)

  if (/\.json$/i.test(ruta)) {
    try {
      JSON.parse(readFileSync(ruta, 'utf8'))
    } catch (e) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `JSON inválido en ${ruta}: ${e.message}. Corrígelo antes de seguir — un settings.json roto desactiva en silencio todo ese fichero.`,
      }))
      process.exit(0)
    }
  }

  if (!LIMPIABLES.test(ruta)) process.exit(0)

  const original = readFileSync(ruta, 'utf8')
  const crlf = original.includes('\r\n')
  const eol = crlf ? '\r\n' : '\n'
  let limpio = original
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join(eol)
  if (limpio.length && !limpio.endsWith(eol)) limpio += eol
  if (limpio !== original) writeFileSync(ruta, limpio)
  process.exit(0)
})
