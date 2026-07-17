---
description: Barrido de seguridad y salud del sistema — auditoría de n8n + estado de RLS en Supabase, y registra lo nuevo en el bug-tracker
allowed-tools: mcp__n8n-mcp__n8n_audit_instance, mcp__supabase__execute_sql, mcp__supabase__list_tables, Read, Edit
---

Corre un chequeo de seguridad y salud, y compáralo con lo ya registrado.

## 1. n8n
`n8n_audit_instance` — secretos hardcodeados, webhooks sin auth, versión desactualizada,
credenciales sin uso.

## 2. Supabase — RLS y políticas
```sql
select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
```
Y revisa `pg_policies`. Marca las tablas **sin** RLS y las que tienen políticas laxas.

## 3. Comparar y registrar
Contrasta con `docs/shared/bug-tracker.md` (ya están BUG-003 secretos, BUG-007 anon/RLS,
BUG-011 versión/webhook, BUG-012 RLS off). **Agrega solo lo nuevo** — no dupliques. Presenta un
resumen priorizado (🔴🟡🟢).

## Reglas
- **No apliques remediaciones automáticamente**: los MCP son solo lectura y habilitar RLS sin
  políticas rompería el bot (escribe con anon en `carritos`/`feedback_pendiente`). Presenta el
  SQL/cambio y deja decidir al usuario.
- La `service_role` expuesta debe rotarse; los writes del bot deben migrar a la credencial de n8n.
