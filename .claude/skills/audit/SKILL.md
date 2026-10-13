---
name: audit
description: Barrido de seguridad y salud de las capas — RLS y políticas en Supabase, secretos y configuración del servidor del bot (VPS, .env, webhooks) y del dashboard (bundle) — contrastado contra el bug-tracker. Úsalo cuando pidan auditar, revisar seguridad, revisar RLS o permisos, comprobar que no quedaron keys expuestas, o antes de una tanda de despliegues.
---

Corre un chequeo de seguridad y salud, y compáralo con lo ya registrado.

## 1. Supabase — RLS y políticas
```sql
select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
```
Y revisa `pg_policies`. Marca las tablas **sin** RLS y las que tienen políticas laxas. Revisa
también las funciones `SECURITY DEFINER`: cada una debe autorizarse sola (`auth.uid() IS NULL → allow`
solo para la secret key del servidor).

## 2. Servidor del bot (`server/`)
- **Webhook de Meta:** la firma `X-Hub-Signature-256` se verifica con `WA_APP_SECRET` (401 si no cuadra).
- **`/hooks/estado-pedido`** exige `x-webhook-token` = `HOOK_TOKEN`; **`/api/wa`** exige el JWT de
  sesión y revisa el rol en `perfiles`; **CORS** solo a `DASHBOARD_ORIGENES`.
- **Secretos:** ninguna clave en git (el repo es **público**); `server/.env` solo en el VPS.
- **Contenedor:** `docker ps` healthy, `curl https://bot.plateo.cloud/salud`.

## 3. Dashboard (bundle público)
Descarga el bundle publicado y busca claves: el token de Meta (`EAA…`), `sb_secret_`, `service_role`.
Solo debe haber la publishable key de Supabase y `VITE_WA_PROXY_URL`.

## 4. Comparar y registrar
Contrasta con `docs/bug-tracker.md` (abiertos) y `docs/backlog.md` (riesgos aceptados). **Agrega solo
lo nuevo** — no dupliques. Presenta un resumen priorizado (🔴🟡🟢).

## Reglas
- **No apliques remediaciones automáticamente**: presenta el hallazgo y el SQL/cambio propuesto y
  deja decidir al usuario (para aplicar un fix acordado usa `/fix-bug`).
- Riesgo aceptado conocido (no re-reportar como nuevo): el token de WhatsApp que estuvo en el bundle
  sigue vigente hasta la instalación en el cliente real — ver `docs/backlog.md`.
