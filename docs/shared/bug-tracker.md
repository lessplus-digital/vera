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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-028**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

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
