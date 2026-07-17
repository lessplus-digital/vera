---
description: Trabaja un bug del tracker de punta a punta — confirma con MCP, aplica el fix en la capa correcta y actualiza el tracker
argument-hint: [BUG-NNN, ej. BUG-007]
allowed-tools: Read, Grep, Edit, mcp__n8n-mcp__n8n_get_workflow, mcp__n8n-mcp__n8n_validate_workflow, mcp__supabase__execute_sql, mcp__supabase__list_tables
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
- **n8n / Supabase:** los MCP están **en solo lectura**. Prepara el cambio exacto (nodo + expresión,
  o el SQL) y entrégalo para que el usuario lo aplique, o pídele habilitar escritura. **NO asumas
  que se aplicó** ni marques resuelto sin confirmación.

## 4. Cerrar
Mueve el bug a **"Resueltos"** en el tracker (con qué se hizo). Si dejó una lección reutilizable,
resúmela en `docs/shared/edge-cases.md`. Si el fix cambió el esquema/workflow, actualiza el doc de capa.

> Reglas del proyecto (ver `CLAUDE.md`): el total lo calcula el trigger (nunca JS/LLM); el bot debe
> escribir con `service_role`; identificadores en español y minúscula.
