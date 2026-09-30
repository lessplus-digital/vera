import type { Repo } from '../bd/repo.js'
import type { LLM } from '../llm/llm.js'
import type { Handler } from '../decision/contexto.js'
import type { Redactor } from '../decision/conversador.js'
import { crearRedactorMenu } from './menu.js'
import { crearRedactorPedidos } from './pedidos.js'
import { crearRedactorSoporte } from './soporte.js'
import { crearRedactorReservas } from './reservas.js'

/** Los agentes reales (Fase 5). Los handlers que falten usan el redactor provisional. */
export function agentes(d: { repo: Repo; llm: LLM }): Partial<Record<Handler, Redactor>> {
  return { menu: crearRedactorMenu(d), pedidos: crearRedactorPedidos(d), soporte: crearRedactorSoporte(d), reservas: crearRedactorReservas(d) }
}
