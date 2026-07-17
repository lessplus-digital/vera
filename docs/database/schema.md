# Esquema de Base de Datos — Supabase (PostgreSQL)

> Fuente de verdad del backend compartido (bot n8n + dashboard). Leído de la instancia
> real vía MCP de Supabase (proyecto `lwigogymjoyyzwiyewgi`), 2026-07-16.
> **Todas las tablas, columnas y valores están en español y minúsculas.**

## Convenciones

- **IDs `text` con prefijo + secuencia** (NO uuid): `CLI-001` (clientes), `PED-001` (pedidos),
  `DET-001` (detalle), `FB-001` (feedback); reservas vía `generar_reserva_id()`;
  `mensajes_soporte` y `n8n_mensajes_pendientes` sí usan `uuid`.
- **`fecha_pedido` es `timestamp` sin zona** con valor UTC → parsear con `parseDb()` en el
  frontend (`src/utils/dateRanges.js`). `fecha_entrega`, `created_at`, etc. son `timestamptz`.
- **`metodo_pago` capitalizado** (`'Efectivo'`/`'Transferencia'`) — el frontend compara exacto.
- **Extensiones activas:** `pg_trgm` (búsqueda difusa) y `unaccent` (quitar tildes).

---

## Tablas

### `menu` — catálogo de productos (133 filas · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `producto_id` 🔑 | text | PK (ej. `PROD-001`) |
| `nombre` / `categoria` | text | |
| `variante` | text | default `'Estándar'` |
| `descripcion` | text | nullable |
| `precio` | numeric | precio actual; no afecta pedidos históricos |
| `disponible` | boolean | default `true` |
| `tamaño` | text | default `'Estándar'`; puede ser JSON `{"porcion":10500,"mediana":37500,...}` |

### `clientes` — (4 filas · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `cliente_id` 🔑 | text | default `CLI-` + secuencia |
| `nombre` | text | nullable (`'Pendiente'` al crearse) |
| `telefono` | text | **unique** — clave de búsqueda principal (NO se llama `direccion`) |
| `direccion_principal` | text | nullable |
| `metodo_pago_preferido` | text | nullable |
| `fecha_registro` / `fecha_nacimiento` | date | |
| `etiqueta` | text | default `'nuevo'` (nuevo/recurrente/frecuente/inactivo) |
| `activo` | boolean | default `true` |
| `modo` | text | default `'bot'` · **check: `bot` / `humano` / `esperando_feedback`** |

> `bot` → el agente procesa; `humano` → van a `mensajes_soporte`; `esperando_feedback` → espera
> la calificación tras la entrega. Fidelidad/gasto se **agregan desde `pedidos`**, no de columnas
> aquí (las viejas `total_pedidos`/`gasto_total` se eliminaron en 2026-06).

### `pedidos` — (18 filas · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `pedido_id` 🔑 | text | `PED-` + secuencia |
| `cliente_id` | text | FK → clientes |
| `telefono` | text | |
| `tipo_pedido` | text | check: `domicilio` / `recoger` |
| `direccion_entrega` | text | nullable |
| `fecha_pedido` | timestamp (sin tz) | default `now()` — parsear con `parseDb()` |
| `estado` | text | check: `pendiente`/`en_cocina`/`en_camino`/`recoger`/`entregado`/`cancelado` |
| `metodo_pago` | text | `'Efectivo'`/`'Transferencia'` (capitalizado) |
| `estado_pago` | text | check: `pendiente`/`confirmado`/`rechazado` |
| `comprobante_url` | text | nullable |
| `total` | numeric | default 0 · **lo calcula un trigger** (ver abajo) |
| `tiempo_estimado` / `repartidor` / `notas` / `motivo_rechazo` | text | nullable |
| `fecha_entrega` | timestamptz | nullable · la fija un trigger al pasar a `entregado` |
| `feedback_solicitado` | boolean | default `false` (lo usa el job de feedback) |

### `detalle_pedidos` — líneas de pedido (16 filas · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `detalle_id` 🔑 | text | `DET-` + secuencia |
| `pedido_id` | text | FK → pedidos |
| `producto_id` | text | FK → menu (**debe existir**) |
| `nombre_producto` | text | copiado del menú |
| `variante` | text | default `'Estándar'` |
| `cantidad` | integer | default 1 |
| `precio_unitario` | numeric | **copiado del menú al crear** (no cambia con el menú) |
| `subtotal` | numeric | **columna generada** = `cantidad * precio_unitario` |
| `notas_item` | text | nullable |

### `carritos` — carrito temporal del bot (0 filas · PK `telefono` · ⚠️ RLS ❌)
`telefono` 🔑, `items` jsonb (default `[]`), `total` numeric, `updated_at` timestamptz.

### `reservas` — (6 filas · RLS ✅)
`reserva_id` 🔑 (`generar_reserva_id()`), `cliente_id` (FK, nullable), `telefono`,
`nombre_cliente`, `fecha` date, `hora` time, `personas` int (**check 1–12**),
`estado` (**check `confirmada`/`cancelada`** — no hay `pendiente`), `origen`
(`whatsapp`/`dashboard`), `notas`, `created_at`.

### `feedback` — calificaciones (1 fila · ⚠️ RLS ❌)
`feedback_id` 🔑 (`FB-`), `cliente_id` (FK), `pedido_id` (FK, **unique**), `fecha`,
`calificacion_general` smallint (**check 1–5**), `comentario`.

### `feedback_pendiente` — cola de espera de feedback (2 filas · PK `telefono` · ⚠️ RLS ❌)
`telefono` 🔑, `pedido_id`, `cliente_id`, `estado` (check `esperando_nota`/`esperando_comentario`),
`fecha_solicitud`.

### `mensajes_soporte` — chat de soporte (29 filas · RLS ✅ + público)
`id` uuid 🔑, `telefono`, `origen` (check `cliente`/`admin`/`sistema`), `mensaje`,
`created_at`, `tipo_contenido` (`texto`/`imagen`), `imagen_url`.

### `info_negocio` — config clave/valor (18 filas · PK `clave` · ⚠️ RLS ❌)
`clave` 🔑, `valor`, `categoria`. Ej.: `horario_semana`, `telefono_principal`, `datos_transferencia`.

### `n8n_chat_histories` — memoria conversacional de los agentes (⚠️ RLS ❌)
`id` 🔑, `session_id` (= telefono), `message` jsonb, `created_at`.

### `n8n_mensajes_pendientes` — buffer de acumulación de mensajes (⚠️ RLS ❌)
`id` uuid 🔑, `telefono`, `mensaje`, `creado_el`.

---

## Triggers

| Tabla | Trigger | Cuándo | Qué hace |
|---|---|---|---|
| `detalle_pedidos` | `trigger_actualizar_total` | **AFTER INSERT** | `pedidos.total` = `SUM(precio_unitario*cantidad)` **+ $5.000 si `domicilio`** |
| `pedidos` | `trigger_fecha_entrega` | BEFORE UPDATE | Fija `fecha_entrega = now()` al pasar a `estado='entregado'` |
| `pedidos` | `notificar-estado-pedido` | AFTER UPDATE | `http_request` (pg_net) — notifica el cambio de estado (webhook) |
| `reservas` | `trigger_validar_cupo` | BEFORE INSERT | Si hay 8 reservas solapadas (90 min) `confirmada` ese día → `RAISE EXCEPTION` |

> **El total lo calcula el trigger, nunca el JS ni el LLM.** Ojo: `trigger_actualizar_total`
> dispara **solo en INSERT** de `detalle_pedidos` (no UPDATE/DELETE) — por eso `editar_pedido`
> recalcula el total por su cuenta.

```sql
-- actualizar_total_pedido() (AFTER INSERT en detalle_pedidos)
UPDATE pedidos SET total = (
  SELECT COALESCE(SUM(precio_unitario * cantidad), 0)
  FROM detalle_pedidos WHERE pedido_id = NEW.pedido_id
) + CASE WHEN tipo = 'domicilio' THEN 5000 ELSE 0 END
WHERE pedido_id = NEW.pedido_id;
```

---

## Funciones / RPCs

| Función | Firma | Qué hace |
|---|---|---|
| `buscar_menu` | `(termino text, umbral float=0.2, limite int=5, solo_disponibles bool=true)` | **Búsqueda difusa** del menú: `normalizar_texto` (unaccent+lower) + diccionario de typos (`papata→patata`, `servex→cervez`, `hamurguesa→hamburguesa`, `birra→cerveza`…) + 3 capas de score (containment / `similarity` full-string / word-level trgm). **Devuelve `similitud` (0–1)**, ordenado desc. |
| `buscar_menu_categoria` | `(cat text, solo_disponibles bool=true)` | Lista productos de una categoría. |
| `editar_pedido` | `(p_pedido_id text, p_items jsonb) → jsonb` | **SECURITY DEFINER**. Solo si `estado='pendiente'` (bloqueo `FOR UPDATE`); borra e reinserta items, **preserva el recargo de domicilio**, recalcula total. Lo usa el dashboard. Retorna `{ success, ... }`. |
| `generar_reserva_id` | `() → text` | Default de `reservas.reserva_id`. |
| `normalizar_texto` | `(text) → text` | unaccent + lower (base de `buscar_menu`). |
| `limpiar_carritos_abandonados` / `limpiar_historial_chat` | `()` | Housekeeping. |

> **`buscar_menu` existe pero `Sub — Consultar_menu` NO lo usa** (hace su propio `ilike`).
> El `similitud` y la tolerancia a typos que el prompt del Agente Menú asume **ya existen aquí**
> → ver [BUG-006](../shared/bug-tracker.md).

---

## Modelo de permisos (RLS) — estado REAL

> ⚠️ `CLAUDE.md`/`infra/supabase/` asumen "RLS en todas las tablas". **La realidad no coincide**
> → ver [BUG-012](../shared/bug-tracker.md).

**Con RLS** (política `auth_full_access` = `authenticated` puede todo):
`clientes`, `pedidos`, `detalle_pedidos`, `reservas`. Además:
- `menu` → + `menu_lectura_publica` (`public` SELECT): el bot lo lee con anon.
- `mensajes_soporte` → + `public` INSERT y SELECT.

**Sin RLS (❌ expuestas a la anon key):**
`info_negocio`, `feedback`, `n8n_chat_histories`, `n8n_mensajes_pendientes`, `carritos`,
`feedback_pendiente`. Cualquiera con la anon key (pública, va en el frontend) puede leer/escribir.

**Consecuencia crítica ([BUG-007](../shared/bug-tracker.md)):** el bot escribe con la anon key
hardcodeada en varios nodos. Donde no hay RLS funciona; pero en `detalle_pedidos` (RLS
solo-`authenticated`) el INSERT con anon **se bloquea** → hay pedidos con `total` pero **sin
líneas** (`PED-109`, `PED-111`, `PED-113`). El bot debería escribir con `service_role`.

---

## Realtime

Publicación `supabase_realtime` (verificado vía MCP, 2026-07-16) — emite INSERT/UPDATE/DELETE de:
**`pedidos`, `detalle_pedidos`, `mensajes_soporte`, `reservas`**.

⚠️ `clientes` **NO** está en la publicación, aunque `useClients` y `useSupportCount` se suscriben a
ella → esos hooks no reciben eventos realtime hasta correr
`ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;` (ver BUG-014).
