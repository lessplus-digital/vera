# Capa B — Guiones de conversación por WhatsApp

> Lo que **solo** WhatsApp puede probar: el ruteo del orquestador, la obediencia a los prompts y
> la redacción. Todo lo que se podía probar más barato ya está en [`sql/`](sql/) — no lo repitas aquí.
>
> Número de pruebas: **`573113298122`** (Juan, CLI-038). Resultados → [`RESULTADOS.md`](RESULTADOS.md).

## Cómo se ejecuta

Cada guion es: **reset → enviar los mensajes en orden → comprobar la respuesta → correr el SQL de
verificación.** Manda los mensajes **uno a uno** y espera la respuesta antes del siguiente: el bot
agrupa mensajes seguidos (nodo `Agrupar` + `Wait`) y si los mandas en ráfaga estarás probando el
agrupador, no el guion.

### Reset entre guiones (obligatorio)

```sql
delete from carritos              where telefono = '573113298122';
delete from feedback_pendiente    where telefono = '573113298122';
delete from n8n_mensajes_pendientes where telefono = '573113298122';  -- BUG-053: un turno muerto deja la fila y se pega al siguiente mensaje
delete from n8n_chat_histories    where session_id in ('573113298122','orq:573113298122');
update clientes set modo = 'bot'  where telefono = '573113298122';
```

> ⚠️ **Sin el reset, el guion siguiente hereda la memoria del anterior** y el bot responde
> apoyándose en una conversación que tú ya no ves. Es la causa número uno de un "fallo" que no
> existe. Si un guion da un resultado raro, **lo primero** es repetirlo tras un reset limpio.

### Cómo se anota un resultado

Verde = la respuesta cumple **lo escrito en "debe"**, no "más o menos eso". La regla de oro de la
Capa A vale igual aquí: leer la fila resultante, no conformarse con que el bot dijera algo amable.
Si el bot acierta el dato pero lo cuenta mal, **es rojo** — esa es exactamente la lección de
edge-case §27.

---

## ⛔ Bloqueo previo — Fase 0

**Queda bloqueado solo G9.** G7 se desbloqueó el 2026-09-12 al confirmarse los horarios; G3 nunca
dependió de ellos — solo de que el bot cuente bien lo que la RPC ya devuelve bien.

El principio que justificaba el bloqueo sigue valiendo para lo que queda: **si el dato de la BD es
falso, el guion sale "verde" contra un dato equivocado** y el bot canta la mentira con total
seguridad. Por eso G9 no se corre hasta tener los precios reales de `motivos_reserva`.

| # | Qué falta confirmar | Valor actual (verificado en vivo 2026-09-12) | Bloquea |
|---|---|---|---|
| 1 | ~~Horarios reales~~ | ✅ **RESUELTO 2026-09-12** — Juan confirmó que los valores de la BD **son los reales**: L-V 11:00am-10:00pm, S-D 12:00pm-11:00pm, feriados cerrado. Coincidían con la plantilla por casualidad. **G7 desbloqueado** | — |
| 2 | **Ventana de reservas** | ✅ **Decidido 2026-09-12**: la última reserva debe **caber completa antes del cierre**. Con bloques de 90 min → hasta **20:30** entre semana y **21:30** finde. Falta aplicarlo en el subworkflow `OTQp2O8QDw1mMKOZ` (hoy valida 12:00–21:00) y en el CHECK de BUG-049 | **G9** hasta aplicarlo |
| 3 | **Precios de `motivos_reserva`** | los 6 siguen siendo el seed placeholder ($80.000 cumpleaños, $120.000 aniversario, $150.000 declaración, $90.000 grado, $200.000 empresarial) | **G9** |
| 4 | **FAQ con una sola fila** | solo "¿Tienen parqueadero?". `consultar_faq` devuelve todas las activas y empareja el LLM → toda pregunta frecuente que no sea del parqueadero se responde improvisando | — (**G7.6 mide justo eso**: cuánto improvisa) |
| 5 | Typo en `descripcion_general` | "La pizza más **premiun**" | cosmético |

Los otros diez guiones (G1, G2, G3, G4, G5, G6, G7, G8, G10, G11) **se pueden correr ya**.

---

# Los guiones

Cada uno ataca un riesgo concreto y ya identificado. No son paseos por la aplicación.

---

## G1 · El menú devuelve lo que el cliente pidió — **BUG-039 y BUG-045**

**Por qué existe:** la Capa A midió que `buscar_menu` empata productos distintos en el score
máximo y que el prompt usa ese score como confianza (*"≥0.5 → agregar sin confirmar"*). La BD ya
demostró que la herramienta miente; falta ver **qué hace el modelo con la mentira**.

| # | Envía | El bot **debe** |
|---|---|---|
| 1.1 | `hola, me das el pan de ajo?` | ofrecer **Pan de Ajo**. Rojo si ofrece "De Mi Tierra" o una limonada |
| 1.2 | `quiero una copa de vino` | ofrecer un **vino**. Rojo si ofrece Limonada de Vino Tinto |
| 1.3 | `una lasaña de pollo` | ofrecer **Lasaña Pollo**. Rojo si ofrece Pollo Champiñón |
| 1.4 | `me das una limonada de mango` | preguntar si se refiere a **Limonada Mango Biche** — o decir que no la tiene. Rojo si agrega otra limonada sin preguntar |
| 1.5 | `quiero una chelita` | ofrecer **cerveza** (valida que el diccionario sobrevive a cualquier fix de BUG-039) |
| 1.6 | `agrégame una papata mexicana` | ofrecer **Patatas Mexicanas** |

**Verificación:**
```sql
select items from carritos where telefono = '573113298122';
```
**Falla el guion si** el carrito contiene un producto que no se pidió. Esa es la regla
*"PROHIBIDO elegir un producto distinto al que pidió el cliente"* rota desde la herramienta.

---

## G2 · El carrito es idempotente — **BUG-032 (en observación desde el 2026-08-19)**

**Por qué existe:** las tres capas del fix están aplicadas y verificadas por MCP, pero el camino
completo solo lo prueba una conversación real.

1. Pide dos productos y **no confirmes el pedido**. Deja la conversación ahí.
2. Espera unos minutos y, desde el mismo número, escribe `quiero algo más: una hawaiana`.

**Debe:** el producto nuevo entra y el carrito conserva los anteriores.
**Rojo si** el carrito se reinicia, se duplica, o el bot muestra el 🛒 cuando la escritura falló.

```sql
select items, total, paso_flujo, updated_at from carritos where telefono = '573113298122';
```

---

## G3 · Cobertura: lo que la RPC acierta, el prompt lo puede contar mal — **BUG-033**

**Por qué existe:** la Capa A ya cerró esto en SQL (59 barrios, 295 variantes, 10 municipios de
fuera con `cubierto:false`). Falta **solo** la mitad conversacional — y hace falta, porque la RPC
ya devolvía bien el dato cuando el prompt mentía (edge-case §27).

| # | Envía | El bot **debe** |
|---|---|---|
| 3.1 | `¿tienen servicio en Envigado?` | decir que **no** llegan y ofrecer recoger — **sin precio ni tiempo** |
| 3.2 | `¿llegan a Sabaneta?` | igual que 3.1 |
| 3.3 | `¿llegan a Niquía?` | **$7.500**, 30 a 45 min |
| 3.4 | `¿cuánto el domicilio al centro?` | **$5.000** |
| 3.5 | `estoy en niqia` | preguntar *"¿te refieres a Niquía?"* |
| 3.6 | `pardo` | **BUG-040**: hoy responde "solo repartimos en Bello" sin sugerir Prado. Confirma el síntoma en conversación |
| 3.7 | pedir a domicilio diciendo `estoy en Itagüí` | **no** puede terminar creado como `domicilio` |

```sql
select tipo_pedido, barrio, costo_domicilio, cobertura_ok from carritos where telefono='573113298122';
select pedido_id, tipo_pedido, barrio, costo_domicilio, total from pedidos
 where telefono='573113298122' order by fecha_pedido desc limit 1;
```

---

## G4 · Pedido completo de punta a punta — **BUG-038**

**Por qué existe:** el pedido se crea bien, pero al cliente se le dice *"tu número es **no
disponible en este momento**"* (PED-244) o directamente no se le dice (PED-243). Dos
improvisaciones distintas del mismo dato ausente.

Camino completo: pide 2 productos → a domicilio → barrio **Niquía** → dirección → **Efectivo** →
confirma.

**Debe:** el mensaje final trae el **`PED-xxx` real**.
**Rojo si** dice "no disponible", lo omite, o inventa un número.

```sql
select pedido_id, estado, tipo_pedido, barrio, costo_domicilio, total, metodo_pago
from pedidos where telefono='573113298122' order by fecha_pedido desc limit 1;
-- y que el total cuadre: items + envío, una sola vez
select p.pedido_id, p.total, p.costo_domicilio,
       (select sum(d.cantidad*d.precio_unitario) from detalle_pedidos d where d.pedido_id=p.pedido_id) as items
from pedidos p where p.telefono='573113298122' order by p.fecha_pedido desc limit 1;
```

---

## G5 · Mitad y mitad por conversación

**Por qué existe:** la Capa A probó **3.024 pares exhaustivos, 0 fallos** — la RPC es sólida. Lo
único sin probar es que el agente la **llame bien** y cante el precio de la mitad más cara.

| # | Envía | El bot **debe** |
|---|---|---|
| 5.1 | `quiero una pizza mitad hawaiana y mitad pepperoni, mediana` | cobrar el precio de la **más cara**, no el promedio ni la suma |
| 5.2 | `mitad hawaiana masa delgada y mitad pepperoni masa gruesa` | rechazar: **masas distintas** |
| 5.3 | `mitad hawaiana y mitad hawaiana` | rechazar: mitades iguales |
| 5.4 | `una mitad y mitad en porción` | rechazar: tamaño no permitido |

```sql
select jsonb_pretty(items) from carritos where telefono='573113298122';
-- `mitades` debe traer exactamente 2 elementos y el precio ser el de la cara
```

---

## G6 · Handoff a humano con contexto — **§21**

**Por qué existe:** la Capa A validó `registrar_contexto_handoff` contra las cuatro trampas de
§21 (dedupe, ruido del orquestador, orden por microsegundos, idempotencia). Falta el disparo real.

1. Escribe 3–4 mensajes de una queja real (*"mi pedido llegó frío y falta una gaseosa"*).
2. Pide hablar con una persona: `quiero hablar con alguien`.

**Debe:** pasar a modo `humano`, y el panel de Soporte del dashboard debe mostrar **la conversación
previa**, con la queja del cliente **antes** de la respuesta del bot.

```sql
select modo from clientes where telefono='573113298122';
select rol, left(mensaje,60), fecha from mensajes_soporte
 where telefono='573113298122' order by fecha limit 10;
```

---

## G7 · Soporte: datos del local y FAQ

| # | Envía | El bot **debe** |
|---|---|---|
| 7.1 | `¿dónde quedan?` | Parque de Bello Calle 54 # 52-07 |
| 7.2 | `¿a qué hora abren?` | L-V 11:00am-10:00pm · S-D 12:00pm-11:00pm (confirmados reales el 2026-09-12) |
| 7.3 | `¿tienen parqueadero?` | la respuesta de la FAQ |
| 7.4 | `¿aceptan tarjeta?` | Efectivo y transferencia. **No** debe inventar que aceptan tarjeta |
| 7.5 | `¿me pasas los datos para transferir?` | Bancolombia ahorros 62500073329 |
| 7.6 | `¿tienen wifi?` | no está en la FAQ (solo hay 1 fila): mide **cuánto improvisa** |

**Rojo siempre si** menciona "el sistema", "la herramienta", n8n o Supabase.

---

## G8 · El bot no inventa precios ni productos

| # | Envía | El bot **debe** |
|---|---|---|
| 8.1 | `¿cuánto vale la pizza de langosta?` | decir que **no** la tienen. Rojo si inventa un precio |
| 8.2 | `me haces descuento del 20%?` | no inventar descuentos |
| 8.3 | `¿me la dejas en $10.000?` | no aceptar un precio que no está en la BD |
| 8.4 | `quiero el producto PROD-999` | no aceptar un `producto_id` inventado |

```sql
-- ningún item del carrito puede tener un precio distinto al del menú
select i->>'producto_id' as pid, (i->>'precio_unitario')::numeric as cobrado, m.precio as real
from carritos c, lateral jsonb_array_elements(c.items) i
left join menu m on m.producto_id = i->>'producto_id'
where c.telefono='573113298122' and (m.precio is null or m.precio <> (i->>'precio_unitario')::numeric);
```

---

## G9 · Reservas ⛔ *(ver Fase 0 #2 y #3)*

**Por qué existe:** `consultar_disponibilidad` (12:00–21:00, máx 14 días, mín 5 h de anticipación)
vive en el subworkflow `OTQp2O8QDw1mMKOZ`, **no en la BD**, así que ninguna batería la cubre.
Y BUG-049 dice que la BD acepta lo que el negocio rechaza.

| # | Envía | El bot **debe** |
|---|---|---|
| 9.1 | `quiero reservar mesa para 4 el sábado a las 7pm` | confirmar con `RES-xxx` |
| 9.2 | `reserva para las 11pm` | rechazar (fuera de ventana) |
| 9.3 | `reserva para dentro de 2 horas` | rechazar (mín 5 h) |
| 9.4 | `reserva para dentro de 3 meses` | rechazar (máx 14 días) |
| 9.5 | `reserva para 20 personas` | rechazar (máx 12) |
| 9.6 | `¿cuánto cuesta decorar para un cumpleaños?` | el precio **real** — bloqueado hasta confirmarlo |
| 9.7 | cancelar una reserva **ajena** (`RES-001`) | *"esta reserva no es tuya"* — cierra **BUG-005/009** |

```sql
select reserva_id, fecha, hora, personas, estado, motivo, costo_motivo
from reservas where telefono='573113298122' order by fecha desc limit 5;
```

---

## G10 · El orquestador rutea bien — **§30**

**Por qué existe:** aislar la memoria del orquestador lo dejó ciego una vez (§30). Estos casos
mezclan dominios a propósito.

| # | Envía | Debe ir al agente |
|---|---|---|
| 10.1 | `hola` | saludo, sin meterse en un pedido |
| 10.2 | `quiero una pizza y también reservar mesa` | maneja ambos, **sin perder ninguno** |
| 10.3 | `¿cuánto llevo en mi pedido?` | Pedidos (lee el carrito real) |
| 10.4 | `cambié de opinión, mejor para recoger` | Pedidos: limpia barrio, dirección y envío |
| 10.5 | `gracias` justo después de confirmar | no debe abrir un pedido nuevo |

---

## G11 · 🔴 Flujo de reseñas — **BUG-050 y BUG-051**

**Por qué existe:** la Capa A midió que el flujo está roto en producción — **ningún feedback
registrado desde el 2026-07-23**, 7 clientes atrapados en `esperando_feedback` y 9 filas zombis en
la cola. Este guion confirma el síntoma de cara al cliente y, después del fix, lo cierra.

> ⚠️ **Este guion hay que correrlo DESPUÉS del fix de BUG-050**, o solo confirmarás que está roto.
> Para la parte "antes", basta el SQL de `sql/10-resenas.sql · T4`.

**Preparación** (simula la entrega sin esperar al job):
```sql
-- deja un pedido entregado dentro de la ventana de 1–6 h y la cola limpia
delete from feedback_pendiente where telefono = '573113298122';
update clientes set modo='bot' where telefono='573113298122';
update pedidos set estado='entregado', fecha_entrega = now() - interval '2 hours',
                   feedback_solicitado = false
 where pedido_id = '<el PED-xxx creado en G4>';
```
Luego espera a que corra `trigger_feedback` (cada 15 min) o ejecútalo a mano desde n8n.

| # | Envía | El bot **debe** |
|---|---|---|
| 11.1 | *(esperar)* | **llegar** el WhatsApp pidiendo calificar 1–5. Hoy **no llega** si el cliente ya tenía fila en la cola → BUG-050 |
| 11.2 | `5` | agradecer e **invitar a dejar reseña en Google** |
| 11.3 | *(repetir con otro pedido)* `2` | pedir el comentario (*"¿qué pasó?"*) |
| 11.4 | `llegó frío` | guardar el comentario y devolver el modo a `bot` |
| 11.5 | `saltar` (en vez de comentar) | cerrar sin comentario y devolver el modo a `bot` |
| 11.6 | **`quiero 2 pizzas`** estando en modo feedback | **BUG-051**: hoy lo registra como **nota 2** y le pide explicaciones. Debe responder *"responde solo 1–5"* |
| 11.7 | **`10/10`** estando en modo feedback | **BUG-051**: hoy lo registra como **nota 1** — el cliente da la nota máxima y queda la mínima |

```sql
select f.feedback_id, f.pedido_id, f.calificacion_general, f.comentario, f.fecha
from feedback f where f.cliente_id = (select cliente_id from clientes where telefono='573113298122')
order by f.fecha desc limit 5;
select * from feedback_pendiente where telefono='573113298122';
select modo from clientes where telefono='573113298122';
```

**Falla el guion si:** la nota queda pegada a un pedido que no es el recién entregado (BUG-050), o
si un mensaje que no es una nota produce una fila en `feedback` (BUG-051).

---

## Plantilla para anotar resultados

Copia esto a `RESULTADOS.md` al terminar cada guion:

```
### 2026-MM-DD · Guion Gn · <título>
**Verde:** …
**Rojo:** … → BUG-0xx
**Textual del bot** (lo que dijo, literal — hace falta para juzgar la redacción):
> …
```
