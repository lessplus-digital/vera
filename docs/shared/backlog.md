# Backlog — Features y mejoras pendientes

> Qué queremos construir o mejorar — **no son bugs** (esos van en
> [`bug-tracker.md`](bug-tracker.md)). Al completar un ítem: quítalo de aquí y registra la
> decisión/el cambio en [`changelog.md`](changelog.md).

## Seguridad (riesgo diferido consciente)

- **Proxy para envíos de WhatsApp** — `VITE_WA_ACCESS_TOKEN` viaja en el bundle del dashboard
  (y además quedó en el historial de versiones de n8n). El fix real: enrutar los sends del
  dashboard por n8n o una edge function, y **rotar el token** (actualizar credencial n8n +
  `.env.local`). Mientras tanto es el único secreto expuesto conocido del sistema.

## Dashboard

- **`useOrders`: exponer estado `error` en el UI** — hoy un fallo de fetch solo hace
  `console.error` (el spinner infinito ya se arregló en BUG-013); falta un banner/toast para
  que el admin se entere sin abrir la consola.
- **Design system: migrar pedidos, reservas y soporte** — clientes y estadísticas ya usan el
  sistema (ver `docs/dashboard/design-system.md`); faltan los modales/botones de
  `orders.less`, `reservations.less` y `support.less`: llevar CTAs a `.btn primary` (1 por
  pantalla), formularios al patrón `.field` (helpers debajo), y purgar `--font-mono` restante.
- **`SalesChart`: eliminar el eje dual** — pedidos (barras) + ingresos (línea) comparten
  gráfica con dos escalas Y; la buena práctica de dataviz es separarlos en dos charts o
  indexarlos a una base común.

## Features nuevas (ideas 2026-07-23)

> Priorización sugerida: el top para vender el SaaS es Resumen diario WA + Tab Reseñas +
> Modo TV (wow inmediato, esfuerzo bajo). Métricas del bot es la carta de ROI para nuevos
> clientes. Campaña de reactivación es la que genera ingresos directos al restaurante.

- **Resumen diario por WhatsApp al dueño** `[S — solo n8n]` — cron en n8n que al cierre
  (~23:00 Colombia) envía al dueño un mensaje con el pulso del día: nº de pedidos, ingresos,
  producto top, cancelados. Deja "sentir" el negocio sin abrir el dashboard. Reutiliza la
  infra existente (n8n + WA); la agregación es la misma lógica del RPC `historial_resumen`.
- ~~**Tab Reseñas 💬**~~ ✅ **Hecho (2026-07-23)** — implementada con doble propósito (pulso de
  satisfacción + cola de recuperación con "Responder por WhatsApp"). Ver `changelog.md` y
  `docs/dashboard/components.md` §9.
- **Métricas del bot 🤖** `[M]` — conversaciones atendidas solo por el bot vs. handoffs a
  humano, tasa de conversión chat→pedido, horas pico de chat. Demuestra el ROI del bot =
  carta de venta para los próximos clientes del SaaS. Data: `n8n_chat_histories` +
  `mensajes_soporte` + `pedidos.origen`.
- **Modo TV para cocina (KDS)** `[S-M]` — botón "Modo pantalla" que abre el kanban
  fullscreen (sin sidebar, cards gigantes, cronómetro por pedido con color según demora,
  sonido fuerte) para poner en una tablet/TV en cocina. Alto valor en demos.
- **Metas y racha del mes 🏆** `[S]` — el dueño fija una meta mensual de ventas en
  Configuración (`info_negocio`); header/estadísticas muestran barra de progreso vs. meta y
  vs. el mes anterior. Gamificación barata que genera hábito de uso.
- **Insights automáticos** `[M]` — card en Estadísticas con 2-3 frases generadas por reglas
  sobre agregaciones que ya se calculan (ej. "los viernes vendes 40% más", "Pizza Hawaiana
  lleva 30 días sin venderse", "5 clientes frecuentes no piden hace un mes" — esto último ya
  lo calcula `RiskClients`). Se siente como IA, es solo agregación.
- **Campañas de reactivación** `[M-L]` — el **envío individual ya está hecho** (2026-07-23):
  `RiskClients` en Estadísticas manda la plantilla `reactivacion_cliente` con `PromoModal`. Falta
  el **masivo/bulk**: seleccionar un segmento (inactivos 30+ días) y enviar en lote — debe ir por
  **n8n** (límites de tier de Meta + no exponer el token en el navegador). Requiere opt-in y cuidar
  la calidad del número.
- **Recordatorio de reserva por WhatsApp (n8n)** `[M]` — plantilla `recordatorio_reserva` ya creada;
  falta el **cron en n8n**: diario busca reservas de mañana (estado pendiente/confirmada) → envía la
  plantilla (nombre/fecha/hora/personas desde `reservas`) → maneja los taps **Confirmar ✅ / Cancelar
  ❌** (enganchar a `Sub — Crear/Cancelar Reserva`). Reduce no-shows. Decisión 2026-07-23: se hace en
  una pasada aparte.
- **Enrutar taps de botón de plantillas en el bot (n8n)** `[S-M]` — los Quick Reply
  (`Quiero pedir`, `Confirmar`, `Sí, les cuento`) entran como mensajes al bot; validar que el agente
  los maneje bien (reactivación → tomar pedido; reserva → confirmar/cancelar).
- **Roles de usuario** `[L]` — admin total vs. "cocina" (solo kanban) vs. "marketing".
  Relevante cuando el restaurante tenga varios empleados usando el dashboard.

## Bot

- **Bloqueo de reservas duplicadas (opcional)** — decisión 2026-07-23 (BUG-008): NO se bloquean
  en BD; una misma persona puede reservar dos veces el mismo día (ej. almuerzo y cena) y el
  agente lo maneja conversacionalmente. Si algún día se quiere bloquear: extender
  `trigger_validar_cupo` o query previa al INSERT en `Sub — Crear Reserva`.

## Marca y marketing — Plateo (el producto)

> **Plateo** es el software (el SaaS que vendemos a muchos restaurantes); **Vera** es solo
> el primer cliente/instancia. Hoy toda la UI dice "Vera Pizzería" y se pierde el concepto de
> producto. Hay que separar la **marca del producto** (Plateo, constante en todos los clientes)
> de la **marca del cliente** (Vera, por tenant). Ver también la visión SaaS abajo.

- **Branding Plateo en la plataforma** `[M]` — introducir la identidad de Plateo sin borrar
  la del cliente. La regla mental: el operador (Vera) ve **su** marca en el contenido (logo,
  nombre del negocio desde `info_negocio`), mientras que Plateo aparece como **el producto**
  en el chrome/marca de agua: login ("Plateo · para Vera Pizzería"), footer/"Powered by
  Plateo", favicon/título de pestaña, pantalla de carga, emails/PDFs exportados. Requisito
  para el modelo multi-tenant: el nombre del cliente debe salir de datos (`info_negocio`,
  que ya tiene el nombre del negocio), nunca hardcodeado — así la misma app sirve a cualquier
  cliente. Definir tokens de marca Plateo (color, logo) separados del tema por-cliente.
- **Landing / sitio de marketing de Plateo** `[M-L]` — página pública que vende Plateo a
  nuevos restaurantes (bot WhatsApp + dashboard + reservas...), con demo, precios y captura
  de leads. Es el frente comercial del SaaS, distinto del dashboard operativo.
- **Programa de referidos** `[M]` — que un cliente de Plateo (ej. Vera) refiera a otro
  restaurante y reciba un beneficio (descuento en su mensualidad / mes gratis) cuando el
  referido se activa. Necesita: código o link de referido por cliente, tracking de referido→
  activación, y un lugar donde el cliente vea sus referidos y su recompensa (sección en el
  dashboard o en el control plane). Encaja de forma natural con el cobro tipo SaaS (Stripe)
  del control plane de abajo. Palanca de crecimiento de bajo costo: los propios dueños de
  restaurante se conocen entre sí.

## SaaS (visión — ver changelog 2026-06-19)

- **Multi-cliente por silo:** un proyecto Supabase + una instancia n8n por cliente
  (aislamiento físico, migraciones-como-código), una sola app React desplegada una vez que
  resuelve el tenant por subdominio (`vera.lessplus.net`).
- **Control plane** con cobro tipo SaaS (Stripe) — futuro.
