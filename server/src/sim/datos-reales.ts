import { crearSupabase } from '../bd/supabase.js'
import { RepoSupabase } from '../bd/repo-supabase.js'
import type { RespuestaRPC } from '../bd/repo.js'
import type { FuenteMenu, PrecioResuelto } from './menu-memoria.js'
import type { RepoMemoria } from './repo-memoria.js'

// Los datos REALES del restaurante para el simulador (escenarios con `datos: real`):
// menú, cobertura de barrios, info del local y preguntas frecuentes. Todo es
// lectura —tablas o funciones STABLE: buscar_menu, precio_producto,
// cotizar_mitad_y_mitad, consultar_cobertura, consultar_faq—, así que el
// simulador no escribe nada en la BD: carrito, pedidos, clientes y reservas
// siguen en memoria. Sirve para los guiones que dependen del dato real (G1: la
// búsqueda de BUG-039/045; G3: los 59 barrios; G7: la info y la FAQ que edita
// el dueño), que el catálogo inventado no puede reproducir.
//
// Las reservas NO: su cupo cuenta reservas reales y el simulador crea las suyas
// en memoria; mezclarlas daría cupos que no cuadran.

export function menuReal(repo: RepoSupabase, sb: ReturnType<typeof crearSupabase>): FuenteMenu {
  return {
    buscar: (termino) => repo.buscarMenu(termino),
    async precio(productoId, tamano): Promise<PrecioResuelto> {
      const { data, error } = await sb.rpc('precio_producto', { p_producto_id: productoId, p_tamano: tamano ?? null })
      if (error) throw new Error(`precio_producto: ${error.message}`)
      const r = data as RespuestaRPC & { precio_unitario?: number; variante?: string; nombre?: string; masa?: string | null }
      if (!r.ok) return r
      return { ok: true, precio: Number(r.precio_unitario), variante: r.variante ?? null, nombre: r.nombre ?? productoId, masa: r.masa ?? null }
    },
    mitad: (a, b, tamano) => repo.cotizarMitad(a, b, tamano),
  }
}

/** Pone en el repo del simulador las lecturas reales. Devuelve false si faltan las credenciales. */
export function usarDatosReales(mem: RepoMemoria): boolean {
  const url = process.env.SUPABASE_URL
  const clave = process.env.SUPABASE_SECRET_KEY
  if (!url || !clave) return false
  const sb = crearSupabase(url, clave)
  const real = new RepoSupabase(sb)
  mem.menu = menuReal(real, sb)
  mem.consultarCobertura = (barrio) => real.consultarCobertura(barrio)
  mem.infoNegocio = (clave) => real.infoNegocio(clave)
  mem.infoNegocioTodo = () => real.infoNegocioTodo()
  mem.consultarFaq = (filtro) => real.consultarFaq(filtro)
  return true
}
