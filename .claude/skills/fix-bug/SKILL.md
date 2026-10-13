---
name: fix-bug
description: Trabaja un bug del tracker de punta a punta — confirma el estado real, aplica el fix en la capa correcta (dashboard / servidor del bot / Supabase) y cierra tracker + changelog. Úsalo cuando se nombre un BUG-NNN de docs/bug-tracker.md, cuando pidan arreglar, confirmar, verificar o cerrar un bug conocido, y antes de dar por resuelto cualquier defecto registrado.
---

Trabaja el bug indicado (el `BUG-NNN` que nombró el usuario, o el que estés a punto de tocar)
desde `docs/bug-tracker.md`.

## 1. Leer la entrada
Lee el bug en el tracker (síntoma, causa, fix propuesto, componente).

## 2. Confirmar el estado REAL antes de tocar nada
- **Servidor del bot:** reproduce con el simulador (`npm run sim -- <escenario> --ver --veces 1`) o lee
  el turno real en `bot_turnos` (skill `debug-bot`).
- **Supabase:** `execute_sql` (solo lectura) para **reproducir el síntoma con datos** (pedidos sin
  detalle, RLS de una tabla, una fila específica).
- **Dashboard:** Read/Grep del archivo real (no confíes en los números de línea del reporte).

## 3. Aplicar el fix en la capa correcta
- **Dashboard (`src/`):** `Edit` directo. Respeta convenciones (`parseDb` para fechas, `metodo_pago`
  capitalizado, total = trigger). Verifica el flujo afectado.
- **Servidor (`server/`):** el cambio va con su prueba unitaria y, si es de conversación, con un
  escenario (`server/test/escenarios/`). `npm test` + `npm run typecheck` en verde.
- **Supabase:** cambios de esquema vía `apply_migration` (nombre `bugNNN_descripcion`) y archivo en
  `supabase/migrations/`; verifica con `execute_sql` y corre la batería de `qa/sql/` que lo cubre.

## 4. Cerrar
Quita el bug de **"Abiertos"** en el tracker y registra una **entrada condensada en
`docs/changelog.md`** (qué se hizo + cómo se verificó). Si la verificación final depende de tráfico
real, déjalo en "En observación". Si dejó una lección reutilizable, resúmela en `docs/edge-cases.md`.
Si el fix cambió el esquema o una regla, actualiza el doc de capa.

> Reglas del proyecto (ver `CLAUDE.md`): el total lo calcula el trigger (nunca JS/LLM); el bot escribe
> con la secret key; identificadores en español y minúscula.
