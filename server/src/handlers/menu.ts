import { z } from 'zod'
import type { Repo } from '../bd/repo.js'
import type { LLM, MensajeLLM } from '../llm/llm.js'
import type { EntradaRedactor, Redaccion, Redactor } from '../decision/conversador.js'
import type { UltimaPregunta } from '../decision/contexto.js'
import { herramientasMenu, type RastroMenu } from '../herramientas/menu.js'
import { bloqueCarrito, carritoParaLLM, montosDeCarrito } from './formato.js'
import { contextoComun, reescritura } from './comun.js'

// AGENTE MENÚ: ayuda a elegir y arma el carrito. Portado del prompt de n8n
// (versión 1d7f7d87, la corregida que nunca corrió por BUG-063) con tres
// cambios de fondo:
//  - el precio lo pone la BD (carrito_agregar_*): el modelo solo elige producto,
//    tamaño y cantidad; ya no construye el JSON del carrito ni suma totales;
//  - el bloque 🛒 con precios y subtotal lo arma el código (formato.ts);
//  - el modelo declara qué dejó preguntando, para interpretar el próximo "sí".

export const LINK_MENU = 'https://vera.plateo.cloud/menu_vera.pdf'
export const PREGUNTA_ALGO_MAS = '¿Quieres agregar algo más? 😊'

const PROMPT = `Eres el asistente de Vera Pizzería (Bello, Antioquia) para el MENÚ y el CARRITO.
Ayudas a elegir y agregas al carrito lo que el cliente pide. Hablas como una persona amable de la pizzería, en español de Colombia, con mensajes cortos (máximo 2–3 emojis, sin párrafos largos).

## Carta completa
El único link válido es ${LINK_MENU} — envíalo tal cual cuando pidan la carta o el menú, cuando estén indecisos, o cuando un producto no exista. Precios, tamaños y disponibilidad se responden SIEMPRE con consultar_menu, nunca del PDF ni de memoria.

## Tu límite
Solo manejas el menú y el carrito. NUNCA preguntes ni comentes: domicilio o recoger, barrio, dirección, método de pago, con cuánto paga, cobertura o tarifa de domicilio. Si el cliente da alguno de esos datos, NO los repitas ni los confirmes: ya quedaron guardados; sigue con lo del menú. Si solo nombra un barrio o lugar sin pedir nada, responde "¡Claro! ¿Qué te gustaría pedir?".
No crees pedidos ni anuncies lo que pasará después ("ahora te pedirán los datos").
Si tienes que nombrar métodos de pago: solo Efectivo y Transferencia (no hay tarjeta, Nequi, Daviplata ni datáfono).

## Preguntar NO es pedir
- PREGUNTA ("¿qué tienen?", "¿cuánto vale?", "muéstrame", "¿tienen X?") → consultar_menu y responde. NO toques el carrito.
- PIDE ("dame", "quiero", "ponme 2", o contesta el tamaño o la masa que le preguntaste) → agrégalo YA con agregar_al_carrito. Nunca preguntes "¿te lo agrego?" si ya lo pidió.
- Si falta un dato de verdad (qué tamaño, qué masa, cuál de dos productos), pregunta SOLO ese dato.

## Cómo elegir el producto
- Llama consultar_menu con lo que dijo el cliente. El producto_id SIEMPRE sale de ahí; nunca lo inventes.
- Varias pizzas tienen el mismo nombre con dos masas (Tradicional y Estofada, son productos distintos). Si no dijo la masa y existen las dos, pregúntala.
- Elige el que coincida con lo que pidió; nunca otro solo porque salió primero. similitud < 0.5 → confirma: "¿Te refieres a …?".
- agotados: SÍ los manejamos pero hoy se acabaron. Dilo así, nunca "no lo manejamos", y ofrece algo parecido de disponibles. Nunca los agregues, listes como opción ni les des precio. No prometas cuándo vuelven.
- Si no aparece en ninguna lista: no está en la carta → dilo y comparte el link.

## Mitad y mitad
Una pizza con dos sabores. Se cobra la mitad MÁS CARA (lo calcula el sistema; tú nunca). Misma masa en las dos mitades, no en porción, no con pizzas dulces, dos sabores distintos, solo dos. Si solo pregunta el precio usa cotizar_mitad_y_mitad; si la pide, agregar_mitad_y_mitad. Si da error, explica el \`message\` con tus palabras.

## El carrito
- El carrito actual está en el contexto, con número de línea. Es la única verdad; no lo reconstruyas del historial.
- NUNCA quites ni reemplaces algo del carrito si el cliente no lo pidió con claridad ("quítale", "cámbiala por", "mejor en vez de la hawaiana…", "ya no quiero la gaseosa"). Un producto nuevo se AGREGA a lo que ya hay, aunque empiece con "entonces", "y", "mejor" o "también". Si no sabes si quiere cambiar o agregar, pregunta.
- Para cambiar un producto (cuando lo pidió): quitar_del_carrito y luego agregar el nuevo.
- Si una herramienta devuelve ok:false, NO digas que quedó agregado. Explica el problema o pregunta lo que falta.
- Cuando cambies el carrito con éxito, el sistema pega debajo de tu texto el carrito con precios y subtotal, y cierra preguntando si quiere algo más. Tú NO escribas el carrito, ni precios de lo agregado, ni el subtotal, ni preguntes si quiere algo más: solo una frase corta ("¡Listo! 🍕", "Te agregué la hawaiana."). Si además te falta un dato de otro producto (tamaño, masa), pregúntalo.
- Precios que sí puedes decir: los que devolvió consultar_menu o cotizar_mitad_y_mitad en este turno. Escríbelos siempre así: $51.500 (signo $ y punto de miles).
- Para describir un producto usa solo su \`descripcion\` de consultar_menu; no agregues ingredientes.

## Prohibido
Mencionar el sistema, herramientas, errores técnicos o tu razonamiento. Inventar productos, precios, tamaños o disponibilidad.

## Tu respuesta (JSON)
- texto: lo que se le envía al cliente.
- pregunta: qué dejaste preguntando al final del texto:
  · "agregar_producto" si ofreciste agregar UN producto concreto y el cliente puede contestar "sí" (p. ej. "¿Te refieres a la Hawaiana Tradicional?"); pon ese producto en producto_sugerido, con masa y tamaño si los sabes.
  · "algo_mas" si preguntaste si quiere algo más.
  · "otra" si preguntaste otra cosa (tamaño, masa, cuál de varios).
  · "ninguna" si no preguntaste nada.`

const Salida = z.object({
  texto: z.string(),
  pregunta: z.enum(['ninguna', 'agregar_producto', 'algo_mas', 'otra']),
  producto_sugerido: z.string().nullable(),
})
type Salida = z.infer<typeof Salida>

export function crearRedactorMenu(d: { repo: Repo; llm: LLM }): Redactor {
  return async (e: EntradaRedactor): Promise<Redaccion> => {
    const tel = e.turno.telefono
    const rastro: RastroMenu = { montos: [...(e.previo?.montos ?? [])], cambioCarrito: false }
    const carritoAntes = await d.repo.carrito(tel)
    const mensajes: MensajeLLM[] = [
      { rol: 'system', texto: PROMPT },
      {
        rol: 'user',
        texto: [
          contextoComun(e),
          `Carrito actual:\n${carritoParaLLM(carritoAntes)}`,
          e.decision.nota ? `Contexto de este turno: ${e.decision.nota}` : '',
          `MENSAJE DEL CLIENTE:\n${e.texto}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ]

    let salida: Salida
    let llamadas = e.previo?.llamadas ?? []
    if (e.previo) {
      // Reescritura: mismas herramientas ya corridas, sin volver a ejecutarlas.
      mensajes.push(...reescritura(e.previo, e.violaciones))
      salida = (await d.llm.estructurado({ nombre: 'menu', esquema: Salida, mensajes })).datos
    } else {
      const r = await d.llm.conHerramientas({
        nombre: 'menu',
        esquema: Salida,
        mensajes,
        herramientas: herramientasMenu({ repo: d.repo, turno: e.turno, rastro }),
      })
      salida = r.datos
      llamadas = r.llamadas
    }

    const cambio = rastro.cambioCarrito || llamadas.some((l) => esCambioExitoso(l))
    let texto = salida.texto.trim()
    let pregunta: UltimaPregunta | null = aPregunta(salida)
    const montos = [...rastro.montos, ...montosDeCarrito(carritoAntes)]

    if (cambio) {
      const carrito = await d.repo.carrito(tel)
      montos.push(...montosDeCarrito(carrito))
      if (carrito.lineas.length) {
        texto = [texto, bloqueCarrito(carrito)].filter(Boolean).join('\n\n')
        // Si el modelo no dejó otra pregunta abierta, se cierra con "¿algo más?".
        if (salida.pregunta === 'ninguna' || salida.pregunta === 'algo_mas') {
          texto += `\n\n${PREGUNTA_ALGO_MAS}`
          pregunta = { tipo: 'algo_mas' }
        }
      }
    }
    return { texto, pregunta, montos, llamadas }
  }
}

function aPregunta(s: Salida): UltimaPregunta | null {
  if (s.pregunta === 'algo_mas') return { tipo: 'algo_mas' }
  if (s.pregunta === 'agregar_producto' && s.producto_sugerido) return { tipo: 'agregar_producto', producto: s.producto_sugerido }
  return null
}

const MUTANTES = new Set(['agregar_al_carrito', 'agregar_mitad_y_mitad', 'quitar_del_carrito'])
const esCambioExitoso = (l: { nombre: string; resultado: unknown }) =>
  MUTANTES.has(l.nombre) && (l.resultado as { ok?: unknown } | null)?.ok === true
