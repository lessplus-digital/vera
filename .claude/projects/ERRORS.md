# Estrategia de Manejo de Errores

## Principio general

> Si algo falla, el cliente NUNCA debe quedar sin respuesta. Siempre hay un fallback humano.

## Errores por capa

### Capa 1: WhatsApp → n8n

| Error | Causa probable | Manejo |
|---|---|---|
| Webhook no recibe mensaje | Meta no alcanza la URL, SSL expirado | Monitorear uptime de n8n. Meta reintenta 3 veces. |
| Payload malformado | Cambio en API de Meta | Code node con try/catch. Loguear payload crudo. |
| Mensaje duplicado | Retry de Meta | Responder 200 inmediato. Deduplicar por message_id. |

### Capa 2: n8n → Supabase

| Error | Causa probable | Manejo |
|---|---|---|
| Cliente no encontrado | Primera interacción | Crear cliente automáticamente con nombre="Pendiente" |
| INSERT falla | Columna requerida null, FK inválida | Validar en Code node antes del INSERT. Si falla, no pasar al agente → enviar "Hubo un problema, intenta de nuevo en un momento." |
| Timeout de Supabase | Carga alta, plan free | Retry 1 vez. Si persiste, escalar a humano. |

### Capa 3: n8n → OpenAI

| Error | Causa probable | Manejo |
|---|---|---|
| Timeout (>30s) | Modelo lento, prompt largo | Timeout configurado en n8n. Fallback: "Dame un momento, ya te atiendo." |
| Rate limit (429) | Muchos mensajes simultáneos | Queue en n8n + retry con backoff. |
| API key inválida | Key expirada o revocada | Alerta al admin. Bot responde "Estamos teniendo problemas técnicos, te atiende un humano." + escalar. |
| Respuesta vacía | Edge case del modelo | Detectar respuesta vacía → "¿Me puedes repetir? No te escuché bien." |

### Capa 4: Tool calls del agente

| Error | Causa probable | Manejo |
|---|---|---|
| consultar_menu retorna 0 resultados | Producto no existe o mal escrito | El agente dice "No tenemos X" y ofrece alternativa (consultando de nuevo). |
| crear_pedido falla | Datos incompletos | El agente DEBE tener tipo_pedido + metodo_pago confirmados antes de llamar. Si falla, pedir datos faltantes. |
| agregar_items falla por producto_id inválido | LLM inventó un ID | Esto NO debe pasar con la regla de consultar_menu primero. Si pasa: loguear como error crítico. |
| actualizar_cliente falla | Teléfono no existe | No debería pasar (se crea al inicio). Loguear. |

### Capa 5: Dashboard React

| Error | Causa probable | Manejo |
|---|---|---|
| Realtime se desconecta | Timeout de WebSocket | Supabase reconecta automáticamente. UI muestra "Reconectando..." |
| Envío WhatsApp desde soporte falla | Token expirado | Alert al admin con mensaje de error. El mensaje SÍ se guarda en BD. |
| Pedido cambió de estado antes de acción | Otro admin lo movió | Refetch antes de actualizar. Mostrar estado actual. |

## Flujo de escalamiento

```
Error en agente IA
  │
  ├─ Error recuperable (timeout, rate limit)
  │   └─ Retry automático (1-2 veces)
  │       └─ Si sigue fallando → Mensaje genérico + escalar a humano
  │
  └─ Error no recuperable (API key, schema change)
      └─ Mensaje al cliente: "Te paso con un compañero."
          └─ UPDATE clientes SET modo = 'humano'
              └─ Aparece en panel de soporte del dashboard
```

## Qué NUNCA decirle al cliente

- "Error en el sistema"
- "La herramienta falló"
- "No se pudo procesar tu solicitud"
- "Hubo un error técnico"
- Cualquier mención a n8n, Supabase, OpenAI, API, webhook, tool

## Qué SÍ decirle

- "Dame un momento, ya te atiendo."
- "No te escuché bien, ¿me repites?"
- "Te paso con un compañero que te ayuda mejor."
- "Estamos a tope ahorita, pero ya te atendemos."
