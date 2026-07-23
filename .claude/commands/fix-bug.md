---
description: Trabaja un bug del tracker de punta a punta — confirma con MCP, aplica el fix en la capa correcta y actualiza tracker + changelog
argument-hint: [BUG-NNN, ej. BUG-007]
allowed-tools: Read, Grep, Edit, mcp__n8n-mcp__n8n_get_workflow, mcp__n8n-mcp__n8n_validate_workflow, mcp__n8n-mcp__n8n_update_partial_workflow, mcp__supabase__execute_sql, mcp__supabase__list_tables, mcp__supabase__apply_migration
---

Trabaja **$ARGUMENTS** desde `docs/shared/bug-tracker.md`.

## 1. Leer la entrada
Lee el bug en el tracker (síntoma, causa, fix propuesto, componente).

## 2. Confirmar el estado REAL antes de tocar nada
- **n8n:** `n8n_get_workflow` (`mode: filtered` + `nodeNames`) del nodo implicado — verifica la
  expresión/config exacta (las líneas del tracker pueden estar desfasadas).
- **Supabase:** `execute_sql` (solo lectura) para **reproducir el síntoma con datos** (ej. pedidos
  sin detalle, RLS de una tabla, una fila específica).
- **Dashboard:** Read/Grep del archivo real (no confíes en los números de línea del reporte heredado).

## 3. Aplicar el fix en la capa correcta
- **Dashboard (este repo):** `Edit` directo. Respeta convenciones (`parseDb` para fechas,
  `metodo_pago` capitalizado, total = trigger). Verifica el flujo afectado.
- **n8n:** escritura habilitada (`n8n_update_partial_workflow`) con reglas: confirma el estado
  real primero, muestra el plan, aplica atómico, valida después (`n8n_validate_workflow`) y
  verifica que la versión publicada tenga el cambio (`versionId == activeVersionId`). Respeta
  la estética del usuario (posiciones, nombres, sticky notes) — no reacomodes nada ajeno al fix.
- **Supabase:** cambios de esquema vía `apply_migration` (nombre `bugNNN_descripcion`);
  verifica con `execute_sql` después.

## 4. Cerrar
Quita el bug de **"Abiertos"** en el tracker y registra una **entrada condensada en
`docs/shared/changelog.md`** (qué se hizo + cómo se verificó). Si la verificación final depende
de tráfico real, déjalo en "En observación" del tracker. Si dejó una lección reutilizable,
resúmela en `docs/shared/edge-cases.md`. Si el fix cambió el esquema/workflow, actualiza el doc de capa.

> Reglas del proyecto (ver `CLAUDE.md`): el total lo calcula el trigger (nunca JS/LLM); el bot debe
> escribir con `service_role`; identificadores en español y minúscula.
