# Vera Pizzería — Sistema de Automatización

Automatiza la atención de un restaurante por WhatsApp: el cliente escribe, un bot IA atiende de
forma natural (menú, pedidos, reservas, soporte) y todo se gestiona desde un dashboard admin en
tiempo real.

## Las tres capas

| Capa | Qué es | Dónde vive |
|---|---|---|
| **Bot** | Workflow n8n + agentes OpenAI que atienden WhatsApp | n8n self-hosted (fuera de este repo) |
| **Base de datos** | PostgreSQL — esquema compartido, triggers, RPCs | Supabase (fuera de este repo) |
| **Dashboard** | SPA React + Vite para gestionar pedidos/soporte/reservas/estadísticas | **Este repositorio** |

> Solo el **dashboard** vive en este repo; el bot y la base de datos viven fuera pero comparten
> el mismo esquema PostgreSQL.

## Stack

| | |
|---|---|
| Automatización | n8n (self-hosted) |
| IA | OpenAI `gpt-5.1` — **orquestador + 4 agentes** (Menú, Pedidos, Soporte, Reservas) con memoria Postgres |
| Base de datos | Supabase (PostgreSQL) + extensiones `pg_trgm` / `unaccent` |
| Canal | WhatsApp Business Cloud API (Meta) |
| Frontend | React + Vite · Supabase JS (datos + realtime) · Recharts · react-big-calendar |

## Arquitectura

```
┌────────────┐    ┌───────────────────────────────────────────────┐    ┌────────────────┐
│  WhatsApp  │───▶│  n8n (Motor de Automatización)                │───▶│  Supabase      │
│  Business  │◀───│  Acumular mensajes → Router de modo →          │◀───│  PostgreSQL    │
│  Cloud API │    │  ORQUESTADOR (gpt-5.1) → 4 agentes:            │    │  (esquema      │
└────────────┘    │    Menú · Pedidos · Soporte · Reservas         │    │   compartido)  │
                  │  + Job programado: pide feedback tras entrega  │    └────────────────┘
                  └───────────────────────────────────────────────┘           │ Realtime
                                                                               ▼
                                              ┌──────────────────────────────────────┐
                                              │  Dashboard React + Vite (este repo)    │
                                              │  Pedidos · Soporte · Estadísticas ·    │
                                              │  Clientes · Reservas                   │
                                              └──────────────────────────────────────┘
```

## Quick start (dashboard)

```bash
cp .env.example .env.local    # completar VITE_SUPABASE_* y VITE_WA_*
npm install
npm run dev                   # Vite dev server
npm run build                 # build de producción
npm run preview               # servir el build
```

`src/lib/supabase.js` lanza al arrancar si faltan las `VITE_SUPABASE_*`. No hay test runner ni
linter configurados. Toda variable es `VITE_`-prefijada (van al bundle del cliente).

## Documentación

La documentación completa —verificada contra n8n y Supabase reales vía MCP— vive en
**[`docs/`](docs/README.md)**:

| Tema | Doc |
|---|---|
| Visión global del sistema | [`docs/architecture.md`](docs/architecture.md) |
| **Bot** (n8n) | [`docs/bot/`](docs/bot/) — workflow, agentes, prompts, feedback, subworkflows |
| **Base de datos** | [`docs/database/schema.md`](docs/database/schema.md) |
| **Dashboard** | [`docs/dashboard/components.md`](docs/dashboard/components.md) |
| Bugs por corregir · lecciones · decisiones | [`docs/shared/`](docs/shared/) |
| Seguridad / RLS como código | [`infra/supabase/`](infra/supabase/) |

Contexto e instrucciones para Claude Code: [`CLAUDE.md`](CLAUDE.md).
