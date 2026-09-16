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
| `barrio` | text | nullable · barrio habitual, **texto libre** (2026-08-18) · se resuelve contra `barrios` recién al crear el pedido, igual que cuando lo dicta el cliente por WhatsApp. El bot lo confirma en vez de repreguntarlo |
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
| `barrio` | text | nullable · **desnormalizado a propósito** (2026-08-18): guarda el nombre del catálogo si hubo match, o el texto crudo del cliente si no. Sin FK, para que el domiciliario lo siga leyendo aunque el admin renombre o borre el barrio |
| `zona` | text | nullable · FK → `zonas_entrega(clave)` **ON UPDATE CASCADE / ON DELETE SET NULL** · **NULL = barrio sin mapear**, se cobró la tarifa base. Es la columna por la que el dashboard lista "barrios sin zona" |
| `costo_domicilio` | numeric | default 0 · **check ≥ 0** · costo del envío **congelado** al crear el pedido. Subirle la tarifa a una zona NO altera pedidos ya hechos |
| `fecha_pedido` | timestamp (sin tz) | default `now()` — parsear con `parseDb()` |
| `estado` | text | check: `pendiente`/`en_cocina`/`en_camino`/`recoger`/`entregado`/`cancelado` |
| `metodo_pago` | text | `'Efectivo'`/`'Transferencia'` (capitalizado) |
| `estado_pago` | text | check: `pendiente`/`confirmado`/`rechazado` |
| `comprobante_url` | text | nullable |
| `total` | numeric | default 0 · **lo calcula un trigger** (ver abajo) · = suma de ítems **+ `costo_domicilio`** |
| `tiempo_estimado` / `repartidor` / `notas` / `motivo_rechazo` | text | nullable · ⚠️ `repartidor` está **muerta**: NULL en los 105 pedidos, solo se lee en `OrderDetailModal`. La sustituye `domiciliario_id` |
| `domiciliario_id` | uuid | nullable · FK → `perfiles(usuario_id)` **ON DELETE SET NULL** · la escribe **solo un admin** · es la columna sobre la que filtra la RLS del rol domiciliario (2026-08-12) |
| `fecha_entrega` | timestamptz | nullable · la fija un trigger al pasar a `entregado` |
| `feedback_solicitado` | boolean | default `false` (lo usa el job de feedback) |

**Índice único anti doble-confirmación:** `unique_pedido_cliente_minuto` sobre
`(telefono, date_trunc('minute', fecha_pedido))` — **un pedido por teléfono y por minuto**. Es lo
que impide que un cliente impaciente que dice "confirmo" dos veces, o un reintento del webhook de
Meta (edge-case §8), acabe con dos pedidos idénticos. Un segundo INSERT en el mismo minuto revienta
con **23505**, así que quien inserte pedidos en lote (seeds, pruebas) tiene que separarlos en el
tiempo. Verificado el 2026-09-09 con `qa/sql/07-housekeeping.sql` T7.

### `detalle_pedidos` — líneas de pedido (16 filas · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `detalle_id` 🔑 | text | `DET-` + secuencia |
| `pedido_id` | text | FK → pedidos · **ON DELETE CASCADE** |
| `producto_id` | text | FK → menu (**debe existir**) |
| `nombre_producto` | text | copiado del menú |
| `variante` | text | default `'Estándar'` |
| `cantidad` | integer | default 1 · **CHECK `> 0`** (`detalle_pedidos_cantidad_chk`, BUG-048) |
| `precio_unitario` | numeric | **copiado del menú al crear** (no cambia con el menú) · **CHECK `>= 0` y `<> 'NaN'`** (`detalle_pedidos_precio_chk`, BUG-048: antes `editar_pedido` dejaba totales negativos) |
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

> **La PK es el teléfono**, así que un cliente solo puede tener **un** carrito. Cualquier escritura
> del bot que cree carrito tiene que ser un **upsert**, nunca un INSERT plano: si la fila ya existe
> PostgREST devuelve conflicto y el nodo de n8n falla en silencio (BUG-032). El header correcto es
> `Prefer: resolution=merge-duplicates,return=representation`.

**Estado del flujo de pedido (2026-09-01):** la tabla lleva además `tipo_pedido`
(`domicilio`/`recoger`), `barrio`, `direccion_entrega`, `metodo_pago`
(`Efectivo`/`Transferencia`), `costo_domicilio`, `cobertura_ok`, `notas` y `paso_flujo`
(`armando`/`datos`/`resumen`/`confirmado`). **No son datos del carrito, son del flujo**, y
viven aquí porque en la memoria del chat se perdían: los 5 agentes comparten una Postgres
Chat Memory con `contextWindowLength = 10` en la que, por cada turno, caen el mensaje del
cliente **dos veces** (memoria del orquestador + la del agente), el JSON de clasificación
del orquestador y cada `tool_call` con su resultado — medido sobre una sesión real, **~6
filas por turno**, o sea una ventana útil de **3 a 5 turnos**. Un *"hola, para pedir una
pizza a domicilio"* ya salió de la ventana cuando el carrito está armado, así que el Agente
Pedidos no podía verlo y lo repreguntaba. Los ítems sobrevivían porque vivían en esta tabla;
desde ahora el resto del pedido también.

CHECK de dominio: `carritos_tipo_pedido_chk`, `carritos_metodo_pago_chk`, `carritos_paso_flujo_chk`,
`carritos_domicilio_coherente_chk` y, desde 2026-09-15, `carritos_costo_domicilio_chk`
(`NULL` o `>= 0` y `<> 'NaN'`, BUG-047b).

Se escriben **solo** vía `guardar_datos_pedido()` y se leen vía la vista `estado_pedido`.
El upsert de `crear_carrito` (que solo manda `telefono, items, total`) **no** los pisa —
verificado. `limpiar_carritos_abandonados()` borra la fila entera a las 24 h, así que el
estado caduca solo; y `Sub — Crear_orden_completa` cierra borrando la fila del carrito, así
que al registrarse el pedido el estado muere con ella.

#### Vista `estado_pedido` — lo que el Agente Pedidos lee en cada turno

`SELECT` sobre `carritos` que agrega `n_items`, **`faltantes`** (jsonb array) y
`listo_para_resumen` (bool). `faltantes` lista, en orden de pregunta, lo que todavía hace
falta: `carrito` → `tipo_pedido` → `barrio` → `cobertura` → `direccion_entrega` →
`metodo_pago`. **Qué preguntar lo decide la BD, no el LLM**: el prompt pasa de *"SIEMPRE
PREGUNTA tipo de pedido"* —la instrucción que causaba la repregunta— a *"pregunta solo lo
que venga en `faltantes`"*. Declarada `security_invoker = true`, así que respeta la RLS de
`carritos` en vez de saltársela.

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

### `zonas_entrega` — zonas de cobertura y su tarifa (1 fila · PK `clave` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `clave` 🔑 | text | slug interno; lo que se guarda en `pedidos.zona` |
| `nombre` | text | lo que se nombra al cliente (`Zona Centro`) |
| `descripcion` | text | nullable · nota interna |
| `costo` | numeric | **check ≥ 0** · tarifa del envío para **todos** los barrios de la zona |
| `tiempo_estimado` | text | nullable · si está, gana sobre `info_negocio.tiempo_entrega_delivery` |
| `es_base` | boolean | default `false` · **zona comodín**: la que se cobra cuando el barrio no está mapeado |
| `activo` | boolean | default `true` · zona inactiva → sus barrios pasan a cobrar la tarifa base |
| `orden` | integer | orden de presentación |

### `barrios` — barrios cubiertos, agrupados por zona (59 filas · PK `clave` · RLS ✅)
| Columna | Tipo | Notas |
|---|---|---|
| `clave` 🔑 | text | **la deriva el trigger** desde `nombre` con `normalizar_barrio()` — es el punto de match contra lo que escribe el cliente |
| `nombre` | text | como se muestra (`La América`) |
| `zona` | text | FK → `zonas_entrega(clave)` **ON UPDATE CASCADE** · borrar una zona con barrios **falla** (hay que moverlos) |
| `activo` | boolean | default `true` |

Índices: `barrios_zona_idx` y `barrios_clave_trgm` (GIN trgm, para el match difuso).

Semilla: **una sola** fila en `zonas_entrega`, `base` = *Tarifa base* a **$5.000** — exactamente lo
que el trigger cobraba quemado, para que el sistema se comporte igual que antes hasta que el
restaurante cargue sus barrios. `barrios` arrancó vacía a propósito: sembrar barrios sería
inventar la cobertura real del negocio. **Ya no lo está**: el restaurante cargó los 58 barrios
de Bello en 5 zonas (2026-08-18), más `centro` → zona *Centro* (2026-08-25, BUG-033: nadie lo
había cargado y «estoy en el centro» caía en el no-match).

> **La tarifa NUNCA la escribe quien inserta**, misma convención que `motivos_reserva`. Ni el LLM
> ni el JS mandan `costo_domicilio`: mandan el **barrio en texto crudo** y
> `trigger_tarifa_domicilio` lo resuelve y copia el precio. Lo que queda en `pedidos` es una
> **foto**. Fuente única para las dos capas: el bot la lee con la tool `consultar_cobertura` y el
> dashboard con `useDeliveryZones` / `useBarrioOptions`.
>
> **Un barrio sin mapear es FUERA DE COBERTURA para el bot** (2026-08-25, BUG-033). Hasta esa
> fecha se cobraba la tarifa base y se aceptaba el pedido «para no perder la venta mientras el
> restaurante carga barrios»; con los 58 barrios ya cargados, esa salvedad dejó de proteger una
> venta y pasó a prometer domicilios a Envigado, Sabaneta y Apartadó. Hoy `consultar_cobertura`
> devuelve `cubierto:false` **sin `costo_domicilio` y sin `tiempo_estimado`**, y los agentes
> tienen prohibido prometer el envío.
>
> El **trigger** `trigger_tarifa_domicilio` sigue aplicando la tarifa base a un barrio sin
> mapear: es la red de seguridad de los pedidos creados a mano desde el dashboard (un admin
> puede escribir un barrio que aún no está en el catálogo) y evita que ese caso cobre **$0**.
> Por eso la zona base sigue protegida contra borrado y desactivación (`proteger_zona_base`).
> `pedidos.zona` NULL sigue siendo la marca de «barrio sin mapear».

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

### `feedback_pendiente` — cola de espera de feedback (PK `telefono` · RLS ✅)
`telefono` 🔑, `pedido_id`, `cliente_id`, `estado` (check `esperando_nota`/`esperando_comentario`),
`fecha_solicitud` (default `now()`).

> **Desde 2026-09-16 (BUG-057/058/059) esta tabla solo la escriben dos RPCs:**
> `solicitar_feedback_lote` (encola) y `procesar_respuesta_feedback` (avanza/cierra), más el cron
> de expiración. La máquina de estados vivía en ~20 nodos de n8n sin transacción y cada paso podía
> fallar en silencio; el resultado fue un cliente atrapado en `esperando_feedback` con la cola viva
> y un pedido ya calificado. **Invariante:** nunca `modo = 'bot'` con fila en la cola, ni
> `esperando_feedback` sin ella (probado por `qa/sql/10-resenas.sql` T15).
>
> ⚠️ `feedback.fecha` es `timestamp` sin zona y guarda **UTC**. Lo escribe la RPC con
> `now() at time zone 'utc'`; n8n escribía `$now.toISO()` en el huso de su instancia (UTC+2) y
> dejaba las notas 2 h en el futuro (BUG-060).

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
- `operacion`: `metodos_pago`, `datos_transferencia`, `tiempo_entrega_delivery`,
  `politica_cancelacion`

> **`zona_delivery` y `costo_delivery` se eliminaron el 2026-08-18.** Eran texto libre que el bot
> solo podía recitar y que no entraba en ningún cálculo (`costo_delivery` estaba **vacío**, y
> `zona_delivery` decía *"Solo dentro del municipio Bello y Copaa, TEN PRESENTE ZONA AMAZONIA"*).
> Los reemplazan `zonas_entrega` + `barrios`. Se borraron en vez de dejarse por compatibilidad
> porque `info_local` hace `getAll` sin filtro: mientras existieran, el Agente Soporte los leería
> y podría **contradecir la tarifa real** que cobra el Agente Pedidos.

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
| `detalle_pedidos` | `trigger_actualizar_total` | **AFTER INSERT OR UPDATE OR DELETE** | `pedidos.total` = `SUM(precio_unitario*cantidad)` **+ `pedidos.costo_domicilio`** (2026-08-18: antes sumaba $5.000 quemados y solo disparaba en INSERT) |
| `pedidos` | `trigger_tarifa_domicilio` | BEFORE INSERT **OR UPDATE OF `tipo_pedido`, `barrio`, `costo_domicilio`** | **Resuelve el barrio y congela la tarifa** (2026-08-18): `barrio` → `resolver_barrio()` → fija `barrio` (nombre canónico), `zona` y `costo_domicilio`. Sin match → tarifa base y `zona` NULL, conservando el texto crudo. `recoger` → los tres a NULL/0. En UPDATE ajusta `total` **por delta** (`−OLD.costo +NEW.costo`), nunca recalculando desde cero. Si solo cambió `costo_domicilio` respeta el override manual (promo / envío gratis) |
| `carritos` | `trg_carritos_normalizar_estado` | BEFORE INSERT **OR UPDATE** | **Canoniza y mantiene coherente el estado del flujo** (2026-09-01). `''` → NULL; `tipo_pedido` → `domicilio`/`recoger` (*"para llevar"* es **recoger**, no domicilio); `metodo_pago` → `Efectivo`/`Transferencia` (solo casing: la jerga la resuelve el extractor de señales, no la BD). Pasar a `recoger` **borra** `barrio`, `direccion_entrega`, `costo_domicilio` y `cobertura_ok`. Cambiar de `barrio` **sin recotizar en el mismo UPDATE** invalida `costo_domicilio` y `cobertura_ok`, para que no se cobre la tarifa del barrio anterior. **Desde 2026-09-15 (BUG-042)** "recotizó" no se infiere de que el precio cambie —la tarifa es por zona, y entre barrios de la misma zona recotizar da el mismo número—: si `cobertura_ok` es true y el costo coincide con la tarifa real del barrio nuevo (`resolver_barrio`), se respeta; un precio viejo de otra zona se sigue invalidando. Carrito vacío → `paso_flujo` vuelve a `armando` |
| `zonas_entrega` | `trigger_proteger_zona_base` | BEFORE UPDATE OR DELETE | Impide borrar o desactivar la zona `es_base`, y quitarle la marca sin pasársela a otra. Sin zona base, un barrio no mapeado se cobraría a $0 (2026-08-18) |
| `barrios` | `trigger_normalizar_barrio` | BEFORE INSERT **OR UPDATE** | `clave` = `normalizar_barrio(nombre)` y `updated_at = now()`. La clave nunca la manda el cliente de la API: se deriva, para que la normalización viva en un solo sitio (2026-08-18) |
| `pedidos` | `trigger_fecha_entrega` | BEFORE UPDATE | Fija `fecha_entrega = now()` al pasar a `estado='entregado'` |
| `pedidos` | `notificar-estado-pedido` | AFTER UPDATE | `http_request` (pg_net) — notifica el cambio de estado (webhook) |
| `reservas` | `trigger_validar_cupo` | BEFORE INSERT **OR UPDATE OF `fecha`, `hora`, `estado`** | Si hay 8 reservas solapadas (90 min) `confirmada` ese día → `RAISE EXCEPTION` (HINT `cupo_agotado`). Hasta 2026-09-15 solo corría en INSERT y reactivar una cancelada o mover una reserva a una franja llena sobrevendía el salón (BUG-043). Excluye la propia fila, así que renombrar o cancelar en una franja llena sigue funcionando |
| `reservas` | `trigger_costo_motivo` | BEFORE INSERT **OR UPDATE OF `motivo`** | `costo_motivo` = `motivos_reserva.costo` de la clave en `motivo`; `motivo` vacío/NULL → costo 0 (2026-08-10) |
| `clientes` | `trigger_contexto_handoff` | AFTER UPDATE OF `modo` · **WHEN `modo` pasa a `'humano'`** | Llama `registrar_contexto_handoff()` y deja una nota `sistema` — el operador abre la conversación con el contexto ya cargado (2026-08-10) |
| `faq` | `trigger_normalizar_faq` | BEFORE INSERT **OR UPDATE** | Normaliza el texto y setea `updated_at`: `pregunta` colapsa a una sola línea; `respuesta` pierde CR y tabuladores y se le reducen los renglones en blanco de más (2026-08-11) |
| `auth.users` | `trigger_crear_perfil` | AFTER INSERT | Crea la fila en `perfiles` con el rol **menos privilegiado** (`domiciliario`) (2026-08-12) |
| `perfiles` | `trigger_proteger_perfil` | BEFORE UPDATE | Setea `updated_at` y **bloquea la escalada de privilegios**: solo un admin cambia `rol`/`activo`, y nadie puede dejar el sistema sin admin activo (2026-08-12) |
| `perfiles` | `trigger_proteger_ultimo_admin` | BEFORE DELETE | Impide borrar al último admin activo (2026-08-12) |
| `pedidos` | `trigger_validar_asignacion` | BEFORE INSERT **OR UPDATE OF `domiciliario_id`, `tipo_pedido`** | **Exige `es_admin()` para cambiar la asignación** (la RLS no puede: el mesero necesita UPDATE sobre `pedidos` y las políticas no limitan por columna). Además valida que el asignado tenga `rol='domiciliario'` y esté activo, y que el pedido sea `tipo_pedido='domicilio'`. No hace nada si la asignación no cambia, para no estorbar al mesero moviendo estados (2026-08-12) |
| `respuestas_rapidas` | `trigger_normalizar_respuesta_rapida` | BEFORE INSERT **OR UPDATE** | Mismo criterio que `normalizar_faq` aplicado a `atajo` (una línea) y `texto` (conserva saltos); setea `updated_at` (2026-08-12) |
| `carritos` | `trg_carritos_touch_updated_at` | BEFORE UPDATE | `updated_at = now()` en cada UPDATE. Antes solo se escribía en el INSERT (default `now()`) y nadie lo refrescaba, así que `limpiar_carritos_abandonados()` medía las 24h **desde que se creó** el carrito y no desde la última actividad — podía borrar un carrito vivo a mitad de conversación (BUG-032, 2026-08-21) |

> **El total lo calcula el trigger, nunca el JS ni el LLM.** El costo del envío tampoco: sale de
> `pedidos.costo_domicilio`, que llena `trigger_tarifa_domicilio` desde la zona del barrio.

```sql
-- actualizar_total_pedido() (AFTER INSERT/UPDATE/DELETE en detalle_pedidos)
-- v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id);
UPDATE pedidos p SET total = (
  SELECT COALESCE(SUM(d.precio_unitario * d.cantidad), 0)
  FROM detalle_pedidos d WHERE d.pedido_id = v_pedido_id
) + p.costo_domicilio
WHERE p.pedido_id = v_pedido_id;
```

> ⚠️ **Bug histórico arreglado el 2026-08-18.** La versión vieja usaba `NEW.pedido_id` también en
> DELETE, donde `NEW` es un registro nulo → el `WHERE` quedaba `pedido_id = NULL` y **borrar un
> ítem nunca recalculaba el total**. Estaba enmascarado porque `editar_pedido` reinserta y
> sobrescribe el total a mano. Verificado en producción antes del fix: al borrar un ítem de
> `PED-102` el total se quedaba clavado en $332.300. Ver `docs/shared/edge-cases.md`.

---

## Funciones / RPCs

| Función | Firma | Qué hace |
|---|---|---|
| `buscar_menu` | `(termino text, umbral float=0.2, limite int=5, solo_disponibles bool=true)` | **Búsqueda difusa** del menú: `normalizar_texto` (unaccent+lower) + diccionario de typos (`papata→patata`, `servex→cervez`, `hamurguesa→hamburguesa`, `birra→cerveza`…) + 3 capas de score (containment / `similarity` full-string / word-level trgm) **sobre `nombre`, `categoria` (peso 0.8) y `descripcion` (peso 0.7)** — extendida 2026-07-22 (migración `bug006_buscar_menu_categoria_descripcion`; antes solo `nombre`). **Devuelve `descripcion` y `similitud` (0–1)**. **Reescrita 2026-09-15 (BUG-039/045a/046):** la capa palabra-a-palabra ya no es `GREATEST` de cualquier palabra (bastaba un "de" compartido para dar 1.000) sino **cobertura**: para cada palabra útil de la búsqueda su mejor parecido en nombre/categoría/descripción, promediado sobre **todas** las palabras y elevado al cuadrado. Stopwords (artículos, "quiero", "dame", tamaños) fuera; palabras en singular. La contención es por palabra completa con `strpos` (el texto nunca es patrón LIKE). Orden: nombre exacto → similitud → nombre más corto. Término sin letras ni dígitos (`''`, `%`, `_`) → **0 filas**. `limite` acotado a 1–200. **Consecuencia para el prompt:** que un producto comparta *una* palabra con la búsqueda ya no lo sube a la banda ≥0.5 ("agregar sin confirmar"): `arepa de pollo` vs *Pollo Champiñon* = 0.25. **STABLE.** |
| `buscar_menu_categoria` | `(cat text, solo_disponibles bool=true)` | Lista productos de una categoría. Alias de plurales (`pizzas`, `postres`→`pizza_dulce`…). **Desde 2026-09-15 (BUG-041/045b):** si la categoría existe tal cual devuelve **solo esa** (antes `pizza_premium` arrastraba `pizza_premium_especial`); si no, cada palabra pedida debe empezar una palabra de la categoría (`pizza` → las cinco `pizza_*`). Vacío/`%`/null → 0 filas. **STABLE.** |
| `cotizar_mitad_y_mitad` | `(p_producto_a text, p_producto_b text, p_tamano text) → jsonb` | **Cotizador de pizza mitad y mitad** (2026-08-10). Valida: los dos productos existen y están disponibles, misma **masa** (`menu.variante`), categoría de pizza salada (`pizza_tradicional/especial/premium/premium_especial`), sabores distintos y tamaño en `pequena/mediana/grande/familiar` (**porción excluida**). Cobra el precio de la **mitad más cara**. Devuelve `{ok:true, producto_id, nombre_producto, variante, masa, precio_unitario, mitades, explicacion}` o `{ok:false, error, message}` (`MASA_DISTINTA`, `TAMANO_NO_PERMITIDO`, `CATEGORIA_NO_PERMITIDA`, `PRODUCTO_AGOTADO`, `MITADES_IGUALES`, `TAMANO_NO_DISPONIBLE`…). La usan **el bot** (tool `armar_mitad_y_mitad`) y **el dashboard** (`MenuPicker`) — misma regla, una sola fuente. |
| `editar_pedido` | `(p_pedido_id text, p_items jsonb) → jsonb` | **SECURITY DEFINER**. Solo si `estado='pendiente'` (bloqueo `FOR UPDATE`); borra e reinserta items, **preserva el recargo de domicilio** — desde 2026-08-18 lo **lee de `pedidos.costo_domicilio`** en vez de despejarlo restando (`total − suma de ítems`), que con tarifa variable daba un número distinto por zona —, recalcula total. Lo usa el dashboard. Retorna `{ success, ... }`. Desde 2026-08-10 (migración `editar_pedido_arrastra_mitades_y_notas_item`) también arrastra **`mitades` y `notas_item`** — antes los perdía al reinsertar. **Desde 2026-09-15 (BUG-047c/048)** valida **antes del DELETE**: `p_items` no-array → `ITEMS_INVALIDOS`; cada ítem debe ser objeto, con `producto_id` existente en `menu`, `cantidad` entera ≥1 y `precio_unitario` numérico ≥0 → si no, `{success:false, error:'ITEM_INVALIDO', message:'Item N: …', posicion}` con el pedido intacto; `detalle_id` repetido también. Sin `nombre_producto` toma el del menú. |
| `consultar_cobertura` | `(p_barrio text=null) → jsonb` | **Tool de zonas de domicilio** (2026-08-18). Sin argumento devuelve `{modo:'listado', tarifa_base, zonas:[{nombre,costo,tiempo_estimado,barrios[]}]}` (la zona base se excluye del listado: no es cobertura, es red de seguridad). Con un barrio devuelve `{modo:'barrio', cubierto, barrio, zona, costo_domicilio, tiempo_estimado, coincidencia_exacta}`. **`cubierto:false` = FUERA DE COBERTURA** (2026-08-25, BUG-033): devuelve `costo_domicilio` y `tiempo_estimado` en **NULL a propósito** —sin número que cantar, el agente no puede prometer un domicilio que no existe— más `mensaje` (instrucción explícita) y `sugerencias` (hasta 3 barrios con `similarity ≥ 0.40`, para erratas que el matcher no alcanzó: `niqia` → `["Niquía"]`; el umbral es alto a propósito para que `sabaneta` **no** sugiera `Sabanalarga`). **Desde 2026-09-15 (BUG-040)**, si trigram no sugiere nada, segunda pasada por **anagrama** (transposición) o **una letra de menos/de más** — `pardo`→Prado, `prdo`→Prado; medido 295/295 erratas, 0 sugerencias para municipios de fuera. El eco del texto del cliente en `barrio` y `mensaje` va acotado a **60 chars** (BUG-054). El modo listado agrega `municipio: "Bello"` y `cobertura`. La usan el Agente Pedidos y el Agente Soporte. **STABLE · SECURITY DEFINER** con el patrón `auth.uid() IS NULL → n8n`. |
| `guardar_datos_pedido` | `(p_telefono text, p_tipo_pedido, p_barrio, p_direccion_entrega, p_metodo_pago text, p_costo_domicilio numeric, p_cobertura_ok boolean, p_notas, p_paso_flujo text) → jsonb` | **Persiste el estado del flujo de pedido** (2026-09-01) en `carritos`, para que deje de depender de la ventana de memoria del chat (ver §`carritos`). Semántica **COALESCE por campo**: solo pisa lo que le mandan, así el agente guarda un dato suelto (*"domicilio"*) sin borrar los demás. Hace **UPSERT** porque el cliente suele decir *"a domicilio"* en el saludo, antes de que exista carrito: la fila nace con `items []`, que el Agente Pedidos ya trata como carrito vacío. Si no le mandan **ningún** dato solo lee (no crea una fila de carrito vacía por cada cliente que salude, porque el orquestador la llama en cada mensaje). Devuelve `{ok, guardo, estado}` con el estado **guardado** (no el pedido) más `faltantes` — el agente tiene prohibido anunciar lo que la tool no confirmó (lección de BUG-032). **Desde 2026-09-15 (BUG-047a)** un valor fuera de dominio ya no escapa como SQLSTATE: devuelve `{ok:false, error:'TIPO_PEDIDO_INVALIDO' | 'METODO_PAGO_INVALIDO' | 'PASO_FLUJO_INVALIDO' | 'COSTO_DOMICILIO_INVALIDO', valores_validos}` sin escribir nada (p. ej. `'nequi'`). **SECURITY DEFINER** con el patrón `auth.uid() IS NULL → n8n`. |
| `resolver_barrio` | `(p_texto text) → TABLE(clave, nombre, zona, zona_nombre, costo, tiempo_estimado, exacto)` | Match tolerante entre lo que escribe el cliente y el catálogo: **exacto → subcadena → similitud trgm ≥ 0.45**. La subcadena exige `length(clave) >= 4` para que un barrio de 3 letras no se trague media ciudad. Devuelve 0 o 1 fila. **STABLE.** |
| `normalizar_barrio` | `(text) → text` | Clave canónica de un barrio: minúsculas, sin tildes, sin puntuación y **sin el prefijo `barrio`** ("barrio El Centro" y "el centro" colapsan igual). **IMMUTABLE** a propósito (se indexa) — por eso no usa `unaccent()`, que es STABLE. |
| `tarifa_base` | `() → numeric` | Costo de la zona `es_base`. **STABLE.** |
| `generar_reserva_id` | `() → text` | Default de `reservas.reserva_id`. |
| `historial_resumen` | `(p_from, p_to timestamp, p_estado, p_tipo, p_search, p_search_digits text, p_cliente_ids text[]) → jsonb` | Agregados del historial (total/entregados/cancelados/ingresos sin cancelados) con los mismos filtros que la lista paginada de la tab Historial. **SECURITY INVOKER** (respeta RLS: sin sesión cuenta 0). Migración `historial_resumen_rpc_e_indice_fecha` (2026-07-23), que también creó el índice `idx_pedidos_fecha_pedido`. **Desde 2026-09-15 (BUG-045c)** escapa `\ % _` en `p_search`/`p_search_digits` y trata la búsqueda en blanco como sin filtro; `useOrderHistory` quita los mismos caracteres para que lista y contador coincidan. |
| `normalizar_texto` | `(text) → text` | unaccent + lower (base de `buscar_menu`). |
| `registrar_contexto_handoff` | `(p_telefono text, p_limite int=40) → integer` | **Contexto al escalar a humano** (2026-08-10). Vuelca la conversación reciente del bot desde `n8n_chat_histories` a `mensajes_soporte` (`human`→`cliente`, `ai`→`bot`). Descarta ruido: mensajes `tool`, `content` no-string (llamadas a tools) y el JSON de clasificación del ORQUESTADOR (`~ '"agente"\s*:'`). Deduplica turnos **consecutivos** repetidos (la memoria es compartida: el mismo mensaje se guarda una vez por cadena que corre). Desempata el orden con microsegundos sobre el `id` de la memoria, porque varios turnos comparten `created_at` y el dashboard ordena por esa columna. **Idempotente por corte temporal:** solo copia lo posterior al último `mensajes_soporte` de ese teléfono, así re-escalar no duplica. Devuelve cuántos mensajes recuperó. `p_limite` acotado a 1–500 (BUG-046: un negativo reventaba). **SECURITY DEFINER**. **Desde 2026-09-01 lee las dos sesiones** (`session_id IN (telefono, 'orq:'||telefono)`): el ORQUESTADOR pasa a tener `sessionKey` propio para dejar de duplicar el turno del cliente y de meter su JSON en la ventana de los agentes, y esta función funcionaba **justamente porque** el orquestador escribía ese turno antes de que el Agente Soporte llamara `solicitar_handoff`. Leer ambas es compatible hacia atrás: mientras el orquestador siga en la sesión vieja, `orq:<tel>` no existe y el resultado es idéntico. |
| `expirar_pedidos_pendientes` | `() → integer` | **BUG-028** (2026-08-10). Cancela los pedidos que quedaron `pendiente` de **días de negocio anteriores** (Colombia UTC-5) con `motivo_rechazo = 'no alcanzamos a procesarlo antes del cierre del día'` — redactado para encajar en la plantilla de n8n. **No toca `en_cocina`/`en_camino`**: esos ya los aceptó la cocina y lo más probable es que se entregaran sin marcarse; los cierra el operador desde Historial. Devuelve cuántos cerró. **SECURITY DEFINER**. |
| `consultar_faq` | `(p_filtro text=null, p_limite int=40)` | **Contexto dinámico del Agente Soporte** (2026-08-11). Devuelve las FAQ **activas** con `faq_id, pregunta, respuesta, orden, relevancia`. `p_filtro` (el mensaje del cliente) **solo reordena**, nunca filtra: a diferencia de `buscar_menu` —donde el cliente nombra el producto casi literal— aquí parafrasea ("¿puedo llevar mi perro?" vs *"¿Aceptan mascotas?"*, trigrama ≈ 0.05) y filtrar perdería la FAQ correcta. El emparejamiento semántico lo hace el LLM; la BD solo le entrega el conjunto acotado. Tope duro de 40 filas (`least(p_limite, 40)`). **STABLE · SECURITY INVOKER.** |
| `normalizar_faq` | `() → trigger` | Trigger de `faq` (ver §Triggers). |
| `normalizar_respuesta_rapida` | `() → trigger` | Trigger de `respuestas_rapidas` (ver §Triggers). |
| `mi_rol` | `() → text` | **Rol del usuario en curso.** NULL si no hay sesión, no tiene perfil o está inactivo. La usan todas las políticas por rol. **STABLE · SECURITY DEFINER** (obligatorio: leer `perfiles` desde las políticas de `perfiles` daría recursión). |
| `es_admin` | `() → boolean` | Azúcar sobre `mi_rol()`. **STABLE · SECURITY DEFINER.** |
| `puede_ver_pedido` / `puede_ver_cliente` | `(text) → boolean` | Visibilidad cruzada del domiciliario sobre `detalle_pedidos` y `clientes`. **STABLE · SECURITY DEFINER** para no encadenar la RLS de `pedidos` dentro de otra política. |
| `solicitar_feedback_lote` | `(p_limite int=5) → table(pedido_id, cliente_id, telefono, nombre)` | **Lado "preguntar" del feedback** (2026-09-16, BUG-058). Devuelve los pedidos a los que hay que pedir calificación y, **en la misma transacción**, marca `feedback_solicitado`, los encola en `feedback_pendiente` y pasa al cliente a `esperando_feedback`. n8n solo envía el WhatsApp. Elegible = `entregado` · flag en false · `fecha_entrega` entre now()−6 h y now()−1 h · cliente `activo` en `'bot'` · **sin fila en `feedback`** (la guarda que faltaba: el hecho manda sobre el flag) · sin cola abierta para ese teléfono. `FOR UPDATE SKIP LOCKED` contra ticks del cron solapados. `p_limite` acotado 1–50. Lleva `#variable_conflict use_column` (los nombres del `RETURNS TABLE` chocan con las columnas del `ON CONFLICT`: 42702 en runtime). **SECURITY DEFINER**, `EXECUTE` solo `service_role`. |
| `procesar_respuesta_feedback` | `(p_telefono text, p_mensaje text) → jsonb` | **Lado "responder" del feedback** (2026-09-16, BUG-057/059/060). Puerta única para cualquier mensaje de un cliente en `esperando_feedback`. Bloquea su fila de la cola (`FOR UPDATE`, dos mensajes seguidos se serializan) y, según `estado`: **`esperando_nota`** → parsea con la regla estricta de BUG-051 (el mensaje tiene que *ser* la nota: dígito 1–5 o `uno`..`cinco` tras quitar puntuación/emoji/acentos), **UPSERT** en `feedback` (una segunda calificación actualiza, no revienta con 23505), y cierra (nota ≥ 4) o pasa a `esperando_comentario` (≤ 3). **`esperando_comentario`** → guarda el texto (≤ 2000; `saltar` no pisa uno existente) y cierra. "Cerrar" = borrar la cola **y** restaurar `modo = 'bot'` en la misma transacción. Sin cola → restaura el modo si estaba huérfano. Estado desconocido → suelta al cliente antes que dejarlo atrapado. Devuelve `{accion}` ∈ `positiva` · `pedir_comentario` · `agradecer` · `nota_invalida` · `sin_pendiente`, y n8n solo elige el texto. **SECURITY DEFINER**, `EXECUTE` solo `service_role`. |
| `marcar_entregado` | `(p_pedido_id text) → pedidos` | **Única vía de escritura del rol domiciliario.** Valida rol, asignación y estado; el UPDATE lo hace saltando RLS. Existe porque **RLS no puede limitar columnas** (ver §Modelo de permisos). **SECURITY DEFINER.** |
| `validar_asignacion_domiciliario` | `() → trigger` | Trigger de `pedidos` (ver §Triggers). |
| `resumen_entregas` | `(p_domiciliario uuid, p_desde timestamptz=null, p_hasta timestamptz=null) → (entregas, total, efectivo, primera, ultima)` | Totales del historial de entregas. Existe porque la lista está paginada y sumar solo lo cargado daría una cifra que crece al hacer scroll. **STABLE · SECURITY INVOKER** — al revés que el resto de RPC de este esquema: así hereda la RLS de `pedidos` y la autorización sale gratis (un domiciliario que pase el id de otro recibe ceros, porque esas filas no existen para él). |
| `listar_usuarios` | `() → setof (usuario_id, nombre, email, rol, telefono, avatar_url, activo, ultimo_acceso, creado)` | Lista de usuarios para la tab **Usuarios** (salió de Configuración el 2026-09-01). Existe porque el email vive en `auth.users`, que PostgREST no expone; la alternativa era denormalizarlo en `perfiles` y que se desincronizara. **STABLE · SECURITY DEFINER** — autoriza ella misma (42501 si no eres admin). |
| `crear_perfil_nuevo_usuario` / `proteger_perfil` / `proteger_ultimo_admin` | `() → trigger` | Triggers de `auth.users` y `perfiles` (ver §Triggers). |
| `limpiar_carritos_abandonados` / `limpiar_historial_chat` | `()` | Housekeeping. |

### Jobs programados (`pg_cron`)

| Job | Cron | Qué corre |
|---|---|---|
| `limpiar-carritos-abandonados` | `0 8 * * *` | `limpiar_carritos_abandonados()` |
| `limpiar_historial_chat_semanal` | `0 3 * * 1` | `limpiar_historial_chat()` |
| `expirar-pedidos-pendientes` | `0 16 * * *` | `expirar_pedidos_pendientes()` — 16:00 UTC = **11:00 Colombia**: el corte (00:00) ya pasó, pero la notificación de cancelación le llega al cliente a una hora decente y no a medianoche. Mientras tanto el pedido viejo no estorba, porque el kanban solo muestra los del día actual |
| `expirar-feedback-pendiente` | `7 * * * *` | `expirar_feedback_pendiente()` — borra filas de `feedback_pendiente` de más de **6 h** y devuelve a `'bot'` a esos clientes si seguían en `esperando_feedback` (nunca pisa un `humano`). BUG-050, 2026-09-12. **2026-09-16 (BUG-057):** era 48 h con corrida diaria — un cliente atrapado podía pasar ~3 días sin bot. Es la red de seguridad de todo el flujo: acota cualquier fallo futuro a ≤ 7 h. |
| `limpiar-mensajes-pendientes` | `*/5 * * * *` | `delete from n8n_mensajes_pendientes where creado_el < now() - interval '5 minutes'` — un turno que muere a mitad del buffer dejaba la fila, y `Combinar mensajes` la pegaba delante del próximo mensaje del cliente aunque llegara días después. Un flujo sano la borra a los ~3 s. BUG-053, 2026-09-15 |

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
| `zonas_entrega` · `barrios` | todo | SELECT | SELECT |
| `perfiles` | todo | solo el suyo | solo el suyo |
| `mensajes_soporte` · `feedback` · `feedback_pendiente` · `respuestas_rapidas` · `carritos` · `n8n_*` | todo | — | — |

**Reglas por COLUMNA — las que la RLS no puede expresar.** Tres capacidades no caben en la matriz
de arriba porque no son "qué filas" sino "qué columna de una fila que sí puedes tocar". Todas están
sostenidas por triggers, no por políticas:

| Regla | Quién puede | Dónde se sostiene |
|---|---|---|
| Cambiar `pedidos.domiciliario_id` | solo admin | `trigger_validar_asignacion` |
| Fijar `pedidos.costo_domicilio` desde el barrio | nadie lo escribe a mano en el alta | `trigger_tarifa_domicilio` (2026-08-18) |
| Cambiar `perfiles.rol` / `perfiles.activo` | solo admin | `trigger_proteger_perfil` |
| Pasar un pedido a `entregado` | admin, mesero, y el domiciliario **asignado** | RPC `marcar_entregado` (el domiciliario no tiene política de UPDATE) |
| Cambiar la contraseña de **otro** usuario | solo admin | Edge Function `admin-password` — no es una columna de `perfiles` sino de `auth.users`, donde ninguna política llega (ver §Edge Functions) |

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
> comparan `(storage.foldername(name))[1]` contra `auth.uid()` **o** aceptan `es_admin()`.
> Cambiar esa convención en `src/lib/avatares.js` no rompe el orden de los archivos: rompe la
> seguridad.
>
> Ese `OR es_admin()` es lo que permite que un admin suba la foto de otro usuario desde la tab
> Usuarios: el archivo cae igual en la carpeta del dueño. Para cualquier otro rol la política
> rebota la subida. Verificado en `pg_policies` el 2026-09-01.
>
> El `timestamp` en el nombre evita el caché — reusar `<uid>/avatar.jpg` deja al navegador y al
> CDN sirviendo la foto vieja tras cambiarla.

> **El tamaño y el tipo los valida el servidor** (`file_size_limit` y `allowed_mime_types` del
> bucket). El formulario valida lo mismo antes de subir, pero eso es cortesía: quien llame a la
> Storage API directo choca igual contra estos límites.

## Edge Functions

Único código de servidor del sistema que **no** vive en n8n. El código está en este repo, bajo
`supabase/functions/`, y se despliega con la CLI (`npx supabase functions deploy <nombre>`).

| Función | Llama | Qué hace |
|---|---|---|
| `admin-password` | El dashboard (tab Usuarios) | Cambia la contraseña de **otro** usuario vía `auth.admin.updateUserById` |

### `admin-password` (2026-09-01)

**Por qué existe.** Poner la contraseña de otra cuenta solo se puede con la Admin API, que exige
`service_role`. Esa clave no puede vivir en el dashboard: todo lo que allí empieza por `VITE_`
acaba dentro del bundle que descarga el navegador (mismo motivo por el que tampoco se crean
cuentas desde el panel). Aquí el `service_role` se queda como secreto de la función.

**Por qué no un email de recuperación.** `resetPasswordForEmail` no habría necesitado nada de
esto, pero **no sirve para este restaurante**: la mayoría del personal (meseros y domiciliarios)
tiene un email interno inventado, sin bandeja real donde recibir el enlace.

**Dos barreras de autorización:**

1. `verify_jwt = true` en `supabase/config.toml` — el gateway rechaza sin sesión válida.
2. La función comprueba que quien llama sea **admin activo**: un JWT válido lo tiene también un
   domiciliario. La comprobación **no** lee el rol del JWT (no viaja ahí y el cliente no es de
   fiar): llama al RPC `mi_rol()` **con el token de quien llama**, la misma fuente que usa la RLS
   y que devuelve NULL si la cuenta está desactivada.

El `service_role` se usa **solo** para el paso final. Todo lo que decide "¿puede?" corre con los
permisos de quien llama. Antes de escribir, además, comprueba que el destinatario exista en
`perfiles`: sin eso, un admin podría cambiarle la contraseña a cualquier fila de `auth.users`
pasando su UUID a mano.

> **Secretos:** `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta
> Supabase automáticamente en toda Edge Function. No hay que declararlos.

> **Límite conocido: no cierra las sesiones abiertas.** `updateUserById` cambia la contraseña pero
> **no revoca los refresh tokens** que ya existan. Sirve para "se le olvidó" y para "hay que darle
> credenciales al que entra"; **no** basta por sí sola para "esta cuenta está comprometida" — en
> ese caso, además, hay que **desactivar el usuario** desde la tab (el switch de acceso), que sí
> corta al instante: `mi_rol()` devuelve NULL con `activo = false` y la RLS le vacía todo.

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
