# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This repo is **only the admin dashboard** (React + Vite SPA) for Vera Pizzería. It is
one of three layers of a larger system — the other two (the n8n WhatsApp bot and the
Supabase database) live outside this repo but share the same PostgreSQL schema:

- **Bot WhatsApp** — n8n workflow + OpenAI agent that takes orders over WhatsApp. Its
  design, system prompt, and tools are documented in `docs/bot/` — the workflow itself
  is not in this repo.
- **Supabase (PostgreSQL)** — shared database. This dashboard reads/writes it directly
  via `@supabase/supabase-js`.
- **This dashboard** — real-time admin panel to manage orders, support chat, clients,
  reservations, and statistics.

> **Migration in progress (2026-09-29): the bot is moving from n8n to a Node server in
> `server/` (this repo).** Principle: *the AI talks, the code decides* — critical actions live in
> tested code, the LLM only classifies and writes. n8n stays the live bot until the cutover
> (Phase 8); until then `docs/bot/n8n-*.md` describe production and `docs/bot/servidor.md`
> describes the new server and its phase status. Rollback point: git tag `pre-migracion-node`.
> **The GitHub repo is public** — never commit n8n exports, DB dumps or operational data.

## Commands

```bash
npm run dev       # Vite dev server (needs .env.local — see below)
npm run build     # production build
npm run preview   # serve the production build locally
```

The **dashboard** has no test runner, linter, or typecheck — its `package.json` has only
`dev`/`build`/`preview`. Don't invent `npm test`/`npm run lint` at the root.

The **bot server** (`server/`, its own `package.json`) does have them — run from `server/`:

```bash
npm test           # Vitest unit tests (no network)
npm run typecheck
npm run sim        # WhatsApp simulator: server/test/escenarios/*.yaml, 5 runs each (thresholds: critico 100%, rest ≥90%)
npm run chat       # talk to the bot from the terminal
```

Prefer the **`bot-sim`** subagent for simulator runs (returns only failures). Simulator phones use
the test range `5730000009xx`, same as the SQL batteries.

**But there IS a test suite** (2026-09-09), and it's not JavaScript: `qa/sql/` holds 10
deterministic SQL batteries (~3.650 cases) covering the RPCs, triggers, constraints and RLS —
which is where most of the logic a customer can break actually lives. They run **through the
Supabase MCP**, not through npm. Each file returns **only the rows that fail** (empty = green);
the ones that write are wrapped in `BEGIN … ROLLBACK`. Before changing a function, a trigger or an
RPC, check whether a battery covers it and re-run it afterwards. Status and findings live in
`qa/RESULTADOS.md`; each battery's header carries the invariants it checks and the setup traps
that already bit (snapshot-in-subquery, the `touch_updated_at` trigger defeating a backdated
`UPDATE`, RLS-blocked writes that don't raise).

### MCP servers, skills and subagents

**Two MCP servers** reach the live system: **`supabase`** and **`n8n-native`**. The community
`n8n-mcp` (npx) was removed on 2026-09-21 — writes had already moved to `n8n-native` (BUG-030)
and it stopped connecting. Nothing should reference `mcp__n8n-mcp__*` any more.

**Skills (`.claude/skills/`)** carry the project's workflows. They are written to fire on their own
when the situation matches, not only when typed as `/name`:

| Skill | Fires when |
|---|---|
| `verify-against-live` | documenting or reasoning about a workflow, table, RLS policy, trigger or RPC |
| `fix-bug` | a `BUG-NNN` is named, or a tracked defect is being fixed or closed |
| `qa-regresion` | a DB function, trigger, RPC, constraint or policy changed — picks the battery that covers it |
| `debug-n8n` | the bot misbehaves and the cause may be in n8n |
| `audit` | a security / RLS / secrets sweep is asked for |
| `new-tool` | a tool of the WhatsApp agent is added or changed |

**Subagents (`.claude/agents/`)** keep huge tool output out of the main context — prefer them over
calling the MCPs directly when the dump would be large:

- **`qa-battery`** — runs one `qa/sql/` battery and returns only the verdict and the failing rows.
- **`bot-sim`** — runs the Node bot's WhatsApp simulator (`server/`) and returns only the verdict
  and the failing steps, classified as real / scenario / infrastructure failures.
- **`n8n-inspector`** — read-only n8n reader (nodes, wiring, failed executions, `versionId` vs
  `activeVersionId`). It cannot write or publish; applying a fix stays in the main thread.

**Hooks (`.claude/settings.json` + `.claude/hooks/`)** run on their own; you don't call them:

- after every Write/Edit → `tidy-file.mjs`: **blocks** if a `.json` was left unparseable, and strips
  trailing whitespace / adds the final newline on code files. It preserves CRLF and skips `.md`
  (`docs/architecture.md` uses Markdown's two-space hard break).
- after `update_workflow` → `n8n-publicar.mjs`: reminds you that the change is still a **draft**
  until `publish_workflow` runs and `versionId == activeVersionId`.
- on Stop → blocks if `src/` changed without `docs/`, and flags untracked junk (`*.bak`, `*.tmp`, …).

### Environment (`.env.local`, git-ignored)

Copy `.env.example` → `.env.local`. `src/lib/supabase.js` throws at startup if the
Supabase vars are missing. All vars are `VITE_`-prefixed, so **they are bundled into the
client** (see the WhatsApp token note under Gotchas).

## Architecture

**No router.** `src/App.jsx` is an auth gate: splash while the Supabase session **and the
user's profile** load, `LoginPage` if there's no session, a "sin acceso" screen if the user
has no usable role, otherwise `DashboardShell`. `DashboardShell` switches tabs via
`activeTab` state (not URLs): `dashboard`, `soporte`, `estadisticas`, `historial`,
`clientes`, `reservas`, `menu`, `resenas`, `usuarios`, `configuracion` — **filtered by role**.

Data hooks that query Supabase live inside `DashboardShell`, **not** `App` — they require
an authenticated session (RLS blocks everything otherwise), so they must not run on the
login screen. The **one declared exception** is the profile/role load, which lives in
`AuthProvider`: the role decides which screens exist, so it must resolve before the shell
mounts. It still doesn't query anything while there's no session.

**Auth + security model:** `src/hooks/useAuth.jsx` wraps the app in `AuthProvider`
(mounted in `main.jsx`). Supabase persists the session in localStorage and attaches the
JWT to every REST/Realtime call. Every table has **RLS enabled**, so the public anon key
alone returns nothing — a logged-in session is required. The secret `service_role` key is
meant to be used **only in n8n**, never here.

**Roles (2026-08-12): `admin` / `mesero` / `domiciliario`.** The role lives in `perfiles.rol`
and RLS policies read it via `public.mi_rol()`. Three rules you cannot get wrong:

1. **`src/utils/permisos.js` is NOT the security boundary** — it only hides screens the DB
   would return empty. The JWT travels on every REST and Realtime call, so filtering in React
   alone would let a `domiciliario` read the whole restaurant via the API.
2. **RLS filters ROWS, not COLUMNS.** When the rule is "only this role may touch this
   *column*", the boundary is a **trigger**, not a policy. Three exist already:
   `pedidos.domiciliario_id` (admin only), `perfiles.rol`/`activo` (admin only), and the
   delivery transition (RPC `marcar_entregado`, since the courier has no UPDATE policy).
3. **A `SECURITY DEFINER` function bypasses RLS**, so it must authorize itself. They all use
   the `auth.uid() IS NULL → allow` pattern so n8n/service_role keeps working.

Full matrix and the verification runs in `docs/database.md` §Modelo de permisos.

**Creating users requires `service_role`**, which cannot ship in the bundle (same reason as
the WhatsApp token). Accounts are created in the Supabase dashboard and land as
`domiciliario` via `trigger_crear_perfil`; the app only assigns roles.

**Edge Functions (`supabase/functions/`) are the escape hatch for that rule** — the only
server-side code in this repo, and they are **not** part of `npm run build`. Deploy them
with `npx supabase functions deploy <name>` (see README §Edge Functions). There is one:
`admin-password`, which lets an admin set another user's password. It exists precisely
because that needs `service_role`; the key stays a function secret. It authorizes itself
twice — `verify_jwt` at the gateway, then `mi_rol()` called **with the caller's token**
(never read from the JWT). Any new function must do the same: the gateway only proves
*someone* is logged in, not *who*.

> ✅ **Update (2026-07-22, verified via Supabase MCP):** RLS is now enabled on **every** table
> (BUG-012 fixed), all n8n nodes use credentials instead of hardcoded keys (BUG-003/007 fixed),
> and the project migrated to Supabase's new API keys: the dashboard uses the `sb_publishable_`
> key, n8n uses an `sb_secret_` key, and the leaked legacy JWT keys were disabled. See
> `docs/database.md` (permissions) and `docs/changelog.md`.

**Per-domain hooks own their data + realtime.** Each tab's data lives in one hook that
does the fetch, subscribes to a Supabase realtime channel, and exposes mutators:
`useOrders`, `useClients`, `useReservations`, `useSupportCount`, `useStatistics`. When
changing what a tab shows, start at its hook. `useOrders` also detects newly-arrived
orders (diffing against a `knownIds` ref) to play a sound and flash the card.

**Styling:** LESS files under `src/styles/`, imported in `main.jsx`. Theme is
dark/light CSS variables toggled by `useTheme` (persisted to localStorage, applied as
`data-theme` on the root).

**Design system (mandatory):** `docs/dashboard/design-system.md` is the visual source
of truth — tokens in `src/styles/index.css`, button hierarchy (`.btn primary|secondary|
ghost|danger`, ONE primary per screen), form pattern (`.field` with helpers BELOW the
input, never in the label), flat surfaces for info containers (glass only on
sidebar/topbar), one font family (mono is deprecated; numbers use `tabular-nums`), and
a validated chart palette (`--chart-1..3`, never cycled). Any UI change must follow it;
new patterns get added there first.

The React component/hook layout is documented in detail in
`docs/dashboard/components.md` — consult it before adding components; don't re-derive it.

## Conventions that will bite you if ignored

These are enforced by the shared DB and the bot, not just by this code:

- **DB identifiers are Spanish + lowercase** (`pedido_id`, `tipo_pedido`,
  `direccion_principal` — *not* `direccion`/`created_at`). Full schema in
  `docs/database.md`.
- **Order `total` is computed by a Postgres trigger**, never in JS and never by the LLM.
  When editing order items, call the `editar_pedido` RPC (not a direct update) so the
  trigger recalculates. Manual order creation inserts items and reads the total back.
- **`metodo_pago` is capitalized** (`'Efectivo'` / `'Transferencia'`) — the frontend
  compares against these exact strings (`METODO_LABEL` in `src/utils/constants.js`).
- **`fecha_pedido` is a `timestamp` without timezone holding a UTC value.** REST returns
  it with no `Z`, so raw `new Date()` would read it as local time. Always parse it via
  `parseDb()` in `src/utils/dateRanges.js`.
- **Business day = Colombia (UTC-5).** "Today's" orders are filtered from 05:00 UTC
  (see `useOrders`); statistics shift timestamps −5h and read with `getUTC*()`.
- **Client totals (fidelity, spend, risk) are aggregated from `pedidos`**, never from
  columns on `clientes` — those counters aren't maintained and the DB no longer has them.
- **Reservations require an existing client.** The reservation modal selects from
  `clientes`; a customer must be created in the Clients tab first.

## WhatsApp sending

The dashboard sends WhatsApp messages **directly from the browser** via
`src/lib/whatsapp.js` (Meta Graph API) — on resolving a support chat, and on
creating/deleting reservations and manual orders. These sends are **best-effort**: if the
API call fails, the DB operation still stands and the UI shows a warning toast.

**Gotcha / known deferred risk:** `VITE_WA_ACCESS_TOKEN` is a `VITE_` var, so the
WhatsApp access token ships in the client bundle. **The fix exists since 2026-10-02 (bot
migration, Phase 7) but is only switched on at the cutover:** with `VITE_WA_PROXY_URL` set,
`whatsapp.js` sends through the Node server (`POST {url}/api/wa` with the session JWT; the
server re-checks the role in `perfiles` — free text admin only, templates admin + mesero — and
holds the Meta token). Without it, the old direct call stays. At the cutover: set
`VITE_WA_PROXY_URL` in Vercel, **delete** `VITE_WA_ACCESS_TOKEN`, rotate the token in Meta.
Don't remove the direct path before the server is live, or production sends break.

## Deeper docs (`docs/`)

Rich, authoritative docs live in **`docs/`**. Two groups: **one document per layer**
(`architecture.md`, `database.md`, `bot/`, `dashboard/`) and, at the root of `docs/`, the
**project-state docs** consulted daily (`bug-tracker`, `backlog`, `changelog`, `edge-cases`).
Single-file folders were flattened on 2026-09-21: `database/schema.md` → `database.md`, and
`shared/*` → `docs/*`. Start at `docs/README.md` (the index). Consult the relevant one before
making a significant change — don't re-derive what's already written:

| Layer | Docs |
|---|---|
| System-wide | `docs/architecture.md` |
| **Bot** (n8n + WhatsApp) | `docs/bot/n8n-workflow.md`, `docs/bot/ai-agents.md` |
| **Database** (Supabase) | `docs/database.md` |
| **Dashboard** (this repo) | `docs/dashboard/components.md`, `docs/dashboard/design-system.md` |
| Cross-layer | `docs/bug-tracker.md` (open bugs), `docs/backlog.md` (pending features), `docs/changelog.md` (done), `docs/edge-cases.md` (lessons) |
| **Tests** | `qa/RESULTADOS.md` (status, findings, **and "Por dónde seguir"** — start here), `qa/sql/` (the batteries), `qa/guiones-bot.md` (Layer B: the WhatsApp conversation scripts) |

When you make a significant change, update the matching doc:

- DB change → `docs/database.md`
- New workflow/tool → `docs/bot/n8n-workflow.md`, `docs/bot/ai-agents.md`
- New React component → `docs/dashboard/components.md`
- Bug found → `docs/bug-tracker.md` · bug resolved → remove it there + condensed
  entry in `docs/changelog.md` · lesson learned → `docs/edge-cases.md`
- Architectural decision → `docs/changelog.md` · deferred feature/idea → `docs/backlog.md`
- Changed a DB function/trigger/RPC → re-run the matching battery in `qa/sql/` and update
  `qa/RESULTADOS.md`; if the change is a fix for a bug the battery caught, add the regression case

## Global rules enforced by the bot + shared DB

These hold system-wide (the dashboard shares the same schema the bot writes):

- **DB identifiers: Spanish, lowercase** (`pedido_id`, `tipo_pedido`).
- **Order `total` is computed by a Postgres trigger** — never by JS and never by the LLM.
- **The LLM never invents a `producto_id`** — it must call `consultar_menu` first.
- **The bot never mentions internals** ("el sistema", "herramientas", n8n, Supabase).
- **Prices are always exact from the DB**, never approximated.

See `docs/bot/ai-agents.md` for the full agent rules.
