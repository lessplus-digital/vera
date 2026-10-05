import { z } from 'zod'
import type { ProductoMenu, Repo, RespuestaRPC, ResultadoMenu } from '../bd/repo.js'
import type { Herramienta } from '../llm/llm.js'
import type { Turno } from '../log/turnos.js'

// Herramientas del agente de Menú. El LLM elige QUÉ producto y cuántos; el
// precio lo pone la BD dentro de la RPC (carrito_agregar_*). No hay forma de
// que el modelo escriba un precio en el carrito: ningún argumento lo lleva.

export type RastroMenu = {
  /** Montos que devolvieron las herramientas: el texto solo puede citar estos. */
  montos: number[]
  /** true si alguna herramienta cambió el carrito con éxito. */
  cambioCarrito: boolean
  /** Nombres y descripciones que devolvió el menú: los únicos productos que el texto puede nombrar. */
  productos: string[]
  /**
   * producto_id que el modelo puede usar: los que devolvió consultar_menu en este
   * turno y los que ya están en el carrito. Cualquier otro es adivinado (visto el
   * 2026-10-02: PROD-011 inventado para "premium hawaiana") y se rechaza sin tocar la BD.
   */
  ids: string[]
  /** Masa de cada producto_id conocido (Tradicional / Estofada; null si no es pizza). */
  masas: Record<string, string | null>
}

const sinTilde = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Las masas que el cliente nombró en su mensaje. */
export function masasNombradas(texto: string): Set<'tradicional' | 'estofada'> {
  const t = sinTilde(texto)
  const r = new Set<'tradicional' | 'estofada'>()
  if (/\btradicional(es)?\b/.test(t)) r.add('tradicional')
  if (/\bestofad[oa]s?\b|\brellen[oa]s?\b/.test(t)) r.add('estofada')
  return r
}

/** Error que ve el modelo cuando usa un producto_id que no salió de consultar_menu. */
export const SIN_CONSULTAR = 'PRODUCTO_SIN_CONSULTAR'

const Cantidad = z.number().int().min(1).max(50)
const Notas = z.string().nullable().describe('Instrucción del cliente para ese producto ("sin cebolla"), o null')
const Tamano = z.string().describe('pequena, mediana, grande o familiar (porcion solo para pizzas enteras por porción)')

/** El producto como lo ve el modelo: sin campos que no necesita, con la masa explícita. */
function paraModelo(p: ProductoMenu) {
  return {
    producto_id: p.producto_id,
    nombre: p.nombre,
    masa: p.variante,
    categoria: p.categoria,
    descripcion: p.descripcion,
    ...(p.tamanos ? { precios_por_tamano: p.tamanos } : { precio: p.precio }),
    similitud: p.similitud,
  }
}

/**
 * Con una coincidencia casi exacta, lo que quedó por debajo de 0.5 es ruido del
 * trigrama ("pan de ajo" traía 9 pastas y bruschettas en 0.49): cada producto de
 * más se reenvía al modelo en cada vuelta y lo invita a ofrecer lo que no se pidió.
 * Sin una coincidencia clara se devuelve todo, para que el modelo pregunte.
 */
export function recortarRuido(r: ResultadoMenu): ResultadoMenu {
  const mejor = Math.max(0, ...[...r.disponibles, ...r.agotados].map((p) => p.similitud))
  if (mejor < 0.9) return r
  const util = (p: ProductoMenu) => p.similitud >= 0.5
  return { disponibles: r.disponibles.filter(util), agotados: r.agotados.filter(util) }
}

export function herramientasMenu(d: { repo: Repo; turno: Turno; rastro: RastroMenu; texto?: string }): Herramienta[] {
  const tel = d.turno.telefono
  const anotar = <T>(nombre: string, args: unknown, fn: () => Promise<T>) => d.turno.herramienta(nombre, args, fn)
  const montosDe = (r: Record<string, unknown>) => {
    for (const k of ['precio_unitario', 'precio', 'total', 'subtotal']) if (typeof r[k] === 'number') d.rastro.montos.push(r[k] as number)
  }
  const siCambio = (r: RespuestaRPC) => {
    if (r.ok === true) d.rastro.cambioCarrito = true
    return r
  }
  /**
   * El cliente nombró la masa: no se le cambia por otra (2026-10-02: a "mitad hawaiana
   * tradicional y mitad pepperoni estofada" el modelo agregó las dos en tradicional). Si
   * en una mitad y mitad nombró las dos masas, es MASA_DISTINTA (no se puede).
   */
  const pedidas = masasNombradas(d.texto ?? '')
  const masaNoPedida = (mitad: boolean, ...ids: string[]): RespuestaRPC | null => {
    if (mitad && pedidas.size === 2) {
      return { ok: false, error: 'MASA_DISTINTA', message: 'El cliente pidió una mitad en masa tradicional y otra en estofada: las dos mitades tienen que ser de la misma masa. Pregúntale cuál prefiere.' }
    }
    if (pedidas.size !== 1) return null
    const [pedida] = [...pedidas]
    const otra = ids.find((id) => {
      const m = d.rastro.masas[id]
      return m != null && sinTilde(m) !== pedida
    })
    if (!otra) return null
    return {
      ok: false,
      error: 'MASA_NO_PEDIDA',
      message: `El cliente pidió masa ${pedida} y ${otra} es ${d.rastro.masas[otra]}. Usa el producto de masa ${pedida} que devolvió consultar_menu.`,
    }
  }
  /** null si todos los ids salieron de consultar_menu o del carrito; si no, el error para el modelo. */
  /**
   * Las dos mitades con el mismo producto_id (2026-10-05: el modelo buscó "Hawaiana Tradicional" y
   * "Premium Hawaiana" y pasó PROD-010 en las dos; la RPC rechazó, pero el bot se lo explicó al
   * cliente en vez de corregir). El rechazo le dice qué hacer, no solo qué pasó.
   */
  const mitadesIguales = (a: string, b: string): RespuestaRPC | null =>
    a !== b
      ? null
      : {
          ok: false,
          error: 'MITADES_IGUALES',
          message: `producto_a y producto_b son el mismo (${a}). Es un error tuyo, no del cliente: busca con consultar_menu cada sabor por separado (solo el nombre, p. ej. "Premium Hawaiana") y usa el producto_id propio de cada uno. Solo si el cliente de verdad pidió el mismo sabor en las dos mitades, explícaselo.`,
        }
  const sinConsultar = (...ids: string[]): RespuestaRPC | null => {
    const faltan = ids.filter((id) => !d.rastro.ids.includes(id))
    if (!faltan.length) return null
    return {
      ok: false,
      error: SIN_CONSULTAR,
      message: `${faltan.join(' y ')} no salió de consultar_menu en este turno. Busca con consultar_menu el producto que nombró el cliente y usa el producto_id que devuelva; nunca lo adivines.`,
    }
  }

  return [
    {
      nombre: 'consultar_menu',
      descripcion:
        'Busca en el menú de Vera Pizzería (tolera errores de escritura). Devuelve `disponibles` (lo único que se puede ofrecer y agregar) y `agotados` (SÍ están en la carta pero hoy se acabaron: nunca los ofrezcas ni los agregues, pero tampoco digas que no los manejamos). Busca con el nombre del producto o una categoría ("pizza", "bebidas"), en singular.',
      esquema: z.object({ termino: z.string().min(1) }),
      ejecutar: ({ termino }: { termino: string }) =>
        anotar('consultar_menu', { termino }, async () => {
          const r = recortarRuido(await d.repo.buscarMenu(termino))
          for (const p of r.disponibles) d.rastro.montos.push(p.precio, ...Object.values(p.tamanos ?? {}))
          for (const p of [...r.disponibles, ...r.agotados]) d.rastro.productos.push(p.nombre, p.descripcion ?? '')
          d.rastro.ids.push(...r.disponibles.map((p) => p.producto_id))
          for (const p of r.disponibles) d.rastro.masas[p.producto_id] = p.variante
          return {
            disponibles: r.disponibles.map(paraModelo),
            // Sin precio: un agotado no se cotiza.
            agotados: r.agotados.map((p) => ({ nombre: p.nombre, masa: p.variante, categoria: p.categoria })),
            nota: !r.disponibles.length && !r.agotados.length ? 'No existe en la carta. Ofrece el link del menú.' : undefined,
          }
        }),
    },
    {
      nombre: 'agregar_al_carrito',
      descripcion:
        'Agrega un producto al carrito cuando el cliente lo PIDE ("dame", "quiero", o contesta el tamaño que le preguntaste). El precio lo pone el sistema. producto_id tiene que venir de consultar_menu. Si es pizza y no sabes el tamaño, pregúntalo antes. Errores: TAMANO_REQUERIDO, TAMANO_NO_DISPONIBLE, PRODUCTO_AGOTADO, PRODUCTO_NO_ENCONTRADO.',
      esquema: z.object({ producto_id: z.string(), tamano: Tamano.nullable(), cantidad: Cantidad, notas: Notas }),
      ejecutar: (a: { producto_id: string; tamano: string | null; cantidad: number; notas: string | null }) =>
        anotar('carrito_agregar_item', a, async () => {
          const rechazo = sinConsultar(a.producto_id) ?? masaNoPedida(false, a.producto_id)
          if (rechazo) return rechazo
          const r = siCambio(await d.repo.carritoAgregarItem(tel, a))
          montosDe((r.agregado as Record<string, unknown>) ?? {})
          return { ok: r.ok, error: r.error, message: r.message, agregado: r.agregado, tamanos: r.tamanos }
        }),
    },
    {
      nombre: 'agregar_mitad_y_mitad',
      descripcion:
        'Agrega UNA pizza mitad y mitad (dos sabores). Se cobra la mitad más cara; lo calcula el sistema. Los dos producto_id deben venir de consultar_menu y ser de la MISMA masa. No se permite en porción, ni con pizzas dulces, ni con sabores iguales. Errores: MASA_DISTINTA, TAMANO_NO_PERMITIDO, CATEGORIA_NO_PERMITIDA, PRODUCTO_AGOTADO, MITADES_IGUALES (lee `message` y explícalo con tus palabras).',
      esquema: z.object({ producto_a: z.string(), producto_b: z.string(), tamano: Tamano, cantidad: Cantidad, notas: Notas }),
      ejecutar: (a: { producto_a: string; producto_b: string; tamano: string; cantidad: number; notas: string | null }) =>
        anotar('carrito_agregar_mitad', a, async () => {
          const rechazo = mitadesIguales(a.producto_a, a.producto_b) ?? sinConsultar(a.producto_a, a.producto_b) ?? masaNoPedida(true, a.producto_a, a.producto_b)
          if (rechazo) return rechazo
          const r = siCambio(await d.repo.carritoAgregarMitad(tel, a))
          montosDe((r.agregado as Record<string, unknown>) ?? {})
          return { ok: r.ok, error: r.error, message: r.message, agregado: r.agregado, explicacion: r.explicacion }
        }),
    },
    {
      nombre: 'cotizar_mitad_y_mitad',
      descripcion: 'Dice cuánto cuesta una mitad y mitad SIN agregarla (cuando el cliente solo pregunta). Mismas reglas y errores que agregar_mitad_y_mitad.',
      esquema: z.object({ producto_a: z.string(), producto_b: z.string(), tamano: Tamano }),
      ejecutar: (a: { producto_a: string; producto_b: string; tamano: string }) =>
        anotar('cotizar_mitad_y_mitad', a, async () => {
          const rechazo = mitadesIguales(a.producto_a, a.producto_b) ?? sinConsultar(a.producto_a, a.producto_b) ?? masaNoPedida(true, a.producto_a, a.producto_b)
          if (rechazo) return rechazo
          const r = await d.repo.cotizarMitad(a.producto_a, a.producto_b, a.tamano)
          montosDe(r)
          return r
        }),
    },
    {
      nombre: 'quitar_del_carrito',
      descripcion:
        'Quita una línea del carrito (el número de línea está en el carrito actual del contexto). cantidad = cuántas unidades quitar; null = la línea entera. Para cambiar un producto por otro: quitar y luego agregar.',
      esquema: z.object({ linea: z.number().int().min(1), cantidad: z.number().int().min(1).nullable() }),
      ejecutar: (a: { linea: number; cantidad: number | null }) =>
        anotar('carrito_quitar_item', a, async () => siCambio(await d.repo.carritoQuitarItem(tel, a.linea, a.cantidad))),
    },
  ]
}
