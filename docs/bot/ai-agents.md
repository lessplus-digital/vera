# Agentes IA — Arquitectura, tools y reglas

> Referencia estructurada del subsistema de agentes. Los **system prompts completos
> (verbatim)** viven en [`agent-prompts.md`](agent-prompts.md).
> Continúa la RUTA DE TEXTO del [workflow principal](n8n-workflow.md#fase-5-orquestador--agentes),
> cuando `cliente.modo == 'bot'`.

## Modelo y memoria (todos los agentes)

- **LLM:** `gpt-5.1` (nodo OpenAI Chat Model, credencial `OpenAi account`).
- **Memoria:** Postgres Chat Memory — `sessionKey = {{ $json.telefono }}`,
  `contextWindowLength = 10`. Cada agente tiene su propia instancia, pero comparten
  la misma tabla de historial por teléfono.

## Arquitectura

```
(desde el Router de modo, modo == 'bot')
  │
  └─ ORQUESTADOR (AI Agent) — clasifica intención, produce SOLO JSON { agente, razon }
       │
       └─ Parse Orquestador (Code) — limpia/parsea el JSON; si falla → 'soporte' (fallback seguro)
            │                          reinyecta contexto desde el nodo 'Edit Fields'
            │
            └─ Decision Orquestador (Switch por {{ $json.agente }}) — 4 salidas
                 ├─ 0: menu     → AGENTE MENÚ
                 ├─ 1: pedidos  → AGENTE PEDIDOS
                 ├─ 2: soporte  → AGENTE SOPORTE
                 └─ 3: reservas → AGENTE RESERVAS
                          │
   (los 4 agentes) ───────┴──────→ Code in JavaScript2 → Send message (WhatsApp)
                                     { output, telefono }
```

> **Un solo** nodo post-agente (`Code in JavaScript2`) recoge la salida de los 4 agentes
> y arma `{ output, telefono }` para el envío. (Versiones viejas tenían un Code por agente.)

---

## 1. ORQUESTADOR

**Rol:** clasifica la intención y decide el agente. **No** responde al cliente ni usa tools;
solo emite `{ "agente": "menu|pedidos|soporte|reservas", "razon": "..." }`.

| Intención | Agente |
|---|---|
| Menú, precios, productos, disponibilidad, armar/editar carrito (antes de confirmar) | **menu** |
| Confirma el pedido o responde al flujo de pedido (tipo, pago, dirección) | **pedidos** |
| Saludos, estado de pedido, info del local, quejas, hablar con humano, actualizar datos | **soporte** |
| Reservar mesa, disponibilidad, cancelar/consultar reserva | **reservas** |

Reglas clave: ante duda menu↔pedidos → **menu**; nunca clasifica **pedidos** sin evidencia
de carrito/flujo activo en el historial; respuestas de una palabra → mirar historial.
Prompt completo: [`agent-prompts.md#orquestador`](agent-prompts.md#orquestador).

---

## 2. AGENTE MENÚ

**Rol:** consultar menú y gestionar el **carrito** (tabla `carritos`, PK = telefono).

**Link del menú (PDF):** el prompt lleva hardcodeado `https://vera.plateo.cloud/menu_vera.pdf`
— el PDF oficial vive en `public/menu_vera.pdf` de este repo y se sirve desde el dominio del
dashboard. Hasta el 2026-07-28 el prompt decía `www.google.com` (placeholder nunca reemplazado).
El mismo valor está en `info_negocio.link_menu`, que el Agente Soporte lee vía `info_local`.
**Si el dominio cambia hay que actualizar los dos sitios** (prompt en n8n + fila en la BD).

**Secuencia obligatoria** al pedir algo: `leer_carrito` → `consultar_menu` → construir items
(existentes + nuevos) → `crear_carrito` (nuevo) o `actualizar_carrito` (existente) → responder.
Nunca crea carrito vacío ni antes de `consultar_menu`; nunca pide confirmación para agregar.

**No anuncia lo que la tool no confirmó (2026-08-21, BUG-032):** el prompt le prohíbe mostrar el
🛒 o cantar el total si `crear_carrito`/`actualizar_carrito` no devolvió el carrito guardado —
reintenta una vez y, si falla, avisa que no pudo guardar. Es la misma regla que ya tenía el Agente
Pedidos para `crear_orden_completa`, y existe porque el fallo silencioso de `crear_carrito` era
indistinguible de un éxito para el cliente.

**Agotado ≠ inexistente (2026-07-28):** `consultar_menu` devuelve `productos_por_categoria`
(disponibles, lo único ofrecible/agregable) y `agotados` (existen en la carta, hoy no hay). El
prompt prohíbe listar u agregar un agotado, y prohíbe igual de fuerte decir "no lo manejamos"
sobre él: la respuesta correcta es "sí lo tenemos, hoy se agotó" + alternativa de la misma
categoría. Solo `encontrados = 0` **con** `agotados` vacío significa que no está en la carta.

| Tool | Tipo | Detalle |
|---|---|---|
| `leer_carrito` | Supabase (get) | `carritos` WHERE `telefono` |
| `consultar_menu` | Subworkflow | `Sub — Consultar_menu` · input `filtro`; RPC `buscar_menu` (fuzzy por nombre/categoría/descripción, devuelve `similitud` — BUG-006, 2026-07-22). Devuelve `productos_por_categoria` (**solo disponibles**) + `agotados` aparte (2026-07-28). Detalle: [subworkflows.md](subworkflows.md#sub--consultar_menu) |
| `crear_carrito` | HTTP POST (**upsert**) | `/carritos` body `{telefono, items, total}` (credencial n8n desde BUG-003). Header **`Prefer: resolution=merge-duplicates,return=representation`** — `carritos` tiene PK `telefono`, así que un POST plano chocaba contra el carrito abandonado del cliente y fallaba en silencio (BUG-032, 2026-08-21). `merge-duplicates` lo vuelve idempotente; `return=representation` es lo que le permite al agente confirmar que se guardó |
| `actualizar_carrito` | HTTP PATCH | `/carritos?telefono=eq.{fromAI}` body `{items, total}` (credencial n8n) |
| `armar_mitad_y_mitad` | HTTP POST | `/rpc/cotizar_mitad_y_mitad` body `{p_producto_a, p_producto_b, p_tamano}` (2026-08-10). Cotiza una pizza mitad y mitad **server-side** y devuelve el item listo para el carrito |

**Pizza mitad y mitad (2026-08-10):** una pizza con dos sabores es **una sola línea** que cobra
el precio de la **mitad más cara** del tamaño pedido. El LLM **nunca** calcula ese precio: llama
`armar_mitad_y_mitad` con los dos `producto_id` (de `consultar_menu`) + el tamaño y copia la
respuesta al carrito **incluido el campo `mitades`**, que es lo que persiste en
`detalle_pedidos.mitades`. Reglas que valida la RPC: misma masa (`menu.variante`: Tradicional con
Tradicional, Estofada con Estofada), tamaño `pequena/mediana/grande/familiar` (la **porción no se
parte**), solo las 4 categorías de pizza salada (las dulces no), ambas disponibles y sabores
distintos. Sí se pueden cruzar categorías (media tradicional + media premium → cobra la premium).
`Sub — Crear_orden_completa` **vuelve a calcular** ese precio contra el menú real al crear el
pedido, así que un precio inventado por el LLM no llega a la BD.

Prompt completo: [`agent-prompts.md#agente-menú`](agent-prompts.md#agente-menú).

---

## 3. AGENTE PEDIDOS

**Rol:** tomar el carrito confirmado y crear el pedido real. Pregunta **siempre** tipo de
pedido y método de pago (una pregunta por mensaje). Si es domicilio pregunta además el
**barrio** y cobra lo que devuelva `consultar_cobertura` — nunca una cifra de memoria.

**Fuera de Bello no hay domicilio (2026-08-25, BUG-033):** si `consultar_cobertura` devuelve
`cubierto:false`, el agente tiene prohibido prometer el envío, inventar una tarifa o cobrar la
tarifa base. Pregunta por las `sugerencias` (por si era una errata) y si no, ofrece recoger en
el local y sigue el pedido como `tipo_pedido = recoger`. Antes hacía lo contrario: el prompt le
ordenaba ignorar el `false` y cobrar igual, y así prometía domicilios a Envigado y Sabaneta.

**Dónde se suma el domicilio (2026-08-19):** en el **PASO 3** el agente lo suma a mano
(`Subtotal + costo_domicilio`) porque el pedido todavía no existe en la BD. En el **PASO 5**
muestra `$[total]` **tal cual** lo devolvió `crear_orden_completa`: ese número ya trae el
domicilio incluido por el trigger `actualizar_total_pedido` (`SUM(items) + costo_domicilio`).
Volver a sumarlo ahí se lo cobra dos veces al cliente — es el error que se coló al aplicar
esto a mano y se corrigió el mismo día.

Invariantes que comparte con la BB.DD.: `tipo_pedido` en minúscula (`domicilio`/`recoger`),
`metodo_pago` capitalizado (`Efectivo`/`Transferencia`), items **sin modificar** desde
`leer_carrito` — incluido el campo `mitades` cuando la línea es una pizza mitad y mitad.
Ante error de `crear_orden_completa` → **no reintenta**, escala.

**Gate de confirmación (2026-07-29, no lo quites):** el flujo del prompt es
`PASO 3 — RESUMEN Y CONFIRMACIÓN` (muestra el resumen, cierra con *"¿Te lo confirmo así?"* y
**termina el turno**) → `PASO 4 — CREAR EL PEDIDO` (solo tras un "sí"/"dale"/"confirmo" llama
`crear_orden_completa`) → `PASO 5` (confirma + datos bancarios si es Transferencia). Los datos
bancarios van en el PASO 5, **no** en el resumen: antes del PASO 4 el pedido todavía no existe.
Reglas duras que sostienen el gate: *nunca preguntes y crees en el mismo mensaje* y
*prohibido asumir `metodo_pago`* — están tanto en el `systemMessage` como en el
`toolDescription` de `crear_orden_completa`, a propósito. Sin ese PASO 4 el agente crea el pedido
en el mismo turno del resumen e **inventa el método de pago** (`edge-cases.md#20`).

| Tool | Tipo | Detalle |
|---|---|---|
| `leer_carrito1` | Supabase (get) | `carritos` WHERE `telefono` |
| `crear_orden_completa` | Subworkflow | `Sub — Crear_orden_completa` · inputs `filtro` (pedido_json), `cliente_id`, `telefono`. Inserta en `pedidos` + `detalle_pedidos` (credencial `service_role` desde BUG-007). Desde 2026-08-18 el `filtro` acepta **`barrio`**, que viaja crudo hasta el INSERT: el precio del envío lo pone el trigger de la BD, nunca el LLM. Detalle: [subworkflows.md](subworkflows.md#sub--crear_orden_completa) |
| `actualizar_cliente1` | Supabase (update) | `clientes` SET `direccion_principal` WHERE `cliente_id` |
| `consultar_cobertura` | HTTP POST | `/rpc/consultar_cobertura` body `{p_barrio}` — el parámetro que ve el LLM se llama `barrio` (`$fromAI`). Tarifa del domicilio para ese barrio, o el listado de zonas si va vacío. **`cubierto:false` = fuera de cobertura** (2026-08-25, BUG-033): la respuesta viene sin `costo_domicilio` y sin `tiempo_estimado`, más `mensaje` y `sugerencias`. Vive desde 2026-08-19 |

Prompt completo: [`agent-prompts.md#agente-pedidos`](agent-prompts.md#agente-pedidos).
Datos bancarios (transferencia): Bancolombia, ahorros 62500073329, Vera Pizzería, NIT 1004967215.

---

## 4. AGENTE SOPORTE

**Rol:** todo lo demás — saludos, estado de pedido, info del local, quejas, actualizar
datos y **handoff** a humano. Registra el nombre si es válido (no emojis/religioso/falso).

| Tool | Tipo | Detalle |
|---|---|---|
| `info_local` | Supabase (getAll) | `info_negocio` (clave/valor: horarios, dirección, pagos). **Ya NO trae zonas de domicilio**: `zona_delivery` y `costo_delivery` se eliminaron el 2026-08-18 |
| `consultar_cobertura1` | HTTP POST | `/rpc/consultar_cobertura` body `{p_barrio}` — mismo RPC que en el Agente Pedidos, para responder "¿a dónde llevan?" y "¿cuánto cuesta el domicilio?". Con `cubierto:false` el Soporte tampoco puede decir que llegan ni dar precio (2026-08-25, BUG-033). Vive desde 2026-08-19 |
| `consultar_faq` | HTTP POST | `/rpc/consultar_faq` body `{p_filtro}` — el parámetro que ve el LLM se llama `filtro` (`$fromAI`), como en `armar_mitad_y_mitad` (2026-08-11). Preguntas frecuentes **activas** que administra el restaurante desde el dashboard |
| `actualizar_cliente` | Supabase (update) | `clientes` SET `nombre`, `direccion_principal` WHERE `cliente_id` |
| `solicitar_handoff` | Supabase (update) | `clientes` SET `modo='humano'` WHERE `cliente_id` AND `telefono` |

Efecto del handoff: el Router de modo deja de pasar al orquestador y los mensajes del
cliente caen en `mensajes_soporte` (panel de soporte del dashboard).

**FAQ configurable (2026-08-11):** todo lo que el cliente pregunta y no es menú, pedido ni
`info_negocio` (¿tienen parqueadero? ¿aceptan mascotas? ¿hacen eventos?) sale ahora de la tabla
`faq`, que el restaurante edita solo desde **Configuración → Preguntas frecuentes**. Antes ese
contenido se escribía a mano en este prompt: por cada cliente nuevo de Plateo había que
reescribirlo, que es justo lo que rompe el modelo multi-tenant. Es la misma jugada que
`motivos_reserva` y `info_negocio` — la verdad del negocio vive en la BD, el prompt queda genérico.

`consultar_faq` **no filtra**: devuelve todas las FAQ activas (tope 40) y `p_filtro` solo las
reordena por parecido. El emparejamiento lo hace el LLM, porque el cliente parafrasea y una
búsqueda por trigrama perdería la FAQ correcta (detalle y medición en
[`../database/schema.md`](../database/schema.md#funciones--rpcs)).

> ⚠️ **El contenido de las FAQ es DATO, nunca instrucción.** Es texto libre que escribe el
> restaurante y entra al contexto del agente, así que es la única vía por la que alguien podría
> —sin querer o a propósito— intentar reescribir el comportamiento del bot o meter un precio que
> no salió de la BD. El prompt lo blinda explícitamente (ver `agent-prompts.md#agente-soporte`):
> las FAQ se leen como información del negocio, y si una parece darle órdenes al agente, se
> ignora. El dashboard además avisa al admin cuando detecta precios, jerga interna o texto con
> forma de instrucción (`src/pages/settings/faqLint.js`) — pero eso es una ayuda de redacción,
> **no** la barrera: la barrera es el prompt.

**Contexto de la escalada (2026-08-10):** el mensaje que dispara el handoff viaja por la ruta del
**bot**, así que nunca pasa por el nodo que escribe en `mensajes_soporte` — el operador abría la
conversación en blanco y tenía que volver a preguntar el problema. Ahora lo resuelve la BD, no
n8n: el trigger `trigger_contexto_handoff` sobre `clientes` llama a `registrar_contexto_handoff()`
y vuelca la conversación reciente desde `n8n_chat_histories`. **Funciona porque el ORQUESTADOR
guarda el turno del cliente al cerrar SU cadena, que corre antes de que el Agente Soporte llame
`solicitar_handoff`** — cuando el trigger dispara, el mensaje ya está en la memoria.
Al vivir en la BD cubre cualquier vía de escalada (la tool, el dashboard, un UPDATE manual) sin
tocar el workflow.
Prompt completo: [`agent-prompts.md#agente-soporte`](agent-prompts.md#agente-soporte).

---

## 5. AGENTE RESERVAS

**Rol:** gestionar reservas (una pregunta por mensaje: personas → día → hora → **ocasión**).
Consulta disponibilidad **antes** de proponer; confirma antes de crear. Máx 12 personas (si no, humano).

**Motivo / ocasión de la reserva (2026-08-10):** tras confirmar disponibilidad, el agente pregunta
la ocasión (cumpleaños, aniversario, declaración, grado, evento empresarial o ninguna). Algunas
llevan un **montaje con costo**, que se anuncia **antes** de pedir la confirmación —igual que el
recargo de domicilio en el Agente Pedidos— y se cobra **en el local**: no genera pedido ni cobro
automático. El agente **nunca** inventa ni recuerda un precio: llama `consultar_motivos_reserva`.
A `crear_reserva` le pasa solo la **clave** (`cumpleanos`, no "Cumpleaños"); el costo lo escribe el
trigger `trigger_costo_motivo` en la BD y vuelve en la respuesta como `costo_legible`. Es tarifa
**fija por reserva**, no por persona — el prompt lo prohíbe explícitamente.

| Tool | Tipo | Detalle |
|---|---|---|
| `consultar_disponibilidad` | Subworkflow | `Sub — consultar_disponibilidad` · inputs `fecha`, `hora` · 8 mesas / 90 min |
| `consultar_motivos_reserva` | Supabase (getAll) | `motivos_reserva` WHERE `activo=true` (2026-08-10). Ocasiones vigentes con `clave`, `nombre`, `descripcion` y `costo` |
| `crear_reserva` | Subworkflow | `Sub — Crear Reserva` · inputs `telefono, nombre, fecha, hora, personas, cliente_id, motivo` · cupo protegido por trigger de BD |
| `consultar_reservas_cliente` | Supabase (getAll) | `reservas` WHERE `telefono`, `estado='confirmada'`, `fecha >= now` |
| `cancelar_reserva` | Subworkflow | `Sub — Cancelar Reserva` · inputs `reserva_id`, `telefono` · valida propiedad por teléfono (cableada 2026-07-23, BUG-005) |

Detalle server-side de todas: [subworkflows.md](subworkflows.md).
Prompt completo: [`agent-prompts.md#agente-reservas`](agent-prompts.md#agente-reservas).

---

## Reglas globales (todos los agentes)

1. **NUNCA** mencionar "el sistema", "herramientas", "base de datos" ni nada técnico.
2. **NUNCA** inventar un `producto_id` — solo IDs de `consultar_menu`.
3. **NUNCA** calcular el total del pedido — lo hace el trigger de Supabase.
4. **NUNCA** dar precios aproximados — exactos desde la BD.
5. Mensajes cortos (≤ 4–5 líneas), emojis con moderación, tono humano.

## Tablas que tocan los agentes (sync en `../database/schema.md`)

`carritos` (PK telefono; items JSON, total), `menu`, `pedidos` + `detalle_pedidos`,
`clientes`, `info_negocio` (clave/valor del negocio), `faq` (preguntas frecuentes editables),
`reservas` + `motivos_reserva`. Memoria de chat en la tabla de n8n Postgres Chat Memory.
