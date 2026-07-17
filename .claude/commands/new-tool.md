---
description: Agrega una nueva tool al agente IA (checklist + validación contra n8n/Supabase reales)
argument-hint: [nombre de la tool, ej. consultar_horario]
allowed-tools: mcp__n8n-mcp__get_node, mcp__n8n-mcp__search_nodes, mcp__n8n-mcp__n8n_get_workflow, mcp__supabase__list_tables, mcp__supabase__execute_sql, Read
---

Agregar la tool **$ARGUMENTS** al agente de WhatsApp. Sigue el checklist y **verifica contra las
fuentes reales** (MCP) — no supongas el esquema ni la config de los nodos.

## 0. Contexto real (MCP) — antes de diseñar
- `list_tables` / `execute_sql` (Supabase, read-only): confirma la tabla y columnas que tocará.
- `get_node` / `search_nodes` (n8n): la config exacta del tipo de nodo.
- `n8n_get_workflow` del workflow "Pizzeria Vera": mira cómo se cablean las tools existentes del
  agente destino (Menú / Pedidos / Soporte / Reservas).

## 1. Definir la tool
- [ ] Nombre snake_case español · descripción clara para el LLM · input schema · output.

## 2. Implementar en n8n
- [ ] ¿Query simple? → nodo Supabase (**credencial `Supabase account`, NO key hardcodeada**).
- [ ] ¿Lógica? → subworkflow (Code + HTTP). Valida inputs (`$json`, no `null`/`undefined`).
- [ ] Probar el subworkflow aislado antes de conectarlo.

## 3. Conectar al agente correcto
- [ ] Nodo `toolWorkflow`/Supabase tool en el AI Agent · input mapping (`$fromAI(...)`) · verificar output.

## 4. System prompt
- [ ] Reglas de uso (cuándo SÍ / cuándo NO) · si trae datos, ¿consultar antes de responder?

## 5. Documentar (obligatorio en este repo)
- [ ] `docs/bot/subworkflows.md` — el subworkflow (si aplica) · `docs/bot/ai-agents.md` — la tool.
- [ ] `docs/bot/agent-prompts.md` — el prompt verbatim si lo tocaste · `docs/shared/changelog.md` — la decisión.

## 6. Probar
- [ ] Caso feliz · sin resultados (sin mencionar internos) · inputs raros/vacíos · cuándo NO debe usarla.

## Template de especificación

```
### nombre_de_la_tool
| Campo | Detalle |
|---|---|
| Tipo | Supabase / Subworkflow / HTTP Request |
| Tabla | `nombre_tabla` |
| Input | `{ campo1: tipo, campo2?: tipo }` |
| Output | `{ resultado }` |
| Cuándo | cuándo el LLM debe usarla |
| NUNCA | cuándo NO |
```
