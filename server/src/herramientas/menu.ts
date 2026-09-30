import { z } from 'zod'
import type { ProductoMenu, Repo, RespuestaRPC } from '../bd/repo.js'
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
}

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

export function herramientasMenu(d: { repo: Repo; turno: Turno; rastro: RastroMenu }): Herramienta[] {
  const tel = d.turno.telefono
  const anotar = <T>(nombre: string, args: unknown, fn: () => Promise<T>) => d.turno.herramienta(nombre, args, fn)
  const montosDe = (r: Record<string, unknown>) => {
    for (const k of ['precio_unitario', 'precio', 'total', 'subtotal']) if (typeof r[k] === 'number') d.rastro.montos.push(r[k] as number)
  }
  const siCambio = (r: RespuestaRPC) => {
    if (r.ok === true) d.rastro.cambioCarrito = true
    return r
  }

  return [
    {
      nombre: 'consultar_menu',
      descripcion:
        'Busca en el menú de Vera Pizzería (tolera errores de escritura). Devuelve `disponibles` (lo único que se puede ofrecer y agregar) y `agotados` (SÍ están en la carta pero hoy se acabaron: nunca los ofrezcas ni los agregues, pero tampoco digas que no los manejamos). Busca con el nombre del producto o una categoría ("pizza", "bebidas"), en singular.',
      esquema: z.object({ termino: z.string().min(1) }),
      ejecutar: ({ termino }: { termino: string }) =>
        anotar('consultar_menu', { termino }, async () => {
          const r = await d.repo.buscarMenu(termino)
          for (const p of r.disponibles) d.rastro.montos.push(p.precio, ...Object.values(p.tamanos ?? {}))
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
