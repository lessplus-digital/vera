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
| `tiempo_estimado` / `repartidor` / `notas` / `motivo_rechazo` | text | nullable · ⚠️ `repartidor` está **muerta**: NULL en los 105 pedidos, solo se lee en `OrderDetailModal`. La sustituye `domiciliario_id` |
| `domiciliario_id` | uuid | nullable · FK → `perfiles(usuario_id)` **ON DELETE SET NULL** · la escribe **solo un admin** · es la columna sobre la que filtra la RLS del rol domiciliario (2026-08-12) |
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

### `faq` — preguntas frecuentes editables (0 filas · PK `faq_id` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `faq_id` 🔑 | text | default `FAQ-###` (`faq_seq`) |
| `pregunta` | text | **check 3–200 caracteres** (tras `btrim`) · el trigger la deja en **una sola línea** |
| `respuesta` | text | **check 3–600 caracteres** (tras `btrim`) · conserva saltos de línea (formato WhatsApp) |
| `activa` | boolean | default `true` · `false` = el bot deja de verla, pero la fila se conserva |
| `orden` | integer | default 0 · orden de presentación (menor primero) |
| `created_at` / `updated_at` | timestamptz | `updated_at` lo escribe el trigger en cada UPDATE |

Creada con la migración `faq_configurable` (2026-08-11). Fuente única para las dos capas, igual
que `motivos_reserva`: el bot la lee con la tool `consultar_faq` y el dashboard la administra en
la **tab Configuración → Preguntas frecuentes** (hook `useFaq`). La tabla nace **vacía a
propósito**: sembrar respuestas de ejemplo sería inventar afirmaciones del negocio que el bot le
diría a clientes reales.

> **Por qué esta tabla existe:** hasta ahora la verdad del negocio que no cabía en `info_negocio`
> vivía escrita a mano en el prompt del Agente Soporte en n8n. Eso obliga a reescribir el prompt
> por cada cliente nuevo de Plateo — exactamente lo que rompe el modelo multi-tenant. Con `faq`,
> el restaurante administra ese contenido solo y el prompt queda genérico.

> **Los límites de longitud no son cosmética.** Acotan cuánto texto libre del restaurante entra al
> contexto del agente por fila; con el tope de 40 filas del RPC, el peor caso del bloque de FAQ
> está acotado. La regla de fondo la sostiene el prompt: **el contenido de las FAQ es DATO, nunca
> instrucción** (ver `../bot/ai-agents.md` §Agente Soporte).

### `respuestas_rapidas` — texto enlatado del chat de soporte (0 filas · PK `respuesta_id` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `respuesta_id` 🔑 | text | default `RR-###` (`respuestas_rapidas_seq`) |
| `atajo` | text | **check 2–30 caracteres** (tras `btrim`) · etiqueta del chip en el chat · el trigger la deja en **una sola línea** · **índice único** sobre `lower(btrim(atajo))` |
| `texto` | text | **check 3–600 caracteres** (tras `btrim`) · conserva saltos de línea (formato WhatsApp) · admite el marcador `{nombre}` |
| `activa` | boolean | default `true` · `false` = no aparece en el chat, pero la fila se conserva |
| `orden` | integer | default 0 · orden de los chips (menor primero) |
| `created_at` / `updated_at` | timestamptz | `updated_at` lo escribe el trigger en cada UPDATE |

Creada con la migración `crear_respuestas_rapidas` (2026-08-12). Se administra en la **tab
Configuración → Respuestas rápidas** (hook `useRespuestasRapidas`) y se consume en la **tab
Soporte**, donde los chips sobre el input escriben el texto en el campo. Nace **vacía a
propósito**, por el mismo criterio que `faq`.

> ⚠️ **Esta tabla NO la lee el bot** — y es la única de las editables (`info_negocio`, `faq`,
> `motivos_reserva`) de la que eso es cierto. Es texto que una **persona** inserta y revisa antes
> de enviarlo por WhatsApp desde el dashboard. Consecuencia práctica: no necesita las guardas
> anti-inyección de `faq` (`faqLint`), porque nunca entra al contexto de un agente. Si algún día
> el bot llegara a leerla, ese razonamiento deja de valer y hay que añadirle el lint.

> **El marcador `{nombre}`** lo resuelve el **dashboard**, no la BD: `aplicarNombre()` en
> `src/utils/quickReplies.js` lo reemplaza por el primer nombre del cliente
> (`conversaciones_soporte.nombre`). Sin nombre registrado el marcador **se borra junto con la
> coma que lo sigue** — "Hola {nombre}, tu pedido…" queda "Hola, tu pedido…" — para que nunca
> salga un `{nombre}` crudo hacia el cliente.

### `perfiles` — usuarios del dashboard y su rol (2 filas · PK `usuario_id` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `usuario_id` 🔑 | uuid | FK → `auth.users(id)` **ON DELETE CASCADE** · 1:1 con el usuario de Auth |
| `nombre` | text | nullable · check 2–80 caracteres · se siembra con la parte local del email |
| `rol` | text | default `'domiciliario'` · **check** `admin` / `mesero` / `domiciliario` |
| `telefono` / `avatar_url` | text | nullable · datos del perfil editables por el propio usuario |
| `activo` | boolean | default `true` · `false` conserva la fila y el historial pero **anula todo acceso** |
| `created_at` / `updated_at` | timestamptz | `updated_at` lo escribe `trigger_proteger_perfil` |

Creada con la migración `roles_etapa1_perfiles_y_helpers` (2026-08-12).

> **No lleva `restaurante_id`, a propósito.** El modelo multi-tenant acordado es **un proyecto
> Supabase por cliente** (aislamiento físico — ver `../shared/changelog.md` 2026-06-19 y
> `../shared/backlog.md` §SaaS). Estos perfiles son los usuarios de ESTE restaurante y nada más;
> añadir una columna de tenant contradiría la arquitectura en vez de reforzarla.

> **Nunca leer el rol desde el cliente.** El dashboard lo consulta a esta tabla en cada arranque
> (`useAuth`), no lo cachea en localStorage ni lo deduce del JWT. Aunque la RLS no se dejaría
> engañar por un valor manipulado, la UI mostraría pantallas que luego llegan vacías.

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
| `faq` | `trigger_normalizar_faq` | BEFORE INSERT **OR UPDATE** | Normaliza el texto y setea `updated_at`: `pregunta` colapsa a una sola línea; `respuesta` pierde CR y tabuladores y se le reducen los renglones en blanco de más (2026-08-11) |
| `auth.users` | `trigger_crear_perfil` | AFTER INSERT | Crea la fila en `perfiles` con el rol **menos privilegiado** (`domiciliario`) (2026-08-12) |
| `perfiles` | `trigger_proteger_perfil` | BEFORE UPDATE | Setea `updated_at` y **bloquea la escalada de privilegios**: solo un admin cambia `rol`/`activo`, y nadie puede dejar el sistema sin admin activo (2026-08-12) |
| `perfiles` | `trigger_proteger_ultimo_admin` | BEFORE DELETE | Impide borrar al último admin activo (2026-08-12) |
| `pedidos` | `trigger_validar_asignacion` | BEFORE INSERT **OR UPDATE OF `domiciliario_id`, `tipo_pedido`** | **Exige `es_admin()` para cambiar la asignación** (la RLS no puede: el mesero necesita UPDATE sobre `pedidos` y las políticas no limitan por columna). Además valida que el asignado tenga `rol='domiciliario'` y esté activo, y que el pedido sea `tipo_pedido='domicilio'`. No hace nada si la asignación no cambia, para no estorbar al mesero moviendo estados (2026-08-12) |
| `respuestas_rapidas` | `trigger_normalizar_respuesta_rapida` | BEFORE INSERT **OR UPDATE** | Mismo criterio que `normalizar_faq` aplicado a `atajo` (una línea) y `texto` (conserva saltos); setea `updated_at` (2026-08-12) |

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
| `consultar_faq` | `(p_filtro text=null, p_limite int=40)` | **Contexto dinámico del Agente Soporte** (2026-08-11). Devuelve las FAQ **activas** con `faq_id, pregunta, respuesta, orden, relevancia`. `p_filtro` (el mensaje del cliente) **solo reordena**, nunca filtra: a diferencia de `buscar_menu` —donde el cliente nombra el producto casi literal— aquí parafrasea ("¿puedo llevar mi perro?" vs *"¿Aceptan mascotas?"*, trigrama ≈ 0.05) y filtrar perdería la FAQ correcta. El emparejamiento semántico lo hace el LLM; la BD solo le entrega el conjunto acotado. Tope duro de 40 filas (`least(p_limite, 40)`). **STABLE · SECURITY INVOKER.** |
| `normalizar_faq` | `() → trigger` | Trigger de `faq` (ver §Triggers). |
| `normalizar_respuesta_rapida` | `() → trigger` | Trigger de `respuestas_rapidas` (ver §Triggers). |
| `mi_rol` | `() → text` | **Rol del usuario en curso.** NULL si no hay sesión, no tiene perfil o está inactivo. La usan todas las políticas por rol. **STABLE · SECURITY DEFINER** (obligatorio: leer `perfiles` desde las políticas de `perfiles` daría recursión). |
| `es_admin` | `() → boolean` | Azúcar sobre `mi_rol()`. **STABLE · SECURITY DEFINER.** |
| `puede_ver_pedido` / `puede_ver_cliente` | `(text) → boolean` | Visibilidad cruzada del domiciliario sobre `detalle_pedidos` y `clientes`. **STABLE · SECURITY DEFINER** para no encadenar la RLS de `pedidos` dentro de otra política. |
| `marcar_entregado` | `(p_pedido_id text) → pedidos` | **Única vía de escritura del rol domiciliario.** Valida rol, asignación y estado; el UPDATE lo hace saltando RLS. Existe porque **RLS no puede limitar columnas** (ver §Modelo de permisos). **SECURITY DEFINER.** |
| `validar_asignacion_domiciliario` | `() → trigger` | Trigger de `pedidos` (ver §Triggers). |
| `resumen_entregas` | `(p_domiciliario uuid, p_desde timestamptz=null, p_hasta timestamptz=null) → (entregas, total, efectivo, primera, ultima)` | Totales del historial de entregas. Existe porque la lista está paginada y sumar solo lo cargado daría una cifra que crece al hacer scroll. **STABLE · SECURITY INVOKER** — al revés que el resto de RPC de este esquema: así hereda la RLS de `pedidos` y la autorización sale gratis (un domiciliario que pase el id de otro recibe ceros, porque esas filas no existen para él). |
| `listar_usuarios` | `() → setof (usuario_id, nombre, email, rol, telefono, avatar_url, activo, ultimo_acceso, creado)` | Lista de usuarios para Configuración → Usuarios. Existe porque el email vive en `auth.users`, que PostgREST no expone; la alternativa era denormalizarlo en `perfiles` y que se desincronizara. **STABLE · SECURITY DEFINER** — autoriza ella misma (42501 si no eres admin). |
| `crear_perfil_nuevo_usuario` / `proteger_perfil` / `proteger_ultimo_admin` | `() → trigger` | Triggers de `auth.users` y `perfiles` (ver §Triggers). |
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

## Modelo de permisos (RLS) — estado REAL (verificado 2026-08-12)

**TODAS las tablas tienen RLS habilitado.** Desde 2026-08-12 las políticas son **por rol**
(`admin` / `mesero` / `domiciliario`), no un `auth_full_access` plano. El rol vive en
`perfiles.rol` y se lee desde las políticas con `public.mi_rol()`.

> **Por qué la RLS es la mitad del trabajo de los roles.** El JWT viaja en cada llamada REST y
> de realtime, así que el filtrado en React es solo presentación: sin estas políticas, un
> domiciliario con su sesión pide `GET /rest/v1/pedidos?select=*` y se lee el restaurante
> entero. Todo lo que un rol no debe ver se corta aquí; el front solo evita mostrar pantallas
> que llegarían vacías.

### Matriz de acceso por rol

| Tabla | admin | mesero | domiciliario |
|---|---|---|---|
| `pedidos` | todo | SELECT · INSERT · UPDATE | **SELECT solo los suyos** (`domiciliario_id = auth.uid()`) · **sin UPDATE** |
| `detalle_pedidos` | todo | SELECT · INSERT · UPDATE · DELETE | SELECT de sus pedidos |
| `clientes` | todo | SELECT · INSERT · UPDATE | SELECT solo de los clientes de sus pedidos |
| `menu` | todo | SELECT | SELECT |
| `info_negocio` | todo | SELECT | SELECT |
| `reservas` | todo | SELECT · INSERT · UPDATE | — |
| `motivos_reserva` · `faq` | todo | SELECT | — |
| `perfiles` | todo | solo el suyo | solo el suyo |
| `mensajes_soporte` · `feedback` · `feedback_pendiente` · `respuestas_rapidas` · `carritos` · `n8n_*` | todo | — | — |

**Reglas por COLUMNA — las que la RLS no puede expresar.** Tres capacidades no caben en la matriz
de arriba porque no son "qué filas" sino "qué columna de una fila que sí puedes tocar". Todas están
sostenidas por triggers, no por políticas:

| Regla | Quién puede | Dónde se sostiene |
|---|---|---|
| Cambiar `pedidos.domiciliario_id` | solo admin | `trigger_validar_asignacion` |
| Cambiar `perfiles.rol` / `perfiles.activo` | solo admin | `trigger_proteger_perfil` |
| Pasar un pedido a `entregado` | admin, mesero, y el domiciliario **asignado** | RPC `marcar_entregado` (el domiciliario no tiene política de UPDATE) |

`menu` conserva además `menu_lectura_publica` (SELECT para `public`): es la que usa el bot con la
key publicable. Consecuencia: el menú lo lee cualquiera con esa key, incluido un usuario
desactivado. No es una regresión — era así desde antes y el menú no es dato sensible.

### Las tres piezas que hacen que esto no se pueda burlar

1. **`public.mi_rol()`** — `STABLE SECURITY DEFINER`. Devuelve el rol del usuario en curso, o
   `NULL` si no hay sesión, no tiene perfil o está **inactivo**. `NULL` = sin acceso a nada: el
   modelo **falla cerrado**. Es `SECURITY DEFINER` por necesidad: leer `perfiles` desde las
   políticas *de* `perfiles` daría recursión infinita.

2. **`marcar_entregado(p_pedido_id)`** — la única vía de escritura del domiciliario.
   **RLS filtra FILAS, no COLUMNAS**: una política `for update using (domiciliario_id = auth.uid())`
   le habría permitido mandar `total = 0` o `estado_pago = 'confirmado'` en *su* fila, y la
   política lo habría autorizado porque efectivamente es suya. Por eso el domiciliario **no tiene
   política de UPDATE** y solo puede llamar este RPC, que valida asignación y estado.

3. **`trigger_proteger_perfil`** — mismo problema, otra tabla. Un usuario puede editar su perfil
   (nombre, teléfono, foto), y sin el trigger mandaría `rol='admin'` en ese mismo UPDATE. El
   trigger corta el cambio de `rol`/`activo` a quien no sea admin, y además impide dejar el
   restaurante **sin ningún admin activo** (degradando o borrando al último).

> **Ojo con `SECURITY DEFINER`.** Esas funciones saltan RLS, así que cada una tiene que autorizar
> por su cuenta. `editar_pedido` era `DEFINER` **sin ningún chequeo** — cualquier usuario
> autenticado podía reescribir los ítems de cualquier pedido llamándola por REST, y las políticas
> no la tocaban. Se le añadió el guard de rol y `set search_path = public` (2026-08-12). Al crear
> una función `DEFINER` nueva, asumir que la RLS **no** la protege.
>
> Todas usan el patrón `auth.uid() IS NULL → dejar pasar`: sin JWT es contexto de backend
> (service_role / n8n), donde no hay privilegio que escalar.

### Verificación (2026-08-12)

Probado con usuarios reales suplantados por API (`set local role authenticated` +
`request.jwt.claims`), sobre 105 pedidos / 196 líneas / 33 clientes:

| Prueba | Resultado |
|---|---|
| Domiciliario lee `pedidos` | **2 de 105** (solo asignados) |
| Domiciliario lee `clientes` | **2 de 33** · `detalle_pedidos` **3 de 196** |
| Domiciliario lee soporte / reseñas / reservas | **0** |
| Domiciliario `UPDATE pedidos SET total=1` en **su propio** pedido | **0 filas** |
| Domiciliario `UPDATE perfiles SET rol='admin'` sobre sí mismo | **error 42501** |
| Domiciliario llama `editar_pedido` | **error 42501** |
| Domiciliario llama `marcar_entregado` en pedido **ajeno** | **error 42501** |
| Domiciliario llama `marcar_entregado` en el **suyo** | ✅ `entregado` + `fecha_entrega` por trigger |
| Mesero | 105 pedidos, 33 clientes, 16 reservas · soporte/reseñas/rápidas **0** |
| Usuario **desactivado** | `mi_rol()` NULL · pedidos y clientes **0** |
| Admin | todo visible (sin regresión) |

Etapa 2 (asignación y entregas), mismo método:

| Prueba | Resultado |
|---|---|
| Admin asigna / desasigna domiciliario | ✅ 1 fila |
| Asignar a un usuario que **no** es domiciliario | **error 23514** |
| Asignar a un pedido `tipo_pedido='recoger'` | **error 23514** |
| **Mesero** asigna domiciliario (antes del fix) | ⚠️ **1 fila — hueco encontrado y cerrado** |
| Mesero asigna domiciliario (después) | **error 42501** |
| Mesero cambia estado de un pedido **ya asignado** | ✅ 1 fila (sin regresión) |
| Mesero marca entregado por RPC | ✅ `entregado` |
| Domiciliario lee su pedido con `clientes` embebido | ✅ nombre, dirección, ítems y total de **sus 2** pedidos |
| Domiciliario entrega el suyo | ✅ sale de su lista (queda solo el otro) |

Etapa 3 (perfiles y usuarios), mismo método:

| Prueba | Resultado |
|---|---|
| Domiciliario llama `listar_usuarios()` | **error 42501** |
| Domiciliario edita **su** nombre/teléfono/foto | ✅ 1 fila |
| Domiciliario edita el perfil de **otro** | **0 filas** |
| Sube avatar a **su** carpeta | ✅ |
| Sube avatar a la carpeta de **otro** | **error 42501** |
| Sube al bucket `comprobantes` | **error 42501** |
| Admin lista usuarios · cambia rol · desactiva | ✅ |
| Admin degrada al **último** admin activo | **error 23514** |
| Admin borra al **último** admin activo | **error 23514** |
| Domiciliario pide `resumen_entregas` **de otro** | **ceros** (0 entregas / $0) — la RLS vacía el agregado sin lanzar error |
| Domiciliario pide el **suyo** | ✅ 31 entregas · $3.673.300 · $2.077.300 en efectivo |

Además:
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

**Alta de usuarios del dashboard:** se crean a mano en **Dashboard → Authentication → Users →
Add user** (email + contraseña), con **Authentication → Providers → Email → "Allow new users to
sign up" = OFF** (no es registro público). La admin API de Supabase exige `service_role`, que
**no puede viajar en el bundle del navegador** — mismo motivo que el token de WhatsApp — así que
el dashboard no crea usuarios, solo les asigna rol y perfil. Si algún día se quiere invitar desde
la UI, va por Edge Function o n8n, nunca desde React.

El trigger `trigger_crear_perfil` (en `auth.users`) le da perfil automático al usuario nuevo con
el rol **menos privilegiado** (`domiciliario`); un admin lo sube después.

> ⚠️ **Gotcha si alguna vez creas un usuario con `INSERT` directo** (p. ej. para pruebas): las
> columnas de tokens de `auth.users` (`confirmation_token`, `recovery_token`, `email_change`,
> `email_change_token_new`, `email_change_token_current`, `phone_change`, `phone_change_token`,
> `reauthentication_token`) quedan en **NULL**, y GoTrue —escrito en Go— las lee como `string`:
> el login revienta con *"converting NULL to string is unsupported"*, que la UI muestra como
> credenciales inválidas. Hay que insertarlas como **cadena vacía**. Los usuarios creados desde
> el panel de Supabase no tienen el problema. Además hace falta la fila correspondiente en
> `auth.identities` (`provider='email'`, `identity_data` con `sub` y `email`). Los dos usuarios que ya
existían al migrar quedaron como `admin` por backfill, para no perder el acceso al cerrar el
`using(true)`.

> Nota: el script `infra/supabase/rls_reference.sql` que servía de referencia de este modelo se
> eliminó del repo (2026-07-22) — el estado se verifica en vivo vía MCP de Supabase, y replicar
> el setup a nuevos clientes se hará igualmente vía MCP.

---

## Storage

| Bucket | Público | Límites | Escritura |
|---|---|---|---|
| `comprobantes` | sí (SELECT `public`) | — | INSERT para `anon` — la usa el bot al guardar comprobantes de transferencia |
| `avatares` | sí (SELECT `public`) | **2 MB** · `image/jpeg`, `image/png`, `image/webp` | INSERT/UPDATE/DELETE solo sobre **la propia carpeta**, o admin |

`avatares` se creó con la migración `roles_etapa3_bucket_avatares` (2026-08-12). **Bucket propio y
no reutilizar `comprobantes`:** ese tiene una política de INSERT para `anon`, y meter ahí los
avatares les daría esa misma puerta.

> **La carpeta ES el permiso.** La ruta es `<usuario_id>/<timestamp>.<ext>` y las políticas
> comparan `(storage.foldername(name))[1]` contra `auth.uid()`. Cambiar esa convención en
> `src/lib/avatares.js` no rompe el orden de los archivos: rompe la seguridad.
>
> El `timestamp` en el nombre evita el caché — reusar `<uid>/avatar.jpg` deja al navegador y al
> CDN sirviendo la foto vieja tras cambiarla.

> **El tamaño y el tipo los valida el servidor** (`file_size_limit` y `allowed_mime_types` del
> bucket). El formulario valida lo mismo antes de subir, pero eso es cortesía: quien llame a la
> Storage API directo choca igual contra estos límites.

## Realtime

Publicación `supabase_realtime` — emite INSERT/UPDATE/DELETE de:
**`pedidos`, `detalle_pedidos`, `mensajes_soporte`, `reservas`, `clientes`, `menu`, `feedback`, `perfiles`**
(`clientes` se agregó al resolver BUG-014, verificado vía MCP 2026-07-17; `menu` se agregó
con la migración `menu_add_to_realtime_publication` al crear la tab Menú del dashboard,
2026-07-22; `feedback` con `feedback_add_to_realtime_publication` al crear la tab Reseñas,
2026-07-23; `perfiles` con `roles_etapa1_perfiles_realtime` para que degradar o desactivar a un
usuario se aplique sin recargar, 2026-08-12).

> El realtime respeta RLS solo si el socket lleva el JWT (`supabase.realtime.setAuth`, BUG-023).
> Con las políticas por rol eso pasa a importar el doble: sin el token, un domiciliario recibiría
> eventos de `pedidos` que no puede leer por REST.
