# Vera Pizzería — Sistema de Automatización

Automatiza la atención de un restaurante por WhatsApp: el cliente escribe, un bot IA atiende de
forma natural (menú, pedidos, reservas, soporte) y todo se gestiona desde un dashboard admin en
tiempo real.

## Las tres capas

| Capa | Qué es | Dónde vive |
|---|---|---|
| **Bot** | Servidor Node: la IA conversa, el código decide | [`server/`](server/) en este repo · corre en un VPS (Docker) |
| **Base de datos** | PostgreSQL — esquema compartido, triggers, RPCs | Supabase ([`supabase/`](supabase/) guarda las migraciones) |
| **Dashboard** | SPA React + Vite para gestionar pedidos/soporte/reservas/estadísticas | `src/` (este repositorio) · Vercel |

## Stack

| | |
|---|---|
| Bot | Node + TypeScript · clasificador y redactor con OpenAI · política y acciones en código |
| Base de datos | Supabase (PostgreSQL) + extensiones `pg_trgm` / `unaccent` |
| Canal | WhatsApp Business Cloud API (Meta) |
| Frontend | React + Vite · Supabase JS (datos + realtime) · Recharts · react-big-calendar |

## Arquitectura

```
┌────────────┐    ┌────────────────────────────────────────┐    ┌──────────────────┐
│  WhatsApp  │───▶│  Servidor del bot (Node, server/)      │───▶│  Supabase        │
│  Business  │◀───│  clasifica → decide → ejecuta →        │◀───│  PostgreSQL      │
│  Cloud API │    │  redacta → guardia                      │    │  (esquema        │
└────────────┘    └────────────────────────────────────────┘    │   compartido)    │
      ▲                                                          └──────────────────┘
      │ /api/wa                                                          │ Realtime
┌─────┴────────────────────────────────────┐                             ▼
│  Dashboard React + Vite (este repo)      │◀────────────────────────────┘
│  Pedidos · Soporte · Estadísticas ·      │
│  Clientes · Reservas · Menú · Usuarios   │
└──────────────────────────────────────────┘
```

## Quick start (dashboard)

```bash
cp .env.example .env.local    # completar VITE_SUPABASE_* y VITE_WA_*
npm install
npm run dev                   # Vite dev server
npm run build                 # build de producción
npm run preview               # servir el build
```

`src/lib/supabase.js` lanza al arrancar si faltan las `VITE_SUPABASE_*`. El dashboard no tiene test
runner ni linter; el bot (`server/`) sí: `npm test`, `npm run typecheck`, `npm run sim`.
Toda variable del dashboard es `VITE_`-prefijada (va al bundle del cliente: **nunca un secreto**).

## Bot (`server/`)

```bash
cd server
cp .env.example .env     # ver las variables dentro
npm test                 # pruebas unitarias (sin red)
npm run sim              # simulador de WhatsApp: escenarios con el modelo real (gasta OpenAI)
npm run chat             # hablar con el bot desde la terminal
```

Despliegue en el VPS: [`docs/bot/despliegue.md`](docs/bot/despliegue.md).

### Edge Functions

`supabase/functions/` no entra en `npm run build`: se despliega aparte con la CLI de Supabase. Hoy
hay una, `admin-password`, que permite a un admin cambiar la contraseña de otro usuario desde la tab
Usuarios — existe porque la `service_role` que eso exige no puede viajar en el bundle.

```bash
npx supabase login                                    # una vez, abre el navegador
npx supabase link --project-ref lwigogymjoyyzwiyewgi  # una vez, en este repo
npx supabase functions deploy admin-password
```

Sin desplegarla, la tab Usuarios funciona entera salvo el botón de contraseña, que devuelve error.
Detalle en `docs/database.md` §Edge Functions.

## Documentación

La documentación completa vive en **[`docs/`](docs/README.md)**:

| Tema | Doc |
|---|---|
| Visión global del sistema | [`docs/architecture.md`](docs/architecture.md) |
| **Bot** | [`docs/bot/servidor.md`](docs/bot/servidor.md) · [`despliegue`](docs/bot/despliegue.md) · [`feedback`](docs/bot/feedback.md) |
| **Base de datos** | [`docs/database.md`](docs/database.md) |
| **Dashboard** | [`docs/dashboard/components.md`](docs/dashboard/components.md) |
| Qué sigue | [`docs/backlog.md`](docs/backlog.md) |
| Bugs · lecciones · decisiones | [`bug-tracker`](docs/bug-tracker.md) · [`edge-cases`](docs/edge-cases.md) · [`changelog`](docs/changelog.md) |
| Seguridad / RLS | [`docs/database.md`](docs/database.md) — sección «Modelo de permisos» |

Contexto e instrucciones para Claude Code: [`CLAUDE.md`](CLAUDE.md).
