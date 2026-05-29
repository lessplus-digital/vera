# Comando: Debug n8n Workflow

> Usa este contexto cuando necesites ayuda para depurar un problema en n8n.

## Información que necesito

Antes de depurar, reúne esta info:

1. **¿Qué nodo falla?** (nombre exacto del nodo en n8n)
2. **¿Cuál es el error?** (mensaje de error completo)
3. **¿Qué input recibió el nodo?** (JSON del panel de ejecución)
4. **¿Es intermitente o constante?**

## Problemas comunes y dónde buscar

### Error en Code node
- Revisa que no uses `fetch`, `URLSearchParams`, `$helpers` — no existen en n8n
- Campos `undefined` se envían como string `"undefined"` — omite el campo si no tiene valor
- Ver: `.claude/projects/vera-pizzeria/EDGE-CASES.md` → casos 3 y 4

### Error en HTTP Request (Supabase)
- ¿Headers correctos? `apikey` y `Authorization: Bearer`
- ¿El filtro tiene `%` o wildcards? No deben ir si consultar_menu los limpia
- ¿El campo `or` tiene paréntesis? Debe ser: `(nombre.ilike.*X*,categoria.ilike.*X*)`

### Error en AI Agent
- ¿El LLM inventó un producto_id? → Revisar logs de tool calls
- ¿La respuesta está vacía? → Revisar si el sistema prompt tiene template vars rotas
- ¿Loop infinito de tools? → Revisar si el agente llama la misma tool repetidamente

### Error en Webhook
- ¿Meta está reenviando? → Verificar que el webhook responde 200 inmediato
- ¿Payload cambió? → Revisar versión de la API de WhatsApp Business

## Archivos de referencia

- Flujo del workflow: `.claude/projects/vera-pizzeria/N8N-WORKFLOWS.md`
- Reglas del agente: `.claude/projects/vera-pizzeria/AI-AGENT.md`
- Errores conocidos: `.claude/projects/vera-pizzeria/EDGE-CASES.md`
