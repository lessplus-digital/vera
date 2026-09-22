---
name: debug-n8n
description: Depura un fallo del bot que pueda venir de n8n — lee el workflow real, las ejecuciones con error y los tipos de nodo por el MCP nativo. Úsalo cuando el bot no conteste, conteste de más o guarde mal; cuando un nodo no dispare, un workflow muera a medias o una ejecución falle; y ante síntomas tipo 409, "eq.undefined", campos vacíos o un paso que falla en verde.
---

Depura el fallo de n8n que se esté investigando (el workflow, nodo o síntoma que nombró el
usuario).

## 1. Traer el estado real (no suponer)

- Ubica el workflow con `search_workflows` si hace falta; tráelo con `get_workflow_details`.
  El volcado es **grande**: si solo necesitas uno o dos nodos, delega la lectura al subagente
  `n8n-inspector` para no meter el JSON entero en el contexto principal.
- Si falla en ejecución: `search_executions` (filtra por `status: error`) → `get_execution` para ver
  el error real, el input del nodo y el path de ejecución.
- Valida con `validate_workflow`; consulta la config esperada del nodo con `search_nodes` +
  `get_node_types` (los discriminadores resource/operation/mode salen de la búsqueda).
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
regístralo en `docs/bug-tracker.md` con el formato del tracker.

Referencias: `docs/bot/n8n-workflow.md` · `docs/bot/subworkflows.md` · `docs/bot/ai-agents.md` ·
`docs/edge-cases.md`.
