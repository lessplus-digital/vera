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
Contrasta con `docs/shared/bug-tracker.md` (abiertos) y `docs/shared/changelog.md` (resueltos:
secretos/keys BUG-003, RLS total BUG-012, webhook/versión BUG-011 — todo cerrado 2026-07-22/23).
**Agrega solo lo nuevo** al tracker — no dupliques. Presenta un resumen priorizado (🔴🟡🟢).

## Reglas
- **No apliques remediaciones automáticamente**: presenta el hallazgo y el SQL/cambio propuesto,
  y deja decidir al usuario (para aplicar un fix acordado usa `/fix-bug`).
- Estado esperado (post 2026-07-23): RLS ON en todas las tablas, bot escribiendo con la
  credencial `Supabase account` (`sb_secret_`), legacy keys deshabilitadas, webhook con Header
  Auth. Cualquier desviación de eso es un hallazgo.
- Riesgo diferido conocido (no re-reportar como nuevo): `VITE_WA_ACCESS_TOKEN` en el bundle
  del dashboard — ver `docs/shared/backlog.md`.
