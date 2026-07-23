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

**Secuencia obligatoria** al pedir algo: `leer_carrito` → `consultar_menu` → construir items
(existentes + nuevos) → `crear_carrito` (nuevo) o `actualizar_carrito` (existente) → responder.
Nunca crea carrito vacío ni antes de `consultar_menu`; nunca pide confirmación para agregar.

| Tool | Tipo | Detalle |
|---|---|---|
| `leer_carrito` | Supabase (get) | `carritos` WHERE `telefono` |
| `consultar_menu` | Subworkflow | `Sub — Consultar_menu` · input `filtro`; RPC `buscar_menu` (fuzzy por nombre/categoría/descripción, devuelve `similitud` — BUG-006, 2026-07-22). Detalle: [subworkflows.md](subworkflows.md#sub--consultar_menu) |
| `crear_carrito` | HTTP POST | `/carritos` body `{telefono, items, total}` (credencial n8n desde BUG-003) |
| `actualizar_carrito` | HTTP PATCH | `/carritos?telefono=eq.{fromAI}` body `{items, total}` (credencial n8n) |

Prompt completo: [`agent-prompts.md#agente-menú`](agent-prompts.md#agente-menú).

---

## 3. AGENTE PEDIDOS

**Rol:** tomar el carrito confirmado y crear el pedido real. Pregunta **siempre** tipo de
pedido y método de pago (una pregunta por mensaje). Domicilio suma **$5.000**.

Invariantes que comparte con la BB.DD.: `tipo_pedido` en minúscula (`domicilio`/`recoger`),
`metodo_pago` capitalizado (`Efectivo`/`Transferencia`), items **sin modificar** desde
`leer_carrito`. Ante error de `crear_orden_completa` → **no reintenta**, escala.

| Tool | Tipo | Detalle |
|---|---|---|
| `leer_carrito1` | Supabase (get) | `carritos` WHERE `telefono` |
| `crear_orden_completa` | Subworkflow | `Sub — Crear_orden_completa` · inputs `filtro` (pedido_json), `cliente_id`, `telefono`. Inserta en `pedidos` + `detalle_pedidos` (credencial `service_role` desde BUG-007). Detalle: [subworkflows.md](subworkflows.md#sub--crear_orden_completa) |
| `actualizar_cliente1` | Supabase (update) | `clientes` SET `direccion_principal` WHERE `cliente_id` |

Prompt completo: [`agent-prompts.md#agente-pedidos`](agent-prompts.md#agente-pedidos).
Datos bancarios (transferencia): Bancolombia, ahorros 62500073329, Vera Pizzería, NIT 1004967215.

---

## 4. AGENTE SOPORTE

**Rol:** todo lo demás — saludos, estado de pedido, info del local, quejas, actualizar
datos y **handoff** a humano. Registra el nombre si es válido (no emojis/religioso/falso).

| Tool | Tipo | Detalle |
|---|---|---|
| `info_local` | Supabase (getAll) | `info_negocio` (clave/valor: horarios, dirección, pagos, zonas) |
| `actualizar_cliente` | Supabase (update) | `clientes` SET `nombre`, `direccion_principal` WHERE `cliente_id` |
| `solicitar_handoff` | Supabase (update) | `clientes` SET `modo='humano'` WHERE `cliente_id` AND `telefono` |

Efecto del handoff: el Router de modo deja de pasar al orquestador y los mensajes del
cliente caen en `mensajes_soporte` (panel de soporte del dashboard).
Prompt completo: [`agent-prompts.md#agente-soporte`](agent-prompts.md#agente-soporte).

---

## 5. AGENTE RESERVAS

**Rol:** gestionar reservas (una pregunta por mensaje: personas → día → hora). Consulta
disponibilidad **antes** de proponer; confirma antes de crear. Máx 12 personas (si no, humano).

| Tool | Tipo | Detalle |
|---|---|---|
| `consultar_disponibilidad` | Subworkflow | `Sub — consultar_disponibilidad` · inputs `fecha`, `hora` · 8 mesas / 90 min |
| `crear_reserva` | Subworkflow | `Sub — Crear Reserva` · inputs `telefono, nombre, fecha, hora, personas, cliente_id` · cupo protegido por trigger de BD |
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
`clientes`, `info_negocio` (clave/valor del negocio), `reservas`. Memoria de chat en la
tabla de n8n Postgres Chat Memory. **Nuevas a documentar:** `carritos`, `info_negocio`.
