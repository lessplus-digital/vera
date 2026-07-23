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
- **Inputs:** `telefono`, `nombre`, `fecha`, `hora`, `personas`, `cliente_id` (sin espacio desde
  el fix de BUG-004, 2026-07-23)
- **Salida:** `{ ok, reserva_id, fecha/hora legibles, personas }` o `{ ok:false, error }`

```
When Executed → Validar y verificar cupo (Code, solo prepara la fila) → INSERT (reservas) → Formatear respuesta
```

- **BUG-004 (✅ 2026-07-23):** la key `cliente_id ` (con espacio) se renombró a `cliente_id` en
  todo el camino (schema de la tool en el main, trigger e INSERT del subworkflow).
- **BUG-008 (✅ 2026-07-23):** se eliminó el check JS muerto de duplicado/cupo (filtraba
  `$input.all()` por `reserva_id` pero nada le pasaba reservas) y el `If(_valido)` siempre-true.
  El **cupo** lo protege el trigger de BD `trigger_validar_cupo` (BEFORE INSERT, RAISE EXCEPTION
  si 8 solapadas); el **duplicado** (misma persona, mismo día) se maneja conversacionalmente
  (decisión consciente: un cliente puede reservar almuerzo y cena el mismo día).

---

## Sub — Cancelar Reserva

- **ID:** `Jk8r0QtxYqYzK8cV` · **Tool:** `cancelar_reserva` (Agente Reservas, cableada 2026-07-23 — BUG-005)
- **Inputs:** `reserva_id`, `telefono` (sin espacio desde el fix de BUG-009)
- **Salida:** fila actualizada de `reservas` (ok) o `{ ok:false, error }` (validación fallida)

```
When Executed → [Supabase GET reservas WHERE reserva_id]  (nodo mal nombrado "INSERT")
  └─ Validar (Code) — ¿existe? ¿es del cliente? ¿estado confirmada?
       └─ ¿Validación OK? (If sobre ok)
            ├─ true  → UPDATE reservas SET estado='cancelada'
            └─ false → Responder error (NoOp — devuelve { ok:false, error } al agente)
```

- **BUG-009 (✅ 2026-07-23):** el input `telefono ` (con espacio) se renombró a `telefono`, y el
  check de propiedad ahora es **fail-closed**: `!input.telefono || reserva.telefono !== input.telefono`
  → sin teléfono no se cancela nada. Además se añadió la compuerta `¿Validación OK?`: antes el
  UPDATE corría incondicionalmente tras Validar (con `ok:false` iba con `reserva_id` undefined).
- **BUG-005 (✅ 2026-07-23):** se agregó el nodo `toolWorkflow` `cancelar_reserva` al Agente
  Reservas en el main (inputs `reserva_id` + `telefono` vía `$fromAI`). El prompt del agente ya
  describía el flujo CANCELAR RESERVA — no hubo que tocarlo.

---

## Sub — Editar pedido — 🗄️ ARCHIVADO (2026-07-22, BUG-010)

- **ID:** `CPJcILNiaw20eRye` · desactivado y archivado en n8n. Nunca estuvo cableado a los
  agentes y tenía **0 ejecuciones** en toda su historia.
- **Por qué se archivó y no se cableó** (análisis BUG-010): editaba `detalle_pedidos` fila a
  fila directo (se saltaba el RPC `editar_pedido` → habría perdido el recargo de domicilio al
  recalcular), no validaba `telefono` (cualquiera con un `pedido_id` editaba pedidos ajenos),
  exigía `detalle_id` que el cliente no conoce, y usaba un `phoneNumberId` equivocado. El caso
  de uso ya está cubierto: el admin edita desde el dashboard (RPC `editar_pedido`).
- **Flujo conversacional que lo reemplaza:** "quiero cambiar mi pedido" (ya registrado) →
  el Orquestador enruta a **soporte** → `solicitar_handoff` → el admin edita en el dashboard
  (reglas añadidas a los prompts del Orquestador y Agente Soporte).
- **Si algún día se quiere como feature:** diseñarlo de cero sobre el RPC `editar_pedido`
  con validación de propiedad por `telefono`.

---

## Sub — Feedback Pendiente

- **ID:** `xGsKJf2u3bFmL6mA` — es el subworkflow "Retener feedback", ya documentado en
  [`feedback.md`](feedback.md#parte-2--subworkflow-de-respuesta-retener-feedback).
