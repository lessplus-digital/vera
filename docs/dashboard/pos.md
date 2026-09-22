# POS — impresión de tickets y cajón de dinero

> **Análisis del 2026-07-30. No se ha escrito código.** Vivía dentro de `backlog.md` y se sacó
> aquí el 2026-09-21 porque son 60 líneas de análisis de hardware que tapaban el resto del
> backlog. El backlog conserva la entrada de una línea que apunta aquí.

**Objetivo comercial:** reemplazar el POS + programa de facturación que la clienta ya usa hoy.

**Decisión del cliente (2026-07-30): sin facturación electrónica DIAN por ahora** — se imprimen
comprobantes internos, no documentos fiscales. Eso elimina la única parte realmente difícil del
problema.

## El hardware ya está en el local (no hay que comprar nada)

| Pieza | Modelo | Lo que importa |
|---|---|---|
| Impresora | **Epson TM-T88** (serie IV o V, por confirmar) | papel de 80 mm → **~72 mm útiles**: ese es el ancho contra el que se diseña |
| Cajón | **3nStar CD350**, 24 V, RJ11 | periférico *tonto*: no se conecta al PC |

El cajón se enchufa al puerto **DK de la impresora**, que lo abre con un pulso de 24 V — voltaje
compatible con la serie TM-T88. **Nunca se le habla al cajón, se le habla a la impresora.**

## Plan A (recomendado): `window.print()` + CSS

`@media print` con `@page` a 72 mm, y Chrome lanzado con `--kiosk-printing` para que no salga el
diálogo (exige que la térmica sea la impresora **predeterminada** del PC).

**El cajón y el corte de papel no requieren código.** El *Advanced Printer Driver* (APD) de Epson
trae la pestaña **Peripherals** con apertura de cajón antes/después de imprimir, y corta el papel
al cerrar el documento.

Cero instalación en el PC del cliente → es el único camino que respeta la visión multi-tenant
(«una sola app React desplegada una vez», ver la sección SaaS del backlog).

## Plan B (solo si el driver no trae la opción de cajón)

ESC/POS crudo por WebUSB / Web Serial, o un agente local (QZ Tray). Menos arriesgado de lo
habitual porque Epson **inventó** ESC/POS y su implementación es la de referencia — pero en
Windows suele exigir cambiar el driver por uno genérico y añade fricción de despliegue por
cliente.

## Enganche en el código

`OrderActions.jsx` (cambios de estado) y `CreateOrderModal.jsx`. La data ya está disponible **sin
queries nuevas**: `useOrders` trae `detalle_pedidos` embebido.

Los textos del negocio (nombre, dirección, teléfono) **se leen de `info_negocio` vía
`useBusinessInfo`, nunca hardcodeados** — requisito del modelo multi-tenant.

## Contenido acordado de los dos tickets

**Factura del cliente:** datos del negocio · nº de pedido · fecha · items con cantidad y precio
unitario · recargo de domicilio si aplica · total · método de pago · nota «comprobante interno —
no válido como factura».

**Orden del domiciliario:** letra grande y sin adornos — nº de pedido · nombre y teléfono del
cliente · dirección completa · items · total a cobrar · **método de pago destacado** (que se vea
de un vistazo si hay que recibir efectivo o si ya pagó por transferencia).

## Pendiente de confirmar en el local antes de empezar

1. ¿La impresora está por **USB o por red**? Si es de red aparece la vía `ePOS-Print` propia de
   Epson, pero choca con contenido mixto (dashboard HTTPS → impresora HTTP en LAN). **USB es
   notablemente más simple.**
2. ¿El cajón ya está enchufado al puerto DK?
3. ¿Qué PC, y tiene Chrome?

## Riesgos asumidos

Los márgenes en 80 mm son quisquillosos por navegador: hay que contar con **2-3 rondas de ajuste
contra impresiones físicas reales**, porque sin acceso al hardware no se puede validar el
resultado. **No desconectar el POS actual hasta probar un día completo de operación real.**

---

## Adyacentes analizados el 2026-07-30, fuera del alcance de esta tarea

### Caja / arqueo de turno `[M]`

Tablas nuevas `turnos_caja` (apertura, base, cierre, conteo declarado vs. esperado) y
`movimientos_caja` (gastos, retiros, propinas). El esperado en efectivo se agrega desde `pedidos`.

**Tres trampas del esquema:**

1. `fecha_pedido` es `timestamp` sin zona con valor UTC → usar `parseDb()`.
2. El día de negocio arranca a las **05:00 UTC** (Colombia, UTC-5).
3. `pedidos.total` **ya incluye el domicilio**. Si no se separan, el arqueo cuadra mal cuando el
   domicilio lo cobra el repartidor. ✅ **Dejó de ser una trampa el 2026-08-18:** el envío vive en
   `pedidos.costo_domicilio` y ya no hay que despejarlo restando — el efectivo de producto es
   `total − costo_domicilio`. Ojo: **ya no es una constante**, varía por zona.

### Venta en mostrador `[M — cross-layer, riesgo]`

`CreateOrderModal` ya es el 80%, pero faltan dos cosas:

- el cliente es obligatorio (en mostrador nadie da el teléfono) → cliente genérico o
  `cliente_id` nullable — **verificar si hoy lo es**;
- `tipo_pedido` tiene un CHECK de `domicilio`/`recoger`. Ampliarlo a `mesa`/`mostrador` **toca la
  BD compartida y los prompts del bot**.

Es el único punto donde el POS puede romper la Capa 1. Comparte bloqueo con «rol mesero: parte de
salón» (PLATEO-52).

### Facturación electrónica DIAN `[L — legal]`

Descartada por ahora. Si algún día se necesita: **integrar un proveedor autorizado por API desde
n8n**, jamás implementar la firma XML/UBL ni el CUFE en casa, y jamás desde el navegador — mismo
motivo que el token de WhatsApp: las credenciales no pueden viajar en el bundle.

### Operación offline `[L]`

Un POS de verdad debe cobrar sin internet; hoy todo depende de Supabase en vivo. Si se cae la
conexión en el rush no hay kanban, ni comanda, ni cobro. Exige cola local + sincronización: es un
rediseño, no una feature.
