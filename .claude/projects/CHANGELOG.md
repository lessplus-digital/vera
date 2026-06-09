# Changelog — Decisiones y Cambios

> Registra decisiones arquitectónicas importantes, no cada commit. Agrega al inicio (más reciente arriba).

## Formato

```
### YYYY-MM-DD — Título
**Contexto:** Por qué se tomó la decisión
**Decisión:** Qué se decidió
**Impacto:** Qué archivos/componentes cambiaron
```

---

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
