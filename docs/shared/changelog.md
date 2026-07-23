# Changelog — Decisiones y Cambios

> Registra decisiones arquitectónicas y **bugs resueltos** (condensados por tema), no cada
> commit. Agrega al inicio (más reciente arriba). El detalle completo de cada bug (verificación,
> comandos, notas) vive en el git history de `bug-tracker.md` y en los docs de capa.

## Formato

```
### YYYY-MM-DD — Título
**Contexto:** Por qué se tomó la decisión
**Decisión:** Qué se decidió
**Impacto:** Qué archivos/componentes cambiaron
```

---

### 2026-07-22 — Kanban vacío de noche (BUG-025, cierra BUG-022) + drop de políticas public (BUG-024) ✅

**Contexto:** Un pedido real del bot (PED-117, 20:49 Colombia) no aparecía en el kanban.
Verificado vía MCP: el pedido estaba bien guardado en UTC y `pendiente`.
**Causa (BUG-025):** `useOrders` derivaba el día de negocio con `setUTCHours(5,0,0,0)` sobre
la fecha UTC actual → entre 00:00 y 05:00 UTC (19:00–24:00 Colombia) el umbral quedaba en el
FUTURO y el filtro `gte` vaciaba kanban y stats del header, justo en el rush nocturno.
**Fix:** usar el helper correcto que ya existía — `colombiaDayStart()` de `dateRanges.js`
(desplaza −5h antes de anclar). Estadísticas nunca falló porque ya lo usaba.
**BUG-022 (cerrado como no-bug):** el "desfase de 6–7 h" al crear pedido manual era ver el
valor UTC crudo en Supabase Studio (+5 vs Colombia); `CreateOrderModal` guarda
`new Date().toISOString()` correctamente, igual que el bot. El síntoma visible (card que no
aparece) era BUG-025.
**BUG-024:** migración `bug024_drop_public_policies_mensajes_soporte` aplicada — eliminadas
las políticas `public` de lectura/inserción; queda solo `auth_full_access` (verificado vía
pg_policies). El realtime del dashboard ahora depende del JWT en el socket (fix BUG-023).
**Impacto:** `src/hooks/useOrders.js`; BD (policies); tracker en cero abiertos.

### 2026-07-22 — DS v2.1: primary tinted amber, dropdowns propios, badge de soporte en realtime (BUG-023) ✅

**Contexto:** Iteración sobre el DS v2: el primary naranja sólido no convenció — se prefirió
el tinted amber de «Crear»/«Nueva reserva», reforzado y unificado. Los selects se veían como
HTML nativo. Y el badge de soporte del sidebar no se actualizaba en tiempo real.
**Decisión/Fix:**
- `.btn.primary` = tinted amber con fuerza (color-mix 16%/55%, texto amber, 700; hover 26%).
  Aplicado a «Nuevo cliente», «+ Crear» (kanban `sm`), «+ Nueva reserva» y confirmar de modales.
  Se eliminan los tokens `--accent-solid*`.
- Dropdowns: estilo global de `<select>` en `index.css` (appearance:none + chevron SVG +
  focus ring ámbar) y `color-scheme` por tema; overrides por página solo de tamaño.
- **BUG-023 (badge):** causa raíz — los eventos realtime de `clientes` (RLS solo
  `authenticated`) se filtran si el socket va con token anon; `mensajes_soporte` sí llegaba
  por su política `public` (→ eso destapó BUG-024, abierta en el tracker). Fix doble:
  `supabase.realtime.setAuth(jwt)` en `useAuth` + `useSupportCount` también refetchea con
  INSERTs de `mensajes_soporte`.
**Impacto:** `index.css`, `clients/statistics/reservations/orders.less`, `Column.jsx`,
`ReservationsPage.jsx`, `useAuth.jsx`, `useSupportCount.js`, `design-system.md`, DS en
claude.ai/design re-publicado.

### 2026-07-22 — Design system v2: superficies planas, jerarquía de botones, tipografía única

**Contexto:** Feedback de experto UX/UI: exceso de degradados ("se ve muy IA"), dos
tipografías mezcladas, CTA sin peso visual, helpers dentro de labels, huecos y exceso de
color en estadísticas. Se decidió estandarizar con un design system documentado.
**Decisión:** `docs/dashboard/design-system.md` es la fuente de verdad visual (regla anclada
en `CLAUDE.md`). Cards/modales planos (glass solo en sidebar/topbar); jerarquía `.btn`
(primary naranja sólido, 1 por pantalla); patrón `.field` con helpers debajo del input y
tag "Opcional" en la minoría; sans única con `tabular-nums` (mono deprecada); paleta de
charts `--chart-1..3` validada contra daltonismo (skill dataviz, 6 checks dark+light);
layout de stats con gaps/paddings unificados (16 / 16x18) y columnas stretch.
**Impacto:** `src/styles/index.css` (tokens v2 + `.btn` + `.field`), `clients.less`,
`statistics.less`, `ClientsPage/ClientModal`, `KpiCards`, `CancellationStats`,
`CategoryRevenue` (top 3 + otras), `SalesChart`, `DeliveryStats`, `ChartTheme`.
Pendiente en backlog: aplicar `.btn`/`.field` a pedidos, reservas y soporte.

### 2026-07-22 — Se elimina `infra/` (RLS como código) — el MCP es la fuente viva

**Contexto:** `infra/supabase/rls_reference.sql` fue la referencia del modelo RLS antes de tener
MCP de Supabase. Hoy RLS ya está aplicado en las 12 tablas (BUG-012) y el estado real se
verifica en vivo vía MCP; mantener el script versionado invitaba a drift.
**Decisión:** eliminar `infra/` del repo. El modelo de permisos vive en
`docs/database/schema.md` («Modelo de permisos», incluye cómo crear el primer admin). Replicar
el setup a nuevos clientes (modelo silo) se hará vía MCP `apply_migration`. También se limpió
`dist/` local (build, gitignored) y se decidió **mantener** `.env.example` y
`.mcp.json.example` como plantillas versionadas de la config secreta.
**Impacto:** `infra/` (eliminada); referencias actualizadas en `README.md`, `docs/README.md`,
`docs/database/schema.md`, `src/hooks/useAuth.jsx`; drift corregido en
`docs/bot/subworkflows.md` (BUG-003/006/007 ya resueltos, verificado vía MCP).

### 2026-07-23 — Reservas: cancelación cableada y subworkflows saneados (BUG-004/005/008/009) ✅

**Contexto:** Los 4 bugs abiertos restantes eran del flujo de reservas del bot. Se aplicaron
directamente en n8n vía MCP (updates atómicos, validados, verificados en la versión publicada).
**Qué se hizo:**
- **BUG-005:** tool `cancelar_reserva` cableada al AGENTE RESERVAS (el prompt ya la describía).
- **BUG-009:** input `telefono ` (espacio invisible) renombrado → el check "esta reserva no es
  tuya" funciona; endurecido a fail-closed; nueva compuerta If para que un fallo de validación
  no llegue al UPDATE y el agente reciba el error.
- **BUG-004:** key `cliente_id ` (espacio) renombrada en todo el camino (tool → trigger → INSERT).
- **BUG-008:** checks JS muertos de duplicado/cupo eliminados; el cupo lo protege el trigger de
  BD `trigger_validar_cupo`. **Decisión:** duplicados NO se bloquean en BD (se manejan
  conversacionalmente; ver backlog).
**Impacto:** n8n (`Pizzeria Vera`, `Sub — Crear Reserva`, `Sub — Cancelar Reserva`);
`docs/bot/subworkflows.md`, `ai-agents.md`, `n8n-workflow.md`; lección #12 en `edge-cases.md`
(keys con espacio invisible → checks fail-closed).

### 2026-07-22/23 — Hardening n8n + Supabase: credenciales, RLS total, keys nuevas (BUG-001..003, 006, 007, 010..012) ✅

**Contexto:** Auditoría de seguridad reveló secretos hardcodeados, tablas sin RLS, webhook sin
auth e instancia n8n 20 versiones atrás. Se resolvió todo el lote en dos días.
**Qué se hizo:**
- **BUG-003/007:** 13 nodos HTTP con secretos en texto plano migrados a credenciales n8n;
  rotación al sistema nuevo de API keys de Supabase (`sb_publishable_` en el dashboard,
  `sb_secret_` en n8n, legacy JWT deshabilitadas). El daño histórico de BUG-007: 8 pedidos
  sin líneas, irrecuperables.
- **BUG-012:** RLS habilitado en las 6 tablas que faltaban → **todas** las tablas con RLS.
- **BUG-011:** webhook Supabase→n8n autenticado con `x-webhook-token`; nodo huérfano y
  workflows archivados con secretos eliminados; instancia n8n actualizada.
- **BUG-006:** `consultar_menu` migrado al RPC `buscar_menu` (fuzzy), extendido primero a
  `categoria`/`descripcion` para no perder fidelidad vs. el `ilike` viejo.
- **BUG-001/002:** expresiones rotas en `Sub — Feedback Pendiente` (faltaba `=`; fuente
  confiable para `cliente_id` en ambas ramas).
- **BUG-010:** `Sub — Editar pedido` archivado como legacy (0 ejecuciones, sin caller);
  mitigación conversacional en prompts de Orquestador/Soporte.
**Impacto:** n8n (7 workflows de producción limpios), BD (migraciones `bug006_*`, `bug011_*`,
`bug012_*`), `.env.local` (key nueva); `CLAUDE.md`, `schema.md`, `feedback.md`,
`subworkflows.md`, `infra/supabase/README.md`; lección #11 en `edge-cases.md`.

### 2026-07-17 — Barrido de calidad del dashboard (BUG-013..021 + deuda técnica) ✅

**Contexto:** Bugs rescatados de reportes de code-review (jul-14/16), resueltos en la rama
`fix/BUG-013-useorders-error-handling`.
**Qué se hizo:**
- **Timezone (BUG-015/016/020/021):** todos los timestamps de BD pasan por `parseDb()`
  (OrderCard, SupportPanel, ConversationItem, ChatBubble, ClientsPage); la validación del
  `ReservationModal` usa offset fijo de Colombia (`-05:00`).
- **Robustez (BUG-013/014/017/018/019):** `useOrders` sin spinner infinito en error; realtime
  de `clientes` con `event:'*'` + tabla añadida a la publicación; errores de notas en
  `EditOrderModal` ya no se descartan; `alert()` reemplazado por banner inline en soporte;
  `reserva_id` lo genera la BD (`generar_reserva_id()`), no `Date.now()`.
- **Deuda técnica:** `<MenuPicker>` extraído (~172 líneas de duplicación menos), errores
  logueados en `useStatistics`, columnas explícitas en `useClients`, debounce (300 ms) en el
  realtime de `useOrders`.
**Impacto:** `src/hooks/*`, `src/pages/dashboard|reservations|support|clients/*`,
`MenuPicker.jsx` (nuevo). Verificado con `npm run build`.

### 2026-06-19 — Autenticación (Supabase Auth) + RLS · Paso 1 hacia SaaS multi-cliente

**Contexto:** Antes de salir a producción y empezar a vender el sistema a clientes (vera, somos, usb…) como SaaS, el dashboard usaba la `anon key` directa **sin login y sin RLS** — cualquiera con esa key (que es pública) podía leer toda la base. Decisión arquitectónica acordada: **un proyecto Supabase por cliente** (aislamiento físico, replicable con migraciones-como-código), una **sola app React** desplegada una vez que resuelve el tenant por subdominio (`vera.lessplus.net`), y cobro tipo SaaS con Stripe en un futuro "control plane". Este commit implementa el **paso 1: auth + RLS** sobre el proyecto actual (Vera).

**Decisión:**
- `AuthProvider` + `useAuth` (`src/hooks/useAuth.jsx`): expone `session`, `user`, `loading`, `signIn`, `signOut`. Usa `supabase.auth` (persistencia en localStorage + JWT automático en cada query/realtime) y `onAuthStateChange`.
- `App.jsx` ahora es un **gate**: `loading` → splash; sin sesión → `LoginPage`; con sesión → `DashboardShell` (extraído para que los hooks que consultan datos —`useOrders`, `useSupportCount`— solo corran autenticados). `useTheme` se mantiene en el top para que el tema aplique también en el login.
- `LoginPage` (`src/pages/auth/`, estilos `auth.less`): email+password, errores de Supabase traducidos al español, glassmorphism + toggle de tema.
- El `AdminMenu` del Header dejó de ser placeholder ("Sesión de invitado / Próximamente"): muestra el usuario real y **Cerrar sesión** (`signOut`). Icono `logout` añadido a `Icon.jsx`.
- **RLS como código** en `infra/supabase/rls_reference.sql` (idempotente): activa RLS en las 6 tablas y crea política `auth_full_access` = acceso total solo para rol `authenticated`. El bot/n8n sigue escribiendo con `service_role` (salta RLS). `infra/supabase/README.md` documenta cómo aplicarla, crear el primer admin y verificar.

**Modelo de seguridad:** `anon key` pública pero inútil sin sesión (RLS bloquea); `service_role` secreta solo en n8n; usuarios del panel creados manualmente (registro abierto OFF). Para multi-tenant pool (futuro, NO ahora) la política filtraría por `tenant_id` del JWT — comentado en el SQL.

**Impacto:** `src/hooks/useAuth.jsx` (nuevo), `src/pages/auth/LoginPage.jsx` (nuevo), `src/styles/auth.less` (nuevo), `infra/supabase/` (nuevo: migración RLS + README), `App.jsx` (refactor a gate + `DashboardShell`), `main.jsx` (`AuthProvider`, import `auth.less`), `Header.jsx` (`AdminMenu` real), `Icon.jsx` (icono `logout`), `index.css` (`.ad-danger`).

### 2026-06-10 — Nueva tab Reservas (calendario)

**Contexto:** La tabla `reservas` ya existe en Supabase (el bot tomará reservas por WhatsApp), pero el dashboard no tenía forma de visualizarlas ni de gestionarlas manualmente.

**Decisión:**
- Quinta tab `reservas` con **react-big-calendar** (localizado en español con el `date-fns` ya instalado) — vistas Día / Semana / Mes, toolbar custom y CSS sobreescrito por completo con las variables del tema dark/light (`reservations.less`)
- Crear reserva manual (`ReservationModal`) y eliminar existentes (`ReservationDetail`, confirmación en dos pasos). **Siempre se notifica al cliente por WhatsApp** en ambas operaciones (best-effort: si WA falla, la operación queda hecha y un toast lo advierte)
- `reserva_id` manual con prefijo `RSV-M<timestamp>`; `origen: 'dashboard'`
- **Para reservar, el cliente debe existir**: el modal usa un selector de clientes con búsqueda por nombre/teléfono (mismo patrón que `CreateOrderModal`, reutiliza `useClients`) en lugar de inputs libres — `cliente_id`, `nombre_cliente` y `telefono` salen del cliente seleccionado
- La BD solo guarda `hora` de inicio — el calendario dibuja bloques de 90 min (`RESERVATION_DURATION_MIN`)
- Estados: `pendiente`/`confirmada`/`cancelada` (`RESERVATION_STATES`), coloreados amber/green/red en el calendario
- Realtime `*` sobre `reservas` para reflejar las reservas que cree el bot

**Impacto:** `src/pages/reservations/` (ReservationsPage, ReservationModal, ReservationDetail), `useReservations.js`, `reservations.less`, `constants.js` (RESERVATION_STATES, RESERVATION_DURATION_MIN), tab nueva en `Header.jsx`/`App.jsx`/`main.jsx`, dependencia `react-big-calendar`. `DATABASE.md` y `DASHBOARD.md` actualizados.

### 2026-06-10 — Creación manual de pedidos desde el Kanban

**Contexto:** Todos los pedidos entraban únicamente por el bot de WhatsApp. Los administradores necesitaban registrar pedidos tomados por otros canales (teléfono, mostrador) sin perder el flujo normal de aprobación ni la notificación al cliente.

**Decisión:**
- Botón "+ Crear pedido manual" en la columna "Por aprobar" que abre `CreateOrderModal` (misma UX de selección de productos que `EditOrderModal`)
- El pedido se asocia a un cliente existente de la tabla `clientes` (búsqueda por nombre/teléfono); la dirección se prellena con `direccion_principal`
- Inserción **directa a Supabase** (sin RPC): primero `pedidos` con `total: 0` y `estado: 'pendiente'`, luego `detalle_pedidos` — el trigger `actualizar_total_pedido` calcula el total real (regla: el frontend nunca calcula el total). Si falla el insert de items, se borra el pedido (rollback best-effort)
- `detalle_id` con prefijo `DET-M` (manual) para distinguir de `DET-E` (edición)
- Tras crear, se lee el `total` final de la BD y se notifica al cliente por WhatsApp (`sendWhatsAppMessage`) con el resumen del pedido (items, total exacto, entrega y método de pago). Si WhatsApp falla, el pedido queda creado y el modal muestra una advertencia
- `metodo_pago` se guarda capitalizado (`'Efectivo'`/`'Transferencia'`) — es lo que la BD ya contiene y lo que `METODO_LABEL`/`OrderCard` esperan, aunque `DATABASE.md` decía minúsculas

**Impacto:** `CreateOrderModal.jsx` (nuevo), `Column.jsx` (prop `onCreate`), `DashboardPage.jsx` (estado del modal), `orders.less` (`.col-add-btn` + `.create-order-modal`). `DASHBOARD.md` actualizado.

### 2026-06-10 — Nueva tab Clientes (CRUD)

**Contexto:** Los administradores solo veían clientes indirectamente (Soporte muestra modo=humano, Estadísticas muestra top/riesgo). Se necesitaba un listado completo con búsqueda y la posibilidad de crear/corregir clientes manualmente (ej: nombres "Pendiente" o direcciones desactualizadas).

**Decisión:**
- Cuarta tab `clientes`: tabla completa de la tabla `clientes` con búsqueda por nombre o teléfono (un solo input), orden alfabético A↔Z y CRUD (crear + editar; sin eliminar — los pedidos referencian `cliente_id`)
- Insert/update **directo a Supabase** desde el dashboard (sin RPC) — campos editables: `nombre`, `telefono`, `direccion`. `modo` se muestra como badge de solo lectura (se gestiona desde Soporte)
- Teléfono se sanitiza a solo dígitos en el input; el duplicado (UNIQUE, error 23505) se traduce a mensaje amigable
- Realtime solo UPDATE (lo único publicado para `clientes`); tras crear/editar se refetchea manualmente

**Impacto:** `src/pages/clients/` (ClientsPage, ClientModal), `useClients.js`, `clients.less`, tab nueva en `Header.jsx`/`App.jsx`/`main.jsx`. `DASHBOARD.md` actualizado.

### 2026-06-09 — Estadísticas avanzadas + limpieza de columnas en clientes

**Contexto:** Segunda iteración de la tab Estadísticas: tiempo de entrega, ingresos por categoría, heatmap hora×día y clientes en riesgo. Al construirlas se encontraron dos problemas de datos.

**Decisión:**
- **`fecha_entrega` ahora la escribe el dashboard** (`OrderCard.updateEstado`) al marcar entregado — antes nadie la escribía de forma confiable y los datos históricos son incoherentes (hay entregas "antes" del pedido). `deliveryStats` descarta duraciones ≤0 o >3h.
- **Fix timezone:** `fecha_pedido` es columna `timestamp` sin tz con valor UTC; JS la parseaba como hora local, corriendo la distribución horaria. Nuevo `parseDb()` en `dateRanges.js` fuerza UTC.
- **Columnas eliminadas de `clientes`:** `total_pedidos`, `gasto_total`, `ultimo_pedido_fecha`, `ultimo_pedido_detalle` — nunca se escribían ni se leían. Los acumulados se calculan desde `pedidos`.
- Nuevas vistas: `DeliveryStats` (promedio + distribución, domicilio vs recoger), `CategoryRevenue` (donut top 5), heatmap 7×24 en `HourlyHeatmap` (reemplaza las dos gráficas de barras), `RiskClients` (recurrentes 3+ pedidos inactivos 30+ días, con link wa.me para reactivarlos).

**Impacto:** `OrderCard.jsx`, `dateRanges.js` (`parseDb`), `statsAggregations.js` (4 funciones nuevas, 2 eliminadas), `useStatistics.js`, 3 componentes nuevos + `HourlyHeatmap` reescrito, `statistics.less`. `DATABASE.md` y `DASHBOARD.md` actualizados. Verificado con Playwright headless contra datos reales sin errores de consola.

### 2026-06-09 — Nueva tab Estadísticas (Recharts)

**Contexto:** Los administradores necesitaban analizar el negocio: pedidos por periodo, ingresos, clientes fieles, productos más/menos pedidos por categoría, horas pico y cancelaciones.

**Decisión:**
- Tercera tab `estadisticas` en el dashboard con **Recharts** (se integra con las CSS vars del tema dark/light)
- Agregación **en el cliente** (sin RPCs ni vistas SQL): fetch de pedidos del rango + agregación JS pura en `statsAggregations.js`
- KPIs comparan contra el periodo inmediatamente anterior de la misma duración
- Ingresos/KPIs excluyen `estado='cancelado'` (mismo criterio que el header); cancelados se muestran aparte como tasa con motivos
- Hora/día en hora Colombia: fecha desplazada -5h leída con `getUTC*()`
- **Clientes fieles se agregan desde `pedidos`**, no desde `clientes.total_pedidos`/`gasto_total`: se verificó que esos contadores están en 0 en la BD aunque existen pedidos (no se mantienen)

**Impacto:** `src/pages/statistics/` (8 componentes), `useStatistics.js`, `dateRanges.js`, `statsAggregations.js`, `statistics.less`, tab nueva en `Header.jsx`/`App.jsx`, `formatPriceShort()` en formatters. Dependencia nueva: `recharts`. Verificado con Playwright headless contra datos reales (dark/light, presets, granularidades, filtro de categoría) sin errores de consola. `DASHBOARD.md` actualizado.

### 2026-06-09 — Refactor estructura del frontend (feature-based)

**Contexto:** `src/` era una carpeta plana con componentes gigantes. `App.jsx` tenía 379 líneas mezclando fetch, realtime, lógica de negocio y UI. `OrderCard.jsx` tenía el componente `Actions` incrustado. No había separación de responsabilidades.

**Decisión:** Reorganizar `src/` con carpetas por dominio:
- `hooks/` — lógica extraída de componentes (`useOrders`, `useSupportCount`, `useTheme`)
- `utils/` — constantes, formateadores y audio desacoplados
- `components/orders/` — todos los componentes de pedidos juntos
- `components/support/` — panel de soporte
- `components/layout/` — header
- `pages/` — vistas montadas en App (DashboardPage)
- `styles/` — CSS con secciones separadas por comentarios

**Impacto:** `App.jsx` pasó de 379 a 30 líneas. `Actions` extraído a `OrderActions.jsx`. `DASHBOARD.md` actualizado. Build verificado sin errores.

---

### 2025-XX-XX — Trigger para cálculo de totales

**Contexto:** El LLM pasaba `total: 0` en crear_pedido porque los items no existían aún.
**Decisión:** Mover el cálculo del total a un trigger de PostgreSQL que se ejecuta al insertar/modificar/eliminar filas en `detalle_pedidos`.
**Impacto:** `DATABASE.md` — trigger `actualizar_total_pedido`. El LLM ya no necesita calcular nada.

### 2025-XX-XX — Modo bot/humano en clientes

**Contexto:** Necesitábamos un mecanismo para que el cliente pudiera hablar con un humano real cuando el bot no puede resolver.
**Decisión:** Campo `modo` en tabla `clientes` (`'bot'` | `'humano'`). El workflow principal chequea el modo antes de pasar al agente. Si es `'humano'`, el mensaje va a `mensajes_soporte`.
**Impacto:** `DATABASE.md`, `N8N-WORKFLOWS.md`, `DASHBOARD.md` (nuevo panel de soporte).

### 2025-XX-XX — Subworkflow para consultar_menu

**Contexto:** La búsqueda de productos necesitaba lógica compleja (múltiples palabras, filtro post-proceso) que no cabe en un solo nodo.
**Decisión:** Extraer consultar_menu como subworkflow separado con Code nodes + HTTP Request.
**Impacto:** `N8N-WORKFLOWS.md` — sección de subworkflow.

### 2025-XX-XX — Estructura .claude/ para contexto del proyecto

**Contexto:** El proyecto tiene contexto distribuido (n8n, Supabase, React, OpenAI) que es difícil de mantener en un solo README.
**Decisión:** Crear estructura `.claude/` con archivos especializados por dominio.
**Impacto:** Este archivo + toda la estructura `.claude/`.
