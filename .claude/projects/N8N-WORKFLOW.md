# Diseño de Workflows n8n — Vera Pizzería

## Workflow principal: Atención WhatsApp

### Trigger

**Tipo:** Webhook (POST)
**Recibe:** Payload de Meta WhatsApp Cloud API

### Flujo completo

```
Webhook Trigger (POST de Meta)
  │
  ├─ Code: Extraer telefono + mensaje del payload
  │   └─ Maneja: text, image (comprobante), interactive (botones)
  │
  ├─ Supabase: SELECT * FROM clientes WHERE telefono = {{ telefono }}
  │
  ├─ IF: ¿Cliente existe?
  │   ├─ NO → Supabase: INSERT INTO clientes (telefono, nombre, modo)
  │   │         VALUES (telefono, 'Pendiente', 'bot')
  │   └─ SI → Continuar
  │
  ├─ IF: ¿cliente.modo == 'humano'?
  │   ├─ SI → INSERT INTO mensajes_soporte (telefono, origen='cliente', mensaje)
  │   │       └─ FIN (no pasa al agente)
  │   └─ NO → Continuar
  │
  ├─ Merge: Combinar datos del cliente con el mensaje
  │
  ├─ Edit Fields: Preparar JSON con telefono, nombre, direccion, mensaje
  │
  └─ AI Agent Node (INTENCION_CLIENTE)
       ├─ Model: OpenAI Chat Model (GPT)
       ├─ Memory: Postgres Chat Memory (session_id = telefono)
       ├─ System Prompt: ver AI-AGENT.md
       └─ Tools:
            ├─ consultar_menu    → Subworkflow
            ├─ crear_pedido      → Supabase INSERT pedidos
            ├─ agregar_items     → Supabase INSERT detalle_pedidos
            ├─ actualizar_cliente → Supabase UPDATE clientes
            └─ escalar_a_humano  → Supabase UPDATE clientes SET modo='humano'
```

## Subworkflow: consultar_menu

### Input

Un solo campo: `filtro` (string). Ejemplo: `"hawaiana"`, `"arepa"`, `"bebidas"`.

### Flujo

```
When Executed by Another Workflow
  │
  ├─ Code Node 1: Construir filtros
  │   - Toma filtro, lo limpia
  │   - Si tiene múltiples palabras: usa la primera para Supabase,
  │     guarda el resto para filtro post-proceso
  │   - Construye queryParams con: select, order, disponible=eq.true, limit=30
  │   - Si hay búsqueda: agrega OR filter (nombre.ilike, categoria.ilike, descripcion.ilike)
  │
  ├─ HTTP Request: GET {SUPABASE_URL}/rest/v1/menu
  │   - Query params desde Code Node 1
  │   - Headers: apikey + Authorization
  │
  └─ Code Node 2: Formatear respuesta
      - Si hay palabras extra de filtro → aplica .filter() local
      - Agrupa por categoría
      - Retorna { encontrados: N, productos_por_categoria: {...} }
```

### Restricciones de n8n en Code Nodes

- **NO** existe `URLSearchParams`, `fetch`, ni `$helpers`
- **NO** usar `null` en campos opcionales → simplemente no incluir el campo
- n8n envía `undefined` como string `"undefined"` en query params → validar antes

## Tools del agente: Especificaciones

### consultar_menu

| Campo | Detalle |
|---|---|
| Tipo | Call Subworkflow |
| Input | `{ filtro: string }` |
| Output | `{ encontrados: number, productos_por_categoria: object }` |
| Cuándo | SIEMPRE antes de mencionar cualquier producto, precio o disponibilidad |

### crear_pedido

| Campo | Detalle |
|---|---|
| Tipo | Supabase INSERT |
| Tabla | `pedidos` |
| Input | `{ telefono, tipo_pedido, metodo_pago, direccion_entrega?, notas? }` |
| Output | `{ pedido_id }` |
| Cuándo | Solo después de confirmación explícita del cliente |
| Nota | `total` se deja en 0 — el trigger lo calcula al agregar items |

### agregar_items

| Campo | Detalle |
|---|---|
| Tipo | Supabase INSERT |
| Tabla | `detalle_pedidos` |
| Input | `{ pedido_id, producto_id, nombre_producto, variante?, cantidad, precio_unitario }` |
| Output | Row insertada |
| Cuándo | Inmediatamente después de crear_pedido, una llamada por producto |
| CRÍTICO | `producto_id` DEBE venir del resultado de consultar_menu |

### actualizar_cliente

| Campo | Detalle |
|---|---|
| Tipo | Supabase UPDATE |
| Tabla | `clientes` |
| Filter | `telefono = {{ telefono }}` |
| Input | `{ nombre?, direccion? }` |
| Cuándo | Cuando el cliente da su nombre o actualiza dirección |

### escalar_a_humano

| Campo | Detalle |
|---|---|
| Tipo | Supabase UPDATE |
| Tabla | `clientes` |
| Filter | `telefono = {{ telefono }}` |
| Input | `{ modo: 'humano' }` |
| Cuándo | Cliente pide hablar con una persona real |

## Variables de entorno en n8n

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | Anon key |
| `OPENAI_API_KEY` | API key de OpenAI |
| `WA_PHONE_NUMBER_ID` | ID del número de WhatsApp Business |
| `WA_ACCESS_TOKEN` | Token permanente de Meta |
| `WA_VERIFY_TOKEN` | Token de verificación del webhook |
