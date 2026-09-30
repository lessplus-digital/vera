# Campaña de pruebas — estado y resultados

Baterías: [`sql/`](sql/) · Guiones: [`guiones-bot.md`](guiones-bot.md) · Bugs → [`../docs/bug-tracker.md`](../docs/bug-tracker.md)

> **Este fichero solo tiene lo vigente.** El histórico corrido de cada batería (2026-09-09 al 09-16)
> se retiró el 2026-09-22 para que no compita con el estado actual: las trampas de montaje viven en
> la cabecera de cada `.sql`, las lecciones en `edge-cases.md`, los bugs en el tracker o el
> changelog, y la narración íntegra en `git log -p qa/RESULTADOS.md`.

## La estrategia, en una frase

**Cada caso se prueba en la capa más barata que pueda detectarlo.** Solo llega a WhatsApp lo que
únicamente WhatsApp puede probar. El bot es una de tres capas, y la mayor parte de la lógica que un
cliente puede romper no vive en el LLM: vive en Postgres.

| Capa | Qué prueba | Coste por caso | Repetible |
|---|---|---|---|
| **A · SQL determinista** | funciones, triggers, constraints, RLS | ~0 (segundos, sin LLM) | sí, infinitas veces |
| **B · Conversación WhatsApp** | el modelo: ruteo, prompts, redacción, memoria | alto (minutos + tokens) | no |
| **C · Vitest sobre utils puras** | agregados y formateo del dashboard | ~0 | sí — **fuera del MVP** |

**Cómo se ejecuta la Capa A:** cada fichero de `sql/` se pasa al MCP de Supabase. Devuelven **solo
las filas que fallan** — resultado vacío = verde. Los que escriben van dentro de `BEGIN … ROLLBACK`
y usan teléfonos ficticios `5730000009xx`, nunca uno real.

Tres trampas de ejecución que muerden cada vez que se olvidan:

- El MCP **solo devuelve el resultado de la última sentencia** → pasa las baterías **por bloques**.
- El MCP **no conserva la sesión entre llamadas**: lo que abras en una llamada se revierte al
  terminarla y `pg_temp` no sobrevive. Cada bloque debe ser autocontenido.
- **Leer una tabla en un subquery del mismo `SELECT` que la escribe devuelve el snapshot previo.**
  Escribe en una sentencia, lee en la siguiente.

**Regla de oro** (edge-cases §11, §18, §19, §22, §31): *el verde no prueba nada por sí solo.* Cada
aserción se hace leyendo la fila resultante o contando filas — nunca preguntando si algo lanzó
excepción. Y su reverso (§39): **`esperado` es un valor comparable, nunca una explicación en prosa**,
o el caso queda en rojo permanente e indistinguible de una regresión.

**Cómo se ejecuta la Capa B:** protocolo, números de prueba y reset en
[`guiones-bot.md`](guiones-bot.md).

---

## Estado

**2026-09-30:** 04, 09, 11 y 12 re-corridas tras la migración `carrito_sale_de_resumen` — verdes (la 12 tras re-montar T2.5/T3.1).

**Última regresión completa: 2026-09-22** — las 10 baterías contra la BD viva tras el despliegue del
feedback del 16-09. **Sin regresiones del sistema.**

| Batería | Estado 2026-09-22 | Rojo que queda |
|---|---|---|
| `01-cobertura.sql` | **6/6** · confirma que el fix de BUG-054 sigue puesto (eco de 300 chars → 60) | — · **le falta cubrir `resolver_barrio`**, ver BUG-061 |
| `02-menu.sql` | T1 **0/133** fuera del top-5 · T3–T8 verdes · T8 20/20 | T2 = 19 empates legítimos (sin cambio) |
| `03-mitad-y-mitad.sql` | **3047/3047** | — |
| `04-flujo-pedido.sql` | **13/13** | — |
| `05-totales.sql` | **14/14** | — |
| `06-reservas.sql` | **14/14** · +**T11–T18**, regresión nueva de BUG-049 | — |
| `07-housekeeping.sql` | **19/19** ✅ — T5b verde tras el fix de BUG-052 | — |
| `08-roles-rls.sql` | **16/16** · el domiciliario ve 34 pedidos, **todos suyos** | — |
| `09-basura.sql` | **BUG-045/046/047/048 confirmados cerrados** | T9 = BUG-049 → cerrado en BD, falta n8n |
| `10-resenas.sql` | **T10–T15 verdes** (las RPC nuevas del feedback aguantan) · T1 reparado | T8 es réplica documental |
| `11-carrito-bot.sql` · **nueva 2026-09-29** | **44/44** (2026-09-30) — carrito del servidor Node: el precio lo pone la BD · +T8: cambiar el pedido con el resumen a la vista lo saca del resumen | — |
| `12-pedido-reservas-bot.sql` · **nueva 2026-09-29** | **44/44** (2026-09-30) — crear pedido en una transacción + reservas del bot · T2.5/T3.1 re-montados: corrompen tarifa/precio y vuelven a poner `resumen` | — |

> **2026-09-29 · migraciones aditivas del bot Node** (`bot_node_tablas_y_carrito`,
> `bot_node_pedido_y_reservas`): 11 y 12 verdes y **regresión de 04 (13/13), 05 (14/14) y 06 (22/22)
> sin cambios**. Trampa nueva de ejecución: si el bloque termina en `ROLLBACK`, el MCP devuelve el
> resultado de una sentencia intermedia, no el del `SELECT` final. Receta que funciona: cambiar solo el
> `SELECT` + `ROLLBACK` finales por un `DO` que haga `RAISE EXCEPTION` con las filas que fallan (o
> `'VERDE'`) **y el número de filas evaluadas**. El error aborta la transacción, así que el rollback está
> garantizado, y el conteo prueba que la consulta corrió.

**Capa B — 3 de 11 corridos.** Estado por guion en [`guiones-bot.md`](guiones-bot.md).

| Guion | Última corrida | |
|---|---|---|
| **G1** · el menú devuelve lo pedido | 🟡 **23-09 · 1.1–1.6 verdes** | falta **1.7** (`quiero una pizza`), añadido después de la corrida |
| **G2** · carrito idempotente | ✅ **verde 22-09**, repetido en verde el 23-09 | y cierra **BUG-055**: el carrito se crea de verdad |
| **G3** · cobertura | 🔴 **22-09 · 5/7** | → **BUG-061** 🔴 y **BUG-062** 🟡 |
| G4 · G5 · G6 · G7 · G8 · G10 · G11 | ⬜ | G11 es el más urgente |
| G9 · reservas | ⛔ | faltan los 6 precios reales de `motivos_reserva` |

> ⚠️ **Lo que la regresión NO prueba.** El último pedido del sistema es del **15-09** y no hay
> ejecuciones de n8n con error desde el 15-09 23:59. Una semana sin tráfico: un flujo arreglado y
> un flujo sin trabajo se ven exactamente igual (§32). Los ceros de la cola de feedback no
> significan nada hasta que G11 corra por WhatsApp.

---

## ▶️ Por dónde seguir

### ⛳ Puerta de salida al MVP

1. **Repetir G3.5 y G3.6** (reset primero) — BUG-061 y BUG-062 ya tienen fix de prompt **publicado
   en n8n el 2026-09-28**, pero ninguno de los dos pasa a cerrado hasta confirmar por WhatsApp que
   el bot pregunta "¿te refieres a Niquía?"/"¿te refieres a Prado?" en vez de inventar tarifa o
   mandar el PDF del menú. Ver el detalle del fix en `docs/bug-tracker.md`.
2. **Correr G11, G1.7, G4 y G10 por WhatsApp** (G1.1–1.6 ya verdes el 23-09). Solo Juan puede. Cinco bugs 🔴
   (BUG-056/057/058/059/060) están desplegados y **verificados únicamente en SQL** — ninguno se ha
   probado hablando con el bot. Es el riesgo más grande abierto. G10.6 confirma además la regresión
   de ruteo de BUG-062.
3. **Terminar BUG-049 en n8n** (la BD ya está cerrada).
4. **Kanban: cuarta columna + navegación por día** — es la otra mitad del fix de BUG-052; sin ella
   el pedido pagado que ya no se autocancela se entierra igual. Ficha en `docs/backlog.md`.
5. **Limpiar los datos de prueba de roles** antes de enseñar estadísticas (4 pedidos ficticios
   cuentan en su día, 67 pedidos con `domiciliario_id` sembrado).
6. **Rotar `VITE_WA_ACCESS_TOKEN`**, que viaja en el bundle. El proxy es `[M]` y no cabe; rotar sí.

**Fuera del MVP, decidido:** G9 y los precios de `motivos_reserva`, el FAQ de una sola fila, la
Capa C (Vitest) y el proxy de WhatsApp.

### Lo que sigue esperando una decisión de negocio (no es código)

- **Los 6 precios de `motivos_reserva`** — siguen siendo el seed placeholder. Bloquean G9.
- **El FAQ** tiene una sola fila; toda pregunta frecuente que no sea del parqueadero se improvisa.

### Lo que NO hay que volver a investigar

Ya se descartó, con evidencia: los 88 domicilios sin barrio (pre-migración del 18-08), las 37
transferencias sin comprobante (32 son semilla; el número real es 5), los 8 pedidos sin líneas
(BUG-007, cerrado, todos anteriores al 01-07), PED-235 en `en_camino` desde agosto (**dato de prueba
manual de Juan**), los ids `RSV-M…` (dashboard viejo) y el webhook de estado disparando en cada
UPDATE (`If1` sí filtra). Y **los $130.500 de PED-240 y PED-242** que el job canceló antes del fix
de BUG-052: `573184821317` es el segundo número de Juan y **todos sus pedidos son de prueba**
(confirmado por Juan el 2026-09-23). No hay nada que reembolsar ni reponer.

> **Recordatorio permanente:** de los 117 pedidos, **~80 son semilla**, y además Juan manipula filas
> a mano para probar. Ningún agregado sobre `pedidos` significa lo que parece hasta partirlo por
> origen del dato. Los tres filtros obligatorios antes de convertir un hallazgo en bug están en
> `edge-cases.md` §33: ¿es dato semilla?, ¿es anterior a una migración?, ¿lo tocó alguien a mano?

---

## Hallazgos vivos que ninguna batería puede cazar

**La banda de confianza del menú no mide unicidad.** El prompt dice *"similitud ≥ 0.5 → match
confiable, proceder sin confirmar"*, pero `similitud` mide **contención de palabras**. Medido:
`'quiero una pizza'` devuelve **62 productos, 59 por encima de 0.5 y cuatro empatados en 1.000**
(Vera Pizza, Pizza Jumbo, Pizza M&M…). `02 · T8` lo da verde **con razón** —su criterio es que nada
que no comparta las palabras de la búsqueda llegue a 0.5, y aquí todos comparten "pizza"—, así que
**ninguna batería puede señalarlo**. Es el mecanismo de BUG-039/045. Lo mide **G1.7**.

**`historial_resumen` con `p_search = ''` no filtra** y devuelve los 117 pedidos (misma forma que
BUG-045c: `'%'||''||'%'` es `'%%'`). **No llega desde el dashboard**: `useOrderHistory` manda
`parts.q || null`. Nota, no bug, mientras nadie más llame a la RPC con `''`.

**Las dos funciones de barrio normalizan distinto.** `consultar_cobertura` tiene emparejamiento
difuso y devuelve `sugerencias`; **`resolver_barrio` —la que usa el trigger de tarifa— solo resuelve
el nombre canónico**. `01 · T2` prueba 295 variantes contra la primera y sale verde; **ninguna las
prueba contra la segunda**. De ahí sale la mitad cara de BUG-061.

---

## 2026-09-22 · Regresión completa + barrido de estado vivo + 2 bugs cerrados

**Por qué:** el 16-09 se desplegaron dos RPC nuevas (`procesar_respuesta_feedback`,
`solicitar_feedback_lote`), se recableó n8n y el cron de expiración pasó de 48 h/diario a 6 h/horario.
Nada de eso se había re-probado.

**Resultado: sin regresiones.** Las cifras de visibilidad por rol son idénticas, los 3024 pares de
mitad y mitad siguen exactos, y la línea base creció de forma orgánica (117 pedidos · 220 detalles,
+1 y +6 desde el 15-09) con los cuatro contadores de corrupción en 0.

**Barrido de estado vivo — limpio.** Ocho chequeos de coherencia sobre pedidos, pagos, comprobantes,
cola de feedback y handoffs. Solo dos señales, y las dos mueren en los filtros de §33: PED-235 lleva
41 días `en_camino` (dato de prueba manual) y PED-237 es una transferencia sin comprobante (uno de
los cuatro `PRUEBA ROLES`). Los cinco cron jobs con **0 corridas fallidas** en 7 días, incluido
`expirar-feedback-pendiente` con el schedule nuevo (`7 * * * *`).

**Dos bugs cerrados** (ficha completa en el changelog):

- **BUG-052** — `expirar_pedidos_pendientes()` lleva ahora `AND comprobante_url IS NULL`: deja de
  cancelar lo que el cliente ya pagó. Verificado **con control**: el pendiente viejo *sin*
  comprobante se sigue cancelando, o el fix habría roto el job entero. `07 · T1` y `T5b` verdes.
  ⚠️ **Se sostiene sobre una pieza de UI que aún no existe** (punto 4 de la puerta de salida).
- **BUG-049, la mitad de BD** — `trigger_validar_ventana_reserva`: rechaza fecha pasada, hora < 12:00
  y hora > 20:30 (L-V) / 21:30 (S-D), inclusive. Es trigger y no CHECK porque `current_date` no es
  IMMUTABLE y porque las 16 reservas históricas son todas pasadas (dos a las 11:00). En UPDATE solo
  valida si `fecha` u `hora` cambian — sin eso, **cancelar una reserva vieja quedaría bloqueado por
  su propia fecha pasada**, que es el control que de verdad importaba (`06 · T18`).

**Tres fallos de los tests, no del sistema (corregidos):**

| Batería · caso | Qué pasaba | Tipo |
|---|---|---|
| `07 · T1` y `07 · T5b` | el `esperado` era una **nota en prosa**, así que `case when valor = esperado` daba ✗ para siempre | **falso rojo permanente** — edge-case §39 |
| `10 · T1` | los dos pedidos del fixture son del mismo teléfono y sin `fecha_pedido` explícito heredan el mismo `now()` → chocan con `unique_pedido_cliente_minuto` y **abortan la transacción antes de medir nada** | fixture |

---

## 2026-09-23 · Capa B · G1 (1.1–1.6) y G2 repetido

**Número:** `573184821317` (CLI-039, segundo número de Juan), con reset antes de cada guion.
Revisado contra `carritos`, `n8n_chat_histories`, `menu` y las ejecuciones de n8n `16516…16546`.

### G1 · El menú devuelve lo pedido — 🟡 **1.1–1.6 verdes, falta 1.7**

| # | Pidió | Entró |
|---|---|---|
| 1.1 | pan de ajo | Pan de Ajo $13.900 |
| 1.2 | copa de vino | Copa de Vino $15.500 — **no** la Limonada de Vino Tinto |
| 1.3 | lasaña de pollo | Lasaña Pollo $23.000 — **no** Pollo Champiñón |
| 1.4 | limonada de mango | Limonada Mango Biche $12.500, directo: es la **única** de mango entre las 9 limonadas |
| 1.5 | chelita | listó las 6 cervezas con precio y preguntó; con *"Corona"* agregó Corona $10.500 |
| 1.6 | papata mexicana | Patatas Mexicanas $21.500, a pesar del typo |

Carrito final **$96.900**, sin productos de más, con precios iguales a `menu`. **1.7 no se corrió**:
se añadió al guion el 22-09. Es el que mide la banda de confianza (ver "Hallazgos vivos"), así que
G1 no queda cerrado hasta correrlo.

> ⚠️ **Trampa al auditar:** `n8n_chat_histories` solo guardó la llamada a `consultar_menu` de la
> chelita, así que parece que el agente armó los otros cinco productos sin consultar el menú. No fue
> así: el subworkflow `r9BbkGSCNJcJ2P6t` corrió una vez por turno (ej. `16517`, `filtro: "pan de
> ajo"`). **Para saber qué tools llamó el agente, mira las ejecuciones, no la memoria.**

### G2 · repetido — ✅ **verde**

Lasaña Pollo + Copa de Vino → `crear_carrito` en el mismo turno, sin *"¿te la dejo?"*. Tras 4 min,
*"quiero algo más: una hawaiana"* → preguntó masa y tamaño → *"Tradicional familiar"* → carrito con
los tres productos, **$97.000**. Confirma el cierre de BUG-055 con otros productos.

**Observación (no es rojo):** `variante` se guardó como texto libre, `"Tradicional familiar"`. En
`detalle_pedidos` ya conviven `Familiar`, `Mediana Tradicional` y `Tradicional - grande` para el
mismo producto. El precio sale bien; conviene vigilarlo en G4, cuando el carrito pase a pedido.

---

## 2026-09-22 · Capa B · G2 y G3

### G2 · El carrito es idempotente — ✅ **verde**

**Número:** `573184821317` (CLI-039).

El carrito quedó con los **dos** productos: La Vera Especial (Estofada Grande, $77.000) + Hawaiana
(Estofada Grande, $65.000), total $142.000, `paso_flujo = 'armando'`. El producto nuevo entró y los
anteriores se conservaron.

**Dos cosas que este guion cierra de paso:**

- **BUG-055 queda cerrado.** El carrito **se creó** de verdad. Antes el agente de menú preguntaba
  *"¿te la dejo?"* sin guardar nada y el `sí` caía en soporte, que inventaba el carrito y dejaba la
  conversación sin salida.
- Ante `una hawaiana` el bot **preguntó** en vez de elegir:

  > *"Perfecto, te agregamos una hawaiana 🍍 ¿La quieres: 1) Tradicional o Estofada? 2) En qué
  > tamaño: porción, pequeña, mediana, grande o familiar?"*

  Es exactamente el comportamiento que exige G1.7 frente a un término ambiguo, y aquí salió solo.
  No lo da por probado —la hawaiana tiene variantes explícitas, que es un caso más fácil que un
  genérico como "pizza"— pero es buena señal.

### G3 · Cobertura — 🔴 **5 de 7** → BUG-061 y BUG-062

**Número:** `573113298122` (CLI-038).

**Verde:** 3.1 y 3.2 (Envigado y Sabaneta: dice que no llegan, ofrece recoger, **sin precio ni
tiempo** — el invariante de §27 se sostiene), 3.3 ($7.500 / 30-45 min), 3.4 ($5.000 / 20-30 min).

**3.7 verde, y es el que más tranquiliza:** pidió *"hazme un domicilio de patatas mexicanas, estoy
en itagui"* y el carrito quedó con `tipo_pedido = NULL`. No se creó ningún pedido fuera de cobertura.
El bot explicó el límite y dejó el producto en el carrito, que es razonable.

**🔴 3.5 → BUG-061.** A `estoy en niqia` el bot respondió:

> *"Perfecto Juan, si estás en Niquía sí te podemos llevar domicilio ✅ El envío allá está en $7.500
> y suele tardar entre 30 y 45 minutos."*

Y `consultar_cobertura('niqia')` había devuelto `cubierto:false`, `costo_domicilio:null`,
`tiempo_estimado:null`, `sugerencias:["Niquía"]` y un mensaje que dice literalmente *"No prometas
domicilio ni des ninguna tarifa ni tiempo de entrega. Si hay sugerencias, pregunta si el cliente se
refería a uno de esos barrios"*. **Los números salieron de la memoria de la conversación**, del
turno 3.3 — no de esa llamada, donde venían en `null`.

Y tiene consecuencia en dinero: el carrito guardó `barrio = 'niqia'` (texto crudo), que
`resolver_barrio` **no resuelve**. Si se convierte en pedido, el trigger cae a `tarifa_base()` =
**$5.000 en vez de $7.500**, con `zona` en NULL.

**🔴 3.6 → BUG-062.** A `pardo` el bot devolvió **el PDF del menú completo** y *"dime qué se te
antoja"*. Ni siquiera consultó cobertura. La expectativa vieja del guion (confirmar el síntoma de
BUG-040) quedó **obsoleta**: BUG-040 está cerrado y `consultar_cobertura('pardo')` ya devuelve
`sugerencias:["Prado"]`. Lo que falla ahora es anterior: el ruteo.

> **La lección de los dos juntos:** G3 es el guion que existe precisamente porque *"lo que la RPC
> acierta, el prompt lo puede contar mal"* (§27). Se cumplió en los dos sentidos posibles — en 3.5
> el prompt ignoró lo que la tool le dijo, y en 3.6 la tool ni se llamó. Las cuatro respuestas
> verdes salieron bien; **las dos rojas son las que nadie habría visto sin hablar con el bot.**
