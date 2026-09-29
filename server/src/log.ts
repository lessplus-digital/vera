import { pino, type Logger } from 'pino'

export type { Logger }

export function crearLogger(nivel: string): Logger {
  return pino({
    level: nivel,
    // Nunca escribir secretos ni el cuerpo completo de Meta en los logs.
    redact: ['*.access_token', '*.authorization', 'headers.authorization'],
  })
}

/** Logger mudo para pruebas y simulador. */
export const loggerMudo: Logger = pino({ level: 'silent' })
