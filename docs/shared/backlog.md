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

## Bot

- **Bloqueo de reservas duplicadas (opcional)** — decisión 2026-07-23 (BUG-008): NO se bloquean
  en BD; una misma persona puede reservar dos veces el mismo día (ej. almuerzo y cena) y el
  agente lo maneja conversacionalmente. Si algún día se quiere bloquear: extender
  `trigger_validar_cupo` o query previa al INSERT en `Sub — Crear Reserva`.

## SaaS (visión — ver changelog 2026-06-19)

- **Multi-cliente por silo:** un proyecto Supabase + una instancia n8n por cliente
  (aislamiento físico, migraciones-como-código), una sola app React desplegada una vez que
  resuelve el tenant por subdominio (`vera.lessplus.net`).
- **Control plane** con cobro tipo SaaS (Stripe) — futuro.
