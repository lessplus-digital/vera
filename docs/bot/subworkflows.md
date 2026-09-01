# Subworkflows de las tools (n8n)

> Lógica **server-side** de las tools que llaman los agentes. Cada uno es un workflow n8n
> independiente con trigger `When Executed by Another Workflow`. Referenciados desde la
> tabla de tools de cada agente en [`ai-agents.md`](ai-agents.md).
> Fuente: instancia n8n vía MCP (`n8n-mcp`), 2026-07-16.
> Secciones **Consultar_menu** y **Crear_orden_completa** re-verificadas 2026-07-22 (nodos ya
> con credencial `Supabase account`; BUG-003/006/007 resueltos).

---

## Sub — Consultar_menu

- **ID:** `r9BbkGSCNJcJ2P6t` · **Tool:** `consultar_menu` (Agente Menú)
- **Input:** `filtro` (string) · **Salida:** `{ encontrados, productos_por_categoria, agotados, mensaje? }`

```
When Executed by Another Workflow (filtro)
  └─ Construir filtros (Code)
       · arma los args del RPC: { termino, umbral: 0.2, limite: 30, solo_disponibles: false }
  └─ HTTP Request (POST /rest/v1/rpc/buscar_menu — credencial `Supabase account`)
  └─ Code in JavaScript1 (Code)
       · filtra filas con producto_id y PARTE el resultado en dos:
         - disponibles → agrupados en productos_por_categoria (lo único ofrecible)
         - agotados    → array aparte (existen en la carta, hoy no hay)
       · encontrados = nº de DISPONIBLES (no del total)
       · mensaje = instrucción para el LLM cuando hay agotados o cuando no hubo ningún match
```

**Nota (BUG-006 resuelto):** la búsqueda ya es difusa de verdad — el RPC `buscar_menu`
(pg_trgm + unaccent + diccionario de typos) devuelve `similitud`, como promete el prompt
del Agente Menú. `papatas` → `patatas` ✅.

**Nota (2026-07-28, `solo_disponibles: false` a propósito):** el sub pasaba
`solo_disponibles: true`, así que un producto marcado **agotado** desde la pestaña Menú del
dashboard desaparecía por completo del resultado y el bot respondía *"no lo manejamos"* — que
es falso: sí está en la carta, hoy no hay. Ahora el RPC devuelve **todo** y es el Code node
quien separa: el agente sigue sin poder ofrecer ni agregar al carrito un agotado (no está en
`productos_por_categoria`), pero **sabe que existe** y puede decir "hoy se agotó" + ofrecer
alternativas de la misma categoría. `encontrados = 0` **y** `agotados: []` es el único caso
en que el producto realmente no está en la carta.

---

## Sub — Crear_orden_completa

- **ID:** `a94A2VKvFC0ugkD3` · **Tool:** `crear_orden_completa` (Agente Pedidos)
- **Inputs:** `cliente_id`, `telefono`, `filtro` (JSON string del pedido)
- **Salida:** `{ ok: true, mensaje }` o `{ ok: false, error, message }`

> ⚠️ **La salida NO incluye `pedido_id` ni `total` (BUG-038).** El nodo `Respuesta de salida` está
> hardcodeado y descarta el `pedidoId` que `Code in JavaScript` ya calculó. El PASO 5 del prompt
> del Agente Pedidos pide `#[pedido_id]`, así que el cliente recibe *"Tu número de pedido es #no
> disponible en este momento"*. Al arreglarlo, **no** devuelvas el `total` de esa fila: en ese
> punto todavía no incluye el domicilio (`trigger_actualizar_total` es AFTER INSERT sobre
> `detalle_pedidos`). Ver [`../shared/bug-tracker.md`](../shared/bug-tracker.md).

```
When Executed (cliente_id, telefono, filtro)
  └─ Validar payload (Code) — parsea filtro; valida tipo_pedido (domicilio/recoger),
  │    metodo_pago (Transferencia/Efectivo), dirección si domicilio, items
  │    (producto_id/cantidad/precio_unitario) y la forma de `mitades` (array de 2 con
  │    producto_id); total preliminar; expone productoIds INCLUYENDO los de cada mitad
  └─ Validar productos menu (HTTP GET /menu?producto_id=in(...)&disponible=eq.true — credencial `Supabase account`)
  │    select: producto_id, nombre, disponible, variante, categoria, tamaño
  └─ Construir pedido (Code) — verifica que todos los productoIds existan/disponibles
  │    (faltan → error PRODUCT_NOT_FOUND); RECALCULA las líneas mitad y mitad contra el
  │    menú real; recalcula el total; arma pedidoObj (estado/estado_pago='pendiente')
  └─ If (¿error?) → Stop and Error  |  INSERT pedido (Supabase, credencial) → tabla pedidos
       └─ Code in JavaScript — arma `detalles` con el pedido_id devuelto (+ `mitades`)
       └─ INSERT detalle_pedidos (HTTP POST — credencial `Supabase account`)
       └─ Limpiar carrito (HTTP DELETE /carritos?telefono — credencial `Supabase account`)
       └─ Respuesta de salida → { ok: true }
```

**Notas:**
- El `total` se calcula en JS aquí y se inserta, pero el trigger de Postgres lo recalcula al
  insertar `detalle_pedidos`. Redundante pero coherente con la convención (total = trigger).
- **BUG-007 resuelto:** todos los nodos HTTP del sub usan la credencial `Supabase account`
  (`sb_secret_`, salta RLS) — verificado vía MCP 2026-07-22. El INSERT de `detalle_pedidos`
  ya no choca con la política `authenticated` de RLS.
- **Pizza mitad y mitad (2026-08-10):** si un item trae `mitades`, `Construir pedido` **no
  confía** en el `precio_unitario` que mandó el LLM: lee las dos mitades del menú que acaba de
  traer, exige misma masa y tamaño válido (`pequena/mediana/grande/familiar` — la porción no),
  y reescribe `producto_id` (la mitad más cara), `nombre_producto` (`"Mitad X / Mitad Y"`) y
  `precio_unitario` (el de la más cara). Errores: `MITAD_TAMANO_INVALIDO`, `MITAD_NO_ENCONTRADA`,
  `MITAD_SIN_PRECIO`, `MITAD_MASA_DISTINTA`, `MITADES_IGUALES`. Es la **segunda** barrera: la
  primera es la RPC `cotizar_mitad_y_mitad` que llamó el Agente Menú al armar el carrito.

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
  el fix de BUG-004, 2026-07-23), **`motivo`** (2026-08-10)
- **Salida:** `{ ok, reserva_id, fecha/hora legibles, personas, motivo, costo_motivo, costo_legible }`
  o `{ ok:false, error }`

```
When Executed → Validar y verificar cupo (Code, solo prepara la fila) → INSERT (reservas) → Formatear respuesta
```

- **Motivo de la reserva (2026-08-10):** el sub recibe solo la **clave** del motivo y la normaliza
  (`trim().toLowerCase()`, vacío → `sin_ocasion`). **No manda el costo**: lo escribe el trigger
  `trigger_costo_motivo` desde `motivos_reserva`, así que un precio inventado por el LLM no puede
  llegar a la fila. `Formatear respuesta` devuelve `costo_motivo` y `costo_legible` (ya formateado)
  para que el agente confirme el valor sin recalcularlo.
- ⚠️ **Latente:** `Validar y verificar cupo` lee `input.notas`, pero `notas` **nunca se declaró**
  como input del trigger ni lo pasa el nodo `crear_reserva` del main → siempre entra `null`. El bot
  no puede guardar notas en una reserva. No lo arreglé aquí porque implica ampliar la firma de la
  tool y el prompt; registrado en el bug-tracker.

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
