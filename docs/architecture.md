# Arquitectura del Sistema — Vera Pizzería

## Visión general

```
┌────────────┐    ┌───────────────────────────────────────────────┐    ┌────────────────┐
│  WhatsApp  │───▶│  n8n (Motor de Automatización)                │───▶│  Supabase      │
│  Business  │◀───│                                               │◀───│  PostgreSQL    │
│  Cloud API │    │  Acumular mensajes → Router de modo →          │    │  menu·clientes │
└────────────┘    │  ORQUESTADOR (gpt-5.1) → 4 agentes + P. Memory:│    │  pedidos·detalle│
                  │    · Menú (carrito)     · Pedidos             │    │  carritos·reservas│
                  │    · Soporte (handoff)  · Reservas            │    │  feedback·info… │
                  │  + Job programado: pide feedback tras entrega  │    └────────────────┘
                  └───────────────────────────────────────────────┘           │ Realtime
                                                                               ▼
                                              ┌──────────────────────────────────────┐
                                              │  Dashboard React + Vite               │
                                              │  Pedidos · Soporte · Estadísticas ·   │
                                              │  Clientes · Reservas                  │
                                              └──────────────────────────────────────┘
```

> **Documentación detallada por capa:** el flujo completo de n8n está en
> [`bot/n8n-workflow.md`](bot/n8n-workflow.md), los agentes y tools en
> [`bot/ai-agents.md`](bot/ai-agents.md), el feedback en [`bot/feedback.md`](bot/feedback.md),
> el esquema en [`database/schema.md`](database/schema.md) y el frontend en
> [`dashboard/components.md`](dashboard/components.md).

## Flujo de datos de extremo a extremo

### 1. Cliente envía mensaje por WhatsApp

```
Cliente → WhatsApp → Meta Webhook → n8n (Webhook Trigger)
```

### 2. n8n procesa el mensaje

```
WhatsApp Trigger
  │
  ├─ Switch por tipo: texto | imagen (comprobante/soporte) | otro
  │
  ├─ Acumular mensajes pendientes (Wait + dedup: procesa solo el último)
  │
  ├─ Resolver cliente (SELECT por telefono; si no existe → crear 'Pendiente', modo 'bot')
  │
  └─ Router de modo (Switch por clientes.modo)
       ├─ 'humano'              → guarda en mensajes_soporte (no pasa al agente)
       ├─ 'esperando_feedback'  → subworkflow "Retener feedback"
       └─ 'bot' → ORQUESTADOR (clasifica) → Decision → 1 de 4 agentes:
                    Menú · Pedidos · Soporte · Reservas → Send message
```

> Detalle nodo por nodo en [`bot/n8n-workflow.md`](bot/n8n-workflow.md).

### 3. Respuesta vuelve al cliente

```
Agente IA → n8n (HTTP Request) → WhatsApp API → Cliente
```

### 4. Dashboard consume en tiempo real

```
Supabase Realtime (postgres_changes)
  │
  ├─ tabla: pedidos    → Kanban se actualiza
  ├─ tabla: clientes   → Badge de soporte se actualiza
  └─ tabla: mensajes_soporte → Chat de soporte se actualiza
```

## Principios de arquitectura

### Separación de responsabilidades

| Componente | Responsabilidad | NO hace |
|---|---|---|
| n8n | Orquestación, routing, llamadas a APIs | Cálculos de negocio |
| OpenAI Agent | Conversación natural, decidir qué tool usar | Calcular totales, inventar IDs |
| Supabase | Persistencia, triggers, cálculos de negocio | Lógica conversacional |
| React Dashboard | Visualización, acciones manuales del staff | Lógica de pedidos |

### Fuente de verdad

- **Precios** → tabla `menu` (nunca el LLM)
- **Totales** → trigger `actualizar_total_pedido` (nunca el LLM)
- **producto_id** → resultado de `consultar_menu` / RPC `buscar_menu` (nunca inventado)
- **Estado del pedido** → tabla `pedidos` (solo se actualiza via Supabase)

### Flujo de estados del pedido

```
pendiente → en_cocina → en_camino → entregado
    │                       │
    └──→ cancelado     (solo para domicilios)
    
pendiente → en_cocina → recoger → entregado
                            │
                       (cliente pasa a recoger)
```

### Flujo de modo del cliente

`clientes.modo` ∈ { `bot`, `humano`, `esperando_feedback` } — lo evalúa el Router de modo.

```
bot (default)
  │
  ├─ Cliente/agente pide humano (solicitar_handoff) → modo = 'humano'
  │   └─ Mensajes van a mensajes_soporte; el admin responde desde el dashboard
  │       └─ Admin resuelve → modo = 'bot'
  │
  └─ Job de feedback (tras entrega) → modo = 'esperando_feedback'
      └─ La respuesta del cliente va al subworkflow "Retener feedback"
          └─ Al terminar (o si es huérfano) → modo = 'bot'
```

## Confiabilidad

### ¿Por qué este diseño es confiable?

1. **Totales calculados por trigger** — Imposible que el LLM mande un total incorrecto
2. **producto_id validado** — El agente DEBE consultar el menú antes de agregar items
3. **Memoria conversacional en Postgres** — No se pierde si n8n se reinicia
4. **Realtime nativo de Supabase** — El dashboard siempre refleja el estado actual
5. **Escalamiento a humano** — Si el bot no puede resolver, hay fallback humano

### Puntos únicos de fallo

| Componente | Impacto si cae | Mitigación |
|---|---|---|
| n8n | Bot no responde | Monitoreo + auto-restart |
| OpenAI API | Bot no responde | Timeout + mensaje de fallback |
| Supabase | Todo cae | Es managed, SLA de Supabase |
| WhatsApp API | No se envían/reciben mensajes | Retry en n8n |
