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

## Commands

```bash
npm run dev       # Vite dev server (needs .env.local — see below)
npm run build     # production build
npm run preview   # serve the production build locally
```

There is **no test runner, linter, or typecheck** configured. `package.json` has only
`dev`/`build`/`preview`. Don't invent `npm test`/`npm run lint` — they don't exist.

### Environment (`.env.local`, git-ignored)

Copy `.env.example` → `.env.local`. `src/lib/supabase.js` throws at startup if the
Supabase vars are missing. All vars are `VITE_`-prefixed, so **they are bundled into the
client** (see the WhatsApp token note under Gotchas).

## Architecture

**No router.** `src/App.jsx` is an auth gate: it shows a splash while the Supabase
session loads, `LoginPage` if there's no session, otherwise `DashboardShell`.
`DashboardShell` switches between five tabs via `activeTab` state (not URLs):
`dashboard` (Kanban), `soporte`, `estadisticas`, `clientes`, `reservas`.

Data hooks that query Supabase live inside `DashboardShell`, **not** `App` — they require
an authenticated session (RLS blocks everything otherwise), so they must not run on the
login screen.

**Auth + security model:** `src/hooks/useAuth.jsx` wraps the app in `AuthProvider`
(mounted in `main.jsx`). Supabase persists the session in localStorage and attaches the
JWT to every REST/Realtime call. The core tables the dashboard reads (`clientes`, `pedidos`,
`detalle_pedidos`, `reservas`, `menu`, `mensajes_soporte`) have **RLS enabled**, so the public
anon key alone returns nothing there — a logged-in session is required. The secret
`service_role` key is meant to be used **only in n8n**, never here.

> ⚠️ **Reality check (2026-07-16, verified via Supabase MCP):** RLS is *not* enabled on 6
> tables (`carritos`, `feedback`, `feedback_pendiente`, `info_negocio`, `n8n_chat_histories`,
> `n8n_mensajes_pendientes`) — they're exposed to the anon key. And several n8n nodes write with
> a hardcoded anon key instead of `service_role`. See `docs/database/schema.md` (permissions)
> and `docs/shared/bug-tracker.md` (BUG-003/007/012).

**Per-domain hooks own their data + realtime.** Each tab's data lives in one hook that
does the fetch, subscribes to a Supabase realtime channel, and exposes mutators:
`useOrders`, `useClients`, `useReservations`, `useSupportCount`, `useStatistics`. When
changing what a tab shows, start at its hook. `useOrders` also detects newly-arrived
orders (diffing against a `knownIds` ref) to play a sound and flash the card.

**Styling:** LESS files under `src/styles/`, imported in `main.jsx`. Theme is
dark/light CSS variables toggled by `useTheme` (persisted to localStorage, applied as
`data-theme` on the root).

The React component/hook layout is documented in detail in
`docs/dashboard/components.md` — consult it before adding components; don't re-derive it.

## Conventions that will bite you if ignored

These are enforced by the shared DB and the bot, not just by this code:

- **DB identifiers are Spanish + lowercase** (`pedido_id`, `tipo_pedido`,
  `direccion_principal` — *not* `direccion`/`created_at`). Full schema in
  `docs/database/schema.md`.
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
WhatsApp access token ships in the client bundle. This is a consciously deferred security
issue (the proper fix is proxying sends through n8n/an edge function). Don't "fix" it
silently — it's tracked.

## Deeper docs (`docs/`)

Rich, authoritative docs live in **`docs/`**, organized by the three system layers.
Start at `docs/README.md` (the index). Consult the relevant one before making a
significant change — don't re-derive what's already written:

| Layer | Docs |
|---|---|
| System-wide | `docs/architecture.md` |
| **Bot** (n8n + WhatsApp) | `docs/bot/n8n-workflow.md`, `docs/bot/ai-agents.md` |
| **Database** (Supabase) | `docs/database/schema.md` |
| **Dashboard** (this repo) | `docs/dashboard/components.md` |
| Cross-layer | `docs/shared/bug-tracker.md`, `docs/shared/edge-cases.md`, `docs/shared/changelog.md` |

When you make a significant change, update the matching doc:

- DB change → `docs/database/schema.md`
- New workflow/tool → `docs/bot/n8n-workflow.md`, `docs/bot/ai-agents.md`
- New React component → `docs/dashboard/components.md`
- Bug to fix → `docs/shared/bug-tracker.md` · lesson learned → `docs/shared/edge-cases.md`
- Architectural decision → `docs/shared/changelog.md`

## Global rules enforced by the bot + shared DB

These hold system-wide (the dashboard shares the same schema the bot writes):

- **DB identifiers: Spanish, lowercase** (`pedido_id`, `tipo_pedido`).
- **Order `total` is computed by a Postgres trigger** — never by JS and never by the LLM.
- **The LLM never invents a `producto_id`** — it must call `consultar_menu` first.
- **The bot never mentions internals** ("el sistema", "herramientas", n8n, Supabase).
- **Prices are always exact from the DB**, never approximated.

See `docs/bot/ai-agents.md` for the full agent rules.
