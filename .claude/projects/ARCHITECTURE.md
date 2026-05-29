# Arquitectura del Sistema — Vera Pizzería

## Visión general

```
┌─────────────┐     ┌──────────────────────────────────────────────┐     ┌─────────────┐
│  WhatsApp   │────▶│  n8n (Motor de Automatización)               │────▶│  Supabase   │
│  Business   │◀────│                                              │◀────│  PostgreSQL │
│  API        │     │  ┌─────────────────────────────────────────┐ │     │             │
└─────────────┘     │  │  Agente IA (OpenAI)                     │ │     │  - menu     │
                    │  │  ├─ Postgres Chat Memory                │ │     │  - pedidos  │
                    │  │  └─ Tools:                              │ │     │  - detalle  │
                    │  │     ├─ consultar_menu (subworkflow)     │ │     │  - clientes │
                    │  │     ├─ crear_pedido (insert)            │ │     │  - mensajes │
                    │  │     ├─ agregar_items (insert)           │ │     └─────────────┘
                    │  │     ├─ actualizar_cliente (update)      │ │            │
                    │  │     └─ escalar_a_humano (update)        │ │            │ Realtime
                    │  └─────────────────────────────────────────┘ │            │
                    └──────────────────────────────────────────────┘            │
                                                                               ▼
                                                                    ┌─────────────────┐
                                                                    │  Dashboard React │
                                                                    │  (Vite)          │
                                                                    │                  │
                                                                    │  - Kanban pedidos│
                                                                    │  - Panel soporte │
                                                                    │  - Notificaciones│
                                                                    └─────────────────┘
```

## Flujo de datos de extremo a extremo

### 1. Cliente envía mensaje por WhatsApp

```
Cliente → WhatsApp → Meta Webhook → n8n (Webhook Trigger)
```

### 2. n8n procesa el mensaje

```
Webhook Trigger
  │
  ├─ Extraer telefono + mensaje del payload de Meta
  │
  ├─ Consultar cliente en Supabase (SELECT por telefono)
  │
  ├─ ¿Cliente existe?
  │   ├─ NO → Crear cliente con nombre="Pendiente", modo="bot"
  │   └─ SI → Continuar
  │
  ├─ ¿Cliente.modo == "humano"?
  │   ├─ SI → Guardar en mensajes_soporte, NO pasar al agente IA
  │   └─ NO → Continuar al agente
  │
  ├─ Merge datos del cliente
  │
  ├─ Edit Fields (preparar contexto: telefono, nombre, direccion)
  │
  └─ Agente IA (con memoria conversacional)
       │
       ├─ Responde al cliente
       └─ Opcionalmente usa tools (consultar_menu, crear_pedido, etc.)
```

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
- **producto_id** → resultado de `consultar_menu` (nunca inventado)
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

### Flujo de modo del cliente (bot ↔ humano)

```
bot (default)
  │
  ├─ Cliente pide hablar con humano → modo = "humano"
  │   └─ Mensajes van a mensajes_soporte (no al agente IA)
  │
  └─ Admin resuelve conversación → modo = "bot"
      └─ Mensajes vuelven al agente IA
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
