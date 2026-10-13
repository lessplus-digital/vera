# Backlog — qué sigue

> **Una sola lista, en el orden en que se hace.** Lo que ya se hizo está en
> [`changelog.md`](changelog.md); los defectos, en [`bug-tracker.md`](bug-tracker.md).
> Estimaciones: `[S]` horas · `[M]` un día · `[L]` varios días. 🔒 = bloqueado por algo externo.
>
> **Estado al 2026-10-13:** el bot Node está en producción con el número de pruebas
> (322 681 7466), n8n está apagado y el dashboard ya envía por el servidor. Falta instalar todo en
> el cliente real.

## 1. Lanzamiento — instalar en el cliente real

Lo que tiene que estar hecho **antes** de abrir al público. Se hace una sola vez, en este orden.

| # | Qué | Quién | Esfuerzo |
|---|---|---|---|
| 1.1 | **Número de WhatsApp y token propios del cliente**; apuntar el webhook de Meta a `https://bot.plateo.cloud/webhook/whatsapp` y poner `WA_ACCESS_TOKEN` y `WA_PHONE_NUMBER_ID` nuevos en `~/vera/server/.env` del VPS (`docker compose up -d --force-recreate`) | Dueño + Claude | `[S]` |
| 1.2 | **Rotar el token que estuvo expuesto** en el bundle público (riesgo aceptado hasta aquí: [ver §Seguridad](#seguridad)). Si el número es nuevo, el token viejo muere solo; revocarlo igual en Meta | Dueño | `[S]` |
| 1.3 | **Plantillas de WhatsApp aprobadas** en el WABA del cliente (`recordatorio_reserva`, `reactivacion_cliente`, la de estado de pedido): sin ellas los envíos fuera de la ventana de 24 h fallan (captura de las actuales: `images/plantillas meta.png`) | Dueño | `[S]` · 🔒 Meta |
| 1.4 | **Limpiar los datos de prueba** (ver [§Housekeeping](#housekeeping)): ~80 pedidos semilla, 4 de `PRUEBA ROLES`, 67 con `domiciliario_id` sembrado, BUG-031 | Claude | `[S]` |
| 1.5 | **Precios reales de `motivos_reserva`** — hoy es una propuesta (Cumpleaños $60.000 · Aniversario $70.000 · Declaración $90.000 · Grado $60.000 · Empresarial $100.000); `UPDATE` o pantalla de §4 | Dueño | `[S]` |
| 1.6 | **FAQ e `info_negocio` reales**: la `faq` tiene 5 filas derivadas de `info_negocio` (dirección, horario, pagos, domicilio, reservas); el restaurante suma las suyas (wifi, mascotas, tarjeta…) desde la tab Configuración y confirma dirección, horarios y cuenta bancaria | Dueño | `[S]` |
| 1.7 | **Kanban: columna de cerrados + navegación por día** (§4) — sin ella el pedido pagado que ya no se autocancela desaparece de la vista al día siguiente | Claude | `[S-M]` |
| 1.8 | **Dump de Supabase** (estructura + datos) guardado fuera del repo (público), y backups del VPS (hoy semanales en Hostinger; el diario cuesta ~US$3/mes) | Dueño | `[S]` |
| 1.9 | **Verificar que el VPS está vigente y con renovación automática** | Dueño | `[S]` |
| 1.10 | **Pruebas reales por WhatsApp** de lo que el simulador no puede cubrir: una reserva completa, un pedido con foto de comprobante, tocar un botón de plantilla, un audio y una ubicación (lista en [`bot/despliegue.md`](bot/despliegue.md)) | Dueño | `[S]` |

## 2. Vigilancia — primeras 48 horas y 2 semanas

- **Cada día, `bot_turnos`:** filas con `error` no nulo o con `guardia` activada. Es la ventana a lo
  que el cliente realmente escribe; cada hallazgo se vuelve un escenario en `server/test/escenarios/`.
- **Costo de OpenAI por conversación:** `bot_turnos.costo` ya guarda el turno completo; con una
  semana de tráfico sale cuánto cuesta atender un cliente (insumo para el precio del SaaS).
- **Unificar la versión de la API de Meta** `[S]` — el webhook llega en v25/v26 y los envíos salen
  en v25.0; dejarlas en la misma.
- **Reservas y calificaciones reales:** confirmar que una reserva real y una calificación real
  cierran bien (ver "En observación" en [`bug-tracker.md`](bug-tracker.md)).
- **Antes de cambiar de modelo de OpenAI:** correr el simulador completo (×5). Casi todos los bugs
  de la migración aparecieron con el modelo real, no con las unitarias.

## 3. Apagar n8n del todo (VPS y cuentas)

**n8n ya no existe en el VPS** (2026-10-13): proyecto, volumen e imagen borrados (verificado),
y Traefik quedó propio y versionado en `server/traefik/`. Falta solo revocar sus claves y
limpiar nombres heredados:

| # | Qué | Quién | Esfuerzo |
|---|---|---|---|
| 3.1 | ✅ **Hecho:** n8n borrado del VPS (contenedor, volumen `n8n_data` e imagen; disco de 6,1 GB a 3,4 GB usados) | — | — |
| 3.2 | ✅ **Hecho:** Traefik propio en `server/traefik/docker-compose.yml` (ver §Incidente abajo) | — | — |
| 3.3 | **Revocar lo que n8n usaba:** la secret key de Supabase de n8n (el bot usa `bot-node`) y la API key de OpenAI de n8n. El token de Meta se rota en §1.2 | Dueño | `[S]` |
| 3.4 | **Quitar el servidor MCP `n8n-native` de `.mcp.json`** local de cada persona que lo tenga | Dueño | `[S]` |
| 3.5 | **Renombrar la red `n8n_default`** (la comparten Traefik y el bot) a `proxy`: tocar `server/docker-compose.yml` y `server/traefik/docker-compose.yml` y recrear ambos (unos segundos sin servicio) | Claude | `[S]` |
| 3.6 | **Renombrar la tabla `n8n_chat_histories`** a algo propio (`chat_historial`): migración + `server/src/bd/repo-supabase.ts` + RPC `registrar_contexto_handoff` + baterías 07/08. Cosmético | Claude | `[M]` |

> **Incidente del 2026-10-13 (lección):** al borrar "n8n" desde el administrador de Docker de
> Hostinger se borró el *proyecto* completo, y Traefik (el proxy HTTPS del bot) vivía dentro de ese
> proyecto: `bot.plateo.cloud` quedó sin responder desde afuera hasta que se recreó Traefik
> (el certificado sobrevivió en el volumen `traefik_data`). Desde entonces Traefik tiene su propio
> compose; **no borrar el volumen `traefik_data` ni los proyectos `server` y `traefik`** desde el panel.

## 4. Dashboard

### Kanban: cuarta columna de cerrados + navegación por día `[S-M]`

**No es cosmético: es la otra mitad del fix de BUG-052.** El job de expiración ya no cancela los
pedidos con comprobante: se quedan vivos en `pendiente` a propósito, para que los atienda una
persona. Pero el kanban solo muestra **el día actual** y **cuatro estados activos**
(`useOrders.js`), así que al día siguiente ese pedido pagado desaparece de la vista.

Lo que pidió el dueño: ver *"los pedidos entregados, los que ya no tienen nada para hacer por
nuestro lado"* y poder *"devolverme a los pedidos de ayer, de antier… como si fuese un calendario"*.

1. **Columna "Cerrados"** (`entregado` + `cancelado`) debajo de las tres actuales, a lo ancho.
   `COLUMNS` (`src/utils/constants.js`) ya admite `key` como array. **Un cancelado con
   `comprobante_url` debe cantarse en la tarjeta**: es dinero recibido por un pedido que no existe.
2. **Navegación por día** (`‹ ›` + "Hoy"). `colombiaDayStart(date)` ya acepta una fecha. Dos
   cuidados: el realtime y el sonido solo actúan cuando el día elegido es hoy, y las `stats` de la
   cabecera deben seguir al día elegido.
3. Actualizar `docs/dashboard/components.md` en el mismo commit y respetar `design-system.md`.

### Otras mejoras del dashboard

- **`useOrders`: mostrar el error en el UI** `[S]` — hoy solo hace `console.error`; falta un banner
  o toast para que el admin se entere sin abrir la consola.
- **Migrar pedidos, reservas y soporte al design system** `[M]` — llevar los CTA a `.btn primary`
  (uno por pantalla), los formularios al patrón `.field` y purgar el `--font-mono` restante
  (`orders.less` tiene ~10 usos). Ver [`dashboard/design-system.md`](dashboard/design-system.md).
- **`SalesChart`: eliminar el eje dual** `[S]` — pedidos (barras) e ingresos (línea) comparten
  gráfica con dos escalas Y; separarlos en dos charts.
- **Rol mesero: parte de salón** `[M]` · 🔒 PLATEO-52 — le faltan **mesas**, que exige ampliar el
  CHECK de `tipo_pedido`. Mismo riesgo que «venta en mostrador» ([`dashboard/pos.md`](dashboard/pos.md)).
- **Invitar usuarios desde la UI** `[M]` — hoy se crean a mano en Supabase porque la admin API exige
  `service_role`. Si se quiere: Edge Function, **nunca desde React**.
- **POS — impresión de tickets y cajón** `[L]` — analizado, sin código: hardware ya en el local
  (Epson TM-T88 + cajón). Plan y datos pendientes en [`dashboard/pos.md`](dashboard/pos.md).

## 5. Bot

- **Notas en la reserva** `[S-M]` — BUG-029: la petición especial del cliente se pierde. Ver
  [`bug-tracker.md`](bug-tracker.md).
- **Soporte no debe decir "no puedo crear pedidos"** `[S]` — BUG-064.
- **Recordatorio de reserva el día anterior** `[M]` — job en `server/src/cron/` que busque las
  reservas de mañana (pendiente/confirmada) y envíe la plantilla `recordatorio_reserva`. Reduce
  no-shows; los taps `Confirmar`/`Cancelar` ya están enrutados.
- **Resumen diario por WhatsApp al dueño** `[S]` — job a las ~23:00 (Colombia): pedidos, ingresos,
  producto top, cancelados. Misma agregación que `historial_resumen`.
- **Revalidar `disponible` al cerrar el pedido** `[M]` — un producto puede agotarse mientras ya
  está en el carrito; verificar que `crear_orden_desde_carrito` lo rechaza y que el bot avisa y
  devuelve al cliente a elegir.
- **Reja dura de cobertura en la BD** `[M]` — la cobertura ya la decide el código, pero la BD
  aceptaría un domicilio con un barrio que no resuelve. Rechazarlo solo en el camino del bot
  (`auth.uid() IS NULL`), nunca desde el dashboard. Riesgo: una errata sin resolver sería una venta
  perdida, así que solo después de medir con tráfico real.
- **Probar los taps de botón en real** `[S]` — verificación pendiente, no desarrollo (§1.10).
- **Pasar el simulador a un modelo más barato donde se pueda** `[S]` — el costo de cada corrida
  completa es relevante; medir con `bot_turnos.costo` qué agente admite un modelo menor.
- **Piloto de Jev** `[M]` — comparar con los mismos escenarios un decisor alternativo.
- **Bloqueo de reservas duplicadas** — ❌ **decidido que NO** (2026-07-23): una persona puede
  reservar almuerzo y cena el mismo día. Aquí solo para que nadie lo vuelva a proponer.

## 6. Reservas

- **Ocasiones editables desde la tab Configuración** `[M]` — que `motivos_reserva` (nombre, costo,
  activo) se edite desde el dashboard en vez de por SQL.
- **Editar una reserva ya creada** `[M]` — hoy `ReservationDetail` solo permite eliminar; cambiar la
  ocasión obliga a borrar y recrear, **lo que dispara dos WhatsApps al cliente**. El trigger
  `trigger_costo_motivo` ya soporta el UPDATE.
- **Plantilla de WhatsApp con el costo del montaje** `[M]` · 🔒 Meta — la confirmación que manda el
  **dashboard** usa `recordatorio_reserva` (4 params) y no incluye la ocasión ni su costo. Crear y
  aprobar una de 6 params y agregarla a `WA_TEMPLATES`.

## 7. Producto — features nuevas

> Para vender el SaaS: **Resumen diario + Modo TV** (wow inmediato, esfuerzo bajo). **Métricas del
> bot** es la carta de ROI para nuevos clientes. **Campañas de reactivación** genera ingresos directos.

- **Modo TV para cocina (KDS)** `[S-M]` — kanban a pantalla completa (sin sidebar, tarjetas
  grandes, cronómetro por pedido con color según demora, sonido fuerte). **Alto valor en demos.**
- **Metas y racha del mes** `[S]` — meta mensual en `info_negocio`; progreso vs. meta y vs. mes anterior.
- **Insights automáticos** `[M]` — 2–3 frases por reglas sobre agregaciones que ya se calculan
  («los viernes vendes 40% más», «5 clientes frecuentes no piden hace un mes»).
- **Métricas del bot** `[M]` — conversaciones resueltas solo por el bot vs. handoffs, conversión
  chat→pedido, horas pico. Datos: `bot_turnos` + `mensajes_soporte` + `pedidos.origen`.
- **Campañas de reactivación en lote** `[M-L]` — el envío individual ya existe (`RiskClients` +
  `PromoModal`); falta el masivo (segmento de inactivos 30+ días) respetando los límites de tier
  de Meta y con opt-in.

## 8. Marca y visión SaaS

> **Plateo** es el software (el SaaS); **Vera** es el primer cliente. Hoy la UI dice «Vera
> Pizzería» en todas partes y se pierde el concepto de producto.

- **Branding Plateo en la plataforma** `[M]` — el operador ve **su** marca en el contenido
  (`info_negocio`); Plateo aparece como producto en el chrome (login, footer, favicon, título).
  El nombre del cliente sale de datos, nunca hardcodeado.
- **Repo modular por cliente / multi-cliente por silo** `[L]` — un proyecto Supabase + un servidor
  del bot por cliente (aislamiento físico, migraciones como código) y **una sola app React**
  desplegada una vez que resuelve el tenant por subdominio (`vera.plateo.cloud`).
- **Volver privado el repo de GitHub** `[S]` — hoy es público; antes hay que confirmar que no quedan
  secretos en el historial.
- **Landing / sitio de marketing** `[M-L]` — página pública que vende Plateo, con demo y leads.
- **Programa de referidos** `[M]` — beneficio cuando un restaurante referido se activa.
- **Control plane con cobro tipo SaaS (Stripe)** — futuro.
- ❌ **Facturación electrónica DIAN** — descartada por ahora (la clienta decidió no hacerla). Si
  algún día: integrar un proveedor autorizado por API desde el servidor, nunca en casa ni en el navegador.

## Seguridad

- **Token de WhatsApp expuesto — riesgo aceptado por el dueño (2026-10-13).** El proxy ya está en
  producción (`/api/wa`) y el bundle público **ya no contiene el token** (verificado descargando
  `vera.plateo.cloud`), pero el token que estuvo ahí sigue vigente. Se rota al instalar en el
  cliente real (§1.2). Pasos: usuario del sistema en Meta → token permanente → `WA_ACCESS_TOKEN`
  en `~/vera/server/.env` → `docker compose up -d --force-recreate` → revocar el viejo.
- **Repo público:** nunca subir dumps, capturas del panel del VPS, tokens ni datos operativos
  (`server/*.png` y `docs/*.jfif` ya están en `.gitignore`).

## Housekeeping

### Datos de prueba de roles en producción `[S]`

Sembrados el **2026-08-12** para validar los tres roles; **siguen ahí** y se dejan hasta el §1.4.

| Qué | Cuánto | Identificador |
|---|---|---|
| Usuarios de Auth + su perfil | 3 | `mesero.prueba@vera.test` · `domi.prueba@vera.test` · `domi2.prueba@vera.test` |
| Pedidos ficticios | 4 | `PED-234`…`PED-237` (`notas = 'PRUEBA ROLES — borrar'`) |
| Cliente ficticio | 1 | `ZZ Cliente Prueba Roles` (`573000000099`) |
| Pedidos con `domiciliario_id` puesto | **67** | pedidos reales/sembrados con repartidor asignado |

⚠️ **Los 4 pedidos ficticios cuentan en las estadísticas de su día** mientras existan.

⚠️ El teléfono `573000000099` es falso **a propósito**: marcar entregado dispara
`notificar-estado-pedido` y el servidor le escribe por WhatsApp al número del pedido. **No
reasignes esos pedidos a un cliente real para probar.**

```sql
-- el primer UPDATE deshace la asignación de los 67 históricos
update public.pedidos set domiciliario_id = null where domiciliario_id is not null;
delete from auth.users where email like '%.prueba@vera.test';
delete from public.pedidos where notas = 'PRUEBA ROLES — borrar';
delete from public.clientes where telefono = '573000000099';
```

Si se subieron fotos de perfil, además `delete from storage.objects where bucket_id='avatares';`
**y** borrar los archivos desde el panel de Supabase (quitar solo la fila deja el objeto en S3).

### Blobs y columnas muertas

- **Borrar `comprobantes/PED-109.jpg` de Storage** `[S]` — huérfano de un bug viejo; sin ninguna
  referencia en la BD. No se puede borrar por SQL: hacerlo desde el panel de Supabase (Storage →
  comprobantes).
- **Limpiar `pedidos.repartidor`** `[S]` — columna muerta sustituida por `domiciliario_id` (NULL en
  todos los pedidos). Se lee en dos sitios: `useOrderHistory.js` (el `select`) y
  `OrderDetailModal.jsx`; eliminarla exige tocar ambos.
- **Avatares huérfanos en Storage** `[S]` — si el borrado de la foto anterior falla queda suelto el
  archivo. Si el bucket crece, un barrido contra `perfiles.avatar_url` lo limpia.
- **Corregir textos viejos en `qa/sql/09-basura.sql`** `[S]` — T6 espera `23514` pero la función
  ya devuelve `PASO_FLUJO_INVALIDO`; T2 pasa la misma mitad a las dos y solo ejercita `MITADES_IGUALES`.
- **Envolver en `BEGIN … ROLLBACK`** las pruebas que escriben sin transacción: `08 T6` (deja un
  carrito vivo del `573000000998`) y `09 T4/T10b`.
