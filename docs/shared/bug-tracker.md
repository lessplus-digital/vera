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

*(ninguno — 2026-07-23)*

---

## Dashboard (React)

> Rescatados de los reportes de code-review archivados (jul-14 + jul-16, deduplicados).
> Las **líneas exactas pueden estar desactualizadas** — verificar contra el código al arreglar.

### Deuda técnica / mejoras (dashboard)
✅ **Toda la lista fue resuelta** (2026-07-17). Ver "Deuda técnica dashboard — resuelta" en Resueltos.

---

## Resueltos

### BUG-005 + BUG-009 — Cancelar reserva: tool sin cablear + verificación de propiedad muerta ✅
- **Resueltos:** 2026-07-23 (juntos) · aplicado vía MCP (`n8n_update_partial_workflow`), validado
  con `n8n_validate_workflow` (0 errores) y verificado que la versión publicada
  (`activeVersionId`) contiene los cambios.
- **BUG-009 (`Sub — Cancelar Reserva`):**
  - Input del trigger renombrado `telefono ` → `telefono` (sin espacio) → `input.telefono` en
    `Validar` ya no es `undefined` y el check "esta reserva no es tuya" funciona.
  - El check se endureció a **fail-closed**: `!input.telefono || reserva.telefono !== input.telefono`
    (antes `input.telefono && …`: sin teléfono, se saltaba la verificación).
  - **Extra (hallado al cablear):** `Validar → UPDATE` iba sin compuerta — con `ok:false` el
    UPDATE corría igual (con `reserva_id` undefined) y el agente nunca veía el error. Se añadió
    `¿Validación OK?` (If sobre `ok`): true → UPDATE, false → NoOp `Responder error` que devuelve
    `{ ok:false, error }` al agente.
- **BUG-005 (main `Pizzeria Vera`):** nodo `toolWorkflow` **`cancelar_reserva`** agregado y
  conectado (`ai_tool`) al AGENTE RESERVAS, apuntando a `Sub — Cancelar Reserva`
  (`Jk8r0QtxYqYzK8cV`), con inputs `reserva_id` + `telefono` vía `$fromAI`. El prompt del agente
  ya describía el flujo CANCELAR RESERVA — no requirió cambios.
- **Pendiente cosmético:** el pinData del trigger del subworkflow conserva la key vieja
  `telefono ` — solo afecta pruebas manuales en el editor; re-pinnear cuando se abra.
- **Verificación pendiente:** probar una cancelación real por WhatsApp (feliz + reserva ajena).

### BUG-004 + BUG-008 — `Sub — Crear Reserva`: key `cliente_id ` con espacio + check JS muerto ✅
- **Resueltos:** 2026-07-23 (juntos) · aplicado vía MCP, validado (0 errores) y publicado.
- **BUG-004:** key `cliente_id ` renombrada a `cliente_id` (sin espacio) en TODO el camino:
  schema/inputs de la tool `crear_reserva` en el main, trigger del subworkflow, y el INSERT
  ahora lee `$('Validar y verificar cupo').item.json.cliente_id` (consistente con los demás campos).
- **BUG-008:** eliminado el check JS muerto de duplicado/cupo (filtraba `$input.all()` por
  `reserva_id` pero nada le pasaba reservas) y el nodo `If(_valido)` siempre-true; el Code quedó
  solo preparando la fila del INSERT, con comentario de que el **cupo** lo protege el trigger de
  BD `trigger_validar_cupo`. **Decisión (consultada):** los duplicados (misma persona, mismo día)
  NO se bloquean en BD — se manejan conversacionalmente; un cliente puede reservar almuerzo y
  cena el mismo día.
- **Pendiente cosmético:** pinData viejo en el subworkflow (keys con espacio, y el pin de
  `Validar y verificar cupo` no trae `cliente_id`) — solo afecta pruebas manuales en el editor.
- **Doc:** `docs/bot/subworkflows.md`, `docs/bot/ai-agents.md` y `docs/bot/n8n-workflow.md`
  actualizados (tool nueva + flujos).

### BUG-011 — Instancia n8n desactualizada + webhook sin auth ✅
- **Resuelto:** 2026-07-22/23 · 4 partes, todas verificadas:
  1. **Webhook `notificar-estado-pedido` autenticado** — es un Database Webhook de Supabase
     (trigger AFTER UPDATE en `pedidos`). Se recreó el trigger con header `x-webhook-token`
     (migración `bug011_webhook_auth_header`) y el nodo Webhook de n8n valida con **Header
     Auth**. Probado: sin token → 403, con token → 200. (El webhook de WhatsApp ya estaba
     protegido por OAuth + verify token de Meta.)
  2. **Nodo `Webhook1` eliminado** — estaba huérfano (sin conexiones) y sin auth.
  3. **Workflows archivados con secretos borrados** — `"Somos"` (dato tipo tarjeta en un
     `Send message`) y `"Pizzeria Vera BACKUP PREVIO MULTI AGENTE"` (tokens WA hardcodeados
     viejos), más la chatarra (`My workflow`, `My Sub-Workflow 1`, `Pizza`). Quedan solo los
     7 workflows de producción.
  4. **Instancia actualizada** (era 2.10.4, 20 versiones atrás) vía Docker Manager de
     Hostinger — el audit ya no reporta "outdated"; los 7 workflows quedaron activos y el
     webhook responde correcto post-update.
- **Nota:** las 2 ejecuciones fallidas del main de ~00:30–00:35 UTC del 23-jul son de las
  pruebas del webhook con payload vacío — ignorar.

### BUG-010 — `Sub — Editar pedido`: `phoneNumberId` distinto y sin cablear ✅
- **Resuelto:** 2026-07-22 · decisión: **archivar como legacy** (no cablear), verificado vía MCP
  (`active: false, isArchived: true`).
- **Análisis costo/beneficio:** el subworkflow tenía **0 ejecuciones históricas** y ningún
  caller. Cablearlo bien exigía: rediseñarlo sobre el RPC `editar_pedido` (editaba
  `detalle_pedidos` directo → habría perdido el recargo de domicilio al recalcular el total),
  añadir validación de propiedad por `telefono` (mismo hueco que BUG-009), resolver el mapeo
  `detalle_id` desde lenguaje natural, corregir el `phoneNumberId` y ampliar prompts de 2
  agentes. El caso de uso ya lo cubre el dashboard (RPC `editar_pedido`).
- **Mitigación conversacional añadida:** prompts del **Orquestador** ("modificar/cancelar un
  pedido YA REGISTRADO → soporte, no menu") y del **Agente Soporte** (nueva señal de handoff:
  cambio en pedido ya registrado → `solicitar_handoff` inmediato) — verificados vía MCP.
- **Doc:** `docs/bot/subworkflows.md` actualizado (sección marcada ARCHIVADO con el análisis).

### BUG-006 — `consultar_menu` no usa el RPC `buscar_menu` que ya existe ✅
- **Resuelto:** 2026-07-22 · en 2 capas (BD por MCP + n8n por el usuario, verificado publicado
  `ecc34926`).
- **Qué se hizo:**
  1. **BD** (migración `bug006_buscar_menu_categoria_descripcion`): el RPC solo buscaba en
     `nombre` — se extendió a `categoria` (peso 0.8) y `descripcion` (peso 0.7) y ahora
     devuelve `descripcion`. Sin esto, migrar el subworkflow habría *perdido* fidelidad vs. el
     `ilike` viejo (que sí cubría esos campos): "bebidas"/"gaseosa" no encontraban nada y
     "pollo"/"champiñones" no encontraban por ingrediente.
  2. **n8n** (`Sub — Consultar_menu`): `Construir filtros` arma `{termino, umbral:0.2,
     limite:30, solo_disponibles:true}`; `HTTP Request` ahora es POST a
     `/rest/v1/rpc/buscar_menu`; el post-proceso agrupa por categoría e incluye
     `descripcion` + `similitud` (el campo que el prompt del Agente Menú llevaba esperando).
- **Verificado con:** SQL y REST — `papatas`→Patatas 1.0, `servesa`→cervezas 0.8 (antes: "Soda
  Cereza" 0.5), `gaseosa`→bebidas 0.8, `champiñones`→incluye match por descripción 0.7,
  término vacío→menú completo. Sin regresiones en los casos que ya funcionaban.
- **Pendiente cosmético:** el nodo `Construir filtros` conserva **pinData viejo** (los query
  params del `ilike`) — solo afecta pruebas manuales en el editor; despinnear cuando se abra.

### BUG-001 — `Guardar comentario` no persiste el comentario ✅
### BUG-002 — `Limpiar modo huérfano` no resetea el modo del cliente ✅
- **Resueltos:** 2026-07-22 (juntos) · `Sub — Feedback Pendiente` · aplicado en la UI de n8n,
  verificado vía MCP en la versión publicada (`b76b8a74`).
- **Qué se hizo:**
  - `Guardar comentario` → filtro `pedido_id` ahora es expresión: `={{ $json.pedido_id }}`
    (le faltaba el `=` → n8n lo mandaba como texto literal y el UPDATE no matcheaba).
  - `Limpiar modo huérfano` → el fix del tracker (`$json.cliente_id`) era **insuficiente**:
    por la rama "sin fila pendiente" de `¿Existe feedback pendiente?` el item llega vacío y
    `$json.cliente_id` seguiría undefined. Se usó la fuente confiable en ambos caminos:
    `={{ $('When Executed by Another Workflow').first().json.cliente_id }}` (el trigger
    siempre recibe `cliente_id` desde el main).
- **Remediación de datos:** no hizo falta — se verificó por SQL que no hay clientes atascados
  en `esperando_feedback` sin fila en `feedback_pendiente`.
- **Nota:** primer intento de fix quedó mal por copy-paste del `=` (quedó `=={{...}}` y
  ` ={{...}}` con espacio) — el `=` lo agrega n8n al activar modo Expression, no se pega.
  Actualizado `docs/bot/feedback.md` (sección "posibles bugs" → resueltos).

### BUG-012 — RLS deshabilitado en 6 tablas (expuestas a la key pública) ✅
- **Resuelto:** 2026-07-22 · migración `bug012_enable_rls_exposed_tables` vía MCP `apply_migration`
- **Qué se hizo:** RLS habilitado en `carritos`, `feedback`, `feedback_pendiente`, `info_negocio`,
  `n8n_chat_histories`, `n8n_mensajes_pendientes`, con política `auth_full_access`
  (`authenticated` puede todo — mismo patrón que el resto de tablas). Se aplicó **después** de
  resolver BUG-003/007 (prerrequisito): el bot ya escribe todo con la `sb_secret_` (salta RLS)
  y el Postgres Chat Memory conecta como `postgres`, dueño de las tablas (exento de RLS).
  Antes de aplicar se auditó `Sub — Feedback Pendiente` vía MCP: todos sus nodos de BD son
  nodos Supabase nativos con credencial → nada quedaba dependiendo de la key pública.
- **Verificado con:** `pg_policies` (RLS ON + política en las 6); `curl` con la publishable key
  devuelve `[]` en las 6 tablas mientras la BD confirma que tienen filas (18/1/18 muestreadas);
  el dashboard solo usa `feedback` de las 6 (lectura en `useStatistics`) → cubierto por
  `auth_full_access`.
- **Nota:** `docs/database/schema.md` (modelo de permisos) y el "reality check" de `CLAUDE.md`
  quedaron actualizados — ya no hay tablas sin RLS.

### BUG-003 — Secretos de Supabase hardcodeados en nodos HTTP (sistémico) ✅
- **Resuelto:** 2026-07-22 · nodos migrados por el usuario en la UI de n8n + rotación de keys;
  todo verificado vía MCP y `curl`.
- **Qué se hizo (2 partes):**
  1. **Migración de nodos** — 13 nodos con secretos en texto plano migrados a
     `authentication: predefinedCredentialType` y verificados en las **versiones publicadas**:
     `Sub — Crear_orden_completa` (3, ver BUG-007), **Pizzeria Vera** (9 con credencial
     `Supabase account` + 2 de imágenes WhatsApp con credencial `whatsAppApi`),
     `Sub — Consultar_menu` (1), `Sub — Editar pedido` (1). El barrido halló 2 nodos que el
     audit no listaba (`Obtener ultimo mensaje`/`1`).
  2. **Rotación** — el proyecto usa el sistema nuevo de API keys de Supabase: se creó una
     `sb_secret_...` para la credencial `Supabase account` de n8n, el dashboard pasó a la
     `sb_publishable_...` en `VITE_SUPABASE_ANON_KEY`, y se pulsó **Disable legacy API keys**.
     Las keys JWT filtradas en el historial de versiones de n8n quedaron inutilizables.
- **Verificado con:** legacy `anon` y `service_role` → **401**; publishable → 200 en REST y
  Auth; ejecución del job feedback post-cambio exitosa (nodo Supabase 200 con la credencial).
- **Nota:** el token de WhatsApp también quedó en el historial de versiones de n8n y en el
  bundle del dashboard — sigue siendo el riesgo diferido conocido (`VITE_WA_ACCESS_TOKEN`);
  rotarlo implica actualizar credencial n8n + `.env.local`.

### BUG-007 — Pedidos del bot quedan SIN líneas (anon key bloqueada por RLS) ✅
- **Resuelto:** 2026-07-22 · aplicado por el usuario en la UI de n8n, verificado vía MCP
- **Causa confirmada:** `detalle_pedidos` tiene RLS (política solo `authenticated`) y el nodo
  `INSERT detalle_pedidos` de `Sub — Crear_orden_completa` insertaba con la **anon key
  hardcodeada** → INSERT bloqueado. El daño real era **8 pedidos sin líneas** (no 3):
  PED-096/097/098/099/100/109/111/113 — sus líneas son **irrecuperables** (el carrito se
  borró tras el INSERT fallido); quedan como pedidos solo-total.
- **Qué se hizo:** los 3 nodos HTTP del subworkflow (`INSERT detalle_pedidos`,
  `Limpiar carrito`, `Validar productos menu`) migrados a
  `authentication: predefinedCredentialType` con la credencial **`Supabase account`**
  (service_role — la misma que ya usaba `INSERT pedido` y sí pasa RLS), keys eliminadas de
  los headers. Verificado por MCP que la **versión publicada** (`152eff78`, 2026-07-22)
  contiene el cambio.
- **Efecto colateral positivo:** al insertarse las líneas, el trigger de total vuelve a
  disparar → los totales vuelven a incluir el recargo de domicilio (antes quedaba el total
  JS sin domicilio).
- **Verificación pendiente:** confirmar que el próximo pedido real del bot trae líneas
  (query: pedidos con `count(detalle)=0`).

### BUG-021 — más sitios sin `parseDb` (ConversationItem, ChatBubble, ClientsPage) ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Contexto:** hallados en un barrido de `new Date(` tras BUG-015/020. Mismo defecto de TZ:
  - `ConversationItem.jsx:25` — la **lista** de conversaciones ("hace X" con `ultima_actividad`);
    BUG-020 solo cubrió el header del chat en `SupportPanel`, la lista quedó igual.
  - `ChatBubble.jsx:52` — la hora de cada mensaje (`created_at`); si es `timestamp` UTC-sin-Z la
    hora sale corrida incluso en navegador Colombia.
  - `ClientsPage.jsx:94` — la fecha de registro (`fecha_registro`); menor (solo día/mes/año, se
    corre solo cerca de medianoche UTC).
- **Qué se hizo:** los tres pasan por `parseDb()` (seguro: no-op si la columna ya trae zona).
- **Nota:** `ReservationsPage.jsx:45,56` (`new Date(fecha+hora)` del calendario) se revisó y **no** es
  bug — react-big-calendar trabaja en hora de pared local; forzar offset ahí desplazaría los slots.
- **Verificado con:** `npm run build`.

### Deuda técnica dashboard — resuelta ✅
- **Resuelto:** 2026-07-17 · rama `fix/BUG-013-useorders-error-handling`
- **Qué se hizo (5 ítems):**
  - **`<MenuPicker>` extraído:** el selector de menú duplicado (~120 líneas) entre `CreateOrderModal`
    y `EditOrderModal` (`CATEGORY_LABELS`, `getProductOptions`, fetch del menú, estado y JSX del panel
    de búsqueda/variantes) vive ahora en `src/pages/dashboard/MenuPicker.jsx` y emite `onAddItem()`.
    Cada padre conserva su propia lista de ítems. (~172 líneas de duplicación menos.)
  - **`useStatistics`:** las queries de montaje (`menu`/`pedidos`/`clientes`) ahora loguean su error
    (antes: listas vacías silenciosas) + aviso `console.warn` si `pedidos` toca el límite de 10000 filas.
  - **`useClients`:** `select('*')` → columnas explícitas usadas (`cliente_id, nombre, telefono,
    direccion_principal, modo, fecha_registro`).
  - **`useOrders`:** el handler de realtime hace debounce (300 ms) → una ráfaga colapsa en un solo
    refetch (montaje y el `fetchOrders` exportado siguen inmediatos).
  - **`import React`** removido de `Header.jsx` / `Icon.jsx` (runtime JSX automático de Vite/React 17+).
- **Verificado con:** `npm run build` (sin errores).

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
