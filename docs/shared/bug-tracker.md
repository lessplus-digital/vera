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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-026**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

*(ninguno — resueltos BUG-022/024/025 el 2026-07-22, ver changelog)*

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
