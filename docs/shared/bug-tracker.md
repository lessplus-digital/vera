# Bug Tracker — Bugs abiertos

> Solo bugs **por corregir** y verificaciones pendientes de fixes recientes.
>
> - Historial de lo resuelto → [`changelog.md`](changelog.md) (entrada condensada por tema;
>   el detalle completo de cada fix vive en el git history de este archivo).
> - Features y mejoras pendientes (no-bugs) → [`backlog.md`](backlog.md).
> - Lecciones reutilizables → [`edge-cases.md`](edge-cases.md).
>
> **Al resolver un bug:** quita su entrada de "Abiertos", registra una entrada condensada en el
> changelog (qué se hizo + cómo se verificó), y si dejó lección, resúmela en edge-cases.

## Convención

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-032**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

### BUG-030 · 🔴 Alta · 🔴 Abierto — ninguna escritura por API funciona sobre el workflow principal de n8n

- **Componente:** n8n → workflow `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`)
- **Síntoma:** **cualquier** `PUT` sobre el workflow falla con
  `Invalid request: request/body/settings must NOT have additional properties`. No es específico
  de un cambio: verificado con un `moveNode` que reposiciona un sticky note a su propia posición,
  y con tres `updateSettings` distintos. El workflow **no se modifica** (el error es de
  validación, previo a la escritura).
- **Causa (identificada 2026-08-18 con el export del workflow):** `settings` contiene claves que
  el editor de n8n escribe pero que el esquema de la API pública v1 **no** acepta. Estado real:

  ```json
  "settings": {
    "executionOrder": "v1",              // ✔ legal
    "timezone": "America/Bogota",        // ✔ legal
    "availableInMCP": false,             // ✔ la tiene el subworkflow, que sí guarda
    "binaryMode": "separate",            // ✘ fuera del esquema
    "timeSavedMode": "fixed",            // ✘ fuera del esquema
    "callerPolicy": "workflowsFromSameOwner"  // ✘ fuera del esquema
  }
  ```

  El esquema solo admite `executionOrder`, `errorWorkflow`, `timezone`, `executionTimeout`,
  `saveExecutionProgress`, `saveManualExecutions`, `saveDataErrorExecution`,
  `saveDataSuccessExecution`. El `PUT` reenvía `settings` tal cual está guardado, así que
  **cualquier** escritura rebota antes de tocar nada.
- **Por qué no se puede arreglar por MCP (las 4 vías, todas descartadas con evidencia):**
  1. `updateSettings` hace **merge**, no reemplazo — verificado mandando solo
     `{executionOrder:"v1"}`: siguió fallando, o sea las claves viejas seguían viajando.
  2. Pasar `null` **no elimina** la clave — verificado con las tres a la vez.
  3. `n8n_update_full_workflow` con `settings` explícito **también mergea** — verificado
     2026-08-18. (Efecto colateral útil: se comprobó que **no** manda `nodes: []` cuando se
     omiten; el workflow quedó intacto en 101 nodos y ni siquiera cambió `updatedAt`.)
  4. Guardar desde la UI tampoco sirve: esas tres claves las **escribe el editor**, así que
     vuelven a aparecer. Verificado — tras un guardado manual el error se repitió idéntico.
- **Impacto:** el bot no puede recibir la tool `consultar_cobertura` ni la limpieza del `$5.000`
  quemado en el prompt del Agente Pedidos (ver changelog 2026-08-18). Funcionalmente el bot sigue
  bien —cobra $5.000 vía la tarifa base, que es lo que dice su prompt— pero **no puede cobrar
  tarifas por zona** hasta que esto se destrabe.
- **Fix:** los cambios pendientes se aplican **a mano en el editor de n8n** — instrucciones
  completas y literales en **[`docs/bot/pendiente-zonas-domicilio.md`](../bot/pendiente-zonas-domicilio.md)**
  (atajo: `/zonas-bot`). De fondo, la vía MCP se destraba solo con una de estas dos, ninguna urgente:
  1. Actualizar el n8n-mcp a una versión que **filtre** `settings` a las 8 claves del esquema
     antes del `PUT` — es lo correcto: el problema es del cliente, no del workflow.
  2. Actualizar n8n a una versión cuyo esquema de API pública ya incluya `binaryMode`,
     `timeSavedMode` y `callerPolicy`.
- **Alcance:** afecta a **todo** el workflow principal, no solo a esta tarea. Cualquier cambio
  futuro por MCP sobre `Pizzeria Vera` va a rebotar igual hasta que se resuelva.

### BUG-031 · 🟡 Media · 🔴 Abierto — 8 pedidos con total escrito a mano y cero líneas de detalle

- **Componente:** BD → `pedidos` / `detalle_pedidos`
- **Síntoma:** 8 pedidos tienen `total` > 0 y **ninguna fila** en `detalle_pedidos`:
  `PED-096` ($216.200), `PED-097` ($3.365.000), `PED-098` ($29.000), `PED-099` ($332.300),
  `PED-100` ($115.400), `PED-109` ($77.000), `PED-111` ($115.500), `PED-113` ($33.300).
  Seis están `entregado`, dos `cancelado`. Fechas entre 2026-05-17 y 2026-07-01.
- **Causa:** sin confirmar. Encajan con datos sembrados a mano o pruebas tempranas; el de
  $3.365.000 es claramente ficticio. No los pudo producir el flujo normal, que inserta las líneas
  y deja que el trigger calcule el total.
- **Impacto:** ensucian las estadísticas de ingresos (`historial_resumen` suma `total` de los no
  cancelados, así que los ~$3.7M entran en el reporte) y el detalle del pedido se ve vacío en el
  dashboard. **No bloquean nada:** el trigger de tarifa por barrio se diseñó por delta justamente
  para no aplanarlos (ver edge-cases §23).
- **Fix propuesto:** decidir con el negocio si se borran o se marcan. **No tocarlos sin
  confirmar** — dos de ellos son del mismo rango de fechas que los datos de prueba de roles que ya
  se acordó dejar vivos.

### BUG-029 · 🟢 Baja · 🔴 Abierto — el bot no puede guardar notas en una reserva

- **Componente:** bot → n8n `Sub — Crear Reserva`, nodo `Validar y verificar cupo`; nodo
  `crear_reserva` del workflow principal
- **Síntoma:** el Code node arma la fila con `notas: input.notas || null`, pero **`notas` nunca se
  declaró** como input del `executeWorkflowTrigger` y el nodo `crear_reserva` del main tampoco lo
  manda vía `$fromAI`. Resultado: `reservas.notas` entra **siempre `null`** en las reservas creadas
  por WhatsApp. Si el cliente dice "mesa cerca de la ventana", se pierde.
- **Verificado vía MCP (2026-08-10):** los `workflowInputs` del sub son `telefono`, `nombre`,
  `fecha`, `hora`, `personas`, `cliente_id` y `motivo` — no hay `notas`. El campo del INSERT existe
  y apunta al Code node, así que el cableado se corta un paso antes.
- **Contraste:** las reservas creadas desde el **dashboard** sí guardan notas (`ReservationModal`
  tiene el campo y `useReservations` lo inserta). Solo falla el camino del bot.
- **Fix propuesto:** declarar `notas` como input del sub, agregar
  `notas: {{ $fromAI('notas', '...') }}` al nodo `crear_reserva` del main y una línea en el prompt
  del Agente Reservas para que capture peticiones especiales. No se hizo junto con `motivo`
  (2026-08-10) porque amplía la firma de la tool y el flujo conversacional: es una feature aparte,
  no parte de los motivos.

---

### BUG-027 · 🟢 Baja · 🔴 Abierto — mensajes de feedback muestran `\n` literal al cliente

- **Componente:** bot → n8n `Sub — Feedback Pendiente`, nodos WhatsApp `Invitar reseña Google`,
  `Pedir comentario`, `Agradecer feedback`, `Pedir nota de nuevo`
- **Síntoma (esperado, sin confirmar con tráfico real):** los cuatro `textBody` guardan los
  saltos de línea **escapados** (`\n` como backslash + n) dentro de un campo de expresión `=`.
  n8n solo evalúa `{{ }}`; el resto es texto literal, así que el cliente vería
  `¡Qué bueno que te gustó! 🍕🔥\n\nNos ayudarías...` en una sola línea con los `\n` a la vista.
  Afecta al mensaje que lleva el **link de reseña de Google**, que queda embebido en ese texto.
- **Contraste:** los nodos WhatsApp del workflow principal (`Comprobante recibido`,
  `Pedido no encontrado`, `en_cocina`…) sí usan saltos de línea reales. Es una desviación
  aislada de este subworkflow, probablemente por pegar el texto desde código.
- **Verificación pendiente:** `n8n_executions` de `Sub — Feedback Pendiente` devuelve **0
  ejecuciones**, así que el camino nunca se ejerció. Confirmar con un feedback real (o una
  ejecución manual) antes de dar por bueno el diagnóstico.
- **Fix propuesto:** reemplazar los `\n` escapados por saltos de línea reales en los cuatro
  nodos. El link de Google en sí **es correcto** (Google Maps real de La Vera Pizzería).

---

### BUG-026 · 🟡 Media · 🔴 Abierto — `info_negocio` contiene datos de plantilla de otro negocio

- **Componente:** BD (`info_negocio`) → bot (tool `info_local`, Agente Soporte)
- **Síntoma:** el bot responde información de **"La Pizzería Don Carlo"** cuando le preguntan
  por el local: teléfonos +58 (Venezuela), "Banco Venezuela" en `datos_transferencia`,
  "municipio Sucre" en `zona_delivery`, instagram `@doncarlопizzeria` (¡con caracteres
  cirílicos!). Son valores semilla de una plantilla, nunca se reemplazaron con los datos
  reales de Vera Pizzería.
- **Causa (verificada vía MCP 2026-07-23):** la tabla se pobló con data de ejemplo y ningún
  flujo la actualizaba — no existía UI para editarla.
- **Fix aplicado parcialmente:** la tab **Configuración** del dashboard (2026-07-23) ya
  permite editarla. **Pendiente (requiere al operador):** llenar los valores reales de Vera
  Pizzería en la tab — en especial `direccion`, `telefono_principal`, `whatsapp`, `instagram`,
  `datos_transferencia`, `zona_delivery`, `horario_*` y `costo_delivery`. Cerrar este bug
  cuando la tabla tenga la data real.
- **Avance (2026-07-28):** `link_menu` ya quedó con su valor real
  (`https://vera.plateo.cloud/menu_vera.pdf`). Sigue pendiente el resto.

---

## En observación

Fixes ya aplicados cuya verificación final depende de tráfico real:

- **BUG-028** — el job `expirar-pedidos-pendientes` (pg_cron, 16:00 UTC) todavía no ha corrido
  en producción. Confirmar en la primera ejecución que: (a) cierra solo los `pendiente` de días
  anteriores y **no** toca los del turno en curso, y (b) el cliente recibe la cancelación con un
  texto que se lee bien (*"Tu pedido fue cancelado, no alcanzamos a procesarlo antes del cierre
  del día."*). Revisar con `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5`.
- **BUG-025** — tras desplegar, confirmar en una noche real (19:00–24:00 Colombia) que el
  kanban muestra los pedidos que entran (antes se vaciaba en esa franja).
- **BUG-023/024** — tras desplegar el build con `realtime.setAuth`, confirmar que el badge
  de soporte y el panel siguen actualizándose en vivo (las políticas `public` de
  `mensajes_soporte` ya no existen; todo el realtime va autenticado).

- **BUG-007** — confirmar que el próximo pedido real del bot trae líneas:
  `pedidos` recientes con `count(detalle_pedidos) = 0` debería dar vacío.
- **BUG-005/009** — probar una cancelación de reserva real por WhatsApp: camino feliz
  y un intento con reserva ajena (debe responder "esta reserva no es tuya").
- **pinData viejo (cosmético)** — `Sub — Crear Reserva` y `Sub — Cancelar Reserva` conservan
  pins con las keys viejas (`cliente_id `/`telefono ` con espacio), y `Sub — Consultar_menu`
  los query params del `ilike`. Solo afecta pruebas manuales en el editor — re-pinnear al abrirlos.
