---
name: new-tool
description: Agrega o modifica una tool del agente de WhatsApp, con checklist y verificación contra n8n y Supabase reales. Úsalo cuando se vaya a crear una tool nueva para el bot, cambiar lo que devuelve una existente, o conectar una RPC nueva a uno de los agentes (Menú / Pedidos / Soporte / Reservas).
---

Agregar o modificar la tool indicada en el agente de WhatsApp. Sigue el checklist y **verifica
contra las fuentes reales** (MCP) — no supongas el esquema ni la config de los nodos.

## 0. Contexto real (MCP) — antes de diseñar
- `list_tables` / `execute_sql` (Supabase, read-only): confirma la tabla y columnas que tocará.
- `search_nodes` → `get_node_types` (n8n): la config exacta del tipo de nodo. Nunca adivines
  nombres de parámetros; el tipo los da literales.
- `get_workflow_details` del workflow "Pizzeria Vera": mira cómo se cablean las tools existentes
  del agente destino (Menú / Pedidos / Soporte / Reservas). Para no volcar el JSON entero en el
  contexto, delega esa lectura al subagente `n8n-inspector`.

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
- [ ] `docs/bot/agent-prompts.md` — el prompt verbatim si lo tocaste · `docs/changelog.md` — la decisión.

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
