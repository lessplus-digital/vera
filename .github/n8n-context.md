# Vera Pizzería — Bot WhatsApp n8n · Contexto

## Stack
- n8n self-hosted en VPS
- WhatsApp Business API
- Supabase como base de datos (mismo proyecto que el dashboard)
- OpenAI GPT-4o como modelo del agente
- Postgres Chat Memory vía Supabase

## Flujo principal — Secuencia de pasos
1. **WhatsApp Trigger** — recibe el mensaje entrante
2. **IF** — filtrar solo mensajes reales del usuario (ignorar actualizaciones de estado, confirmaciones de entrega)
3. **Supabase INSERT** — guardar mensaje en `pending_messages` (buffer de debounce)
4. **Wait** — 3 segundos
5. **HTTP Request** — obtener la última fila de `pending_messages` para el teléfono
6. **Code node** — comparar IDs para verificar si este sigue siendo el último mensaje
7. **IF continuar** — abortar rama si ya llegó un mensaje más nuevo
8. **Supabase SELECT** — obtener todos los `pending_messages` del teléfono
9. **Code node** — combinar todos los mensajes pendientes en uno solo
10. **Supabase DELETE** — limpiar `pending_messages` del teléfono
11. **Code node (limpiar nombre)** — extraer y sanitizar el primer nombre del remitente
12. **Supabase SELECT** — buscar cliente en `clientes` por `telefono`
13. **IF ¿cliente existe?**
    - No → **Supabase INSERT** — crear nuevo cliente con nombre limpio
14. **Merge** — unir datos del cliente de ambas ramas
15. **Edit Fields** — construir el objeto de contexto para el agente
16. **AI Agent (INTENCION CLIENTE)** — GPT-4o con herramientas + memoria
17. **Send Message WhatsApp** — responder al cliente

## AI Agent — Herramientas disponibles
| Herramienta | Método | Endpoint |
|---|---|---|
| `consultar_menu` | GET | `/rest/v1/menu` — productos disponibles |
| `crear_pedido` | INSERT | `/rest/v1/pedidos` |
| `agregar_items` | INSERT | `/rest/v1/detalle_pedidos` |
| `actualizar_cliente` | UPDATE | `/rest/v1/clientes` |
| `info_local` | GET | `/rest/v1/store_info` — tabla con info del restaurante |

## Variables de contexto que llegan al agente
| Variable | Formato | Notas |
|---|---|---|
| `cliente_id` | `CLI-001` | PK de Supabase |
| `nombre` | string \| null | Primer nombre limpio |
| `telefono` | número E.164 completo | Incluye código de país |
| `mensaje` | string | Todos los mensajes del debounce combinados |

## Lógica de limpieza de nombre (Code node)
- Extraer solo el **primer nombre** del nombre de display de WhatsApp
- Descartar: emojis, palabras religiosas, números solos, `null`/vacío
- Capitalizar correctamente (title case)
- Si el resultado es inválido → retornar `null`
- Se usa tanto al crear un cliente nuevo como al actualizar uno existente

## Memoria del chat
- Tipo de nodo: **Postgres Chat Memory**
- Conectado a: Supabase Postgres (misma BD que el dashboard)
- Session ID: `telefono` del cliente
- Tabla: `n8n_chat_histories`
- Ventana de contexto: **10 mensajes**

## Esquema Supabase — tablas usadas por n8n

### pending_messages (buffer de debounce)
| Columna | Tipo |
|---|---|
| `id` | uuid PK |
| `telefono` | text |
| `mensaje` | text |
| `created_at` | timestamptz |

### n8n_chat_histories (memoria del agente)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | serial PK | |
| `session_id` | text | = `telefono` |
| `message` | jsonb | |
| `created_at` | timestamptz | |

### clientes
| Columna | Tipo | Valores |
|---|---|---|
| `cliente_id` | text PK | formato `CLI-001` |
| `telefono` | text UNIQUE | |
| `nombre` | text | primer nombre limpio |
| `direccion` | text | |
| `modo` | text | `'bot'` \| `'humano'` |

## Convenciones clave
- **Ventana de debounce**: 3 segundos — siempre comparar el ID del mensaje entrante contra la última fila en BD antes de procesar; abortar si el mensaje ya es viejo.
- **Número de teléfono**: siempre almacenado y comparado como número completo con código de país (ej. `573001234567`, sin `+`).
- **Creación de pedido** siempre requiere dos pasos: primero `crear_pedido` para obtener el `pedido_id`, luego `agregar_items` por cada línea.
- El agente nunca debe inventar productos — debe llamar `consultar_menu` y ofrecer solo ítems donde `disponible = true`.
- Los precios de productos con tamaños están en un JSON string en `tamaño` (`{"porcion":10500,"pequena":23500,...}`); el agente debe parsearlo para cotizar el precio correcto.
- `estado` en pedidos nuevos siempre es `'pendiente'`; `estado_pago` es `'Pendiente'` — el dashboard gestiona todos los cambios de estado posteriores.

