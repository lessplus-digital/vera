# Arquitectura del Sistema — Vera Pizzería

## Visión general

```
┌────────────┐    ┌────────────────────────────────────────┐    ┌──────────────────┐
│  WhatsApp  │───▶│  Servidor del bot (Node, server/)      │───▶│  Supabase        │
│  Business  │◀───│  clasifica (LLM) → decide (código) →   │◀───│  PostgreSQL      │
│  Cloud API │    │  ejecuta → redacta (LLM) → guardia      │    │  menú·clientes   │
└────────────┘    │  + job que pide la calificación         │    │  pedidos·reservas│
      ▲           └────────────────────────────────────────┘    │  feedback·info…  │
      │  /api/wa (JWT de sesión)         ▲                       └──────────────────┘
      │                                  │ POST /hooks/estado-pedido     │ Realtime
┌─────┴──────────────────────────────────┴───┐                           ▼
│  Dashboard React + Vite (este repo)        │◀──────────────────────────┘
│  Pedidos · Soporte · Estadísticas ·        │
│  Clientes · Reservas · Menú · Usuarios     │
└────────────────────────────────────────────┘
```

> **Documentación detallada por capa:** el servidor del bot en
> [`bot/servidor.md`](bot/servidor.md), el feedback en [`bot/feedback.md`](bot/feedback.md), el
> despliegue en [`bot/despliegue.md`](bot/despliegue.md), el esquema en [`database.md`](database.md)
> y el frontend en [`dashboard/components.md`](dashboard/components.md).

## Flujo de datos de extremo a extremo

### 1. El cliente escribe por WhatsApp

```
Cliente → WhatsApp → Meta → POST https://bot.plateo.cloud/webhook/whatsapp (firma verificada)
```

### 2. El servidor procesa el turno

```
Webhook → dedupe por wamid → buffer por teléfono (junta mensajes seguidos)
  │
  ├─ Resolver cliente (por teléfono; si no existe se crea 'Pendiente', modo 'bot')
  │
  └─ Por clientes.modo y tipo de mensaje (sin LLM):
       ├─ 'humano'              → mensajes_soporte (el bot calla)
       ├─ 'esperando_feedback'  → RPC procesar_respuesta_feedback
       ├─ foto                  → comprobante de transferencia
       └─ 'bot' + texto → CLASIFICA (LLM, JSON estricto) → DECIDE (política en código)
                          → EJECUTA acciones críticas → REDACTA (Menú · Pedidos · Soporte ·
                            Reservas) → GUARDIA de salida → responde y registra en bot_turnos
```

> Detalle y reglas en [`bot/servidor.md`](bot/servidor.md).

### 3. La respuesta vuelve al cliente

```
Servidor → WhatsApp Cloud API (Graph) → Cliente
```

Los mensajes que manda el **dashboard** (resolver un chat, confirmar una reserva) también salen
por el servidor: `POST /api/wa` con la sesión del usuario; el servidor revisa su rol y guarda el
token de Meta.

### 4. El dashboard consume en tiempo real

```
Supabase Realtime (postgres_changes)
  │
  ├─ tabla: pedidos    → Kanban se actualiza
  ├─ tabla: clientes   → Badge de soporte se actualiza
  └─ tabla: mensajes_soporte → Chat de soporte se actualiza
```

Cuando un pedido cambia de estado, un trigger de la BD llama a `POST /hooks/estado-pedido` del
servidor, que le avisa al cliente por WhatsApp.

## Principios de arquitectura

**La IA conversa, el código decide.** Las acciones críticas (crear pedido, crear o cancelar
reserva, pasar a humano, verificar cobertura) las ejecuta código probado; el LLM solo clasifica
el mensaje y escribe la frase.

### Separación de responsabilidades

| Componente | Responsabilidad | NO hace |
|---|---|---|
| Servidor del bot (código) | Decidir, ejecutar, validar, registrar | Conversar libremente |
| LLM (OpenAI) | Clasificar el mensaje, redactar la frase | Calcular totales, inventar IDs, crear pedidos |
| Supabase | Persistencia, triggers, cálculos de negocio, RLS | Lógica conversacional |
| React Dashboard | Visualización, acciones manuales del staff | Lógica de pedidos |

### Fuente de verdad

- **Precios** → tabla `menu` (nunca el LLM)
- **Totales** → trigger `actualizar_total_pedido` (nunca el LLM ni JS)
- **producto_id** → resultado de `consultar_menu` / RPC `buscar_menu` (nunca inventado)
- **Estado del pedido** → tabla `pedidos`
- **Costo de una ocasión de reserva** → tabla `motivos_reserva` (nunca el LLM)

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

`clientes.modo` ∈ { `bot`, `humano`, `esperando_feedback` } — lo evalúa el procesador de turno.

```
bot (default)
  │
  ├─ Cliente pide una persona (o frustración alta) → modo = 'humano'
  │   └─ trigger_contexto_handoff vuelca la conversación reciente
  │      (n8n_chat_histories) a mensajes_soporte → el admin ve el contexto
  │   └─ Los mensajes van a mensajes_soporte; el admin responde desde el dashboard
  │       └─ Admin resuelve → modo = 'bot'
  │
  └─ Job de feedback (tras entrega) → modo = 'esperando_feedback'
      └─ La respuesta del cliente la procesa la RPC procesar_respuesta_feedback
          └─ Al terminar (o si es huérfano) → modo = 'bot'
```

## Confiabilidad

1. **Totales calculados por trigger** — imposible que el LLM mande un total incorrecto.
2. **Pedido y reserva solo con el "sí" del cliente** — el código los crea contra el resumen que vio.
3. **El cliente nunca queda en silencio** — si el modelo falla sale un texto seguro y el turno
   queda registrado con su error en `bot_turnos`.
4. **Realtime nativo de Supabase** — el dashboard siempre refleja el estado actual.
5. **Escalamiento a humano** — si el bot no puede resolver, hay un fallback humano.

### Puntos únicos de fallo

| Componente | Impacto si cae | Mitigación |
|---|---|---|
| Servidor del bot (VPS) | Bot no responde | Docker `restart`, healthcheck en `/salud` |
| OpenAI API | Bot sin respuesta inteligente | Timeout + texto seguro al cliente |
| Supabase | Todo cae | Es managed, SLA de Supabase |
| WhatsApp API | No se envían/reciben mensajes | Meta reintenta el webhook; el dedupe evita duplicados |
