# Subworkflows de las tools (n8n)

> Lógica **server-side** de las tools que llaman los agentes. Cada uno es un workflow n8n
> independiente con trigger `When Executed by Another Workflow`. Referenciados desde la
> tabla de tools de cada agente en [`ai-agents.md`](ai-agents.md).
> Fuente: instancia n8n vía MCP (`n8n-mcp`), 2026-07-16.

---

## Sub — Consultar_menu

- **ID:** `r9BbkGSCNJcJ2P6t` · **Tool:** `consultar_menu` (Agente Menú)
- **Input:** `filtro` (string) · **Salida:** `{ encontrados, productos_por_categoria }`

```
When Executed by Another Workflow (filtro)
  └─ Construir filtros (Code)
       · select fijo · order categoria.asc,nombre.asc · disponible=eq.true · limit 30
       · palabras del filtro con length > 2:
         - 1 palabra  → or=(nombre/categoria/descripcion ilike *p*)
         - N palabras → or con la 1ª (nombre/descripcion) + `_filtrar_palabras` = resto
  └─ HTTP Request (GET /menu con esos query params)   ⚠️ service_role hardcodeada (BUG-003)
  └─ Code in JavaScript1 (Code)
       · post-filtro: cada palabra extra debe aparecer en nombre+descripcion+categoria
       · agrupa por categoria → { encontrados, productos_por_categoria }
```

**⚠️ BUG-006:** el prompt del Agente Menú promete "búsqueda inteligente" + campo `similitud`,
pero esto solo hace `ilike` (substring) y no devuelve `similitud`. `papatas` ≠ `patatas`.

---

## Sub — Crear_orden_completa

- **ID:** `a94A2VKvFC0ugkD3` · **Tool:** `crear_orden_completa` (Agente Pedidos)
- **Inputs:** `cliente_id`, `telefono`, `filtro` (JSON string del pedido)
- **Salida:** `{ ok: true, mensaje }` o `{ ok: false, error, message }`

```
When Executed (cliente_id, telefono, filtro)
  └─ Validar payload (Code) — parsea filtro; valida tipo_pedido (domicilio/recoger),
  │    metodo_pago (Transferencia/Efectivo), dirección si domicilio, items
  │    (producto_id/cantidad/precio_unitario); calcula total SERVER-SIDE; expone productoIds
  └─ Validar productos menu (HTTP GET /menu?producto_id=in(...)&disponible=eq.true)  ⚠️ key anon
  └─ Construir pedido (Code) — verifica que todos los productoIds existan/disponibles
  │    (faltan → error PRODUCT_NOT_FOUND); arma pedidoObj (estado/estado_pago='pendiente')
  └─ If (¿error?) → Stop and Error  |  INSERT pedido (Supabase, credencial) → tabla pedidos
       └─ Code in JavaScript — arma `detalles` con el pedido_id devuelto
       └─ INSERT detalle_pedidos (HTTP POST)      ⚠️ key anon (BUG-007)
       └─ Limpiar carrito (HTTP DELETE /carritos?telefono)   ⚠️ key anon
       └─ Respuesta de salida → { ok: true }
```

**Notas:**
- El `total` se calcula en JS aquí y se inserta, pero el trigger de Postgres lo recalcula al
  insertar `detalle_pedidos`. Redundante pero coherente con la convención (total = trigger).
- **⚠️ BUG-007:** `detalle_pedidos` se inserta con la **anon key** vía HTTP; si RLS está activo
  en esa tabla (`rls_reference.sql` la incluye, política solo `authenticated`), el INSERT se
  bloquearía. Que hoy funcione sugiere que RLS quizá no está aplicado — verificar.

---

## Sub — consultar_disponibilidad

- **ID:** `OTQp2O8QDw1mMKOZ` · **Tool:** `consultar_disponibilidad` (Agente Reservas)
- **Inputs:** `fecha` (YYYY-MM-DD), `hora` (HH:MM)
- **Salida:** `{ disponible, mesas_ocupadas, mesas_libres, fecha, hora, error }` o `{ ok:false, error }`

```
When Executed (fecha, hora)
  └─ Validar parámetros (Code) — horario 12:00–21:00 · no fechas pasadas · máx 14 días ·
  │    mín 5 h de anticipación si es hoy (TZ America/Bogota)
  └─ If (ok) → Contar reservas solapadas (Supabase getAll reservas WHERE fecha, estado=confirmada)
  │              └─ Calcular disponibilidad (Code) — 8 mesas, 90 min; cuenta solapes → { disponible, ... }
  └─ (no ok) → Code → { error }
```

Usa credencial de n8n (sin key hardcodeada). Nota menor: un inicio a las 21:00 dura hasta
las 22:30 (pasa el cierre de 9 PM) — revisar si es intencional.

---

## Sub — Crear Reserva

- **ID:** `xyb9zB6nz6OmmboX` · **Tool:** `crear_reserva` (Agente Reservas)
- **Inputs:** `telefono`, `nombre`, `fecha`, `hora`, `personas`, `cliente_id ` (con espacio, BUG-004)
- **Salida:** `{ ok, reserva_id, fecha/hora legibles, personas }` o `{ _valido:false, error }`

```
When Executed → Validar y verificar cupo (Code) → If(_valido) → INSERT (reservas) → Formatear respuesta
```

- **⚠️ BUG-008:** `Validar y verificar cupo` hace `$input.all().filter(r => r.reserva_id)`,
  pero nada le pasa reservas (no hay query previa) → siempre vacío → los checks de **duplicado**
  y **cupo** nunca se disparan. La única barrera real es `consultar_disponibilidad` (upstream).
- **BUG-004 (corregido):** el INSERT lee `['cliente_id ']` (con espacio), así que el
  `cliente_id` **sí** entra. Pero `input.cliente_id` (sin espacio) en el nodo Validar es
  `undefined` — fragilidad latente, no rotura.

---

## Sub — Cancelar Reserva

- **ID:** `Jk8r0QtxYqYzK8cV` · **existe pero NO está cableado** como tool al Agente Reservas (BUG-005)
- **Inputs:** `reserva_id`, `telefono ` (con espacio)
- **Salida:** `{ ok, reserva_id, mensaje }` o `{ ok:false, error }`

```
When Executed → [Supabase GET reservas WHERE reserva_id]  (nodo mal nombrado "INSERT")
  └─ Validar (Code) — ¿existe? ¿es del cliente? ¿estado confirmada?
  └─ UPDATE reservas SET estado='cancelada'
```

- **⚠️ BUG-009:** la verificación de propiedad usa `input.telefono`, pero el input llega como
  `telefono ` (con espacio) → `undefined` → el check "esta reserva no es tuya" se salta
  **siempre**. Con un `reserva_id`, se puede cancelar la reserva de cualquiera.

---

## Sub — Editar pedido

- **ID:** `CPJcILNiaw20eRye` · **no aparece cableado** como tool en el workflow de agentes actual
  (posible legacy; el dashboard edita pedidos por su cuenta vía RPC).
- **Input:** `filtro` (JSON: `{ operacion, pedido_id, payload/campos }`)

```
When Executed → Code(parse) → Mapear datos → HTTP GET pedido (WHERE pendiente + detalle_pedidos)  ⚠️ service_role
  └─ If (¿pedido pendiente?) → Switch(operacion)  |  Send message "ya está en cocina, no editable"
       ├─ agregar          → Get a row (menu) → agregar (variante/precio) → Create a row (detalle)
       ├─ eliminar         → Delete a row (detalle)
       ├─ cambiar_cantidad → Cambiar Cantidad → Update a row (detalle.cantidad)
       └─ campo            → Cambiar campos → Switch1 → actualizar_direccion / Actualizar notas
```

- **⚠️ BUG-010:** el `Send message` usa `phoneNumberId` **1034474539749030**, distinto al del
  resto del sistema (**1026022853935447**) → podría enviar desde otro número o fallar. Además el
  subworkflow no aparece conectado a los agentes (confirmar si sigue en uso).

---

## Sub — Feedback Pendiente

- **ID:** `xGsKJf2u3bFmL6mA` — es el subworkflow "Retener feedback", ya documentado en
  [`feedback.md`](feedback.md#parte-2--subworkflow-de-respuesta-retener-feedback).
