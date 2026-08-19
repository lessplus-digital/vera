---
description: Retoma el cableado pendiente de las zonas de domicilio en el bot (tool consultar_cobertura + prompts sin $5.000 quemado)
allowed-tools: Read, Edit, mcp__n8n-mcp__n8n_get_workflow, mcp__n8n-mcp__n8n_update_partial_workflow, mcp__n8n-mcp__n8n_list_workflows, mcp__n8n-mcp__n8n_workflow_versions, mcp__supabase__execute_sql
---

Aplicar lo que quedó pendiente de **zonas de domicilio con tarifa por barrio** en el workflow
principal de n8n. Todo el detalle (config exacta de los nodos y el texto literal de cada
reemplazo en los prompts) está en **`docs/bot/pendiente-zonas-domicilio.md`** — **léelo primero**,
no lo re-derives.

Contexto imprescindible: la BD y el dashboard ya están en producción desde el 2026-08-18. Lo único
que falta es n8n, y está bloqueado por **BUG-030**.

## 1. ¿Sigue bloqueado?

Antes de nada, prueba si la API ya acepta escrituras con una operación inocua:

```
n8n_update_partial_workflow(id: "8LI3J7PLi35zf4EJ", operations: [
  { type: "moveNode", nodeName: "Sticky Note", position: [-2032, -896] }
])
```

- **Falla con `settings must NOT have additional properties`** → sigue bloqueado. Ve al paso 2.
- **Pasa** → aplícalo todo por MCP siguiendo el doc, y salta al paso 3.

> No pierdas tiempo re-intentando `updateSettings` (mergea), `null` (no borra) ni
> `n8n_update_full_workflow` (mergea también): las cuatro vías están descartadas con evidencia en
> BUG-030. La causa es el cliente n8n-mcp, que debería filtrar `settings` a las 8 claves del
> esquema antes del `PUT`. **Vale la pena comprobar si hay una versión más nueva de n8n-mcp**:
> es lo único que destraba la vía automática.

## 2. Si sigue bloqueado

Entrega al usuario las instrucciones del doc, tal cual, para que las aplique en el editor de n8n.
No las resumas: los textos de las descripciones y los prompts van copiados literalmente o el
agente se comporta distinto. Ofrece ir sección por sección si lo prefiere.

## 3. Al terminar (lo aplique quien lo aplique)

Sigue la sección **"Al terminar"** del doc: verificar contra n8n real por MCP, sincronizar
`agent-prompts.md` (y quitar su bloque de deuda conocida), quitar los ⏳ de `ai-agents.md`, cerrar
la parte *Pendiente* del changelog y BUG-030, y la prueba de humo con una zona de tarifa distinta
de $5.000.

⚠️ **No inventes el estado del workflow.** Léelo con `n8n_get_workflow` (mode `filtered` con
`nodeNames` para no traerte los 101 nodos) antes de afirmar que algo quedó aplicado.
