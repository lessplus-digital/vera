---
name: fix-bug
description: Trabaja un bug del tracker de punta a punta — confirma el estado real por MCP, aplica el fix en la capa correcta (dashboard / n8n / Supabase) y cierra tracker + changelog. Úsalo cuando se nombre un BUG-NNN de docs/bug-tracker.md, cuando pidan arreglar, confirmar, verificar o cerrar un bug conocido, y antes de dar por resuelto cualquier defecto registrado.
---

Trabaja el bug indicado (el `BUG-NNN` que nombró el usuario, o el que estés a punto de tocar)
desde `docs/bug-tracker.md`.

## 1. Leer la entrada
Lee el bug en el tracker (síntoma, causa, fix propuesto, componente).

## 2. Confirmar el estado REAL antes de tocar nada
- **n8n:** `get_workflow_details` del workflow implicado — verifica la expresión/config exacta
  del nodo (las líneas del tracker pueden estar desfasadas). Si solo te interesan unos nodos,
  delega la lectura al subagente `n8n-inspector`: el JSON completo es enorme.
- **Supabase:** `execute_sql` (solo lectura) para **reproducir el síntoma con datos** (ej. pedidos
  sin detalle, RLS de una tabla, una fila específica).
- **Dashboard:** Read/Grep del archivo real (no confíes en los números de línea del reporte heredado).

## 3. Aplicar el fix en la capa correcta
- **Dashboard (este repo):** `Edit` directo. Respeta convenciones (`parseDb` para fechas,
  `metodo_pago` capitalizado, total = trigger). Verifica el flujo afectado.
- **n8n:** escritura habilitada (`update_workflow`) con reglas: confirma el estado real primero,
  muestra el plan, aplica atómico, valida después (`validate_workflow`) y **publica**
  (`publish_workflow`) — un `update_workflow` sin publicar deja el cambio en borrador. Verifica
  siempre `versionId == activeVersionId` al cerrar. Respeta la estética del usuario (posiciones,
  nombres, sticky notes) — no reacomodes nada ajeno al fix.
- **Supabase:** cambios de esquema vía `apply_migration` (nombre `bugNNN_descripcion`);
  verifica con `execute_sql` después.

## 4. Cerrar
Quita el bug de **"Abiertos"** en el tracker y registra una **entrada condensada en
`docs/changelog.md`** (qué se hizo + cómo se verificó). Si la verificación final depende
de tráfico real, déjalo en "En observación" del tracker. Si dejó una lección reutilizable,
resúmela en `docs/edge-cases.md`. Si el fix cambió el esquema/workflow, actualiza el doc de capa.

> Reglas del proyecto (ver `CLAUDE.md`): el total lo calcula el trigger (nunca JS/LLM); el bot debe
> escribir con `service_role`; identificadores en español y minúscula.
