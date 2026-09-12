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

- **ID:** `BUG-NNN` correlativo — **siguiente libre: BUG-052**. Los IDs no se reutilizan.
- **Severidad:** 🔴 Alta · 🟡 Media · 🟢 Baja. **Estado:** 🔴 Abierto · 🟠 En progreso.
- Cada entrada: componente, síntoma, causa (verificada vía MCP si es n8n/BD), fix propuesto.

---

## Abiertos

### BUG-050 · 🔴 Alta · 🟠 En progreso — el job de feedback muere en el cliente repetido, deja al cliente mudo y nunca le pregunta nada

> **Estado 2026-09-12:**
> - ✅ **Limpieza aplicada en vivo** — 7 clientes devueltos a `modo='bot'`, 9 filas zombis
>   borradas. Las 19 reseñas reales, intactas.
> - ✅ **Pieza 3 aplicada en vivo** — función `expirar_feedback_pendiente()` + cron
>   `expirar-feedback-pendiente` (diario 02:30 Colombia). Verificada: borra la fila vencida y
>   devuelve el modo a `bot`, sin tocar la fresca ni un `modo='humano'` en curso.
> - ⚠️ **Piezas 1 y 2 escritas pero SIN PUBLICAR.** El workflow `Pizzeria Vera` tiene el cambio
>   guardado como borrador (`versionId` 09029f4e…) pero la versión **activa** sigue siendo
>   6391e1ea…, que conserva el orden viejo y `Prefer: return=minimal`. **Producción sigue rota
>   hasta que alguien pulse Publicar en n8n.**
> - Riesgo mientras tanto: con la cola vacía, el primer pedido de cada cliente sí se procesa; el
>   fallo vuelve cuando un cliente recibe **un segundo pedido dentro de las 48 h** de uno sin
>   responder.

- **Componente:** n8n → workflow `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`), rama `trigger_feedback`
  → nodo `feedback_pendiente` · tabla `feedback_pendiente` (PK = `telefono`).
- **Síntoma medido (2026-09-12):** **no se registra un solo feedback desde el 2026-07-23** (51 días),
  no entra una fila nueva en `feedback_pendiente` desde el 2026-08-13 (30 días), y sin embargo
  **todos** los pedidos entregados de los últimos 30 días están marcados `feedback_solicitado = true`.
  Es decir: el sistema cree que preguntó, y no preguntó.
- **Causa (leída de la ejecución real `14816`, 2026-09-08, no inferida):** la cadena es

  ```
  Code — Preparar payload → Marcar pedido como solicitado → Activar modo esperando_feedback
                          → feedback_pendiente → Enviar WhatsApp → Wait1
  ```

  `feedback_pendiente` tiene **PK `telefono`**, o sea **un solo slot por cliente**, y el nodo hace
  `POST` sin upsert. Con un cliente que ya tenía fila, Supabase responde:

  ```
  409 · {"code":"23505","details":"Key (telefono)=(573184821317) already exists."}
  body: {"telefono":"573184821317","pedido_id":"PED-245","cliente_id":"CLI-039", ...}
  ```

  El nodo tiene `retryOnFail: true` y `onError` por defecto (**detener workflow**), así que
  reintenta, vuelve a chocar y **mata la ejecución**: `lastNodeExecuted: feedback_pendiente`.
- **Por qué el daño es permanente y silencioso:** los dos nodos que ya corrieron **escriben antes
  de la caída** y nadie los revierte:
  1. `feedback_solicitado = true` → ese pedido **nunca volverá a entrar** en la búsqueda del job.
  2. `modo = 'esperando_feedback'` → el `Router de modo` manda **todo** lo que escriba ese cliente
     al listener de feedback, no a los agentes de pedidos.

  Y `Enviar WhatsApp` **nunca llega a ejecutarse**. Resultado neto: al cliente **no se le preguntó
  nada**, pero queda en un modo donde el bot solo sabe responder *"responde 1–5"*, y su pedido
  quedó marcado como ya preguntado para siempre.
- **Alcance medido hoy:** **7 clientes en `modo = 'esperando_feedback'`** (CLI-039 desde el
  2026-09-08) y **9 filas zombis** en `feedback_pendiente`, la más vieja de **108 días** (PED-100,
  del 2026-05-28). Ese cliente acumula 6 pedidos entregados marcados como "preguntados"
  (PED-114, 115, 223, 228, 229, 245) y **cero feedback**.
- **Envenenamiento del dato, además:** si CLI-039 responde ahora "5", el subworkflow lee la fila
  zombi y escribe la calificación contra **PED-100 (mayo)**, no contra el pedido que acaba de
  recibir. La nota queda pegada al pedido equivocado.
- **Nada expira esa cola:** `cron.job` tiene 3 jobs (`limpiar-carritos-abandonados`,
  `limpiar_historial_chat_semanal`, `expirar-pedidos-pendientes`) y **ninguno toca
  `feedback_pendiente`**. Las filas zombis no caducan solas.
- **Fix propuesto (tres piezas, la 1 es la que desangra):**
  1. **Upsert en vez de POST**: cabecera `Prefer: resolution=merge-duplicates` (y
     `return=minimal`), para que un cliente repetido **reemplace** su fila en vez de chocar.
     Alternativa de fondo: que la PK sea `(telefono, pedido_id)` y la cola admita varios.
  2. **Reordenar la cadena**: crear la fila pendiente y **enviar el WhatsApp primero**, y solo
     después marcar `feedback_solicitado` y cambiar el modo. Hoy se marca el efecto antes de la
     causa, que es lo que hace el daño irreversible.
  3. **Job de expiración** de `feedback_pendiente` (>48 h → borrar fila y devolver `modo='bot'`),
     al lado de los otros tres en `cron.job`.
- **Limpieza del estado actual (aparte del fix):** las 9 filas zombis y los 7 clientes atrapados
  hay que devolverlos a `modo='bot'` a mano; el fix no los arregla retroactivamente.
- **Regresión:** `qa/sql/10-resenas.sql` T4/T5 cubren el choque de PK y la cola vencida.

---

### BUG-051 · 🟡 Media · 🟠 En progreso — «quiero 2 pizzas» se registra como una calificación de 2 estrellas

> **Estado 2026-09-12:** parser estricto escrito en `Sub — Feedback Pendiente` → `Parsear
> calificación` (versión `cb2ff4b5…`), **pero SIN PUBLICAR**: la versión activa sigue siendo
> `75e3fd55…` con el `texto.match(/[1-5]/)` viejo. Falta pulsar Publicar en n8n.
>
> El parser nuevo exige que el mensaje **sea** la nota: quita adornos (puntuación, emoji,
> espacios) y lo que queda debe ser un dígito 1-5 o una palabra `uno`..`cinco`. Probado contra
> los 19 casos de `qa/sql/10-resenas.sql · T8` + variantes: acepta `5`, `  4 `, `5!`, `5 ⭐`,
> `cinco`, `CINCO`; rechaza los 6 que fabricaban notas (`10/10`, `quiero 2 pizzas`,
> `me demoraron 45 minutos`, `mi direccion es calle 52 # 3-21`, …) mandándolos a
> `Pedir nota de nuevo`, que es literalmente lo que ese mensaje pide.

- **Componente:** n8n → `Sub — Feedback Pendiente` (`xGsKJf2u3bFmL6mA`), nodo `Parsear calificación`.
- **Síntoma:** el parser toma **el primer dígito 1–5 que aparezca en el texto** (`/[1-5]/`). Un
  cliente que está en `esperando_feedback` (ver BUG-050, hoy son 7) y escribe *"quiero 2 pizzas"*
  no recibe su pedido: recibe un **2 de calificación** guardado en `feedback`, y como 2 ≤ 3 el flujo
  lo manda por la **ruta negativa** y le pregunta *"¿qué pasó?"*.
- **Por qué importa más de lo que parece:** el cliente atrapado en modo feedback **solo tiene esa
  puerta**. Su intento natural de pedir comida es justo la frase que el parser malinterpreta, y el
  resultado es una reseña negativa falsa contra un pedido que además puede ser el equivocado
  (BUG-050). Las dos cosas juntas fabrican calificaciones de 1–3 estrellas que nadie dio.
- **Fix propuesto:** exigir que el mensaje sea **solo** la nota (`/^\s*[1-5]\s*$/`), o aceptar
  también «cinco/cuatro/…», y mandar cualquier otra cosa a `Pedir nota de nuevo`. Con el fix, "quiero
  2 pizzas" cae en "responde solo 1–5" en vez de fabricar una reseña.
- **Cabo suelto relacionado:** aun con el parser estricto, un cliente en modo feedback sigue sin
  poder pedir. Convendría una salida: si el mensaje no es una nota **dos veces seguidas**, liberar
  el modo a `'bot'` y seguir la conversación normal.

---

### BUG-039 · 🔴 Alta · 🔴 Abierto — `buscar_menu` empata todo en 1.000 y el bot agrega el producto equivocado

- **Componente:** BD → `buscar_menu()` · consumido por `Sub — Consultar_menu` (`r9BbkGSCNJcJ2P6t`)
  → tool `consultar_menu` del Agente Menú.
- **Síntoma (medido con la batería `qa/sql/02-menu.sql`, 2026-09-09):**
  - **26 de 133 productos (20%) no salen en el top-5** al buscarlos por su **nombre exacto**,
    aunque su similitud sea 1.000.
  - **125 de 133 (94%) empatan** en el score máximo con otro producto de nombre distinto; 49 de
    ellos con entre 6 y 20 competidores.
  - Frases naturales que **no devuelven lo pedido en ninguna de las 5 posiciones**:

    | El cliente escribe | Lo que recibe el bot |
    |---|---|
    | `una copa de vino` | De Mi Tierra · De Mi Tierra · Limonada de Vino Tinto · Panecillos de Nutella · Limonada de Sandía |
    | `pan de ajo` | De Mi Tierra · Limonada de Vino Tinto · Panecillos de Nutella · De Mi Tierra · Limonada de Sandía |
    | `arepa de pollo` | Pollo Champiñon · Pollo Tocineta · Pollo Champiñon · Pollo Tocineta · Limonada de Vino Tinto |
    | `lasaña de pollo` | Pollo Champiñon · Pollo Tocineta · Pollo Champiñon · Pollo Tocineta · Limonada de Vino Tinto |
    | `una limonada de mango` | Panecillos de Nutella · Limonada de Vino Tinto · Limonada Tamarindo · Limonada Hierbabuena · De Mi Tierra |

- **Causa (leída de la definición viva):** la **CAPA C** (`word_scores`) puntúa palabra contra
  palabra con `MAX(similarity(f.word, sw.word))` y el score final es un `GREATEST(...)`. Basta que
  **una sola palabra** del nombre coincida exacta con **una sola palabra** de la búsqueda para que
  el producto puntúe **1.000**. El filtro es `length(word) >= 2`, así que la preposición **`"de"`**
  entra: todo producto que contenga "de" empata a 1.000 con toda búsqueda que contenga "de". Luego
  `ORDER BY similitud DESC LIMIT 5` corta **arbitrariamente** entre los empatados.
- **Por qué es Alta:** el prompt del Agente Menú usa la similitud como criterio de confianza
  (*"≥0.5 → proceder sin confirmar; 0.2-0.5 → confirmar «¿Te refieres a…?»"*). Con todo empatado en
  1.000 **el bot nunca entra en la banda de confirmación**: agrega al carrito, con plena confianza,
  un producto que el cliente no pidió. La regla `PROHIBIDO elegir un producto distinto al que pidió
  el cliente` se rompe **desde la herramienta**, no desde el modelo (patrón de edge-case §27).
- **Fix propuesto (simulado y medido, no teórico):**
  1. Excluir stopwords (`de la el en con y al los las un una del sin por para mi su a`) del match
     palabra-a-palabra, **a ambos lados**.
  2. Desempatar en el `ORDER BY`: coincidencia exacta del nombre normalizado → containment →
     similitud → nombre más corto.

  **Medición:** producto hallado en top-5 por su nombre exacto pasa de **107/133 (80%) a 133/133
  (100%)**; queda primero en 105/133, y **los 28 que no quedan primeros son exactamente los nombres
  duplicados por variante** (Tradicional/Estofada), donde "primero" no está definido.
- ⚠️ **Trampa al implementarlo:** la simulación **descartó la CAPA D** (diccionario de correcciones)
  y por eso `chelita` dejó de devolver cervezas. El fix real **debe conservar `termino_corregido`** y
  aplicar el filtro de stopwords sobre las dos variantes del término. El test `02-menu.sql · T4`
  existe para atrapar esa regresión.
- **Cabo suelto que el fix NO resuelve:** `una limonada de mango` sigue sin devolver *Limonada Mango
  Biche*. Es vocabulario, no ranking: entrada en el diccionario o en `descripcion`.

---

### BUG-040 · 🟡 Media · 🔴 Abierto — un typo de transposición deja a un cliente de Bello fuera de cobertura

- **Componente:** BD → `consultar_cobertura()`, bloque `sugerencias` (umbral `similarity >= 0.40`).
- **Síntoma (batería `qa/sql/01-cobertura.sql`, 2026-09-09):** barrido de 59 barrios × 4 clases de
  typo = **236 casos**; **25 devuelven `cubierto:false` Y cero sugerencias** — el bot le dice *"solo
  repartimos en Bello"* a alguien que **vive en Bello**, sin ofrecerle una corrección.

  | Clase de typo | Fallos / 59 | Ejemplos |
  |---|---|---|
  | **transponer 2 letras seguidas** | **21 (36%)** | `pardo`→Prado · `cnetro`→Centro · `zmaora`→Zamora · `saurez`→Suárez · `nqiuia`→Niquía |
  | borrar una letra (nombres ≤5) | 4 | `prdo`→Prado · `peez`→Pérez · `pais`→París |
  | duplicar letra · quitar la última | 0 | robustos |

- **Causa:** trigram se hunde con las transposiciones (similitud 0.20–0.385 contra el umbral 0.40).
  **No es un umbral mal elegido**: el comentario del código explica que 0.40 es deliberadamente alto
  para que `sabaneta` no sugiera `Sabanalarga`. Bajarlo rompería ese diseño.
- **Fix propuesto (validado):** añadir una **segunda pasada por anagrama** cuando trigram no devuelve
  nada — transponer dos letras conserva exactamente el multiconjunto de caracteres, así que basta
  comparar las letras ordenadas de la clave normalizada.

  **Medición:** resuelve **21/21** transposiciones, cada una a **un solo** barrio, con **0 falsos
  positivos** en los controles negativos `sabaneta`, `sabanalarga`, `envigado`, `itagui`, `medellin`,
  `bogota`, `copacabana`. El umbral 0.40 se queda como está.
- **Sin resolver:** las 4 deleciones en nombres de ≤5 letras. Necesitarían distancia de edición —
  `fuzzystrmatch` está **disponible pero no instalada** en el proyecto.

---

### BUG-048 · 🟡 Media · 🔴 Abierto — `editar_pedido` acepta cantidad y precio negativos y deja el pedido con total negativo

- **Componente:** BD → `editar_pedido()` y la tabla `detalle_pedidos` · llamado desde
  `src/pages/dashboard/EditOrderModal.jsx:81`.
- **Síntoma (medido con `qa/sql/09-basura.sql · T8b`, 2026-09-12):** con el pedido de prueba
  (envío 5.000, un ítem de 30.000):

  | Lo que se manda | Lo que devuelve | Total que queda |
  |---|---|---|
  | `cantidad: -3`, `precio_unitario: 10000` | `success: true` | **−25.000** |
  | `cantidad: 1`, `precio_unitario: -10000` | `success: true` | **−5.000** |
  | `cantidad: 0` | `success: true` | 5.000 (sólo el envío) |

- **Causa:** `detalle_pedidos` **no tiene ningún CHECK**: ni `cantidad > 0` ni
  `precio_unitario >= 0`. `editar_pedido` tampoco los valida — hace
  `(v_item->>'cantidad')::INT * (v_item->>'precio_unitario')::NUMERIC` y escribe el resultado.
  Y `pedidos` sólo protege `costo_domicilio >= 0`; **`total` no tiene CHECK**, así que el número
  negativo se persiste sin que nada chille.
- **Por qué importa aunque la UI no lo permita:** el único guardarraíl hoy es
  `Math.max(1, item.cantidad + delta)` en `EditOrderModal.jsx:41` y el `disabled` del botón −.
  Eso es React, y por la **regla #1 de `CLAUDE.md`** React no es la frontera de seguridad: el RPC
  es `SECURITY DEFINER` y cualquier admin o mesero autenticado lo alcanza por REST con un cuerpo
  a mano. Un solo pedido con total negativo desvía los ingresos de la pestaña Estadísticas, que
  suma `pedidos.total` directamente.
- **Fix propuesto (dos capas, la de BD primero):**
  1. `ALTER TABLE detalle_pedidos ADD CONSTRAINT detalle_cantidad_chk CHECK (cantidad > 0)` y
     `… precio_unitario >= 0`. Verificar antes que las 214 filas vivas los cumplen (lo hacen:
     `detalles_invalidos = 0` en T11).
  2. En `editar_pedido`, devolver `{success:false, error:'ITEM_INVALIDO'}` en vez de dejar que
     reviente el CHECK — el resto de la función ya usa ese contrato.
- **Regresión:** añadir los tres casos de T8b a `qa/sql/09-basura.sql`; el contador
  `pedidos_total_negativo` de T11 es la red permanente.

---

### BUG-045 · 🟡 Media · 🔴 Abierto — el comodín `LIKE` del cliente nunca se escapa: término vacío o `%` devuelve el menú entero

- **Componente:** BD → `buscar_menu()` (a), `buscar_menu_categoria()` (b), `historial_resumen()` (c).
- **Síntoma (medido con `qa/sql/09-basura.sql · T2/T3/T10`, 2026-09-12):**

  | Función | Entrada | Devuelve | Debería |
  |---|---|---|---|
  | `buscar_menu` | `''`, `'   '`, `'%'`, `'_'`, `'%_%'` | **5 productos con similitud 0.850** | 0 filas |
  | `buscar_menu_categoria` | `''`, `'   '`, `'%'`, `'_'`, `null` | **130** (el menú disponible entero) | 0 filas |
  | `historial_resumen` | `p_search='%'` o `'_'`, `p_search_digits='%'` | **116** (todos los pedidos) | 0 |

- **Causa (leída de la definición viva):** las tres construyen el patrón concatenando el texto del
  usuario sin escapar — `ILIKE '%' || termino || '%'`. Con el término vacío el patrón queda `'%%'`
  y **todo** encaja; con `%` o `_` el cliente inyecta un comodín en el patrón. Raíz común:
  `normalizar_texto(null)` devuelve **`''`, no `NULL`**, así que el guardarraíl obvio ("si es null,
  no filtres") nunca se activa.
- **Por qué (a) es el caso caro y no un detalle cosmético:** el prompt del Agente Menú usa la
  similitud como criterio de confianza — *"≥0.5 → proceder sin confirmar"*. **0.850 está muy por
  encima**, así que ante un término vacío el bot no pregunta: agrega al carrito el producto que le
  tocó en el `LIMIT 5` (medido: *Limonada Tamarindo*, *Jugo Natural en Agua*…). Es el mismo daño
  que **BUG-039** por otra puerta: allí empatan a 1.000 los productos que comparten una palabra,
  aquí empata a 0.850 el menú completo. **Un fix de BUG-039 que no toque la CAPA A no cierra este.**
- **Fix propuesto:** cortocircuitar antes de consultar —
  `IF coalesce(nullif(btrim(termino_norm),''),'') = '' THEN RETURN; END IF;` — y escapar el
  comodín en las tres: `replace(replace(t,'%','\%'),'_','\_')` con `ILIKE … ESCAPE '\'`.
- **(c) no es una fuga:** `historial_resumen` **no** es `SECURITY DEFINER`, así que RLS sigue
  filtrando las filas; lo único que miente es el contador del Historial cuando alguien teclea `%`.

---

### BUG-049 · 🟢 Baja · 🔴 Abierto — `reservas` acepta fechas pasadas y horas con el local cerrado

- **Componente:** BD → tabla `reservas` (faltan CHECK) · escrito directo por el modal de reservas
  del dashboard.
- **Síntoma (medido con `qa/sql/09-basura.sql · T9`, 2026-09-12):** se aceptan sin rechistar una
  reserva con `fecha = 2020-01-01` (cuatro años en el pasado), otra a las **04:00** y otra a las
  **23:59**. Los CHECK que sí existen (`personas` 1-12, `origen`, `estado`) muerden correctamente.
- **Causa:** la única validación de horario del sistema (12:00-21:00, máx 14 días, mín 5h de
  anticipación) vive en el subworkflow n8n `OTQp2O8QDw1mMKOZ`, o sea **sólo protege el camino del
  bot**. El dashboard hace `insert into reservas` directo y no pasa por ahí.
- **Relación con BUG-044:** son el mismo hueco por los dos lados — allí el modal ofrece valores que
  la BD rechaza; aquí la BD acepta valores que el negocio rechaza. Conviene arreglarlos juntos.
- **Fix propuesto:** bajar la regla a la capa que comparten las tres — un CHECK de rango horario en
  `reservas` y un trigger que rechace `fecha` anterior a hoy. Ojo antes: la ventana correcta
  **no es 12:00-21:00** sino la que diga `info_negocio` (hoy el local cierra a 22:00/23:00, ver la
  incoherencia abierta en la Fase 0 de `qa/RESULTADOS.md`); decidirla es prerrequisito del fix.

---

### BUG-046 · 🟢 Baja · 🔴 Abierto — un `limite` negativo revienta `buscar_menu` y `registrar_contexto_handoff`

- **Componente:** BD → `buscar_menu()`, `registrar_contexto_handoff()`.
- **Síntoma (medido, 2026-09-12):** `buscar_menu('pizza', 0.2, -5, true)` y
  `registrar_contexto_handoff(tel, -5)` lanzan **2201W · "LIMIT must not be negative"**. El agente
  recibe un error de Postgres, no algo que pueda contarle al cliente.
- **Causa:** el parámetro se pasa crudo al `LIMIT`. `consultar_faq` hace exactamente lo que estas
  dos no: `limit greatest(1, least(p_limite, 40))`.
- **Fix propuesto:** copiar ese `greatest(1, least(...))`. Probabilidad baja (requiere que el LLM
  invente un límite negativo), coste del fix ~1 línea por función.

---

### BUG-047 · 🟢 Baja · 🔴 Abierto — las RPC del bot rompen su propio contrato de error ante un dominio inválido

- **Componente:** BD → `guardar_datos_pedido()`, `editar_pedido()`.
- **Síntoma (medido, 2026-09-12):** estas funciones prometen `{ok:false, error:'CODIGO'}` y lo
  cumplen para los casos previstos (`TELEFONO_REQUERIDO`, `SIN_ITEMS`, `PEDIDO_NO_ENCONTRADO`),
  pero **escapan como excepción cruda** cuando el valor está fuera de dominio:

  | Llamada | Devuelve |
  |---|---|
  | `guardar_datos_pedido(tel, p_tipo_pedido:='pizza')` | 💥 23514 `carritos_tipo_pedido_chk` |
  | `guardar_datos_pedido(tel, p_metodo_pago:='nequi')` | 💥 23514 `carritos_metodo_pago_chk` |
  | `editar_pedido(id, '{}'::jsonb)` | 💥 22023 *cannot get array length of a non-array* |
  | `editar_pedido(id, '[{… sin cantidad}]')` | 💥 23502 |

- **Por qué es baja pero no cero:** `'nequi'` no es basura teórica, es lo que dice medio Medellín.
  Hoy el agente no recibe "ese método de pago no existe" sino un SQLSTATE, así que no puede
  reconducir la conversación. El **dato no se corrompe** (el CHECK hace su trabajo) — lo que falla
  es lo que el bot puede decir después.
- **Fix propuesto:** validar el dominio al entrar y devolver `{ok:false, error:'METODO_PAGO_INVALIDO'}`
  / `'TIPO_PEDIDO_INVALIDO'` / `'ITEMS_INVALIDOS'`, dejando el CHECK como última red.

---

### BUG-043 · 🟡 Media · 🔴 Abierto — se puede sobrevender el salón: el control de cupo solo corre en INSERT

- **Componente:** BD → `trigger_validar_cupo` sobre `reservas`.
- **Síntoma (batería `qa/sql/06-reservas.sql` T4, 2026-09-09):** con las 8 mesas ya ocupadas a una
  hora, **cualquier UPDATE mete una novena reserva confirmada**. Medido por dos vías:
  - **a) Reactivar una cancelada:** cancelar una reserva libera el cupo, entra otra persona, y al
    volver a poner la primera en `confirmada` quedan **9 confirmadas a las 19:00**.
  - **b) Mover una reserva a una franja llena:** un admin cambia la hora de una reserva de las
    13:00 a las 19:00 (llena) desde el modal del dashboard → **9 confirmadas**.
- **Causa:** el trigger está declarado `BEFORE INSERT` únicamente:

  ```sql
  CREATE TRIGGER trigger_validar_cupo BEFORE INSERT ON public.reservas
    FOR EACH ROW EXECUTE FUNCTION validar_cupo_reserva()
  ```

  La función en sí ya está escrita para soportar UPDATE — excluye la fila propia con
  `reserva_id != NEW.reserva_id` y sale temprano si `estado != 'confirmada'`. **Solo falta
  declararla también en UPDATE.**
- **Por qué importa al cliente final:** dos grupos llegan a la misma mesa a la misma hora y hay que
  decirle a uno que se vaya. Y `consultar_disponibilidad` (el subworkflow que consulta el bot)
  cuenta reservas confirmadas, así que el bot seguirá ofreciendo una franja que ya está sobrevendida.
- **Fix propuesto:** `CREATE TRIGGER … BEFORE INSERT OR UPDATE OF fecha, hora, estado ON reservas`.
  Acotar a esas tres columnas evita revalidar en cada cambio de notas o de nombre.
  ⚠️ Antes de aplicarlo hay que comprobar que no haya reservas ya sobrevendidas, porque el primer
  UPDATE que recibieran empezaría a fallar. **Comprobado el 2026-09-09: no hay ninguna** — cero
  franjas con más de 8 confirmadas solapadas, y las 16 reservas de la BD (15 confirmadas + 1
  cancelada) son todas del pasado (11-jun a 15-ago). **El fix se puede aplicar sin migración de
  datos.**

---

### BUG-044 · 🟢 Baja · 🔴 Abierto — el modal de reservas ofrece valores que la BD rechaza

- **Componente:** dashboard → `src/utils/constants.js:95-99` (`RESERVATION_STATES`) y
  `src/pages/reservations/ReservationModal.jsx:156,165`.
- **Síntoma:** dos desajustes entre lo que la UI permite elegir y lo que el CHECK de la BD acepta:
  1. **Estado `pendiente`.** `RESERVATION_STATES[0]` es `pendiente` y el `<select>` de la línea 165
     lo ofrece, pero `reservas_estado_check` solo acepta `confirmada`/`cancelada` — verificado: el
     INSERT revienta. El admin que elija "Pendiente" recibe un error crudo de Postgres.
  2. **`personas` hasta 30.** El input de la línea 156 tiene `max={30}`, pero
     `reservas_personas_check` es **1–12**. Escribir 20 pasa la validación del navegador y revienta
     en la BD.
- **Efecto secundario:** `ReservationDetail.jsx:11` usa `RESERVATION_STATES[0]` como *fallback*
  cuando no encuentra el estado, así que cualquier valor inesperado se pinta como "Pendiente" en
  ámbar — un estado que no existe. Y el filtro de `ReservationsPage.jsx:214` ofrece "Pendiente",
  que siempre devuelve vacío.
- **Fix propuesto:** quitar `pendiente` de `RESERVATION_STATES` (y usar `confirmada` como fallback
  en `ReservationDetail`), y bajar el `max` del input a 12. Ojo: el prompt del Agente Reservas ya
  dice que más de 12 personas se escalan a un humano, así que 12 es el número correcto en las tres
  capas.

---

### BUG-042 · 🟢 Baja · 🔴 Abierto — recotizar el domicilio con la misma tarifa se descarta y el bot vuelve a preguntar

- **Componente:** BD → trigger `trg_carritos_normalizar_estado` (`carritos_normalizar_estado()`),
  bloque de invalidación por cambio de barrio.
- **Síntoma (batería `qa/sql/04-flujo-pedido.sql` T4, 2026-09-09):** el cliente cambia de barrio
  dentro de la **misma zona** (p. ej. Centro → La Milagrosa, ambos $5.000). El Agente Pedidos
  recotiza correctamente y guarda `costo_domicilio = 5000, cobertura_ok = true`… y el trigger lo
  **descarta**: los dos campos quedan en NULL y `faltantes` vuelve a incluir `"cobertura"`.
- **Causa:** la heurística del trigger asume que recotizar **cambia el número**:

  ```sql
  if tg_op = 'UPDATE'
     and new.barrio is distinct from old.barrio
     and new.costo_domicilio is not distinct from old.costo_domicilio then
    new.costo_domicilio := null;  new.cobertura_ok := null;
  end if;
  ```

  El propio comentario lo dice: *"(Si la tarifa cambia en el MISMO update, es que ya se recotizó:
  se respeta.)"*. Pero **la tarifa es por zona, no por barrio**, así que moverse entre dos barrios
  de la misma zona recotiza bien y aun así se tira. **321 de 1711 pares de barrios (18,8%)
  comparten tarifa.**
- **Impacto real (medido):** se **autorrepara en el segundo guardado** — al recotizar otra vez el
  barrio ya no cambia, la condición no se cumple y el valor entra. Cuesta un turno extra y puede
  hacer que el bot anuncie el costo del domicilio dos veces, lo que al cliente le parece un
  tartamudeo. **No rompe el pedido.** Por eso 🟢 y no 🟡.
- **Fix propuesto:** distinguir "no recotizó" de "recotizó y dio lo mismo" con un dato explícito en
  vez de inferirlo del precio. Lo más barato: que el trigger no invalide cuando el UPDATE trae
  `cobertura_ok` explícito (es decir, cuando el agente sí llamó a `consultar_cobertura`), en lugar
  de comparar `costo_domicilio`.

---

### BUG-041 · 🟢 Baja · 🔴 Abierto — `buscar_menu_categoria` devuelve categorías vecinas

- **Componente:** BD → `buscar_menu_categoria()`.
- **Síntoma:** `pizza_premium` devuelve **36** productos cuando la categoría tiene **24** (se cuela
  `pizza_premium_especial`, 12 productos con **precios distintos**). `adicion` devuelve **14** cuando
  tiene **4**.
- **Riesgo:** el bot puede listar una premium-especial como si fuera premium y cantar el precio de la
  categoría equivocada — choca con la regla global *"precios siempre exactos desde la BD"*.
- **Misma línea de código que BUG-045b** (`ILIKE '%' || cat_norm || '%'`): aquí desborda a la
  categoría vecina, allí al menú entero cuando `cat_norm` queda vacío. Un solo fix cierra los dos.

---

### BUG-038 · 🟡 Media · 🔴 Abierto — el bot no le da al cliente su número de pedido

- **Componente:** n8n → `Sub — Crear_orden_completa` (`a94A2VKvFC0ugkD3`), nodo `Respuesta de salida`
- **Síntoma (visto en las pruebas del 2026-09-01):** al registrar el pedido, el cliente recibe
  *"🎉 ¡Pedido registrado! Tu número de pedido es #**no disponible en este momento**"* (PED-244).
  En otra corrida el agente simplemente **omitió** el número y escribió *"quedó agendado"*
  (PED-243). Dos improvisaciones distintas del mismo dato ausente. El pedido **sí se crea bien**:
  `PED-244` quedó completo y con el total correcto — lo único que falla es lo que se le dice al
  cliente. Sin número, el cliente no puede referirse a su pedido después ("¿cómo va el PED-244?").
- **Causa (verificada leyendo el subworkflow vivo):** el último nodo devuelve una respuesta
  **hardcodeada** que descarta lo que el nodo anterior ya había calculado:

  ```js
  // Respuesta de salida
  return [{ json: { ok: true, mensaje: "El pedido se creó correctamente" } }];
  ```

  Dos nodos antes, `Code in JavaScript` ya tiene `pedidoId` y `pedidoFinal` (la fila completa que
  devolvió el INSERT) y los pasa hacia adelante — y ahí se pierden. Mientras tanto el PASO 5 del
  prompt del Agente Pedidos pide `#[pedido_id]` y `$[total]`: **el prompt pide dos campos que la
  tool nunca devolvió.** Es un desajuste preexistente entre prompt y subworkflow, no de los
  cambios de BUG-035/036.
- **Fix propuesto:** que `Respuesta de salida` devuelva también el `pedido_id`:

  ```js
  const c = $('Code in JavaScript').first().json;
  return [{ json: { ok: true, pedido_id: c.pedidoId, mensaje: "El pedido se creó correctamente" } }];
  ```

  ⚠️ **Trampa al hacerlo — NO devuelvas `pedidoFinal.total`.** En ese punto del flujo ese total es
  **solo la suma de ítems, sin domicilio**: el trigger `trigger_actualizar_total` corre AFTER
  INSERT sobre `detalle_pedidos`, o sea **después** de que el INSERT de `pedidos` devolvió la fila.
  Devolverlo haría que el PASO 5 le cante al cliente un total menor al que va a pagar. Hoy el
  agente calcula el total él mismo (subtotal + domicilio) y en las pruebas dio exacto ($104.300,
  igual que `pedidos.total`), así que **el total no hay que tocarlo**: solo agregar `pedido_id`.
  Si algún día se quiere devolver el total real, hay que **releer el pedido** después del INSERT
  de detalles, no reusar la fila del primer INSERT.

---

### BUG-030 · 🟢 Baja · 🔴 Abierto — el n8n-mcp de la comunidad no puede escribir el workflow principal

> **Degradado de 🔴 Alta a 🟢 Baja el 2026-08-25.** El bug sigue existiendo tal cual está descrito,
> pero dejó de bloquear: el **MCP nativo de n8n** (`n8n-native`, `/mcp-server/http`) escribe por el
> SDK, no por la API pública v1, y no reenvía `settings`. Las 4 ediciones de BUG-033 se aplicaron
> por ahí sin tocar el editor. Lo que queda roto es la vía `n8n-mcp` (npx), que sí sigue rebotando.

- **Componente:** n8n → workflow `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`)
- **Síntoma:** **cualquier** `PUT` sobre el workflow falla con
  `Invalid request: request/body/settings must NOT have additional properties`. No es específico
  de un cambio: verificado con un `moveNode` que reposiciona un sticky note a su propia posición,
  y con tres `updateSettings` distintos. El workflow **no se modifica** (el error es de
  validación, previo a la escritura).
- **Causa (identificada 2026-08-18 con el export del workflow):** `settings` contiene claves que
  el editor de n8n escribe pero que el esquema de la API pública v1 **no** acepta. Estado real:

  ```json
  "settings": {
    "executionOrder": "v1",              // ✔ legal
    "timezone": "America/Bogota",        // ✔ legal
    "availableInMCP": false,             // ✔ la tiene el subworkflow, que sí guarda
    "binaryMode": "separate",            // ✘ fuera del esquema
    "timeSavedMode": "fixed",            // ✘ fuera del esquema
    "callerPolicy": "workflowsFromSameOwner"  // ✘ fuera del esquema
  }
  ```

  El esquema solo admite `executionOrder`, `errorWorkflow`, `timezone`, `executionTimeout`,
  `saveExecutionProgress`, `saveManualExecutions`, `saveDataErrorExecution`,
  `saveDataSuccessExecution`. El `PUT` reenvía `settings` tal cual está guardado, así que
  **cualquier** escritura rebota antes de tocar nada.
- **Por qué no se puede arreglar por MCP (las 4 vías, todas descartadas con evidencia):**
  1. `updateSettings` hace **merge**, no reemplazo — verificado mandando solo
     `{executionOrder:"v1"}`: siguió fallando, o sea las claves viejas seguían viajando.
  2. Pasar `null` **no elimina** la clave — verificado con las tres a la vez.
  3. `n8n_update_full_workflow` con `settings` explícito **también mergea** — verificado
     2026-08-18. (Efecto colateral útil: se comprobó que **no** manda `nodes: []` cuando se
     omiten; el workflow quedó intacto en 101 nodos y ni siquiera cambió `updatedAt`.)
  4. Guardar desde la UI tampoco sirve: esas tres claves las **escribe el editor**, así que
     vuelven a aparecer. Verificado — tras un guardado manual el error se repitió idéntico.
- **Impacto (actualizado 2026-08-19):** las zonas de domicilio **ya no están bloqueadas** — se
  aplicaron a mano en el editor y el bot cobra por barrio (ver changelog 2026-08-18). Lo que queda
  es el impacto estructural: **todo cambio futuro sobre `Pizzeria Vera` hay que hacerlo a mano**,
  con el costo que eso tiene (en la aplicación manual de las zonas se coló un error —
  `$[total + costo_domicilio]` en el PASO 5, que cobraba el domicilio dos veces— que solo se
  detectó al releer el workflow por MCP; por API el diff habría sido evidente).
- **Workaround vigente (2026-08-25):** escribir con **`n8n-native`** (`update_workflow` +
  `publish_workflow`), que no toca la API pública v1. Antes de eso los cambios se aplicaban a
  mano en el editor. La lectura por `n8n_get_workflow` (mode `filtered`) **sí** funciona en
  ambas vías y sigue siendo la forma de verificar. De fondo, la vía `n8n-mcp` se destraba solo
  con una de estas dos, ninguna urgente:
  1. Actualizar el n8n-mcp a una versión que **filtre** `settings` a las 8 claves del esquema
     antes del `PUT` — es lo correcto: el problema es del cliente, no del workflow.
     **Comprobado el 2026-08-19: n8n-mcp está en 2.73.0, que es la última publicada, y sigue sin
     filtrar.** Hay que esperar una versión nueva; no tiene sentido reintentar hasta entonces.
  2. Actualizar n8n a una versión cuyo esquema de API pública ya incluya `binaryMode`,
     `timeSavedMode` y `callerPolicy`. (La instancia dejó de reportar su versión a la API desde
     n8n 1.119.0, así que hay que mirarla desde la UI.)
- **Alcance (corregido 2026-08-25):** afecta a la vía `n8n-mcp` (npx) sobre `Pizzeria Vera`, no a
  todo cambio futuro, como decía este entry antes. Con `n8n-native` configurado las escrituras
  van por ahí; esto queda como registro de por qué `n8n_update_partial_workflow` sigue fallando
  si alguien lo intenta.
- **Recomprobado 2026-08-21** trabajando BUG-032: un `patchNodeField` de un solo header sobre
  `crear_carrito` rebotó con el mismo `request/body/settings must NOT have additional properties`.
  Sigue vigente; los dos cambios de BUG-032 van a mano.

### BUG-034 · 🟢 Baja · 🔴 Abierto — 5 nodos `OpenAI Chat Model` con un parámetro fuera de esquema

- **Componente:** n8n → `Pizzeria Vera`, nodos `OpenAI Chat Model` … `OpenAI Chat Model4`
- **Síntoma:** cada escritura por `n8n-native` devuelve la misma advertencia para los cinco:
  `Field "parameters.builtInTools": This field is only allowed when: /responsesApiEnabled=true`.
- **Detectado:** 2026-08-25, aplicando BUG-033. Son advertencias de validación, **no** errores:
  la escritura se guarda igual y el bot funciona. Preexistente — no lo introdujeron esos cambios.
- **Causa probable:** los nodos conservan `builtInTools` de cuando se probó la Responses API;
  con `responsesApiEnabled` en false el campo queda huérfano y el validador lo marca.
- **Riesgo:** hoy ninguno visible. Importa si una versión futura de n8n endurece la validación y
  pasa de advertencia a error, o si alguien enciende `responsesApiEnabled` sin mirar qué tools
  quedaron ahí dentro.
- **Fix propuesto:** abrir uno de los cinco nodos, confirmar que `builtInTools` está vacío o es
  irrelevante, y quitarlo con `update_workflow` (`setNodeParameter`). Verificar que la
  advertencia desaparece en la siguiente escritura.

### BUG-031 · 🟡 Media · 🔴 Abierto — 8 pedidos con total escrito a mano y cero líneas de detalle

- **Componente:** BD → `pedidos` / `detalle_pedidos`
- **Síntoma:** 8 pedidos tienen `total` > 0 y **ninguna fila** en `detalle_pedidos`:
  `PED-096` ($216.200), `PED-097` ($3.365.000), `PED-098` ($29.000), `PED-099` ($332.300),
  `PED-100` ($115.400), `PED-109` ($77.000), `PED-111` ($115.500), `PED-113` ($33.300).
  Seis están `entregado`, dos `cancelado`. Fechas entre 2026-05-17 y 2026-07-01.
- **Causa:** sin confirmar. Encajan con datos sembrados a mano o pruebas tempranas; el de
  $3.365.000 es claramente ficticio. No los pudo producir el flujo normal, que inserta las líneas
  y deja que el trigger calcule el total.
- **Impacto:** ensucian las estadísticas de ingresos (`historial_resumen` suma `total` de los no
  cancelados, así que los ~$3.7M entran en el reporte) y el detalle del pedido se ve vacío en el
  dashboard. **No bloquean nada:** el trigger de tarifa por barrio se diseñó por delta justamente
  para no aplanarlos (ver edge-cases §23).
- **Fix propuesto:** decidir con el negocio si se borran o se marcan. **No tocarlos sin
  confirmar** — dos de ellos son del mismo rango de fechas que los datos de prueba de roles que ya
  se acordó dejar vivos.

### BUG-029 · 🟢 Baja · 🔴 Abierto — el bot no puede guardar notas en una reserva

- **Componente:** bot → n8n `Sub — Crear Reserva`, nodo `Validar y verificar cupo`; nodo
  `crear_reserva` del workflow principal
- **Síntoma:** el Code node arma la fila con `notas: input.notas || null`, pero **`notas` nunca se
  declaró** como input del `executeWorkflowTrigger` y el nodo `crear_reserva` del main tampoco lo
  manda vía `$fromAI`. Resultado: `reservas.notas` entra **siempre `null`** en las reservas creadas
  por WhatsApp. Si el cliente dice "mesa cerca de la ventana", se pierde.
- **Verificado vía MCP (2026-08-10):** los `workflowInputs` del sub son `telefono`, `nombre`,
  `fecha`, `hora`, `personas`, `cliente_id` y `motivo` — no hay `notas`. El campo del INSERT existe
  y apunta al Code node, así que el cableado se corta un paso antes.
- **Contraste:** las reservas creadas desde el **dashboard** sí guardan notas (`ReservationModal`
  tiene el campo y `useReservations` lo inserta). Solo falla el camino del bot.
- **Fix propuesto:** declarar `notas` como input del sub, agregar
  `notas: {{ $fromAI('notas', '...') }}` al nodo `crear_reserva` del main y una línea en el prompt
  del Agente Reservas para que capture peticiones especiales. No se hizo junto con `motivo`
  (2026-08-10) porque amplía la firma de la tool y el flujo conversacional: es una feature aparte,
  no parte de los motivos.

---

### BUG-027 · 🟢 Baja · 🔴 Abierto — mensajes de feedback muestran `\n` literal al cliente

- **Componente:** bot → n8n `Sub — Feedback Pendiente`, nodos WhatsApp `Invitar reseña Google`,
  `Pedir comentario`, `Agradecer feedback`, `Pedir nota de nuevo`
- **Síntoma (esperado, sin confirmar con tráfico real):** los cuatro `textBody` guardan los
  saltos de línea **escapados** (`\n` como backslash + n) dentro de un campo de expresión `=`.
  n8n solo evalúa `{{ }}`; el resto es texto literal, así que el cliente vería
  `¡Qué bueno que te gustó! 🍕🔥\n\nNos ayudarías...` en una sola línea con los `\n` a la vista.
  Afecta al mensaje que lleva el **link de reseña de Google**, que queda embebido en ese texto.
- **Contraste:** los nodos WhatsApp del workflow principal (`Comprobante recibido`,
  `Pedido no encontrado`, `en_cocina`…) sí usan saltos de línea reales. Es una desviación
  aislada de este subworkflow, probablemente por pegar el texto desde código.
- **Verificación pendiente:** `n8n_executions` de `Sub — Feedback Pendiente` devuelve **0
  ejecuciones**, así que el camino nunca se ejerció. Confirmar con un feedback real (o una
  ejecución manual) antes de dar por bueno el diagnóstico.
- **Fix propuesto:** reemplazar los `\n` escapados por saltos de línea reales en los cuatro
  nodos. El link de Google en sí **es correcto** (Google Maps real de La Vera Pizzería).

## En observación

Fixes ya aplicados cuya verificación final depende de tráfico real.

> **Campaña de pruebas 2026-09-09** — la Capa A (SQL determinista, `qa/sql/`) cerró las
> verificaciones que no necesitaban una conversación real. Lo que sigue aquí es lo que **solo** se
> puede comprobar hablando con el bot por WhatsApp. Resultados en `qa/RESULTADOS.md`.

- **BUG-033** — cobertura fuera de Bello. ✅ **Capa SQL verificada** (`qa/sql/01-cobertura.sql`):
  los 59 barrios resuelven con tarifa y tiempo, 295 variantes de escritura son consistentes, y los
  10 municipios de fuera devuelven `cubierto:false` con costo y tiempo en NULL. Falta **solo** la
  prueba por WhatsApp, que es la única que ejercita al modelo — y sigue siendo necesaria porque la
  RPC ya devolvía bien el dato cuando el prompt mentía (edge-case §27):
  «¿Tienen servicio en Envigado?» y «¿Llegan a Sabaneta?» → debe decir que no llegan y ofrecer
  recoger, **sin precio ni tiempo**; «¿Llegan a Niquía?» → $7.500, 30 a 45 min; «estoy en niqia»
  → debe preguntar «¿te refieres a Niquía?»; «¿cuánto el domicilio al centro?» → $5.000; y un
  pedido a domicilio diciendo «estoy en Itagüí» **no** puede terminar creado como domicilio.
- **BUG-032** — carrito idempotente. Las tres capas están aplicadas y verificadas por MCP (upsert
  en `crear_carrito`, regla nueva en el Agente Menú, trigger `trg_carritos_touch_updated_at`), pero
  el camino completo solo se prueba con una conversación real: **dejar un carrito con items sin
  convertirlo en pedido y, desde ese mismo teléfono, pedir otra cosa**. El producto debe entrar y el
  carrito quedar con los items nuevos (`select * from carritos where telefono = '...'`). Confirmar
  también que si la escritura falla el bot **no** muestra el 🛒 — antes lo cantaba igual.
- **BUG-025** — tras desplegar, confirmar en una noche real (19:00–24:00 Colombia) que el
  kanban muestra los pedidos que entran (antes se vaciaba en esa franja).
- **BUG-023/024** — tras desplegar el build con `realtime.setAuth`, confirmar que el badge
  de soporte y el panel siguen actualizándose en vivo (las políticas `public` de
  `mensajes_soporte` ya no existen; todo el realtime va autenticado).

- **BUG-005/009** — probar una cancelación de reserva real por WhatsApp: camino feliz
  y un intento con reserva ajena (debe responder "esta reserva no es tuya").
- **pinData viejo (cosmético)** — `Sub — Crear Reserva` y `Sub — Cancelar Reserva` conservan
  pins con las keys viejas (`cliente_id `/`telefono ` con espacio), y `Sub — Consultar_menu`
  los query params del `ilike`. Solo afecta pruebas manuales en el editor — re-pinnear al abrirlos.
