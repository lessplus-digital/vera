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
| `cliente_id` | text | FK → clientes · **ON DELETE CASCADE** |
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
| `pedido_id` | text | FK → pedidos · **ON DELETE CASCADE** |
| `producto_id` | text | FK → menu (**debe existir**) |
| `nombre_producto` | text | copiado del menú |
| `variante` | text | default `'Estándar'` |
| `cantidad` | integer | default 1 |
| `precio_unitario` | numeric | **copiado del menú al crear** (no cambia con el menú) |
| `subtotal` | numeric | **columna generada** = `cantidad * precio_unitario` |
| `notas_item` | text | nullable |
| `mitades` | jsonb | nullable · **pizza mitad y mitad** (migración `mitad_y_mitad_columna_y_cotizador`, 2026-08-10) |

> **Pizza mitad y mitad.** Una pizza con dos sabores es **UNA sola fila** de `detalle_pedidos`:
> `producto_id` = la mitad **más cara** (la que fija el precio, y así la FK sigue siendo válida),
> `nombre_producto` = `"Mitad X / Mitad Y"`, `variante` = el **tamaño**, `precio_unitario` = el
> precio de esa mitad más cara en ese tamaño, y `mitades` = array de **exactamente 2** objetos
> `{producto_id, nombre, variante, precio}` (donde `variante` es la **masa** — el único sitio
> donde se conserva). En productos normales `mitades` es `NULL`. Al ser una línea normal, el
> trigger del total, el historial y las estadísticas siguen funcionando sin cambios.
> Quien decide el precio es la RPC `cotizar_mitad_y_mitad` (ver abajo), nunca el LLM ni el JS.

### `carritos` — carrito temporal del bot (0 filas · PK `telefono` · RLS ✅)
`telefono` 🔑, `items` jsonb (default `[]`), `total` numeric, `updated_at` timestamptz.

### `reservas` — (15 filas · RLS ✅)
`reserva_id` 🔑 (`generar_reserva_id()`), `cliente_id` (FK, nullable, **ON DELETE CASCADE**), `telefono`,
`nombre_cliente`, `fecha` date, `hora` time, `personas` int (**check 1–12**),
`estado` (**check `confirmada`/`cancelada`** — no hay `pendiente`), `origen`
(`whatsapp`/`dashboard`), `notas`, `created_at`,
**`motivo`** (FK → `motivos_reserva.clave`, ON DELETE SET NULL) y
**`costo_motivo`** numeric NOT NULL default 0 (migración `motivos_reserva_tabla_y_costo`, 2026-08-10).

### `motivos_reserva` — ocasiones de reserva y su costo (6 filas · PK `clave` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `clave` 🔑 | text | slug estable; es lo que se guarda en `reservas.motivo` |
| `nombre` | text | lo que ve el cliente (`Cumpleaños`) |
| `descripcion` | text | qué incluye el montaje |
| `costo` | numeric | **check ≥ 0** · tarifa **FIJA por reserva**, NO por persona |
| `activo` | boolean | default `true` · `false` = deja de ofrecerse, pero las reservas históricas conservan la clave |
| `orden` | integer | orden de presentación (menor primero) |

Seed inicial (**precios PLACEHOLDER**, se ajustan con un `UPDATE`): `sin_ocasion` $0,
`cumpleanos` $80.000, `aniversario` $120.000, `declaracion` $150.000, `grado` $90.000,
`empresarial` $200.000. Las 15 reservas que existían antes de la migración quedaron en
`sin_ocasion` (no se les puede inventar una ocasión retroactiva).

> **El costo NUNCA lo escribe quien inserta.** Ni el LLM del bot ni el JS del dashboard mandan
> `costo_motivo`: solo mandan la `clave` del motivo, y el trigger `trigger_costo_motivo` copia el
> precio desde esta tabla. Lo que queda en `reservas.costo_motivo` es una **foto**: cambiar el
> precio del motivo no altera reservas ya creadas. Es la misma convención que el total de `pedidos`.
> Fuente única para las dos capas: el bot la lee con la tool `consultar_motivos_reserva` y el
> dashboard con el hook `useReservationReasons`.

### `feedback` — calificaciones (1 fila · RLS ✅)
`feedback_id` 🔑 (`FB-`), `cliente_id` (FK, **ON DELETE CASCADE**), `pedido_id` (FK, **unique**,
**ON DELETE CASCADE**), `fecha`, `calificacion_general` smallint (**check 1–5**), `comentario`,
`resuelta_at` timestamptz (NULL = pendiente; se setea al contactar al cliente desde la tab Reseñas —
migración `feedback_add_resuelta_at`, 2026-07-23; solo aplica a negativas/neutras).

> **Borrado en cascada (migración `cascade_delete_cliente`, 2026-07-22):** eliminar un cliente
> borra sus `pedidos` (→ `detalle_pedidos`), `reservas` y `feedback`. Es una acción destructiva
> que altera las estadísticas históricas; el dashboard lo advierte en la confirmación del modal.
> `mensajes_soporte` no tiene FK a `clientes` (referencia por `telefono`), así que el historial
> de soporte NO se borra.

### `feedback_pendiente` — cola de espera de feedback (2 filas · PK `telefono` · RLS ✅)
`telefono` 🔑, `pedido_id`, `cliente_id`, `estado` (check `esperando_nota`/`esperando_comentario`),
`fecha_solicitud`.

### `mensajes_soporte` — chat de soporte (RLS ✅ solo authenticated)
`id` uuid 🔑, `telefono`, `origen` (check `cliente`/`admin`/`sistema`/**`bot`**), `mensaje`,
`created_at`, `tipo_contenido` (`texto`/`imagen`), `imagen_url`.

> **`origen = 'bot'` (2026-08-10):** turnos del agente IA **recuperados del historial** al escalar
> la conversación a humano. No los escribe el bot en vivo: los vuelca la RPC
> `registrar_contexto_handoff` desde `n8n_chat_histories`. El dashboard los pinta del lado del
> cliente pero atenuados (son contexto pasado, no algo que responder).

### `info_negocio` — config clave/valor (17 filas · PK `clave` · RLS ✅)
`clave` 🔑, `valor`, `categoria`. El bot la lee completa vía la tool `info_local` (getAll, sin
filtros por clave) y el dashboard la edita en la **tab Configuración**. Reestructurada con la
migración `info_negocio_single_sede_y_claves_dashboard` (2026-07-23): al haber **una sola
sede**, `sede_1_direccion` → `direccion` (categoria `contacto`) y `sede_1_nombre` se eliminó;
se agregaron `link_menu` (contacto) y `costo_delivery` (operacion), creadas vacías.
`link_menu` se llenó el **2026-07-28** con `https://vera.plateo.cloud/menu_vera.pdf` (el PDF
oficial que se sirve desde `public/` del dashboard); el mismo valor está hardcodeado en el prompt
del Agente Menú en n8n — si el dominio cambia hay que actualizar **ambos**.

Claves por `categoria`:
- `identidad`: `nombre_negocio`, `slogan`, `descripcion_general`
- `contacto`: `direccion`, `telefono_principal`, `whatsapp`, `instagram`, `link_menu`
- `horarios`: `horario_semana`, `horario_finsemana`, `horario_feriados`
- `operacion`: `metodos_pago`, `datos_transferencia`, `zona_delivery`, `costo_delivery`,
  `tiempo_entrega_delivery`, `politica_cancelacion`

> ⚠️ Los **valores** actuales son de plantilla ("La Pizzería Don Carlo", teléfonos +58) —
> ver BUG-026: el operador debe llenar la data real desde la tab Configuración.

### `n8n_chat_histories` — memoria conversacional de los agentes (RLS ✅)
`id` 🔑, `session_id` (= telefono), `message` jsonb, `created_at`.

### `n8n_mensajes_pendientes` — buffer de acumulación de mensajes (RLS ✅)
`id` uuid 🔑, `telefono`, `mensaje`, `creado_el`.

---

## Triggers

| Tabla | Trigger | Cuándo | Qué hace |
|---|---|---|---|
| `detalle_pedidos` | `trigger_actualizar_total` | **AFTER INSERT** | `pedidos.total` = `SUM(precio_unitario*cantidad)` **+ $5.000 si `domicilio`** |
| `pedidos` | `trigger_fecha_entrega` | BEFORE UPDATE | Fija `fecha_entrega = now()` al pasar a `estado='entregado'` |
| `pedidos` | `notificar-estado-pedido` | AFTER UPDATE | `http_request` (pg_net) — notifica el cambio de estado (webhook) |
| `reservas` | `trigger_validar_cupo` | BEFORE INSERT | Si hay 8 reservas solapadas (90 min) `confirmada` ese día → `RAISE EXCEPTION` |
| `reservas` | `trigger_costo_motivo` | BEFORE INSERT **OR UPDATE OF `motivo`** | `costo_motivo` = `motivos_reserva.costo` de la clave en `motivo`; `motivo` vacío/NULL → costo 0 (2026-08-10) |
| `clientes` | `trigger_contexto_handoff` | AFTER UPDATE OF `modo` · **WHEN `modo` pasa a `'humano'`** | Llama `registrar_contexto_handoff()` y deja una nota `sistema` — el operador abre la conversación con el contexto ya cargado (2026-08-10) |

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
| `buscar_menu` | `(termino text, umbral float=0.2, limite int=5, solo_disponibles bool=true)` | **Búsqueda difusa** del menú: `normalizar_texto` (unaccent+lower) + diccionario de typos (`papata→patata`, `servex→cervez`, `hamurguesa→hamburguesa`, `birra→cerveza`…) + 3 capas de score (containment / `similarity` full-string / word-level trgm) **sobre `nombre`, `categoria` (peso 0.8) y `descripcion` (peso 0.7)** — extendida 2026-07-22 (migración `bug006_buscar_menu_categoria_descripcion`; antes solo `nombre`). **Devuelve `descripcion` y `similitud` (0–1)**, ordenado desc. Término vacío/null → devuelve el menú (respeta `limite`). |
| `buscar_menu_categoria` | `(cat text, solo_disponibles bool=true)` | Lista productos de una categoría. |
| `cotizar_mitad_y_mitad` | `(p_producto_a text, p_producto_b text, p_tamano text) → jsonb` | **Cotizador de pizza mitad y mitad** (2026-08-10). Valida: los dos productos existen y están disponibles, misma **masa** (`menu.variante`), categoría de pizza salada (`pizza_tradicional/especial/premium/premium_especial`), sabores distintos y tamaño en `pequena/mediana/grande/familiar` (**porción excluida**). Cobra el precio de la **mitad más cara**. Devuelve `{ok:true, producto_id, nombre_producto, variante, masa, precio_unitario, mitades, explicacion}` o `{ok:false, error, message}` (`MASA_DISTINTA`, `TAMANO_NO_PERMITIDO`, `CATEGORIA_NO_PERMITIDA`, `PRODUCTO_AGOTADO`, `MITADES_IGUALES`, `TAMANO_NO_DISPONIBLE`…). La usan **el bot** (tool `armar_mitad_y_mitad`) y **el dashboard** (`MenuPicker`) — misma regla, una sola fuente. |
| `editar_pedido` | `(p_pedido_id text, p_items jsonb) → jsonb` | **SECURITY DEFINER**. Solo si `estado='pendiente'` (bloqueo `FOR UPDATE`); borra e reinserta items, **preserva el recargo de domicilio**, recalcula total. Lo usa el dashboard. Retorna `{ success, ... }`. Desde 2026-08-10 (migración `editar_pedido_arrastra_mitades_y_notas_item`) también arrastra **`mitades` y `notas_item`** — antes los perdía al reinsertar. |
| `generar_reserva_id` | `() → text` | Default de `reservas.reserva_id`. |
| `historial_resumen` | `(p_from, p_to timestamp, p_estado, p_tipo, p_search, p_search_digits text, p_cliente_ids text[]) → jsonb` | Agregados del historial (total/entregados/cancelados/ingresos sin cancelados) con los mismos filtros que la lista paginada de la tab Historial. **SECURITY INVOKER** (respeta RLS: sin sesión cuenta 0). Migración `historial_resumen_rpc_e_indice_fecha` (2026-07-23), que también creó el índice `idx_pedidos_fecha_pedido`. |
| `normalizar_texto` | `(text) → text` | unaccent + lower (base de `buscar_menu`). |
| `registrar_contexto_handoff` | `(p_telefono text, p_limite int=40) → integer` | **Contexto al escalar a humano** (2026-08-10). Vuelca la conversación reciente del bot desde `n8n_chat_histories` a `mensajes_soporte` (`human`→`cliente`, `ai`→`bot`). Descarta ruido: mensajes `tool`, `content` no-string (llamadas a tools) y el JSON de clasificación del ORQUESTADOR (`~ '"agente"\s*:'`). Deduplica turnos **consecutivos** repetidos (la memoria es compartida: el mismo mensaje se guarda una vez por cadena que corre). Desempata el orden con microsegundos sobre el `id` de la memoria, porque varios turnos comparten `created_at` y el dashboard ordena por esa columna. **Idempotente por corte temporal:** solo copia lo posterior al último `mensajes_soporte` de ese teléfono, así re-escalar no duplica. Devuelve cuántos mensajes recuperó. **SECURITY DEFINER**. |
| `expirar_pedidos_pendientes` | `() → integer` | **BUG-028** (2026-08-10). Cancela los pedidos que quedaron `pendiente` de **días de negocio anteriores** (Colombia UTC-5) con `motivo_rechazo = 'no alcanzamos a procesarlo antes del cierre del día'` — redactado para encajar en la plantilla de n8n. **No toca `en_cocina`/`en_camino`**: esos ya los aceptó la cocina y lo más probable es que se entregaran sin marcarse; los cierra el operador desde Historial. Devuelve cuántos cerró. **SECURITY DEFINER**. |
| `limpiar_carritos_abandonados` / `limpiar_historial_chat` | `()` | Housekeeping. |

### Jobs programados (`pg_cron`)

| Job | Cron | Qué corre |
|---|---|---|
| `limpiar-carritos-abandonados` | `0 8 * * *` | `limpiar_carritos_abandonados()` |
| `limpiar_historial_chat_semanal` | `0 3 * * 1` | `limpiar_historial_chat()` |
| `expirar-pedidos-pendientes` | `0 16 * * *` | `expirar_pedidos_pendientes()` — 16:00 UTC = **11:00 Colombia**: el corte (00:00) ya pasó, pero la notificación de cancelación le llega al cliente a una hora decente y no a medianoche. Mientras tanto el pedido viejo no estorba, porque el kanban solo muestra los del día actual |

> ✅ Desde 2026-07-22 **`Sub — Consultar_menu` llama a `buscar_menu`** (POST
> `/rest/v1/rpc/buscar_menu` con `{termino, umbral: 0.2, limite: 30, solo_disponibles: true}`)
> en vez del `ilike` casero — el `similitud` y la tolerancia a typos que el prompt del
> Agente Menú asume por fin llegan de verdad (BUG-006 resuelto).

---

## Modelo de permisos (RLS) — estado REAL (verificado 2026-07-22)

**TODAS las tablas tienen RLS habilitado** con la política `auth_full_access`
(`authenticated` puede todo). Además:
- `menu` → + `menu_lectura_publica` (`public` SELECT): el bot puede leerlo con la key pública.
- ~~`mensajes_soporte` → + `public` INSERT y SELECT~~ — **eliminadas 2026-07-22 (BUG-024)**:
  exponían todo el historial de soporte a la key pública. Migración
  `bug024_drop_public_policies_mensajes_soporte`; el realtime del dashboard ahora exige el
  JWT en el socket (`supabase.realtime.setAuth`, BUG-023).

Historia: hasta 2026-07-22, 6 tablas (`carritos`, `feedback`, `feedback_pendiente`,
`info_negocio`, `n8n_chat_histories`, `n8n_mensajes_pendientes`) estaban **sin RLS** y expuestas
a la key pública (BUG-012), y varios nodos n8n escribían con keys hardcodeadas (BUG-003), lo que
además bloqueaba el INSERT de `detalle_pedidos` y dejó 8 pedidos sin líneas (BUG-007). Todo
resuelto: nodos migrados a credenciales, keys legacy deshabilitadas (sistema nuevo
`sb_publishable_`/`sb_secret_`), RLS habilitado vía migración `bug012_enable_rls_exposed_tables`.
El Postgres Chat Memory de n8n conecta como `postgres` (dueño de las tablas) → exento de RLS.

**Modelo de acceso vigente:**
| Actor | Key | Acceso |
|---|---|---|
| Dashboard | `sb_publishable_` + sesión auth | rol `authenticated` → todo vía `auth_full_access` |
| Bot n8n | `sb_secret_` (credencial `Supabase account`) | salta RLS |
| Público (key sola) | `sb_publishable_` | solo `menu` (SELECT) |

**Usuarios admin del dashboard:** Supabase no trae usuarios por defecto. Se crean a mano en
**Dashboard → Authentication → Users → Add user** (email + contraseña), con
**Authentication → Providers → Email → "Allow new users to sign up" = OFF** (no es registro
público; los usuarios del panel los crea el operador).

> Nota: el script `infra/supabase/rls_reference.sql` que servía de referencia de este modelo se
> eliminó del repo (2026-07-22) — el estado se verifica en vivo vía MCP de Supabase, y replicar
> el setup a nuevos clientes se hará igualmente vía MCP.

---

## Realtime

Publicación `supabase_realtime` — emite INSERT/UPDATE/DELETE de:
**`pedidos`, `detalle_pedidos`, `mensajes_soporte`, `reservas`, `clientes`, `menu`, `feedback`**
(`clientes` se agregó al resolver BUG-014, verificado vía MCP 2026-07-17; `menu` se agregó
con la migración `menu_add_to_realtime_publication` al crear la tab Menú del dashboard,
2026-07-22; `feedback` con `feedback_add_to_realtime_publication` al crear la tab Reseñas,
2026-07-23).
