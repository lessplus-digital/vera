# Documentación — Vera Pizzería

Base de conocimiento del sistema, organizada por las **tres capas** que lo componen.
Empieza aquí y baja al documento de la capa que vas a tocar. La puerta de entrada
para Claude es `CLAUDE.md` (raíz); este índice es el detalle.

```
docs/
├── README.md              ← este índice
│
│   ── UNA CAPA, UN DOCUMENTO ──
├── architecture.md        ← visión global del sistema (las 3 capas juntas)
├── database.md            ← Capa 2 · Supabase: tablas, triggers, RPCs, permisos
├── bot/                   ← Capa 1 · Bot de WhatsApp (servidor Node en server/)
│   ├── servidor.md        ← cómo funciona: flujo del turno, política, agentes, fases
│   ├── despliegue.md      ← cómo se instala y actualiza en el VPS (Docker + Traefik)
│   └── feedback.md        ← calificaciones: el job que pide la nota y la RPC que la procesa
├── dashboard/             ← Capa 3 · Frontend React + Vite (ESTE repositorio)
│   ├── components.md      ← componentes, hooks, estructura del frontend
│   ├── design-system.md   ← tokens, botones, forms, charts (fuente de verdad visual)
│   └── pos.md             ← análisis de impresión de tickets + cajón (sin código aún)
│
│   ── ESTADO DEL PROYECTO — transversal, lo que se consulta a diario ──
├── backlog.md             ← QUÉ SIGUE: lanzamiento, vigilancia, mejoras y deuda, en orden
├── bug-tracker.md         ← bugs ABIERTOS (nada más)
├── changelog.md           ← lo HECHO: decisiones arquitectónicas + bugs resueltos
└── edge-cases.md          ← lecciones reutilizables (se consultan ANTES de trabajar)
```

Fuera de `docs/` está la **suite de pruebas**. Vive en la raíz y no aquí dentro porque no es
documentación: `qa/sql/` son ficheros **ejecutables** — es el `tests/` de la base de datos. El
bot tiene las suyas en `server/test/` (unitarias y escenarios de conversación).

```
qa/                        ← pruebas de la BD (última regresión completa: 2026-10-13, sin rojos)
├── RESULTADOS.md          ← EMPIEZA AQUÍ: estado por batería, hallazgos, y "Por dónde seguir"
├── guiones-bot.md         ← los 11 guiones de conversación (hoy son escenarios en server/test/)
└── sql/                   ← 12 baterías deterministas, ejecutables vía el MCP de Supabase
```

**Antes de tocar una función, un trigger o una RPC, mira si hay una batería que la cubra** y
ejecútala después del cambio: es la forma más barata de no reabrir algo ya cerrado. Cada fichero
devuelve **solo las filas que fallan** (resultado vacío = verde) y lleva en el encabezado los
invariantes que verifica y las trampas de montaje que ya mordieron.

## Las tres capas

| Capa | Qué es | Dónde vive | Doc |
|---|---|---|---|
| **Bot** | Servidor Node: la IA conversa, el código decide | `server/` → VPS (Docker) | [`bot/`](bot/) |
| **Base de datos** | PostgreSQL, backend compartido | Supabase Cloud | [`database.md`](database.md) |
| **Dashboard** | Panel admin en tiempo real | `src/` → Vercel | [`dashboard/components.md`](dashboard/components.md) |

> El bot y el dashboard **comparten el mismo esquema PostgreSQL**.

## Cómo mantener esta documentación al día

Cuando hagas un cambio significativo, actualiza el doc que corresponde:

| Cambiaste… | Actualiza |
|---|---|
| Esquema de BD (tabla, trigger, RPC) | `database.md` (+ migración en `supabase/migrations/`) |
| Una regla o handler del bot | `bot/servidor.md` |
| Cómo se despliega | `bot/despliegue.md` |
| Componente o hook de React | `dashboard/components.md` |
| Estilos, tokens o patrones visuales | `dashboard/design-system.md` |
| Encontraste un bug por corregir | `bug-tracker.md` (Abiertos) |
| Resolviste un bug | quítalo del tracker → entrada condensada en `changelog.md` |
| La solución dejó una lección reutilizable | `edge-cases.md` |
| Surgió una feature/mejora para después | `backlog.md` |
| Tomaste una decisión arquitectónica | `changelog.md` |

El modelo de seguridad (RLS, políticas, keys) se documenta en
[`database.md`](database.md) (sección «Modelo de permisos») y se verifica
en vivo contra Supabase vía MCP.
