# Documentación — Vera Pizzería

Base de conocimiento del sistema, organizada por las **tres capas** que lo componen.
Empieza aquí y baja al documento de la capa que vas a tocar. La puerta de entrada
para Claude es `CLAUDE.md` (raíz); este índice es el detalle.

```
docs/
├── README.md              ← este índice
├── architecture.md        ← visión global del sistema (las 3 capas juntas)
│
├── bot/                   ← Capa 1 · Automatización WhatsApp (n8n + OpenAI)
│   ├── n8n-workflow.md    ← workflow principal (trigger → routing → agentes)
│   ├── feedback.md        ← sistema de feedback: job que pide + subworkflow que procesa
│   ├── ai-agents.md       ← agentes IA: arquitectura, tools, reglas (referencia)
│   ├── agent-prompts.md   ← system prompts completos verbatim (fuente de verdad)
│   └── subworkflows.md    ← lógica server-side de las tools (n8n)
│
├── database/             ← Capa 2 · Supabase (PostgreSQL) — backend compartido
│   └── schema.md          ← tablas, columnas, triggers, RPCs
│
├── dashboard/            ← Capa 3 · Frontend React + Vite (ESTE repositorio)
│   └── components.md      ← componentes, hooks, estructura del frontend
│
└── shared/               ← Transversal a las tres capas
    ├── bug-tracker.md     ← lista ACTIVA de bugs/mejoras por corregir (incl. dashboard)
    ├── edge-cases.md      ← casos límite y lecciones aprendidas (gotchas del bot)
    └── changelog.md       ← decisiones arquitectónicas (con el porqué)
```

## Las tres capas

| Capa | Qué es | Dónde vive | Doc |
|---|---|---|---|
| **Bot** | Agente IA que toma pedidos por WhatsApp | n8n (servidor externo) | [`bot/`](bot/) |
| **Base de datos** | PostgreSQL, backend compartido | Supabase Cloud | [`database/schema.md`](database/schema.md) |
| **Dashboard** | Panel admin en tiempo real | Este repositorio | [`dashboard/components.md`](dashboard/components.md) |

> El bot y el dashboard **comparten el mismo esquema PostgreSQL**. Solo el
> dashboard vive en este repo; el workflow de n8n y la base de datos viven fuera.

## Cómo mantener esta documentación al día

Cuando hagas un cambio significativo, actualiza el doc que corresponde:

| Cambiaste… | Actualiza |
|---|---|
| Esquema de BD (tabla, trigger, RPC) | `database/schema.md` |
| Workflow o tool del agente | `bot/n8n-workflow.md` + `bot/ai-agents.md` |
| Componente o hook de React | `dashboard/components.md` |
| Encontraste un bug por corregir | `shared/bug-tracker.md` |
| Resolviste un bug / lección reutilizable | `shared/edge-cases.md` |
| Tomaste una decisión arquitectónica | `shared/changelog.md` |

La infraestructura como código (RLS, seguridad) se documenta aparte en
[`../infra/supabase/README.md`](../infra/supabase/README.md).
