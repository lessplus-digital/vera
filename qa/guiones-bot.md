# Capa B — Guiones de conversación por WhatsApp

> Lo que **solo** WhatsApp puede probar: el ruteo del orquestador, la obediencia a los prompts y
> la redacción. Todo lo que se podía probar más barato ya está en [`sql/`](sql/) — no lo repitas aquí.
>
> Resultados → [`RESULTADOS.md`](RESULTADOS.md) · Bugs → [`../docs/bug-tracker.md`](../docs/bug-tracker.md)

## Estado de los guiones

| Guion | Qué ataca | Estado |
|---|---|---|
| G1 | el menú devuelve lo pedido | ⬜ **re-correr** (el intento del 15-09 fue antes del fix de `buscar_menu`) |
| G2 | el carrito es idempotente | ✅ **verde 2026-09-22** |
| G3 | cobertura | 🔴 **rojo 2026-09-22** → BUG-061, BUG-062 |
| G4 | pedido de punta a punta | ⬜ pendiente |
| G5 | mitad y mitad | ⬜ pendiente |
| G6 | handoff con contexto | ⬜ pendiente |
| G7 | datos del local y FAQ | ⬜ pendiente |
| G8 | no inventa precios ni productos | ⬜ pendiente |
| G9 | reservas | ⛔ **bloqueado**: faltan los 6 precios reales de `motivos_reserva` |
| G10 | el orquestador rutea bien | ⬜ pendiente — **súbelo de prioridad**, BUG-062 salió justo de ahí |
| G11 | flujo de reseñas | ⬜ **el más urgente**: 5 bugs 🔴 desplegados y sin verificar |

## Cómo se ejecuta

Cada guion es: **reset → enviar los mensajes en orden → comprobar la respuesta → correr el SQL de
verificación.** Manda los mensajes **uno a uno** y espera la respuesta antes del siguiente: el bot
agrupa mensajes seguidos (nodo `Agrupar` + `Wait`) y si los mandas en ráfaga estarás probando el
agrupador, no el guion.

**Números de prueba:** `573113298122` (Juan, CLI-038) y `573184821317` (CLI-039). El SQL de cada
guion usa `:tel` — sustitúyelo por el número que usaste.

### Reset entre guiones (obligatorio)

```sql
delete from carritos                where telefono = :tel;
delete from feedback_pendiente      where telefono = :tel;
delete from n8n_mensajes_pendientes where telefono = :tel;  -- BUG-053: un turno muerto deja la fila y se pega al siguiente mensaje
delete from n8n_chat_histories      where session_id in (:tel, 'orq:' || :tel);
update clientes set modo = 'bot'    where telefono = :tel;
```

> ⚠️ **Sin el reset, el guion siguiente hereda la memoria del anterior** y el bot responde
> apoyándose en una conversación que tú ya no ves. Es la causa número uno de un "fallo" que no
> existe. Si un guion da un resultado raro, **lo primero** es repetirlo tras un reset limpio.
>
> Y no es teoría: **BUG-061 es exactamente eso al revés** — el bot cantó una tarifa correcta que
> la herramienta le había devuelto en `null`, sacándola de tres turnos antes. La memoria tapa
> tanto los fallos como los aciertos.

### Cómo se anota un resultado

Verde = la respuesta cumple **lo escrito en "debe"**, no "más o menos eso". La regla de oro de la
Capa A vale igual aquí: leer la fila resultante, no conformarse con que el bot dijera algo amable.
Si el bot acierta el dato pero lo cuenta mal, **es rojo** — esa es la lección de edge-case §27.

**Guarda siempre el texto literal del bot.** Sin él no se puede juzgar la redacción después, y es
lo que permitió ver que BUG-061 no era un acierto sino una coincidencia.

### Datos semilla que aún ensucian algún guion

| Qué | Estado | Bloquea |
|---|---|---|
| **Precios de `motivos_reserva`** | los 6 siguen siendo el seed placeholder ($80.000 cumpleaños, $120.000 aniversario, $150.000 declaración, $90.000 grado, $200.000 empresarial) | **G9** — sin esto el guion sale "verde" contra un dato falso |
| **FAQ con una sola fila** | solo *"¿Tienen parqueadero?"*. `consultar_faq` devuelve todas las activas y empareja el LLM → toda pregunta frecuente que no sea esa se responde improvisando | — (**G7.6 mide justo eso**: cuánto improvisa) |

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
| 1.7 | `quiero una pizza` | **ofrecer opciones, NO agregar.** Medido el 22-09: ese término devuelve **62 productos, 59 por encima del umbral de 0.5 y cuatro empatados en 1.000**. El prompt lee eso como "match confiable, proceder sin confirmar" |

**Verificación:**
```sql
select items from carritos where telefono = :tel;
```
**Falla el guion si** el carrito contiene un producto que no se pidió. Esa es la regla
*"PROHIBIDO elegir un producto distinto al que pidió el cliente"* rota desde la herramienta.

---

## G2 · El carrito es idempotente — **BUG-032** · ✅ verde 2026-09-22

**Por qué existe:** las tres capas del fix están aplicadas y verificadas por MCP, pero el camino
completo solo lo prueba una conversación real.

1. Pide dos productos y **no confirmes el pedido**. Deja la conversación ahí.
2. Espera unos minutos y, desde el mismo número, escribe `quiero algo más: una hawaiana`.

**Debe:** el producto nuevo entra y el carrito conserva los anteriores.
**Rojo si** el carrito se reinicia, se duplica, o el bot muestra el 🛒 cuando la escritura falló.

```sql
select items, total, paso_flujo, updated_at from carritos where telefono = :tel;
```

> ✅ **Corrido el 2026-09-22 (`573184821317`) — verde.** El carrito quedó con los **dos** productos
> (La Vera Especial Estofada Grande $77.000 + Hawaiana Estofada Grande $65.000, total $142.000) y
> `paso_flujo = 'armando'`. Dos cosas que este guion cierra de paso:
> - **BUG-055 queda cerrado.** El carrito **se creó** de verdad; antes el agente preguntaba
>   *"¿te la dejo?"* sin guardar nada y el `sí` caía en soporte.
> - Ante `una hawaiana`, el bot **preguntó** *"¿Tradicional o Estofada? ¿en qué tamaño?"* en vez de
>   elegir por su cuenta. Es el comportamiento que G1.7 exige y aquí salió solo.

---

## G3 · Cobertura: lo que la RPC acierta, el prompt lo puede contar mal — **BUG-033** · 🔴 rojo 2026-09-22

**Por qué existe:** la Capa A ya cerró esto en SQL (59 barrios, 295 variantes, 10 municipios de
fuera con `cubierto:false`). Falta **solo** la mitad conversacional — y hace falta, porque la RPC
ya devolvía bien el dato cuando el prompt mentía (edge-case §27).

| # | Envía | El bot **debe** | 22-09 |
|---|---|---|---|
| 3.1 | `¿tienen servicio en Envigado?` | decir que **no** llegan y ofrecer recoger — **sin precio ni tiempo** | ✅ |
| 3.2 | `¿llegan a Sabaneta?` | igual que 3.1 | ✅ |
| 3.3 | `¿llegan a Niquía?` | **$7.500**, 30 a 45 min | ✅ |
| 3.4 | `¿cuánto el domicilio al centro?` | **$5.000** | ✅ |
| 3.5 | `estoy en niqia` | **preguntar** *"¿te refieres a Niquía?"* — la tool devuelve `cubierto:false` con `sugerencias:["Niquía"]` y prohíbe dar tarifa o tiempo | 🔴 **BUG-061** |
| 3.6 | `pardo` | **preguntar** *"¿te refieres a Prado?"* — la tool ya devuelve `sugerencias:["Prado"]` | 🔴 **BUG-062** |
| 3.7 | pedir a domicilio diciendo `estoy en Itagüí` | **no** puede terminar creado como `domicilio` | ✅ |

```sql
select tipo_pedido, barrio, costo_domicilio, cobertura_ok from carritos where telefono = :tel;
select pedido_id, tipo_pedido, barrio, costo_domicilio, total from pedidos
 where telefono = :tel order by fecha_pedido desc limit 1;
-- Y el que de verdad destapa BUG-061: el barrio guardado debe resolver.
select * from resolver_barrio((select barrio from carritos where telefono = :tel));
```

> 🔴 **Corrido el 2026-09-22 (`573113298122`) — 5 de 7.**
> - **3.5 → BUG-061 🔴.** A `estoy en niqia` el bot respondió *"si estás en Niquía sí te podemos
>   llevar domicilio ✅ El envío allá está en $7.500 y suele tardar entre 30 y 45 minutos"*, cuando
>   la tool había devuelto `cubierto:false` con la tarifa y el tiempo en `null`. **Los números
>   salieron de la memoria de la conversación**, del turno 3.3. Y el carrito guardó
>   `barrio = 'niqia'`, que `resolver_barrio` **no resuelve**: si eso se convierte en pedido, el
>   trigger aplica `tarifa_base()` = $5.000 en vez de $7.500.
> - **3.6 → BUG-062 🟡.** A `pardo` el bot devolvió **el PDF del menú completo**: la pregunta ni
>   siquiera llegó al agente de cobertura. *(La expectativa vieja de este caso —confirmar el
>   síntoma de BUG-040— quedó obsoleta: BUG-040 está cerrado y la sugerencia «Prado» ya existe.)*
> - **3.7 verde**, y es el que más tranquiliza: pidió a domicilio desde Itagüí y el carrito quedó
>   con `tipo_pedido = NULL`. No se creó ningún pedido fuera de cobertura.

---

## G4 · Pedido completo de punta a punta — **BUG-038**

**Por qué existe:** el pedido se crea bien, pero al cliente se le dice *"tu número es **no
disponible en este momento**"* (PED-244) o directamente no se le dice (PED-243). Dos
improvisaciones distintas del mismo dato ausente.

Camino completo: pide 2 productos → a domicilio → barrio **Niquía** → dirección → **Efectivo** →
confirma.

**Debe:** el mensaje final trae el **`PED-xxx` real**.
**Rojo si** dice "no disponible", lo omite, o inventa un número.

> Escribe **`Niquía` bien** en este guion. Si lo escribes mal estarás probando BUG-061, no BUG-038,
> y el envío saldrá a $5.000 en vez de $7.500 sin que el bot lo diga.

```sql
select pedido_id, estado, tipo_pedido, barrio, costo_domicilio, total, metodo_pago
from pedidos where telefono = :tel order by fecha_pedido desc limit 1;
-- y que el total cuadre: items + envío, una sola vez
select p.pedido_id, p.total, p.costo_domicilio,
       (select sum(d.cantidad*d.precio_unitario) from detalle_pedidos d where d.pedido_id=p.pedido_id) as items
from pedidos p where p.telefono = :tel order by p.fecha_pedido desc limit 1;
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
select jsonb_pretty(items) from carritos where telefono = :tel;
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
select modo from clientes where telefono = :tel;
select rol, left(mensaje,60), fecha from mensajes_soporte
 where telefono = :tel order by fecha limit 10;
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
where c.telefono = :tel and (m.precio is null or m.precio <> (i->>'precio_unitario')::numeric);
```

---

## G9 · Reservas ⛔ *(bloqueado: faltan los 6 precios reales de `motivos_reserva`)*

**Por qué existe:** `consultar_disponibilidad` (máx 14 días, mín 5 h de anticipación) vive en el
subworkflow `OTQp2O8QDw1mMKOZ`, **no en la BD**, así que ninguna batería la cubre.

> ⚠️ **Las dos capas dicen cosas distintas ahora mismo.** Desde el 2026-09-22 la BD rechaza por su
> cuenta (`trigger_validar_ventana_reserva`: 12:00–20:30 L-V, 12:00–21:30 S-D, inclusive), pero el
> subworkflow sigue con una sola ventana `12:00–21:00` para los siete días y **solo valida la hora
> de inicio**. O sea que hoy el bot puede ofrecer las 21:00 de un martes y la BD rechazarlo después,
> con otro texto. Está en BUG-049; hay que cerrarlo antes de dar por bueno 9.2.

| # | Envía | El bot **debe** |
|---|---|---|
| 9.1 | `quiero reservar mesa para 4 el sábado a las 7pm` | confirmar con `RES-xxx` |
| 9.2 | `reserva para las 11pm` | rechazar (fuera de ventana) |
| 9.3 | `reserva para dentro de 2 horas` | rechazar (mín 5 h) |
| 9.4 | `reserva para dentro de 3 meses` | rechazar (máx 14 días) |
| 9.5 | `reserva para 20 personas` | rechazar (máx 12) |
| 9.6 | `¿cuánto cuesta decorar para un cumpleaños?` | el precio **real** — bloqueado hasta confirmarlo |
| 9.7 | cancelar una reserva **ajena** (`RES-001`) | *"esta reserva no es tuya"* — cierra **BUG-005/009** |
| 9.8 | `reserva el martes a las 20:45` | rechazar y decir que la última es a las **20:30** entre semana |

```sql
select reserva_id, fecha, hora, personas, estado, motivo, costo_motivo
from reservas where telefono = :tel order by fecha desc limit 5;
```

---

## G10 · El orquestador rutea bien — **§30**

**Por qué existe:** aislar la memoria del orquestador lo dejó ciego una vez (§30). Estos casos
mezclan dominios a propósito. **Subió de prioridad el 22-09: BUG-062 es un fallo de ruteo**, y lo
encontró G3 de casualidad, no este guion.

| # | Envía | Debe ir al agente |
|---|---|---|
| 10.1 | `hola` | saludo, sin meterse en un pedido |
| 10.2 | `quiero una pizza y también reservar mesa` | maneja ambos, **sin perder ninguno** |
| 10.3 | `¿cuánto llevo en mi pedido?` | Pedidos (lee el carrito real) |
| 10.4 | `cambié de opinión, mejor para recoger` | Pedidos: limpia barrio, dirección y envío |
| 10.5 | `gracias` justo después de confirmar | no debe abrir un pedido nuevo |
| 10.6 | `prado` (una palabra, un barrio) | **Cobertura**, no Menú — regresión de BUG-062 |

---

## G11 · 🔴 Flujo de reseñas — el más urgente

**Por qué existe:** cinco bugs (**BUG-056/057/058/059/060**) se arreglaron moviendo la máquina de
estados de ~20 nodos de n8n a la BD, se publicaron el 2026-09-16 y **están verificados solo en
SQL**. `10-resenas.sql · T10–T15` está verde, pero eso prueba las RPC, no la conversación.

> ⚠️ **Los ceros no prueban nada.** `feedback_pendiente` está en 0 y no hay ejecuciones con error,
> pero el último pedido del sistema es del 15-09: un flujo arreglado y un flujo sin trabajo se ven
> exactamente igual (§32). El único feedback nuevo (`FB-PED-246`, nota 5, comentario *"Dije 5"*) es
> **anterior** al último publish, y ese comentario huele a la ruta negativa de BUG-056.

**Preparación** (simula la entrega sin esperar al job):
```sql
-- deja un pedido entregado dentro de la ventana de 1–6 h y la cola limpia
delete from feedback_pendiente where telefono = :tel;
update clientes set modo='bot' where telefono = :tel;
update pedidos set estado='entregado', fecha_entrega = now() - interval '2 hours',
                   feedback_solicitado = false
 where pedido_id = '<el PED-xxx creado en G4>';
```
Luego espera a que corra el job (cada 15 min) o ejecútalo a mano desde n8n.

| # | Envía | El bot **debe** |
|---|---|---|
| 11.1 | *(esperar)* | **llegar** el WhatsApp pidiendo calificar 1–5 |
| 11.2 | `5` | agradecer e **invitar a dejar reseña en Google**. Rojo si dice *"Lamento que no fuera lo esperado"* → BUG-056 sigue vivo |
| 11.3 | *(otro pedido)* `2` | pedir el comentario (*"¿qué pasó?"*) |
| 11.4 | `llegó frío` | guardar el comentario y devolver el modo a `bot` |
| 11.5 | `saltar` (en vez de comentar) | cerrar sin comentario y devolver el modo a `bot` |
| 11.6 | `5` **dos veces seguidas** | **no quedarse callado.** Ese silencio era BUG-057, el que dejaba al cliente atrapado para siempre |
| 11.7 | `10/10` | *"responde solo 1–5"*. Rojo si queda registrada una **nota 1** → BUG-051 reabierto |
| 11.8 | `quiero 2 pizzas` estando en modo feedback | *"responde solo 1–5"*. Rojo si queda una **nota 2** |

```sql
select f.feedback_id, f.pedido_id, f.calificacion_general, f.comentario, f.fecha
from feedback f where f.cliente_id = (select cliente_id from clientes where telefono = :tel)
order by f.fecha desc limit 5;
select * from feedback_pendiente where telefono = :tel;
select modo from clientes where telefono = :tel;
-- BUG-060: `fecha` no puede quedar en el futuro
select feedback_id, fecha, now() from feedback order by fecha desc limit 1;
```

**Falla el guion si:** la nota queda pegada a un pedido que no es el recién entregado (BUG-050), si
un mensaje que no es una nota produce una fila en `feedback` (BUG-051), si el cliente se queda sin
respuesta (BUG-057), o si `feedback.fecha` queda por delante de `now()` (BUG-060).

---

## Plantilla para anotar resultados

Copia esto a `RESULTADOS.md` al terminar cada guion:

```
### 2026-MM-DD · Gn · <título> — <verde | rojo>
**Número:** 5731…
**Verde:** …
**Rojo:** … → BUG-0xx
**Textual del bot** (literal — sin esto no se puede juzgar la redacción):
> …
**SQL:** lo que quedó en la tabla, no lo que el bot dijo que quedó.
```
