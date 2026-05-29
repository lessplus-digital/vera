# Comando: Agregar una nueva tool al agente IA

> Usa este checklist cuando necesites agregar una nueva herramienta al agente de WhatsApp.

## Checklist

### 1. Definir la tool

- [ ] **Nombre** en snake_case español (ej: `consultar_horario`)
- [ ] **Descripción** clara para el LLM (qué hace, cuándo usarla)
- [ ] **Input schema** — qué parámetros recibe y de qué tipo
- [ ] **Output** — qué retorna al agente

### 2. Implementar en n8n

- [ ] ¿Es una query simple? → Nodo Supabase directo
- [ ] ¿Necesita lógica? → Subworkflow (Code nodes + HTTP Request)
- [ ] Validar que los inputs no sean `undefined` ni `null`
- [ ] Probar el subworkflow aislado antes de conectar al agente

### 3. Conectar al agente

- [ ] Agregar como tool en el nodo AI Agent de n8n
- [ ] Configurar input mapping
- [ ] Verificar que el output llega correctamente al agente

### 4. Actualizar system prompt

- [ ] Agregar reglas de uso de la nueva tool
- [ ] Definir cuándo DEBE usarla vs cuándo NO
- [ ] Si trae datos, ¿el LLM debe consultar ANTES de responder?

### 5. Actualizar documentación

- [ ] `N8N-WORKFLOWS.md` — agregar especificación de la tool
- [ ] `AI-AGENT.md` — agregar reglas en el system prompt
- [ ] `CHANGELOG.md` — registrar la decisión

### 6. Probar

- [ ] Caso feliz: el LLM la usa correctamente
- [ ] Caso sin resultados: el LLM responde sin mencionar internos
- [ ] Caso con datos raros: inputs vacíos, caracteres especiales
- [ ] El LLM NO la usa cuando no debería

## Template de especificación

```
### nombre_de_la_tool

| Campo | Detalle |
|---|---|
| Tipo | Supabase INSERT / Subworkflow / HTTP Request |
| Tabla | `nombre_tabla` |
| Input | `{ campo1: tipo, campo2?: tipo }` |
| Output | `{ resultado }` |
| Cuándo | Descripción de cuándo el LLM debe usarla |
| NUNCA | Descripción de cuándo NO debe usarla |
```
