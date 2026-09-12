# Campaña de pruebas — plan y resultados

Baterías: [`sql/`](sql/) · Bugs nuevos → [`../docs/shared/bug-tracker.md`](../docs/shared/bug-tracker.md)

## La estrategia, en una frase

**Cada caso se prueba en la capa más barata que pueda detectarlo.** Solo llega a WhatsApp lo que
únicamente WhatsApp puede probar. El bot es una de tres capas, y la mayor parte de la lógica que un
cliente puede romper no vive en el LLM: vive en Postgres.

| Capa | Qué prueba | Coste por caso | Repetible |
|---|---|---|---|
| **A · SQL determinista** | funciones, triggers, constraints, RLS | ~0 (segundos, sin LLM) | sí, infinitas veces |
| **B · Conversación WhatsApp** | el modelo: ruteo, prompts, redacción, memoria | alto (minutos + tokens) | no |
| **C · Vitest sobre utils puras** | agregados y formateo del dashboard | ~0 | sí |

**Cómo se ejecuta la Capa A:** cada fichero de `sql/` se pasa al MCP de Supabase. Devuelven **solo
las filas que fallan** — resultado vacío = verde. Los que escriben van dentro de `BEGIN … ROLLBACK`
(validado que el MCP lo respeta) y usan teléfonos ficticios `5730000009xx`, nunca uno real.

**Regla de oro** (sale de edge-cases §11, §18, §19, §22, §31): *el verde no prueba nada por sí
solo.* Cada aserción se hace leyendo la fila resultante o contando filas — nunca preguntando si
algo lanzó excepción.

**Número acordado para la Capa B:** el de Juan, `573113298122` (CLI-038). Reset entre guiones:

```sql
delete from carritos where telefono = '573113298122';
delete from n8n_chat_histories where session_id in ('573113298122','orq:573113298122');
update clientes set modo = 'bot' where telefono = '573113298122';
```

## Estado

| Batería | Estado | Casos | Verde | Rojo |
|---|---|---|---|---|
| `01-cobertura.sql` | ✅ ejecutada | 236 + 46 | 211 + 46 | 25 (BUG-040) |
| `02-menu.sql` | ✅ ejecutada | 133 × 3 + 39 | — | BUG-039 (crítico), BUG-041 |
| `03-mitad-y-mitad.sql` | ✅ ejecutada | 3024 + 23 | **3047** | **0** |
| `04-flujo-pedido.sql` | ✅ ejecutada | 12 | 11 | 1 (BUG-042) |
| `05-totales.sql` | ✅ ejecutada | 14 | **14** | **0** |
| `06-reservas.sql` | ✅ ejecutada | 12 | 10 | 2 (BUG-043, BUG-044) |
| `07-housekeeping.sql` | ✅ ejecutada | 19 | **19** | **0** |
| `08-roles-rls.sql` | ✅ ejecutada | 16 | **16** | **0** |
| `09-basura.sql` | ✅ ejecutada | 71 | 64 | 7 (BUG-045…049) |
| `10-resenas.sql` | ✅ ejecutada | 32 | 22 | 10 (BUG-050 🔴, BUG-051) |
| Capa B · 11 guiones WhatsApp | 📝 escritos, 8/11 ejecutables | | | |
| Capa C · Vitest | ⬜ pendiente | | | |

**Capa A cerrada.** Las 10 baterías están ejecutadas: ~3.650 casos, 13 bugs encontrados
(BUG-039…051), ninguno de ellos visible desde el código del dashboard.

**Capa B lista para correr:** los 11 guiones están en [`guiones-bot.md`](guiones-bot.md) con los
mensajes exactos, la respuesta esperada y el SQL de verificación. **G3, G7 y G9 siguen bloqueados**
por las preguntas de negocio de la Fase 0 (horarios reales, ventana de reservas, precios de
`motivos_reserva`, FAQ con una sola fila); los otros ocho se pueden ejecutar ya.

---

## 2026-09-09 · Batería 01 · Cobertura

**Verde:**
- **T1** — los 59 barrios se resuelven a sí mismos, con tarifa y tiempo. 0 fallos.
- **T2** — 295 variantes de escritura (minúscula, sin tilde, MAYÚSCULA, prefijo "barrio"):
  todas caen en el mismo barrio y la misma tarifa. 0 fallos.
- **T3** — Envigado, Sabaneta, Itagüí, Medellín, Bogotá, Copacabana, Girardota, Barbosa,
  La Estrella, Caldas → `cubierto:false` con `costo_domicilio` y `tiempo_estimado` en NULL
  y mensaje explícito. **El invariante de edge-case §27 se sostiene.**
- **T6** — sin argumento, `''` y `'   '` → `modo:'listado'` con las 5 zonas. Correcto.

> Esto **cierra la verificación pendiente de BUG-033 en la capa SQL**. Falta solo la
> confirmación conversacional (guion G7), porque lo que la RPC devuelve bien el prompt
> todavía puede contarlo mal — que es exactamente la lección de edge-case §27.

**Rojo → BUG-040** (ver abajo).

**Descartado:** anoté que `consultar_cobertura('')` devolvía un "objeto mudo". Era un error
de mi consulta (no seleccionaba `modo`); en modo listado `cubierto` legítimamente no existe.
La función está bien.

---

## 2026-09-09 · Batería 02 · Menú

**Verde:**
- **T3** — los 3 productos agotados siguen siendo visibles con `disponible:false`. El
  riesgo de edge-case §17 ("no lo manejamos" en vez de "hoy se agotó") no se materializa
  en la capa SQL.
- **T4** — las 11 entradas del diccionario de correcciones funcionan (`papata`→patata,
  `chelita`/`birra`/`servexa`→cerveza, `hamburgesa`→hamburguesa, `calson`→calzone…).

**Rojo → BUG-039** (crítico, ver abajo) y **BUG-041** (categorías, menor).

---

## 2026-09-09 · Fase 0 · Datos semilla — cerrada parcialmente

`info_negocio` ya tiene los datos reales (verificado vía MCP): "La Vera Pizzería", Parque de Bello
Calle 54 # 52-07, (604) 4799978, +573233148517, @laverapizzeria. Y **se resolvió la contradicción
entre capas**: `datos_transferencia` ahora dice "Bancolombia ahorros 62500073329", exactamente lo
mismo que el PASO 5 del prompt del Agente Pedidos. **BUG-026 cerrado.**

**Sigue pendiente antes de la Capa B:**

1. **Horarios sin tocar.** `horario_semana` ("Lunes a Viernes 11:00am - 10:00pm"),
   `horario_finsemana` ("Sábados y Domingos 12:00pm - 11:00pm") y `horario_feriados` ("Cerrado")
   son **idénticos a los de la plantilla de Don Carlo**. Puede ser coincidencia, pero hay que
   confirmarlo: si el bot canta un horario falso, lo hará con total seguridad.
2. **Incoherencia entre capas que hay que decidir:** el subworkflow de reservas valida
   **12:00–21:00**, pero `info_negocio` dice que el local cierra a las **22:00** entre semana y
   **23:00** el finde. Hoy un cliente no puede reservar a una hora en la que el local está abierto.
   Y el bloque de reserva dura 90 min, así que una reserva de las 21:00 termina a las 22:30.
3. **FAQ sigue con 1 sola fila** ("Tienen parqueadero?"). `consultar_faq` no filtra: devuelve todas
   las activas y el emparejamiento lo hace el LLM. Con una sola fila, toda pregunta frecuente que
   no sea del parqueadero se responde por improvisación.
4. **`motivos_reserva` sin cambios** — los 6 precios siguen siendo los del seed documentado como
   placeholder ($80.000 cumpleaños, $120.000 aniversario, $150.000 declaración, $90.000 grado,
   $200.000 empresarial). Confirmar si son los reales.
5. Detalle menor: `descripcion_general` dice "La pizza más **premiun**" (typo) y contiene un salto
   de línea. Ojo con el salto: `WA_TEMPLATES` no admite saltos de línea en los parámetros — Meta
   rechaza el envío.

---

## 2026-09-09 · Batería 03 · Mitad y mitad — **verde completo**

Cierra el *"falta probar"* del changelog (entrada mitad y mitad, 2026-08-10) en la capa SQL.

- **T1 exhaustivo:** **3024 pares** (todas las combinaciones de pizza salada con la misma masa ×
  los 4 tamaños). **3024 correctos, 0 fallos.** Los tres invariantes se cumplen siempre: el precio
  es el de la **mitad más cara** (ni promedio ni suma), el `producto_id` es el de la cara, y
  `mitades` trae exactamente 2 elementos. El cruce de categorías funciona como está documentado.
- **T2 rechazos:** 21/21 correctos — `MASA_DISTINTA`, `TAMANO_NO_PERMITIDO` (porción),
  `CATEGORIA_NO_PERMITIDA` (dulces, en ambas posiciones), `MITADES_IGUALES`,
  `PRODUCTO_NO_ENCONTRADO` (incluido el caso "el LLM inventa un producto_id"), `TAMANO_INVALIDO`
  (tamaño vacío, null, emoji, `' OR 1=1 --`), `FALTAN_PRODUCTOS`. Y los alias que dice un cliente
  real (`personal`, `peque`, `media`, `familia`, `MEDIANA`, `pequeña`) resuelven bien.
- **T3 `PRODUCTO_AGOTADO`:** no hay pizzas agotadas en el menú, así que se agota una dentro de una
  transacción que se revierte. Correcto en ambos órdenes de los argumentos, y nombra la pizza
  correcta.

> De paso quedó validado que **`BEGIN … ROLLBACK` funciona a través del MCP de Supabase**, lo que
> habilita las baterías que escriben sin dejar rastro.

---

## 2026-09-09 · Batería 04 · Flujo del pedido

**Verde:**
- **T1** — `faltantes` pide los datos en el orden correcto: carrito → tipo_pedido → barrio →
  cobertura → direccion_entrega → metodo_pago. Y normaliza bien: `"a domicilio"` → `domicilio`,
  `"efectivo"` → `Efectivo`.
- **T2** — la semántica COALESCE se sostiene: guardar solo `notas` no borró ninguno de los otros
  cinco campos.
- **T3** — pasar a recoger limpia barrio, dirección, envío y cobertura. Y `"para llevar"` normaliza
  a **recoger**, que es lo correcto en Colombia (un `domicilio` habría cobrado un envío inexistente).
- **T6** — vaciar el carrito devuelve `paso_flujo` a `armando` (caso BUG-032 / edge-case §25).

**Rojo → BUG-042** (bajo, se autorrepara).

> ⚠️ **Trampa metodológica que mordió aquí y quedó documentada en el encabezado de
> `04-flujo-pedido.sql`:** leer la tabla en un subquery del mismo `SELECT` que ejecuta la función
> devuelve el **snapshot previo**. Tres tests parecieron fallar por eso. Escribe en una sentencia,
> lee en la siguiente.

---

## 2026-09-09 · Batería 05 · Totales — **verde completo (14/14)**

El invariante `total = SUM(items) + costo_domicilio` **una sola vez** se sostiene en todos los
caminos, incluido el combo peligroso de edge-case §24 (cambiar de zona, que ajusta por delta, y
luego meter un ítem, que recalcula desde cero).

- **T3 · regresión de edge-case §22 cerrada:** borrar un ítem recalcula el total. El `COALESCE(NEW,
  OLD)` está puesto y funciona; el `WHERE pedido_id = NULL` silencioso no vuelve.
- **T5-T8:** cambios de barrio entre zonas, domicilio→recoger (envío a 0 y barrio a NULL) y la
  vuelta, todos con el total exacto.
- **T9:** el override manual del envío (promo / envío gratis del admin) se respeta y solo corrige
  el total, como está documentado.
- **T10-T14 · `editar_pedido`:** total correcto con el envío congelado sumado una vez; arrastra
  `mitades` y `notas_item`; y los tres caminos de error responden bien (`SIN_ITEMS`,
  `PEDIDO_NO_ENCONTRADO`, `PEDIDO_YA_PROCESADO`).

Corrección de una expectativa mía: esperaba que un pedido recién creado sin ítems tuviera
`total = costo_domicilio`. Es 0, y **es correcto** — el trigger documenta que el INSERT no toca
`total`, lo escribe el de `detalle_pedidos` cuando entran los ítems.

---

## 2026-09-09 · Batería 06 · Reservas

**Verde:** las 8 mesas se respetan en INSERT (la 9ª revienta con `cupo_agotado`) · la frontera del
bloque de 90 min es exacta (20:30 ya no solapa con 19:00, 20:29 sí) · `costo_motivo` lo escribe el
trigger e **ignora el valor que mande el LLM** (probado con 999 → quedó 80000) · `motivo` vacío →
NULL y costo 0 · los CHECK de `personas` (0, 13) y de `motivo` inexistente rechazan.

**Rojo → BUG-043** (sobreventa, media) y **BUG-044** (el modal ofrece valores que la BD rechaza).

> Lo que NO cubre esta batería: `consultar_disponibilidad` (horario 12:00-21:00, máx 14 días, mín
> 5h de anticipación) vive en el subworkflow n8n `OTQp2O8QDw1mMKOZ`, no en la BD. Va en el guion G9
> de la Capa B.

---

## 2026-09-09 · Batería 07 · Housekeeping — **verde completo (19/19)**

**Cierra la verificación pendiente de BUG-028.** El job `expirar-pedidos-pendientes` **sí ha
corrido**: 30 ejecuciones, 30 exitosas, la última hoy a las 16:00 UTC (`cron.job_run_details`).
Los otros dos también: `limpiar-carritos-abandonados` 655/655 y `limpiar_historial_chat_semanal`
16/16.

- **Los dos puntos que BUG-028 dejaba abiertos, verificados:**
  (a) el job cierra solo los `pendiente` de días anteriores — probadas las tres fronteras: −2h del
  corte se cancela, 00:05 de hoy y "ahora mismo" sobreviven, y un `en_cocina` viejo queda intacto.
  Además **no queda ni un pendiente viejo sin cerrar** en la BD.
  (b) el texto encaja en la plantilla: *"❌ Tu pedido fue cancelado, no alcanzamos a procesarlo
  antes del cierre del día. Lamentamos los inconvenientes."*
- **Carritos abandonados (regresión §26):** borra los de >24h, respeta el de 23h y el fresco, y el
  trigger `touch_updated_at` refresca la marca al tocar el carrito, así que el job mide lo que dice
  medir. Un carrito tocado deja de ser borrable.
- **`registrar_contexto_handoff` — las cuatro trampas de §21, todas superadas.** Con una
  conversación simulada de 9 filas llenas de ruido real (el mismo mensaje guardado 3 veces por dos
  sesiones, el JSON de clasificación del orquestador, un mensaje `tool` y un `content` que no es
  string) vuelca exactamente **4 mensajes**, en orden `cliente|bot|cliente|bot`, y **la queja del
  cliente queda antes de la respuesta del bot** — el desempate por microsegundos funciona. La
  segunda corrida vuelca 0: es idempotente.
- **Hallazgo colateral en verde:** existe un constraint `unique_pedido_cliente_minuto` sobre
  `(telefono, date_trunc('minute', fecha_pedido))` que no estaba en mi mapa. Es lo que salva de que
  un cliente impaciente diga "confirmo" dos veces y le entren dos pedidos. Probado: el segundo
  rebota.

---

## 2026-09-09 · Batería 08 · Roles y RLS — **verde completo**

La regla #1 de `CLAUDE.md` se sostiene: **un domiciliario no puede leer el restaurante entero.**

| Ve… | domiciliario | mesero | sin perfil |
|---|---|---|---|
| pedidos (116) | **34** | 116 | 0 |
| clientes (35) | **17** | 35 | 0 |
| detalle_pedidos (214) | **71** | 214 | 0 |
| reservas (16) | **0** | 16 | 0 |
| soporte · carritos · chat · feedback | **0** | **0** | 0 |
| perfiles (5) | 1 (el suyo) | 1 (el suyo) | 0 |
| menu (133) | 133 | 133 | **133** |

Los 34 pedidos del domiciliario son **todos suyos**: 0 sin asignar, 0 de otro repartidor.
El `menu` visible sin perfil es la política `menu_lectura_publica` y es intencional — el menú ya
es público (`vera.plateo.cloud/menu_vera.pdf`), no es una fuga.

- **Triggers de columna (regla #2):** el mesero intentando asignar un domiciliario → **42501**; el
  mesero intentando hacerse admin → **42501**; el domiciliario llamando `listar_usuarios` →
  **42501**.
- **Escrituras bloqueadas por RLS:** el DELETE del mesero y los dos UPDATE del domiciliario (marcar
  entregado un pedido ajeno, auto-asignarse uno) **no cambiaron ni una fila** — verificado contando
  antes y después, no por excepción (ver la trampa de abajo).
- **El camino de n8n (regla #3):** sin JWT, `mi_rol()` es NULL y las cuatro tools del bot
  responden — el patrón `auth.uid() IS NULL → dejar pasar` funciona. Y con sesión de un rol no
  admin la misma tool se cierra: `guardar_datos_pedido` → *"no autorizado"*.

> ⚠️ **Falso verde que mordió aquí y quedó documentado en `edge-cases.md` §31:** una escritura
> bloqueada por RLS **no lanza excepción** — afecta 0 filas y devuelve éxito. Un test que solo
> pregunte "¿lanzó?" da verde aunque la política no exista. Para RLS se cuentan filas; para
> triggers se atrapan códigos de error.

---

## 2026-09-12 · Batería 09 · Entrada basura — 64/71

Las otras ocho baterías prueban cada función contra su contrato. Esta cruza las 15 clases de
basura (inyección SQL, emoji, zero-width, RTL, 10.000 caracteres, comodines LIKE, NULL en todo,
números fuera de rango, JSONB que no es un array) contra las 14 RPC. El llamador no es un cliente
de API: es un LLM, y un LLM manda `''` con la misma facilidad que `null`.

**Verde — lo que sí aguanta:**

- **I3 · ninguna inyección ejecutó nada.** Contado, no supuesto: 116 pedidos · 214 detalles ·
  35 clientes · 16 reservas · 133 menu · 20 tablas, idénticos a la línea base de la batería 08.
  Las 4 inyecciones × 6 RPC de lectura se tratan como texto.
- **El trigger `aplicar_tarifa_domicilio` pisa al llamador.** Un `costo_domicilio` de −5.000 o
  `NaN` entra al INSERT de `pedidos` y queda guardado como **5.000**, la tarifa real de la zona;
  el total sale exacto. Es el mismo patrón que `costo_motivo` en reservas: **el trigger ignora
  lo que mande el LLM**. Es el mejor resultado de la batería.
- Los CHECK de dominio muerden donde deben: `pedidos.estado`, `reservas.personas`,
  `reservas.origen`, `carritos.tipo_pedido`/`metodo_pago`/`paso_flujo` → 23514.
- El **FK `detalle_pedidos.producto_id → menu`** es el que impide materializar el producto que el
  LLM inventa: 23503, no una línea fantasma.
- `consultar_faq` es la única que sanea su `limite` (`greatest(1, least(p_limite, 40))`), y por eso
  es la única que sobrevive a un límite negativo. **Ese es el patrón a copiar** en las otras dos.
- Texto largo y unicode hostil (10k caracteres, emoji, zero-width, RTL, saltos de línea) se guarda
  y se devuelve íntegro, sin truncar ni romper.

**Rojo → BUG-045 (media), BUG-046 (baja), BUG-047 (baja), BUG-048 (media), BUG-049 (baja).**
El que más pesa es **BUG-048**: `editar_pedido` acepta cantidad y precio negativos con
`success:true` y deja el pedido con **total negativo** (medido: −25.000). El único guardarraíl es
`Math.max(1, …)` en React — es decir, exactamente donde la regla #1 de `CLAUDE.md` dice que la
frontera *no* está.

> ⚠️ **Falso verde que mordió aquí y quedó documentado en `edge-cases.md` §32:**
> `historial_resumen(null, null, …)` devuelve `total: 0` y lo leí como "fail-closed". No lo era: el
> `WHERE` es `fecha_pedido >= p_from AND fecha_pedido < p_to`, así que con `p_from` NULL la
> cláusula entera es NULL y no hay filas — el 0 no venía del filtro de búsqueda que yo creía estar
> probando. Con el rango puesto, el mismo caso devuelve 116. **En una batería de basura el cero es
> el resultado más sospechoso que hay**, porque es justo lo que devuelve un test que no llegó a
> ejecutarse.

> ⚠️ **Segunda trampa:** el FK contra `menu` dispara *antes* que cualquier validación de
> cantidad/precio. Tres casos de cantidad negativa parecían "rechazados" y en realidad nunca se
> habían probado — usaban un `producto_id` inventado. Con `PROD-019` real apareció BUG-048.

---

## 2026-09-12 · Batería 10 · Flujo de reseñas — 22/32 · **el flujo está roto en producción**

Ninguna batería cubría el feedback. Al mirarlo apareció que **no es un riesgo teórico: lleva
51 días sin funcionar.**

**El síntoma, medido en vivo:**

| Indicador | Valor |
|---|---|
| Último `feedback` registrado | **2026-07-23** (hace 51 días) |
| Última fila nueva en `feedback_pendiente` | 2026-08-13 (hace 30 días) |
| Pedidos entregados de los últimos 30 días **sin** `feedback_solicitado` | **0** — el sistema cree que preguntó |
| Clientes atrapados en `modo='esperando_feedback'` | **7** |
| Filas zombis en la cola | **9**, la más vieja de **108 días** |

**La causa, leída de la ejecución real de n8n `14816` (2026-09-08), no inferida.** La cadena del
job escribe **antes** de la operación que puede fallar:

```
Marcar feedback_solicitado ✓ → Activar modo esperando_feedback ✓ → POST feedback_pendiente 💥 → Enviar WhatsApp ✗
```

`feedback_pendiente` tiene **PK `telefono`** (un slot por cliente) y el nodo hace POST sin upsert.
Con un cliente que ya tenía fila:

```
409 · {"code":"23505","details":"Key (telefono)=(573184821317) already exists."}
```

`retryOnFail` reintenta, vuelve a chocar y **mata la ejecución**. Los dos writes anteriores quedan
confirmados y nadie los revierte: el pedido queda marcado como "ya preguntado" **para siempre**, el
cliente queda en un modo donde el bot solo sabe decir *"responde 1–5"*, **y el WhatsApp nunca se
envía**. Al cliente no se le preguntó nada. → **BUG-050 🔴**

Y si ese cliente responde ahora, la nota se escribe contra el pedido de la fila zombi — CLI-039
tiene 6 pedidos entregados marcados y **cero feedback**; su cola apunta a un pedido de mayo.

**T5 valida el fix:** con `on conflict (telefono) do update` (que es lo que hace la cabecera
`Prefer: resolution=merge-duplicates` de PostgREST) el upsert pasa, queda **1 fila apuntando al
pedido nuevo** y el reloj se reinicia.

**BUG-051, el segundo hallazgo:** `Parsear calificación` coge **el primer dígito 1–5 del texto**.
De 11 mensajes realistas, **6 fabrican una calificación que nadie dio**:

| El cliente escribe | Nota que queda registrada |
|---|---|
| `10/10` | **1** — da la nota máxima, se guarda la mínima |
| `me demoraron 45 minutos` | **4** → ruta positiva: le agradece y le pide reseña en Google por una queja |
| `quiero 2 pizzas` | **2** → ruta negativa: le pide explicaciones a quien solo quería comida |
| `mi direccion es calle 52 # 3-21` | **5** |

Las dos cosas se agravan entre sí: el cliente atrapado por BUG-050 **solo tiene esa puerta**, y su
intento natural de pedir comida es justo la frase que el parser malinterpreta.

**Verde:** los constraints de ambas tablas cumplen (`calificacion` 1–5, `UNIQUE(pedido_id)` impide
dos reseñas del mismo pedido, los FK rechazan ids inventados, `estado` acotado) y la ventana 1–6 h
del job es exacta en las cuatro fronteras.

> ⚠️ **Dos trampas mordieron aquí, las dos ya documentadas y aun así reincidentes:**
> (a) el `UNIQUE(pedido_id)` dispara **antes** que el FK de `cliente_id`, así que el caso del
> cliente inventado medía el constraint equivocado — la misma familia que el FK de la batería 09;
> hay que usar un pedido distinto. (b) leer `feedback_pendiente` en un subquery del mismo `SELECT`
> que ejecuta el upsert devuelve el **snapshot previo**: el fix de T5 parecía no funcionar y
> funcionaba. Es literalmente la trampa del encabezado de `04-flujo-pedido.sql`.

---

# Bugs nuevos

## BUG-039 · 🔴 Alta — `buscar_menu` empata todo en 1.000 y el bot agrega el producto equivocado

- **Componente:** BD → `buscar_menu()` · consumido por `Sub — Consultar_menu` (`r9BbkGSCNJcJ2P6t`)
  → tool `consultar_menu` del Agente Menú.
- **Síntoma medido:**
  - **26 de 133 productos (20%) no aparecen en el top-5** al buscarlos por su **nombre exacto**,
    pese a tener similitud 1.000.
  - **125 de 133 (94%) empatan** en el score máximo con al menos otro producto de nombre distinto.
    49 de ellos empatan con entre 6 y 20 competidores.
  - Frases naturales de cliente que **no devuelven lo pedido en ninguna de las 5 posiciones**:

    | El cliente escribe | Lo que recibe el bot |
    |---|---|
    | `una copa de vino` | De Mi Tierra · De Mi Tierra · Limonada de Vino Tinto · Panecillos de Nutella · Limonada de Sandía |
    | `pan de ajo` | De Mi Tierra · Limonada de Vino Tinto · Panecillos de Nutella · De Mi Tierra · Limonada de Sandía |
    | `arepa de pollo` | Pollo Champiñon · Pollo Tocineta · Pollo Champiñon · Pollo Tocineta · Limonada de Vino Tinto |
    | `lasaña de pollo` | Pollo Champiñon · Pollo Tocineta · Pollo Champiñon · Pollo Tocineta · Limonada de Vino Tinto |
    | `una limonada de mango` | Panecillos de Nutella · Limonada de Vino Tinto · Limonada Tamarindo · Limonada Hierbabuena · De Mi Tierra |

- **Causa (leída de la definición viva):** la **CAPA C** (`word_scores`) puntúa palabra contra
  palabra con `MAX(similarity(f.word, sw.word))`, y el score final es un `GREATEST(...)`. Basta
  que **una sola palabra** del nombre coincida exacta con **una sola palabra** de la búsqueda
  para que el producto puntúe **1.000**. El filtro es `length(word) >= 2`, así que la
  preposición **`"de"`** entra: cualquier producto que contenga "de" empata a 1.000 con
  cualquier búsqueda que contenga "de". Luego `ORDER BY similitud DESC LIMIT 5` corta
  **arbitrariamente** entre decenas de empatados.
- **Por qué es alta y no media:** el prompt del Agente Menú usa la similitud como criterio de
  confianza — *"≥0.5 → proceder sin confirmar; 0.2-0.5 → confirmar «¿Te refieres a…?»"*. Con
  todo empatado en 1.000 **el bot nunca entra en la banda de confirmación**: agrega al carrito,
  con plena confianza, un producto que el cliente no pidió. Es la regla `PROHIBIDO elegir un
  producto distinto al que pidió el cliente` (agent-prompts.md) rota desde la herramienta, no
  desde el modelo. Y encaja con la lección de edge-case §27: la herramienta miente y el prompt
  no tiene cómo saberlo.
- **Fix propuesto (simulado y medido, no teórico):**
  1. Excluir stopwords (`de la el en con y al los las un una del sin por para mi su a`) del
     match palabra-a-palabra, **a ambos lados**.
  2. Desempatar en el `ORDER BY`: primero coincidencia exacta del nombre normalizado, luego
     containment, luego similitud, luego nombre más corto.

  **Medición de la simulación:** producto hallado en top-5 por su nombre exacto pasa de
  **107/133 (80%) a 133/133 (100%)**; queda primero en 105/133, y **los 28 que no quedan
  primeros son exactamente los nombres duplicados por variante** (Tradicional/Estofada), donde
  "primero" no está definido. Comparativas: `pan de ajo` → *Pan de Ajo* en 1º;
  `papata mexicana` → aparece *Patatas Mexicanas*; `lasaña de pollo` → aparece *Lasaña Pollo*.
- ⚠️ **Trampa al implementarlo:** mi simulación **descartó la CAPA D** (el diccionario de
  correcciones) y por eso `chelita` dejó de devolver cervezas. El fix real **debe conservar
  `termino_corregido`** y aplicar el filtro de stopwords sobre las dos variantes del término.
  El test `02-menu.sql · T4` existe justamente para atrapar esa regresión.
- **Cabo suelto que el fix NO resuelve:** `una limonada de mango` sigue sin devolver
  *Limonada Mango Biche* (el nombre real lleva "Biche"). Es un problema de vocabulario, no de
  ranking; se resolvería con una entrada en el diccionario o con `descripcion`.

---

## BUG-040 · 🟡 Media — un typo de transposición deja a un cliente de Bello fuera de cobertura

- **Componente:** BD → `consultar_cobertura()`, bloque de `sugerencias` (umbral `similarity >= 0.40`).
- **Síntoma medido:** barrido sistemático de 59 barrios × 4 clases de typo = **236 casos**;
  **25 devuelven `cubierto:false` Y cero sugerencias**, o sea el bot le dice *"solo repartimos
  en Bello"* a alguien que **vive en Bello**, sin ofrecerle siquiera una corrección.

  | Clase de typo | Fallos / 59 | Ejemplos |
  |---|---|---|
  | **transponer 2 letras seguidas** | **21 (36%)** | `pardo`→Prado · `cnetro`→Centro · `zmaora`→Zamora · `saurez`→Suárez · `nqiuia`→Niquía |
  | borrar una letra (nombres ≤5) | 4 | `prdo`→Prado · `peez`→Pérez · `pais`→París |
  | duplicar letra · quitar la última | 0 | robustos |

- **Causa:** trigram se hunde con las transposiciones (similitud 0.20–0.385 contra el umbral
  0.40). No es un umbral mal elegido: el comentario del código explica que 0.40 es
  deliberadamente alto para que `sabaneta` no sugiera `Sabanalarga`. **Bajarlo rompería ese
  diseño.**
- **Fix propuesto (validado):** añadir una **segunda pasada por anagrama** cuando trigram no
  devuelve nada — transponer dos letras conserva exactamente el multiconjunto de caracteres,
  así que basta comparar las letras ordenadas de la clave normalizada.

  **Medición:** resuelve **21/21** transposiciones, cada una a **un solo** barrio (sin
  ambigüedad), y da **0 falsos positivos** en los controles negativos `sabaneta`,
  `sabanalarga`, `envigado`, `itagui`, `medellin`, `bogota`, `copacabana`. El umbral 0.40 se
  queda como está.
- **Sin resolver:** las 4 deleciones en nombres de ≤5 letras. Necesitarían distancia de
  edición — `fuzzystrmatch` está **disponible pero no instalada** en el proyecto.

---

## BUG-041 · 🟢 Baja — `buscar_menu_categoria` devuelve categorías vecinas

- **Componente:** BD → `buscar_menu_categoria()`.
- **Síntoma:** `pizza_premium` devuelve **36** productos cuando la categoría tiene **24** (se
  cuela `pizza_premium_especial`, 12 productos con **precios distintos**). `adicion` devuelve
  **14** cuando tiene **4**.
- **Riesgo:** el bot puede listar una premium-especial como si fuera premium y cantar el
  precio de la categoría equivocada.

---

## BUG-042 · 🟢 Baja — recotizar el domicilio con la misma tarifa se descarta

- **Componente:** BD → trigger `carritos_normalizar_estado()`, bloque de invalidación por cambio
  de barrio.
- **Síntoma:** el cliente cambia de barrio dentro de la **misma zona** (Centro → La Milagrosa,
  ambos $5.000). El agente recotiza bien y guarda `costo_domicilio=5000, cobertura_ok=true`, y el
  trigger lo tira: los dos quedan NULL y `faltantes` vuelve a pedir `"cobertura"`.
- **Causa:** el trigger infiere "¿recotizó?" comparando si el precio cambió. Pero **la tarifa es
  por zona, no por barrio**: 321 de 1711 pares de barrios (18,8%) comparten tarifa.
- **Impacto medido:** se autorrepara en el segundo guardado (el barrio ya no cambia). Cuesta un
  turno y puede hacer que el bot anuncie el costo del domicilio dos veces. No rompe el pedido.
- Detalle completo y fix propuesto en `docs/shared/bug-tracker.md`.
