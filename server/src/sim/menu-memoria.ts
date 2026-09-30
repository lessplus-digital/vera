import type { ProductoMenu, ResultadoMenu, RespuestaRPC } from '../bd/repo.js'

// Menú y reglas de carrito del simulador. Imita lo que importa de buscar_menu,
// precio_producto, cotizar_mitad_y_mitad y carrito_agregar_* (cubiertas por
// qa/sql/11-carrito-bot.sql), con un catálogo pequeño pero con los casos
// difíciles: mismo nombre con dos masas, un agotado, una dulce y productos de
// precio único.

type ProductoSim = Omit<ProductoMenu, 'similitud'> & { disponible: boolean }

const tam = (porcion: number, pequena: number, mediana: number, grande: number, familiar: number) => ({
  porcion,
  pequena,
  mediana,
  grande,
  familiar,
})

export const MENU_SIM: ProductoSim[] = [
  { producto_id: 'PROD-010', nombre: 'Hawaiana', categoria: 'pizza_tradicional', variante: 'Tradicional', descripcion: 'Mozzarella, jamón, piña.', precio: 10500, tamanos: tam(10500, 23500, 37500, 50500, 58500), disponible: true },
  { producto_id: 'PROD-015', nombre: 'Hawaiana', categoria: 'pizza_tradicional', variante: 'Estofada', descripcion: 'Estofada (rellena): mozzarella, jamón, piña.', precio: 14000, tamanos: tam(14000, 35500, 51500, 65000, 76000), disponible: true },
  { producto_id: 'PROD-020', nombre: 'Pepperoni', categoria: 'pizza_tradicional', variante: 'Tradicional', descripcion: 'Mozzarella y pepperoni.', precio: 11000, tamanos: tam(11000, 25000, 39000, 52000, 60000), disponible: true },
  { producto_id: 'PROD-031', nombre: 'Premium Hawaiana', categoria: 'pizza_premium', variante: 'Tradicional', descripcion: 'Jamón, pollo o tocineta, piña.', precio: 14900, tamanos: tam(14900, 30000, 47000, 57000, 67000), disponible: true },
  { producto_id: 'PROD-060', nombre: 'Pizza M&M', categoria: 'pizza_dulce', variante: 'Tradicional', descripcion: 'Chocolate y M&M.', precio: 12000, tamanos: tam(12000, 26000, 40000, 53000, 61000), disponible: false },
  { producto_id: 'PROD-061', nombre: 'Cookies and Cream', categoria: 'pizza_dulce', variante: 'Tradicional', descripcion: 'Galleta y crema.', precio: 12000, tamanos: tam(12000, 26000, 40000, 53000, 61000), disponible: true },
  { producto_id: 'PROD-090', nombre: 'Coca Cola 400ml', categoria: 'bebidas', variante: null, descripcion: null, precio: 5000, tamanos: null, disponible: true },
  { producto_id: 'PROD-091', nombre: 'Sprite 400ml', categoria: 'bebidas', variante: null, descripcion: null, precio: 4800, tamanos: null, disponible: true },
]

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

const palabras = (s: string) => norm(s).split(/[^a-z0-9&]+/).filter((w) => w.length > 1)

/**
 * Parecido a buscar_menu (trigramas): no depende del orden de las palabras
 * ("hawaiana premium" encuentra "Premium Hawaiana") ni de tildes o mayúsculas.
 */
function similitudSim(termino: string, p: ProductoSim): number {
  const t = norm(termino)
  const nombre = norm(p.nombre)
  if (nombre === t) return 1
  const tw = palabras(termino)
  const nw = palabras(p.nombre)
  const cubreNombre = tw.length > 0 && nw.every((w) => tw.includes(w))
  if (cubreNombre && tw.every((w) => nw.includes(w))) return 0.95 // mismas palabras, otro orden
  if (cubreNombre) return 0.8 // el término nombra el producto completo (y algo más)
  const comunes = tw.filter((w) => nw.includes(w)).length
  if (comunes) return Math.min(0.7, 0.3 + 0.2 * comunes)
  if (tw.some((w) => norm(p.categoria).includes(w))) return 0.3
  return 0
}

export function buscarMenuSim(termino: string): ResultadoMenu {
  const r: ResultadoMenu = { disponibles: [], agotados: [] }
  for (const p of MENU_SIM) {
    const similitud = similitudSim(termino, p)
    if (!similitud) continue
    const { disponible, ...prod } = p
    ;(disponible ? r.disponibles : r.agotados).push({ ...prod, similitud })
  }
  for (const l of [r.disponibles, r.agotados]) l.sort((a, b) => b.similitud - a.similitud)
  return r
}

const ALIAS_TAMANO: Record<string, string> = { personal: 'pequena', pequeña: 'pequena', media: 'mediana' }
const normTamano = (t: string) => ALIAS_TAMANO[norm(t)] ?? norm(t)
const titulo = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace('pequena', 'pequeña')

/** precio_producto: el único lugar del simulador donde nace un precio. */
export function precioSim(productoId: string, tamano: string | null | undefined): RespuestaRPC & { precio?: number; variante?: string | null } {
  const p = MENU_SIM.find((x) => x.producto_id === productoId)
  if (!p) return { ok: false, error: 'PRODUCTO_NO_ENCONTRADO' }
  if (!p.disponible) return { ok: false, error: 'PRODUCTO_AGOTADO', nombre: p.nombre }
  if (!p.tamanos) return { ok: true, precio: p.precio, variante: null }
  if (!tamano) return { ok: false, error: 'TAMANO_REQUERIDO', nombre: p.nombre, message: `Falta el tamaño de ${p.nombre}.`, tamanos: p.tamanos }
  const k = normTamano(tamano)
  const precio = p.tamanos[k]
  if (precio == null) return { ok: false, error: 'TAMANO_NO_DISPONIBLE', tamanos: p.tamanos }
  return { ok: true, precio, variante: titulo(k) }
}

/** cotizar_mitad_y_mitad: se cobra la mitad MÁS CARA; misma masa; sin porción ni dulces. */
export function cotizarMitadSim(a: string, b: string, tamano: string): RespuestaRPC {
  const pa = MENU_SIM.find((x) => x.producto_id === a)
  const pb = MENU_SIM.find((x) => x.producto_id === b)
  if (!pa || !pb) return { ok: false, error: 'PRODUCTO_NO_ENCONTRADO' }
  if (a === b) return { ok: false, error: 'MITADES_IGUALES', message: 'Las dos mitades tienen que ser sabores distintos.' }
  if (!pa.disponible || !pb.disponible) return { ok: false, error: 'PRODUCTO_AGOTADO' }
  if ([pa, pb].some((p) => p.categoria === 'pizza_dulce')) return { ok: false, error: 'CATEGORIA_NO_PERMITIDA', message: 'Las pizzas dulces no se piden mitad y mitad.' }
  if (pa.variante !== pb.variante) return { ok: false, error: 'MASA_DISTINTA', message: 'Las dos mitades deben ser de la misma masa.' }
  const k = normTamano(tamano)
  if (k === 'porcion') return { ok: false, error: 'TAMANO_NO_PERMITIDO', message: 'Una porción no se parte.' }
  const precioA = pa.tamanos?.[k]
  const precioB = pb.tamanos?.[k]
  if (precioA == null || precioB == null) return { ok: false, error: 'TAMANO_NO_DISPONIBLE' }
  const cara = precioA >= precioB ? pa : pb
  return {
    ok: true,
    producto_id: cara.producto_id,
    nombre_producto: `Mitad ${pa.nombre} / Mitad ${pb.nombre}`,
    variante: titulo(k),
    precio_unitario: Math.max(precioA, precioB),
    mitades: [
      { producto_id: pa.producto_id, nombre: pa.nombre, variante: pa.variante, precio: precioA },
      { producto_id: pb.producto_id, nombre: pb.nombre, variante: pb.variante, precio: precioB },
    ],
  }
}

export const masaSim = (productoId: string) => MENU_SIM.find((x) => x.producto_id === productoId)?.variante ?? null
