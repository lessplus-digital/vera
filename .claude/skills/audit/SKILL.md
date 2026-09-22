---
name: audit
description: Barrido de seguridad y salud de las tres capas — RLS y políticas en Supabase, secretos/webhooks/credenciales en n8n — contrastado contra el bug-tracker. Úsalo cuando pidan auditar, revisar seguridad, revisar RLS o permisos, comprobar que no quedaron keys expuestas, o antes de una tanda de despliegues.
---

Corre un chequeo de seguridad y salud, y compáralo con lo ya registrado.

## 1. n8n — a mano, con el MCP nativo

No hay tool de auditoría: `n8n_audit_instance` vivía en el servidor comunitario `n8n-mcp`, que se
retiró del proyecto (no volvió a conectar). El barrido se hace leyendo. Delega la lectura en el
subagente **`n8n-inspector`** — los volcados son enormes — y pídele estos cuatro puntos:

- **Secretos a mano:** cualquier `apikey`, `Authorization` o `Bearer` escrito dentro de
  `parameters` en vez de venir de una credencial. Lo esperado: la credencial `Supabase account`
  (`sb_secret_`). Fue BUG-003/007; que esté cerrado no quiere decir que siga cerrado.
- **Webhooks sin auth:** todo nodo Webhook debe llevar Header Auth (BUG-011).
- **Credenciales huérfanas o de más:** `list_credentials` contra lo que los workflows usan de verdad.
- **Borradores sin publicar:** `versionId != activeVersionId` significa que lo que crees desplegado
  no está corriendo. Es hallazgo, no curiosidad.

## 2. Supabase — RLS y políticas
```sql
select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
```
Y revisa `pg_policies`. Marca las tablas **sin** RLS y las que tienen políticas laxas.

## 3. Comparar y registrar
Contrasta con `docs/bug-tracker.md` (abiertos) y `docs/changelog.md` (resueltos:
secretos/keys BUG-003, RLS total BUG-012, webhook/versión BUG-011 — todo cerrado 2026-07-22/23).
**Agrega solo lo nuevo** al tracker — no dupliques. Presenta un resumen priorizado (🔴🟡🟢).

## Reglas
- **No apliques remediaciones automáticamente**: presenta el hallazgo y el SQL/cambio propuesto,
  y deja decidir al usuario (para aplicar un fix acordado usa `/fix-bug`).
- Estado esperado (post 2026-07-23): RLS ON en todas las tablas, bot escribiendo con la
  credencial `Supabase account` (`sb_secret_`), legacy keys deshabilitadas, webhook con Header
  Auth. Cualquier desviación de eso es un hallazgo.
- Riesgo diferido conocido (no re-reportar como nuevo): `VITE_WA_ACCESS_TOKEN` en el bundle
  del dashboard — ver `docs/backlog.md`.
