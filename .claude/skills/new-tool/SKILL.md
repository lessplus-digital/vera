---
name: new-tool
description: Agrega o modifica una acción o herramienta del bot de WhatsApp Node (server/) — RPC nueva, acción del ejecutor o lectura de un handler — con checklist y pruebas. Úsalo cuando se vaya a darle al bot una capacidad nueva, cambiar lo que devuelve una existente, o conectar una RPC nueva a uno de los agentes (Menú / Pedidos / Soporte / Reservas).
---

Principio del servidor: **la IA conversa, el código decide.** Una capacidad nueva casi nunca es "una
tool que el modelo llama"; es una acción en código que la política decide y el ejecutor corre, o una
lectura que el handler ya hizo antes de redactar. Sigue el checklist y verifica contra la BD viva.

## 0. Contexto real
- `list_tables` / `execute_sql` (Supabase, solo lectura): confirma tabla, columnas y la RPC que se usará.
- Lee `docs/bot/servidor.md` (flujo del turno y reglas) y el handler destino en `server/src/handlers/`.

## 1. Decidir dónde vive
- [ ] ¿Cambia **qué se hace** (crear, cancelar, guardar, escalar)? → acción en `decision/politica.ts`
      (cuándo) + `decision/ejecutor.ts` (cómo). Nunca en el prompt.
- [ ] ¿Es **un dato que el agente necesita leer**? → lectura en el handler (`handlers/*.ts`), que se
      la pasa al modelo ya resuelta. El modelo no tiene herramientas que escriban.
- [ ] ¿Toca BD? → RPC `SECURITY DEFINER` con el patrón `auth.uid() IS NULL → allow` (ver `docs/database.md`).

## 2. Implementarla
- [ ] RPC / migración en `supabase/migrations/` (aplicada con `apply_migration`).
- [ ] Método en la interfaz `Repo` (`server/src/bd/repo.ts`) + `repo-supabase.ts` (real) + `sim/repo-memoria.ts` (simulador).
- [ ] Texto fijo en `server/src/textos.ts` si el cliente ve algo; los números salen siempre de la BD.
- [ ] Si el modelo redacta: cuida la guardia (`guardia/guardia.ts`) — no puede contradecir lo que el código ya dijo.

## 3. Probar (los tres niveles)
- [ ] Unitaria en `server/test/unit/` — la regla, sin red ni modelo.
- [ ] Escenario en `server/test/escenarios/*.yaml` — con el modelo real (`npm run sim -- <nombre> --veces 1`,
      ×5 solo al cerrar; cada corrida gasta OpenAI).
- [ ] Si tocó una función, trigger o RPC: corre la batería de `qa/sql/` que la cubre (skill `qa-regresion`).

## 4. Documentar
- [ ] `docs/bot/servidor.md` (el flujo o la regla) · `docs/database.md` (si hay RPC/tabla) · `docs/changelog.md` (la decisión).
