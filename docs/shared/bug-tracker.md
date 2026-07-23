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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-027**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

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
  `datos_transferencia`, `zona_delivery`, `horario_*`, `link_menu` y `costo_delivery` (los
  dos últimos se crearon vacíos). Cerrar este bug cuando la tabla tenga la data real.

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
