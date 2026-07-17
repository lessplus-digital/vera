---
description: Depura un workflow o nodo de n8n usando el MCP (lee el workflow real, ejecuciones y docs de nodos)
argument-hint: [workflow o nodo, ej. "Sub — Crear Reserva" o "crear_carrito"]
allowed-tools: mcp__n8n-mcp__n8n_list_workflows, mcp__n8n-mcp__n8n_get_workflow, mcp__n8n-mcp__n8n_executions, mcp__n8n-mcp__n8n_validate_workflow, mcp__n8n-mcp__get_node, mcp__supabase__execute_sql, mcp__supabase__list_tables, Read, Grep
---

Depura el problema de n8n en: **$ARGUMENTS**

## 1. Traer el estado real (no suponer)

- Ubica el workflow con `n8n_list_workflows` si hace falta; tráelo con `n8n_get_workflow`
  (`mode: structure` para el mapa, `mode: filtered` + `nodeNames` para un nodo pesado sin volcar todo).
- Si falla en ejecución: `n8n_executions` (action `list` → luego `get` con `mode: error`) para ver
  el error real, el input del nodo y el path de ejecución.
- Valida con `n8n_validate_workflow`; consulta la config esperada del nodo con `get_node`.
- Si toca datos, confírmalos en Supabase con `execute_sql` (solo lectura).

## 2. Trampas conocidas de ESTE proyecto

- **Code node:** no existen `fetch`, `URLSearchParams`, `$helpers`. `undefined` se serializa como
  string `"undefined"` → omite el campo. Usa `$json` (no `json`); todo valor de expresión empieza
  con `=`. (BUG-001 y BUG-002 salieron exactamente de esto.)
- **HTTP a Supabase:** ¿credencial `Supabase account` o key **hardcodeada**? La anon key choca con
  RLS en tablas protegidas → INSERT bloqueado (BUG-007). Filtro `or`: `(nombre.ilike.*X*,categoria.ilike.*X*)`.
- **AI Agent:** producto_id inventado, respuesta vacía (template var rota), loop de la misma tool.
- **Webhook:** responder 200 inmediato; ¿cambió el payload de Meta?

## 3. Diagnóstico + fix

Da la **causa raíz con evidencia** (nodo + expresión/línea) y el fix concreto. Si es un bug nuevo,
regístralo en `docs/shared/bug-tracker.md` con el formato del tracker.

Referencias: `docs/bot/n8n-workflow.md` · `docs/bot/subworkflows.md` · `docs/bot/ai-agents.md` ·
`docs/shared/edge-cases.md`.
