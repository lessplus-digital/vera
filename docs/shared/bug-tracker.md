# Bug Tracker — Correcciones y mejoras pendientes

> Lista **activa** de bugs y mejoras por resolver, registrada a partir de esta sesión.
> Al corregir uno: márcalo ✅ en "Resueltos" y, si dejó una lección reutilizable,
> resúmela en [`edge-cases.md`](edge-cases.md) (causa + solución).
>
> **Contexto:** [`edge-cases.md`](edge-cases.md) es un doc heredado (otra herramienta): sus
> lecciones históricas siguen siendo válidas, pero valídalas contra el código real cuando toques
> esa área. (`error-handling.md` se eliminó por estar superado; su contenido vive en los prompts
> de agentes y en este tracker.)

## Convención

- **ID:** `BUG-NNN` correlativo. **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja.
- **Estado:** 🔴 Abierto · 🟠 En progreso · ✅ Resuelto.

---

## Abiertos

### BUG-001 — `Guardar comentario` no persiste el comentario 🔴
- **Componente:** n8n · subworkflow *Retener feedback* · nodo `Guardar comentario`
- **Síntoma:** El comentario del cliente (calificación ≤ 3) nunca queda en `feedback.comentario`.
- **Causa:** El filtro `pedido_id` tiene `keyValue: "{{ $json.pedido_id }}"` **sin el `=` inicial**,
  así que n8n lo trata como texto literal y el `WHERE pedido_id = eq.{{ $json.pedido_id }}`
  no matchea ninguna fila.
- **Fix:** Poner el valor como expresión: `={{ $json.pedido_id }}`.
- **Ref:** [`../bot/feedback.md`](../bot/feedback.md#-posibles-bugs-confirmar-en-n8n)
- **Estado:** 🔴 Abierto · detectado 2026-07-16

### BUG-002 — `Limpiar modo huérfano` no resetea el modo del cliente 🟡
- **Componente:** n8n · subworkflow *Retener feedback* · nodo `Limpiar modo huérfano`
- **Síntoma:** El `UPDATE clientes SET modo='bot'` de limpieza no matchea; un cliente en
  modo de feedback sin fila pendiente queda atascado fuera del flujo del bot.
- **Causa:** El filtro `cliente_id` usa `={{ json.cliente_id }}` — variable **`json` en vez
  de `$json`** → la expresión resuelve a indefinido.
- **Fix:** Corregir a `={{ $json.cliente_id }}`.
- **Ref:** [`../bot/feedback.md`](../bot/feedback.md#-posibles-bugs-confirmar-en-n8n)
- **Estado:** 🔴 Abierto · detectado 2026-07-16

### BUG-003 — Secretos de Supabase hardcodeados en nodos HTTP (sistémico) 🔴
- **Componente:** n8n · **24 instancias** confirmadas por `n8n_audit_instance` (2026-07-16)
  en 4 workflows activos:
  - **Pizzeria Vera** (main): `crear_carrito`, `Traer/Descargar imagen de whatsapp`, y los
    nodos del job feedback (`Buscar pedidos…`, `Marcar pedido…`, `Activar modo…`, `feedback_pendiente`).
  - **Sub — Consultar_menu**: `HTTP Request`.
  - **Sub — Crear_orden_completa**: `Validar productos menu`, `INSERT detalle_pedidos`, `Limpiar carrito` (anon).
  - **Sub — Editar pedido**: `HTTP Request`.
- **Síntoma / Riesgo:** keys de Supabase (unas `service_role` = crítico, otras `anon`) en
  texto plano en headers `apikey`/`Authorization`. Quedan en el export del workflow y la
  `service_role` salta RLS. Muchos otros nodos ya usan la credencial `Supabase account`.
- **Fix:** Migrar cada nodo a `authentication: predefinedCredentialType` (credencial
  `Supabase account`), quitar las keys, y **rotar la `service_role`**. El MCP puede
  auto-arreglarlo, pero está en solo-lectura → habilitar temporalmente o hacerlo a mano.
- **Estado:** 🔴 Abierto · detectado 2026-07-16

### BUG-004 — Key `cliente_id ` con espacio en `crear_reserva` (frágil, funciona) 🟢
- **Componente:** n8n · Agente Reservas · tool `crear_reserva` + `Sub — Crear Reserva`
- **Verificado vía MCP (corrige el diagnóstico inicial):** el espacio está en TODO el camino
  (schema del tool, trigger del subworkflow, y el INSERT lee `['cliente_id ']`), así que el
  `cliente_id` **sí se inserta**. Pero en `Validar y verificar cupo` se lee `input.cliente_id`
  (sin espacio) → `undefined` (latente, no rompe porque el INSERT no depende de ese nodo).
- **Fix:** renombrar la key a `cliente_id` (sin espacio) en todo el camino para quitar la fragilidad.
- **Estado:** 🟢 Abierto (bajo) · re-evaluado 2026-07-16

### BUG-005 — Agente Reservas no puede cancelar (subworkflow existe pero sin cablear) 🟡
- **Componente:** n8n · Agente Reservas
- **Síntoma:** El system prompt describe un flujo "CANCELAR RESERVA" que llama
  `cancelar_reserva`, pero esa tool **no está conectada** al agente (solo tiene
  `consultar_disponibilidad`, `crear_reserva`, `consultar_reservas_cliente`).
- **Causa (refinada vía MCP):** El subworkflow **`Sub — Cancelar Reserva` (id
  `Jk8r0QtxYqYzK8cV`) SÍ existe**, solo falta agregarlo como tool al Agente Reservas.
- **Fix:** Añadir un nodo `toolWorkflow` que apunte a `Sub — Cancelar Reserva` en el
  Agente Reservas (como las otras tools de reservas).
- **Estado:** 🔴 Abierto · detectado 2026-07-16

### BUG-006 — `consultar_menu` no usa el RPC `buscar_menu` que ya existe 🟡
- **Componente:** n8n · `Sub — Consultar_menu` + prompt del Agente Menú
- **Síntoma:** El prompt decide según un campo `similitud` que la tool **nunca devuelve**, y
  promete tolerar typos (`papatas`→`patatas`) que **no** ocurre — el subworkflow solo hace `ilike`.
- **Hallazgo (vía MCP Supabase):** la BD **ya tiene el RPC `buscar_menu`** con búsqueda difusa
  real (`pg_trgm` + `unaccent` + diccionario de correcciones `papata→patata`, `servex→cervez`…)
  que **devuelve `similitud` (0–1)**. La infraestructura que el prompt asume ya existe.
- **Fix (fácil):** apuntar `Sub — Consultar_menu` al RPC `buscar_menu` en vez del `ilike` casero.
- **Estado:** 🟡 Abierto · re-evaluado 2026-07-16

### BUG-007 — Pedidos del bot quedan SIN líneas (anon key bloqueada por RLS) 🔴🔴
- **Componente:** n8n · `Sub — Crear_orden_completa` · `INSERT detalle_pedidos` (HTTP, anon key)
- **CONFIRMADO (vía MCP Supabase):** `detalle_pedidos` **sí tiene RLS** (política solo
  `authenticated`), pero el nodo inserta con la **anon key** → el INSERT **se bloquea**. Hay
  pedidos con `total` pero **0 líneas de detalle**: `PED-113`, `PED-111`, `PED-109`.
- **Impacto:** pérdida de datos real en producción — el pedido se ve con total (calculado en JS,
  sin sumar domicilio porque el trigger nunca dispara) pero sin ítems. Rompe el detalle en el
  dashboard y las estadísticas de productos.
- **Fix:** que `INSERT detalle_pedidos` (y `Limpiar carrito`, `Validar productos menu`) usen la
  credencial `service_role` (`Supabase account`) en vez de la anon key hardcodeada. Relacionado
  con BUG-003 (mismo root: auth inconsistente en n8n).
- **Estado:** 🔴 Abierto · **confirmado 2026-07-16 con datos reales**

### BUG-008 — `Sub — Crear Reserva`: chequeo JS de cupo/duplicado muerto 🟢
- **Componente:** n8n · `Sub — Crear Reserva` · nodo `Validar y verificar cupo`
- **Síntoma:** filtra `$input.all()` por `reserva_id`, pero nada le pasa reservas → siempre vacío
  → los checks JS de **duplicado** y **cupo** nunca se disparan.
- **Mitigación confirmada (vía MCP):** el **cupo SÍ está protegido** por el trigger de BD
  `trigger_validar_cupo` (BEFORE INSERT en `reservas`, `RAISE EXCEPTION` si 8 solapadas). Lo que
  **no** cubre nadie es el **duplicado** (misma persona, mismo día).
- **Fix:** quitar el check JS muerto; si se quiere impedir duplicados, hacerlo en el trigger o
  con un query real antes del INSERT.
- **Estado:** 🟢 Abierto (bajo) · re-evaluado 2026-07-16

### BUG-009 — `Sub — Cancelar Reserva`: verificación de propiedad muerta 🔴
- **Componente:** n8n · `Sub — Cancelar Reserva` · nodo `Validar`
- **Síntoma / Riesgo:** el check "esta reserva no es tuya" lee `input.telefono`, pero el input
  llega como **`telefono `** (con espacio) → `undefined` → el check se salta **siempre**. Con
  un `reserva_id` cualquiera se puede cancelar la reserva de otra persona.
- **Fix:** leer `input['telefono ']` (o renombrar el input a `telefono`) para que el check funcione.
- **Estado:** 🔴 Abierto · detectado 2026-07-16 · (además el subworkflow no está cableado — BUG-005)

### BUG-010 — `Sub — Editar pedido`: `phoneNumberId` distinto y sin cablear 🟡
- **Componente:** n8n · `Sub — Editar pedido` · nodo `Send message`
- **Síntoma:** usa `phoneNumberId` **1034474539749030**, distinto al del resto del sistema
  (**1026022853935447**) → podría enviar desde otro número o fallar. Además el subworkflow no
  aparece conectado como tool en el workflow de agentes actual (posible legacy).
- **Fix:** unificar `phoneNumberId`; confirmar si el subworkflow sigue en uso.
- **Estado:** 🟡 Abierto · detectado 2026-07-16

### BUG-011 — Instancia n8n desactualizada + webhook sin auth 🟡
- **Componente:** infraestructura n8n (`n8n_audit_instance`)
- **Síntoma / Riesgo:** n8n en **2.10.4**, 19 versiones atrás (última 2.30.6) → posibles
  vulnerabilidades. Hay **1 webhook sin autenticación**. (Aparte: el workflow ajeno `"Somos"`
  tiene un dato tipo tarjeta hardcodeado en un `Send message` — revisar/limpiar.)
- **Fix:** actualizar n8n; revisar el webhook (el de WhatsApp valida por verify token — confirmar).
- **Estado:** 🟡 Abierto · detectado 2026-07-16

### BUG-012 — RLS deshabilitado en 6 tablas (expuestas a la anon key) 🔴
- **Componente:** Supabase · tablas `info_negocio`, `feedback`, `n8n_chat_histories`,
  `n8n_mensajes_pendientes`, `carritos`, `feedback_pendiente`
- **Síntoma / Riesgo (advisory de Supabase):** estas 6 tablas **no tienen RLS** → cualquiera con
  la **anon key** (que es pública y va en el bundle del frontend) puede **leer o modificar todas
  las filas**. Contradice lo que afirma `CLAUDE.md` ("every table has RLS enabled").
- **Matiz:** habilitar RLS a secas **rompería el bot**, que hoy escribe en `carritos` /
  `feedback_pendiente` con la anon key. Hay que (a) mover esos writes a `service_role` y
  (b) habilitar RLS con políticas adecuadas. Ligado a BUG-003/BUG-007.
- **SQL de remediación (NO aplicar sin políticas):**
  ```sql
  ALTER TABLE public.info_negocio ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.n8n_mensajes_pendientes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.carritos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.feedback_pendiente ENABLE ROW LEVEL SECURITY;
  ```
- **Estado:** 🔴 Abierto · detectado 2026-07-16 (advisory Supabase)

---

## Dashboard (React)

> Rescatados de los reportes de code-review archivados (jul-14 + jul-16, deduplicados).
> Las **líneas exactas pueden estar desactualizadas** — verificar contra el código al arreglar.

### Deuda técnica / mejoras (dashboard)
- **Duplicación ~120 líneas** del selector de menú entre `CreateOrderModal` y `EditOrderModal`
  (`getProductOptions`, `CATEGORY_LABELS`, JSX de búsqueda) → extraer `<MenuPicker>` / hook.
- **`useStatistics`:** `.limit(10000)` sin aviso de truncamiento; queries iniciales
  (`menu`/`pedidos`/`clientes`) sin manejo de error (listas vacías silenciosas).
- **`useClients`:** `select('*')` → traer solo las columnas usadas.
- **`useOrders`:** debounce de `fetchOrders` ante ráfagas de realtime (evita queries en cascada).
- **`import React`** innecesario en `Header.jsx` / `Icon.jsx` (JSX transform de Vite/React 17+).

---

## Resueltos

### BUG-020 — `SupportPanel`: `ultima_actividad` sin `parseDb` ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Contexto:** hallado al arreglar BUG-015 — desmiente que aquél fuera "el único sitio sin
  `parseDb()`". En `SupportPanel.jsx:93` el "última actividad hace X" usaba
  `new Date(selectedConvo.ultima_actividad)` directo (mismo desfase de TZ que BUG-015).
- **Qué se hizo:** cambiado a `parseDb(selectedConvo.ultima_actividad)`. `parseDb` es seguro pase
  lo que pase con el tipo de columna: solo añade `Z` si el string no trae offset, así que si
  `ultima_actividad` ya fuera `timestamptz` el cambio es un no-op. (No se pudo verificar el tipo
  vía MCP — token caído — pero el fix es correcto en ambos casos.)
- **Verificado con:** `npm run build`.

### BUG-019 — `useReservations`: `reserva_id` con `Date.now()` ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** `createReservation` ya **no envía** `reserva_id` (era `RSV-M${Date.now()}`, con
  riesgo de colisión 23505 en el mismo ms); ahora lo genera la BD por default
  (`generar_reserva_id()`, confirmado en `docs/database/schema.md`). El insert usa `.select().single()`
  para leer la fila de vuelta con el id real generado (el objeto devuelto solo alimenta el WhatsApp,
  que no usa el id, pero así queda consistente). `created_at` se mantiene explícito (no se confirmó
  default y está fuera del alcance del bug).
- **Verificado con:** `npm run build`.

### BUG-015 — `OrderCard`: `fecha_pedido` sin `parseDb` ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** en `src/pages/dashboard/OrderCard.jsx` se importó `parseDb` y el "hace X"
  ahora usa `parseDb(order.fecha_pedido)` en vez de `new Date()` directo. `fecha_pedido` es un
  `timestamp` UTC sin `Z`, así que `new Date()` lo leía como hora local → desfase en navegadores
  ≠ UTC-5. Era el único sitio de la app que omitía `parseDb()`.
- **Verificado con:** `npm run build` (2223 módulos, sin errores).

### BUG-016 — `ReservationModal`: validación de fecha/hora ignora timezone ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** en `src/pages/reservations/ReservationModal.jsx` la validación "ya pasó"
  ahora construye la fecha con offset fijo de Colombia: `new Date(\`${fecha}T${hora}:00-05:00\`)`.
  Antes `new Date(\`${fecha}T${hora}\`)` usaba la hora local del navegador → podía marcar como
  pasada una reserva futura en Colombia (o viceversa) fuera de UTC-5.
- **Verificado con:** `npm run build`.

### BUG-017 — `EditOrderModal`: error al guardar notas se descarta ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** en `src/pages/dashboard/EditOrderModal.jsx` el `update({ notas })` ahora captura
  su `error`; si falla, hace `console.error`, muestra un mensaje ("Los ítems se guardaron, pero no
  se pudieron guardar las notas…") y **mantiene el modal abierto** para reintentar. Se deja claro
  que los ítems ya se aplicaron vía el RPC `editar_pedido` (solo fallaron las notas).
- **Verificado con:** `npm run build`.

### BUG-018 — `useSupportConversations`: usa `alert()` nativo ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** el hook (`src/hooks/useSupportConversations.js`) ahora expone estado `error` +
  `dismissError` en vez de dos `alert()` bloqueantes; se limpia al iniciar un envío y al cambiar de
  conversación. `SupportPanel.jsx` renderiza un banner de error inline (descartable al clic) sobre
  el área de escritura, consistente con el resto del UI.
- **Verificado con:** `npm run build`.

### BUG-013 — `useOrders` dejaba el Kanban en spinner infinito ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** en `src/hooks/useOrders.js`, el branch de error ahora hace `setLoading(false)`
  + `console.error` (antes `if (error) return` dejaba `loading` en `true` para siempre). Además la
  2ª query (stats del header) captura su `error` y lo loguea en vez de tragarlo.
- **Verificado con:** `npm run build` (2223 módulos, sin errores).
- **Mejora opcional pendiente:** exponer un estado `error` en el hook y mostrarlo en el UI (no
  bloqueante — el síntoma crítico, el spinner infinito, ya está resuelto).

### BUG-014 — `clientes` no llegaba por realtime ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo:** (frontend) `useClients` ahora escucha `event: '*'` en vez de solo `UPDATE`; (DB)
  se agregó `clientes` a la publicación: `ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;`
  — **verificado vía MCP** que `clientes` ya está en `supabase_realtime`. Los clientes nuevos del bot
  aparecen en tiempo real y se arregla de paso el badge de soporte (`useSupportCount`).
