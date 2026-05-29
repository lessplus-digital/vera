# Vera Pizzería — Contexto del Proyecto


## ¿Qué es este proyecto?

Sistema de automatización para Vera Pizzería con tres capas:

1. **Bot WhatsApp** — Agente IA que toma pedidos por WhatsApp (n8n + OpenAI)
2. **Base de datos** — Supabase (PostgreSQL) con tablas en español y minúsculas
3. **Dashboard Admin** — React + Vite para gestionar pedidos y soporte en tiempo real

## Stack

| Capa | Tecnología | Dónde vive |
|---|---|---|
| Automatización | n8n (self-hosted) | Servidor externo |
| Base de datos | Supabase (PostgreSQL) | Cloud Supabase |
| LLM | OpenAI GPT (vía n8n AI Agent) | API |
| Frontend | React + Vite | Este repositorio |
| Canal | WhatsApp Business API | Meta Cloud API |

## Estructura de contexto .claude/

```
.claude/
├── claude.md                          ← ESTE ARCHIVO (lee primero)
├── commands/                          ← Comandos reutilizables
│   ├── debug-n8n.md                   ← Guía para depurar workflows
│   └── new-tool.md                    ← Agregar una tool al agente IA
└── projects/
    └── vera-pizzeria/
        ├── ARCHITECTURE.md            ← Arquitectura completa del sistema
        ├── DATABASE.md                ← Esquema Supabase (tablas, triggers, RPCs)
        ├── N8N-WORKFLOWS.md           ← Diseño de workflows y subworkflows
        ├── AI-AGENT.md                ← System prompt, tools, reglas del LLM
        ├── DASHBOARD.md               ← Componentes React, estructura del frontend
        ├── EDGE-CASES.md              ← Casos límite documentados
        ├── ERRORS.md                  ← Estrategia de manejo de errores
        └── CHANGELOG.md              ← Decisiones y cambios importantes
```

## Reglas globales

- Variables en base de datos: **español, minúsculas** (ej: `pedido_id`, `tipo_pedido`)
- El total del pedido **NUNCA** lo calcula el LLM — siempre el trigger de Supabase
- El LLM **NUNCA** inventa `producto_id` — siempre llama `consultar_menu` primero
- El bot **NUNCA** menciona "el sistema", "herramientas" ni procesos internos
- Los precios **NUNCA** son aproximados — siempre exactos desde la BD

## Cómo actualizar este contexto

Cuando hagas un cambio significativo:

1. **Cambio en BD** → actualiza `DATABASE.md`
2. **Nuevo workflow o tool** → actualiza `N8N-WORKFLOWS.md` y `AI-AGENT.md`
3. **Nuevo componente React** → actualiza `DASHBOARD.md`
4. **Bug resuelto o lección aprendida** → agrega a `EDGE-CASES.md`
5. **Decisión arquitectónica** → agrega a `CHANGELOG.md`
