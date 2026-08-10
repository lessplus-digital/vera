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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-030**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

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

### BUG-028 · 🟡 Media · 🔴 Abierto — 11 pedidos llevan semanas en `pendiente` y envenenan las búsquedas del bot

- **Componente:** datos (`pedidos`) → bot (ruta de comprobante), dashboard (kanban)
- **Síntoma:** hay **11 pedidos en `estado = 'pendiente'`**, varios de mayo/junio, que nunca se
  cerraron ni cancelaron. Cinco son del mismo cliente (CLI-038: `PED-113`, `PED-103`, `PED-104`,
  `PED-222`, `PED-107`).
- **Por qué importa:** son la munición que activó el fix de hoy (ver changelog 2026-07-29 y
  `edge-cases.md#18`). Cualquier flujo que busque "el pedido pendiente del cliente" recibe **N filas**
  en vez de 1. El fix de `Preparar Upload` ya desempata por fecha, pero el dato sucio sigue ahí y
  seguirá rompiendo cualquier consulta futura que asuma unicidad.
- **Causa:** no existe proceso (ni manual ni automático) que cierre o cancele pedidos abandonados.
  Un pedido queda `pendiente` para siempre si el cliente nunca paga y nadie lo toca en el kanban.
- **Fix propuesto:** (a) decidir con el operador qué hacer con esos 11 (cancelar con
  `motivo_rechazo` = abandonado, o cerrarlos); (b) evaluar una regla de expiración —
  p. ej. cancelar automáticamente los `pendiente` con más de X horas sin comprobante.
- **Pendiente menor (mismo tema):** quedó un objeto huérfano `comprobantes/PED-109.jpg` en Storage
  (copia con nombre engañoso del comprobante de `PED-223`). No se pudo borrar por MCP: las políticas
  de `storage.objects` solo tienen `SELECT` público e `INSERT` para `anon`, **no hay `DELETE`**.
  Borrarlo desde el dashboard de Supabase o con la `service_role`.

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
