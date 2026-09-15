-- ============================================================================
-- QA · 09 · Entrada basura y adversarial
-- Oráculo: no hay uno. Esta batería no comprueba que las RPC acierten, sino que
-- **no se rompan ni escriban porquería** cuando les llega algo que nadie diseñó.
-- Estado 2026-09-12: 71 casos · 64 verde · 7 rojo (BUG-045, BUG-046, BUG-047).
-- Estado 2026-09-15: corregidos BUG-045/046/047/048. Sigue rojo solo BUG-049 (T9,
--   reservas en el pasado / con el local cerrado: espera la decisión de horario).
--   Lo que cambia al leer los resultados de abajo:
--     T1  buscar_menu_categoria(null,null) → 0 (antes 130)
--     T2  '', '   ', '%_%' → 0 en menu y categoria (antes 5 / 130)
--     T3  sin filas (antes 5 productos a 0.850)
--     T4  limite -5 → 1 fila en buscar_menu y 0 en handoff, sin 2201W
--     T5  'pizza' / 'bitcoin' / 'nequi' → {ok:false, TIPO_PEDIDO_INVALIDO | METODO_PAGO_INVALIDO};
--         envío -5000 / NaN → COSTO_DOMICILIO_INVALIDO (1e30 sigue entrando: sin tope)
--     T6  PASO_FLUJO_INVALIDO en vez de 23514
--     T8a ITEMS_INVALIDOS / ITEM_INVALIDO en vez de 22023 / 23502 / 22P02 / 22003 / 23503 / 23505
--     T8b cantidad 0 / -3 y precio -10000 → success:false y el total se queda en 35000.00
--     T10a `digitos_comodin` (p_search NULL + p_search_digits '%') no filtra NADA por diseño:
--         sin término de búsqueda no hay filtro. El caso que prueba el escape es
--         p_search='x', p_search_digits='%' → 0.
--
-- Las otras ocho baterías prueban cada función contra SU contrato. Esta las cruza
-- todas contra las mismas 15 clases de basura, porque el que llama a estas
-- funciones no es un cliente de API: es un LLM, y un LLM manda '' con la misma
-- facilidad que null, manda `limite: -5` si el prompt dice "pocos", y repite el
-- literal del cliente aunque el cliente haya escrito `' OR 1=1 --`.
--
-- LOS TRES INVARIANTES:
--   I1 · Nada revienta sin control. Una tool que lanza excepción deja al cliente
--        sin respuesta en WhatsApp. La respuesta correcta a la basura es
--        {ok:false,error:'CODIGO'} o un resultado vacío — nunca un SQLSTATE.
--   I2 · Nada corrupto se persiste. Si la basura logra escribir, la fila que
--        queda tiene que seguir cumpliendo los invariantes del schema.
--   I3 · Ninguna inyección se ejecuta. Se comprueba contando tablas y filas al
--        final (T11), no confiando en que "no pasó nada raro".
--
-- ⚠️ LA TRAMPA DE ESTA BATERÍA (falso verde que mordió el 2026-09-12):
--    `historial_resumen(null, null, ...)` devuelve total=0, y yo lo leí como
--    "fail-closed, verde". No lo era: el WHERE es `fecha_pedido >= p_from AND
--    fecha_pedido < p_to`, así que con p_from NULL **toda** la cláusula es NULL
--    y no hay filas — el 0 no venía del filtro de búsqueda, venía del rango. Con
--    el rango puesto, el mismo caso devuelve 116 (BUG-045c).
--    Corolario: en una batería de basura, **el cero es el resultado más
--    sospechoso que hay**. Antes de cantar verde sobre un 0, haz pasar el control
--    positivo (T10a) por el mismo camino.
--
-- ⚠️ SEGUNDA TRAMPA: `detalle_pedidos.producto_id` tiene FK contra `menu`, así
--    que un producto_id inventado revienta con 23503 **antes** de llegar a la
--    validación de cantidad/precio. Los casos de cantidad negativa hay que
--    correrlos con un producto_id REAL o el FK te esconde el hallazgo (me pasó:
--    tres casos parecían "rechazados" y en realidad nunca se probaron).
--
-- Teléfonos: 5730000009xx (el rango 5730000000xx son los clientes semilla).
-- Todo lo que escribe va dentro de BEGIN … ROLLBACK.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- T1 · NULL en todos los argumentos de todas las RPC. Verde: 14/14, ninguna
--      revienta. Medido 2026-09-12:
--        consultar_cobertura(null)        -> modo:'listado' (las 5 zonas)
--        normalizar_texto(null)           -> ''  (OJO: cadena vacía, NO null;
--                                            es la raíz de BUG-045)
--        normalizar_barrio(null)          -> NULL
--        resolver_barrio(null)            -> 0 filas
--        buscar_menu(null,null,null,null) -> 0 filas
--        buscar_menu_categoria(null,null) -> 130 filas  ← el menú entero (BUG-045b)
--        consultar_faq(null,null)         -> 1 fila
--        cotizar_mitad_y_mitad(n,n,n)     -> {ok:false, FALTAN_PRODUCTOS}
--        guardar_datos_pedido(null)       -> {ok:false, TELEFONO_REQUERIDO}
--        editar_pedido(null,null)         -> {success:false, PEDIDO_NO_ENCONTRADO}
--        registrar_contexto_handoff(n,n)  -> 0
--        marcar_entregado(null)           -> 42501 'Sesión no válida' (por diseño:
--                                            exige sesión; no es un fallo de basura)
--        historial_resumen(todo null)     -> {total:0,...}  ← ver LA TRAMPA
--        resumen_entregas(null,null,null) -> 0
-- ---------------------------------------------------------------------------
create or replace function pg_temp.probe(sql text) returns text language plpgsql as $$
declare r text; begin execute sql into r; return coalesce(r,'<NULL>');
exception when others then return '💥 '||sqlstate||': '||left(sqlerrm,70); end $$;

-- helper para sentencias que NO devuelven fila (INSERT/UPDATE sin RETURNING):
-- `EXECUTE … INTO` lanza 42601 con ellas y te fabrica un falso rojo.
create or replace function pg_temp.run(sql text) returns text language plpgsql as $$
begin execute sql; return 'ACEPTADO';
exception when others then return '💥 '||sqlstate||': '||left(sqlerrm,55); end $$;

select 'consultar_cobertura(null)' as caso, pg_temp.probe($$select left(consultar_cobertura(null)::text,30)$$) as res
union all select 'normalizar_texto(null)',          pg_temp.probe($$select normalizar_texto(null)$$)
union all select 'normalizar_barrio(null)',         pg_temp.probe($$select normalizar_barrio(null)$$)
union all select 'resolver_barrio(null)',           pg_temp.probe($$select count(*)::text from resolver_barrio(null)$$)
union all select 'buscar_menu(null x4)',            pg_temp.probe($$select count(*)::text from buscar_menu(null,null,null,null)$$)
union all select 'buscar_menu_categoria(null,null)',pg_temp.probe($$select count(*)::text from buscar_menu_categoria(null,null)$$)
union all select 'consultar_faq(null,null)',        pg_temp.probe($$select count(*)::text from consultar_faq(null,null)$$)
union all select 'cotizar_mitad_y_mitad(null x3)',  pg_temp.probe($$select cotizar_mitad_y_mitad(null,null,null)->>'error'$$)
union all select 'guardar_datos_pedido(null)',      pg_temp.probe($$select guardar_datos_pedido(null)->>'error'$$)
union all select 'editar_pedido(null,null)',        pg_temp.probe($$select editar_pedido(null,null)->>'error'$$)
union all select 'registrar_contexto_handoff(n,n)', pg_temp.probe($$select registrar_contexto_handoff(null,null)::text$$)
union all select 'marcar_entregado(null)',          pg_temp.probe($$select (marcar_entregado(null)).pedido_id$$)
union all select 'historial_resumen(todo null)',    pg_temp.probe($$select historial_resumen(null,null,null,null,null,null,null)->>'total'$$)
union all select 'resumen_entregas(null x3)',       pg_temp.probe($$select (select entregas from resumen_entregas(null,null,null))::text$$);


-- ---------------------------------------------------------------------------
-- T2 · Las 15 clases de basura × las 6 RPC de lectura del bot. 90 casos.
--      Verde: ninguna revienta, ninguna inyección se ejecuta (confirmado en T11).
--      Rojo → BUG-045: `''`, `'   '`, `'%'`, `'_'` y `'%_%'` devuelven
--      130 productos en buscar_menu_categoria (el menú disponible entero).
--      El comodín LIKE del cliente **nunca se escapa**.
-- ---------------------------------------------------------------------------
with payloads(clase, p) as (values
  ('inyeccion-drop',   $x$'; drop table pedidos; --$x$),
  ('inyeccion-or11',   $x$' OR 1=1 --$x$),
  ('inyeccion-delete', $x$'); delete from clientes; select ('$x$),
  ('inyeccion-union',  $x$%' UNION SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL --$x$),
  ('emoji',            '🍕🔥👩‍👩‍👧‍👦'),
  ('zero-width',       E'pi​zza'),
  ('rtl-override',     E'‮pizza‬'),
  ('combinantes',      E'ṕízza'),
  ('solo-espacios',    '     '),
  ('vacio',            ''),
  ('10k-chars',        repeat('a',10000)),
  ('solo-simbolos',    '!@#$%^&*()[]{}<>'),
  ('comodin-like',     '%_%'),
  ('json-embebido',    '{"a":1}'),
  ('saltos-y-tabs',    E'pizza\nhawaiana\r\ntab\there')
)
select clase,
       pg_temp.probe(format($$select left(consultar_cobertura(%L)::text,25)$$, p))            as cobertura,
       pg_temp.probe(format($$select count(*)::text from buscar_menu(%L,0.2,5,true)$$, p))    as menu,
       pg_temp.probe(format($$select count(*)::text from buscar_menu_categoria(%L,true)$$, p))as categoria,
       pg_temp.probe(format($$select count(*)::text from consultar_faq(%L,40)$$, p))          as faq,
       pg_temp.probe(format($$select count(*)::text from resolver_barrio(%L)$$, p))           as barrio,
       pg_temp.probe(format($$select cotizar_mitad_y_mitad(%L,%L,'mediana')->>'error'$$,p,p)) as mitad
from payloads;


-- ---------------------------------------------------------------------------
-- T3 · BUG-045a, el caso caro: ¿con cuánta CONFIANZA devuelve basura el menú?
--      No basta con "devuelve 5 filas"; el prompt del Agente Menú usa la
--      similitud como criterio de confianza (≥0.5 → agregar sin confirmar).
--      Medido: término vacío / '   ' / '%' / '_' / '%_%' → 5 productos a **0.850**.
--      Es decir: el bot agrega una Limonada Tamarindo al carrito sin preguntar.
--      Causa: CAPA A hace `nombre ILIKE '%'||termino||'%'` → con término vacío
--      el patrón es '%%' y **todo** el menú puntúa 0.85; el LIMIT 5 corta al azar.
-- ---------------------------------------------------------------------------
select termino,
       count(*) as filas,
       round(max(similitud)::numeric,3) as confianza_max,
       string_agg(nombre, ' · ' order by nombre) as devuelve
from (values (''),('   '),('%'),('_'),('%_%')) v(termino),
     lateral buscar_menu(v.termino, 0.2, 5, true)
group by termino order by termino;


-- ---------------------------------------------------------------------------
-- T4 · Argumentos numéricos fuera de rango.
--      Verde: umbral -1 / 0 / 1 / 2 / NaN / ±Infinity / null → nunca revienta
--             (NaN e Infinity fallan cerrado: 0 filas).
--      Rojo → BUG-046: `limite` negativo revienta con 2201W "LIMIT must not be
--             negative" en buscar_menu y en registrar_contexto_handoff.
--             `consultar_faq` hace bien lo que las otras dos no:
--             `limit greatest(1, least(p_limite, 40))`. Ese es el patrón a copiar.
-- ---------------------------------------------------------------------------
select 'buscar_menu umbral='||u as caso,
       pg_temp.probe(format($$select count(*)::text from buscar_menu('pizza', %s, 5, true)$$, u)) as filas
from (values ('-1'),('0'),('0.5'),('1'),('2'),($$'NaN'$$),($$'Infinity'$$),($$'-Infinity'$$),('null')) v(u)
union all
select 'buscar_menu limite='||l,
       pg_temp.probe(format($$select count(*)::text from buscar_menu('pizza', 0.2, %s, true)$$, l))
from (values ('-5'),('0'),('1'),('2147483647'),('null')) v(l)
union all
select 'consultar_faq limite='||l,
       pg_temp.probe(format($$select count(*)::text from consultar_faq('parqueadero', %s)$$, l))
from (values ('-5'),('0'),('99999'),('null')) v(l)
union all
select 'registrar_contexto_handoff limite='||l,
       pg_temp.probe(format($$select registrar_contexto_handoff('573000000901', %s)::text$$, l))
from (values ('-5'),('0'),('2147483647')) v(l);


-- ---------------------------------------------------------------------------
-- T5 · `guardar_datos_pedido` con valores fuera del dominio.
--      Verde: la normalización aguanta ('DOMICILIO!!'→domicilio,
--             '  EFECTIVO '→Efectivo), el teléfono vacío devuelve
--             {ok:false,TELEFONO_REQUERIDO}, y notas de 10k y con emoji/saltos
--             se guardan íntegras.
--      Rojo → BUG-047a: un dominio inválido (tipo_pedido='pizza',
--             metodo_pago='bitcoin'/'nequi') sale como **excepción 23514 cruda**
--             en vez de {ok:false,error:'...'}. El agente recibe un error de
--             Postgres, no algo que pueda contarle al cliente.
--      Rojo → BUG-047b: `costo_domicilio` negativo y NaN se guardan tal cual en
--             `carritos` (la tabla no tiene el CHECK >=0 que sí tiene `pedidos`).
--             Ver T7 para el alcance real del daño.
--      Observación: paso_flujo='xyz' NO revienta aquí sólo porque el carrito está
--             vacío y el trigger lo fuerza a 'armando'. Con items sí revienta
--             (23514) — ver T6.
-- ---------------------------------------------------------------------------
begin;
select caso, pg_temp.probe(q) as respuesta from (values
 ('tipo_pedido=''pizza''',       $$select left(guardar_datos_pedido('573000000911', p_tipo_pedido:='pizza')::text,60)$$),
 ('tipo_pedido=''DOMICILIO!!''', $$select guardar_datos_pedido('573000000912', p_tipo_pedido:='DOMICILIO!!')->'estado'->>'tipo_pedido'$$),
 ('tipo_pedido=inyeccion',       $$select left(guardar_datos_pedido('573000000913', p_tipo_pedido:=$i$'; drop table carritos; --$i$)::text,60)$$),
 ('metodo_pago=''bitcoin''',     $$select left(guardar_datos_pedido('573000000914', p_metodo_pago:='bitcoin')::text,60)$$),
 ('metodo_pago=''nequi''',       $$select left(guardar_datos_pedido('573000000915', p_metodo_pago:='nequi')::text,60)$$),
 ('metodo_pago=''  EFECTIVO ''', $$select guardar_datos_pedido('573000000916', p_metodo_pago:='  EFECTIVO ')->'estado'->>'metodo_pago'$$),
 ('paso_flujo=''xyz'' (carrito vacío)', $$select left(guardar_datos_pedido('573000000917', p_paso_flujo:='xyz')::text,40)$$),
 ('costo_domicilio=-5000',       $$select guardar_datos_pedido('573000000918', p_tipo_pedido:='domicilio', p_costo_domicilio:=-5000)->'estado'->>'costo_domicilio'$$),
 ('costo_domicilio=1e30',        $$select guardar_datos_pedido('573000000919', p_tipo_pedido:='domicilio', p_costo_domicilio:=1e30)->'estado'->>'costo_domicilio'$$),
 ('costo_domicilio=''NaN''',     $$select guardar_datos_pedido('573000000920', p_tipo_pedido:='domicilio', p_costo_domicilio:='NaN')->'estado'->>'costo_domicilio'$$),
 ('telefono=''   ''',            $$select left(guardar_datos_pedido('   ')::text,45)$$),
 ('telefono=10k chars',          $$select left(guardar_datos_pedido(repeat('9',10000), p_notas:='x')::text,25)$$),
 ('telefono=inyeccion',          $$select left(guardar_datos_pedido($i$573000000921'; delete from carritos; --$i$, p_notas:='x')::text,25)$$),
 ('notas=10k chars',             $$select length(guardar_datos_pedido('573000000922', p_notas:=repeat('z',10000))->'estado'->>'notas')::text$$),
 ('notas=emoji+saltos',          $$select guardar_datos_pedido('573000000923', p_notas:=E'sin ñ\U0001F355\nqueso')->'estado'->>'notas'$$)
) v(caso,q);
rollback;


-- ---------------------------------------------------------------------------
-- T6 · paso_flujo fuera de dominio CON el carrito lleno.
--      Medido: 23514. Confirma que el verde de T5 era circunstancial — el CHECK
--      `carritos_paso_flujo_chk` sí existe y sí muerde; en T5 no llegó a
--      evaluarse porque el trigger había reescrito el valor a 'armando'.
-- ---------------------------------------------------------------------------
begin;
insert into carritos (telefono, items, total, paso_flujo)
values ('573000000951','[{"x":1}]'::jsonb, 1000, 'datos');
select 'paso_flujo=''xyz'' con carrito NO vacío' as caso, '23514' as esperado,
       pg_temp.probe($$select left(guardar_datos_pedido('573000000951', p_paso_flujo:='xyz')::text,60)$$) as res;
rollback;


-- ---------------------------------------------------------------------------
-- T7 · ¿Hasta dónde llega el envío basura de T5? Hasta `carritos` y para.
--      **VERDE, y es el mejor resultado de la batería:** el trigger
--      `aplicar_tarifa_domicilio` **pisa** lo que mande el llamador con la tarifa
--      real de la zona. Un envío de -5000 o NaN entra al INSERT de `pedidos` y
--      queda guardado como **5000**, y el total sale correcto (35.000 con un
--      ítem de 30.000). El mismo patrón que `costo_motivo` en reservas (T3 de la
--      batería 06): el trigger ignora al LLM.
--      Queda un cabo suelto real aunque de bajo impacto: el bot **lee el carrito**
--      para cantarle el costo al cliente, así que puede anunciar -5000 y cobrar
--      5000. Por eso BUG-047b sigue abierto pese a este verde.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro) values
 ('CLI-QA09a','573000000961','QA a', now()),
 ('CLI-QA09b','573000000962','QA b', now()),
 ('CLI-QA09c','573000000963','QA c', now());
create temp table r7(ord int, caso text, res text, guardado text) on commit drop;

insert into r7 values (1,'pedidos · costo_domicilio=-5000 con barrio Centro',
  pg_temp.run($$insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,metodo_pago,barrio,costo_domicilio)
                values ('PED-QA09B','CLI-QA09a','573000000961','domicilio','Efectivo','Centro',-5000)$$), null);
update r7 set guardado = coalesce((select costo_domicilio::text from pedidos where pedido_id='PED-QA09B'),'no existe') where ord=1;

insert into r7 values (2,'pedidos · costo_domicilio=-5000 SIN barrio',
  pg_temp.run($$insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,metodo_pago,costo_domicilio)
                values ('PED-QA09C','CLI-QA09b','573000000962','domicilio','Efectivo',-5000)$$), null);
update r7 set guardado = coalesce((select costo_domicilio::text from pedidos where pedido_id='PED-QA09C'),'no existe') where ord=2;

insert into r7 values (3,'pedidos · costo_domicilio=NaN (el CHECK >=0 NO atrapa NaN)',
  pg_temp.run($$insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,metodo_pago,costo_domicilio)
                values ('PED-QA09D','CLI-QA09c','573000000963','domicilio','Efectivo','NaN')$$), null);
update r7 set guardado = coalesce((select costo_domicilio::text from pedidos where pedido_id='PED-QA09D'),'no existe') where ord=3;

insert into r7 values (4,'  └ total tras meter un ítem de 30.000 sobre ese envío',
  pg_temp.run($$insert into detalle_pedidos (detalle_id,pedido_id,producto_id,nombre_producto,cantidad,precio_unitario)
                values ('DET-QA09D','PED-QA09D','PROD-019','Pizza QA',1,30000)$$), null);
update r7 set guardado = coalesce((select total::text from pedidos where pedido_id='PED-QA09D'),'no existe') where ord=4;

select caso, res, guardado from r7 order by ord;   -- esperado: 5000, 5000, 5000, 35000.00
rollback;


-- ---------------------------------------------------------------------------
-- T8 · `editar_pedido` con JSONB basura.
--      Rojo → BUG-047c: si `p_items` no es un array ({}, "x", 5, json null) la
--             función revienta con 22023 "cannot get array length of a non-array"
--             en vez de devolver {success:false}. Lo mismo con un ítem al que le
--             falta `cantidad` (23502), con cantidad no entera ("dos", 1.5 →
--             22P02) o fuera del rango de int4 (22003).
--      Rojo → BUG-048 (el grave): **cantidad negativa y precio negativo se
--             aceptan con success:true y dejan el pedido con TOTAL NEGATIVO.**
--             Medido: cantidad=-3 × 10.000 + envío 5.000 → total **-25.000**.
--             `detalle_pedidos` no tiene ningún CHECK; el único guardarraíl es
--             `Math.max(1, …)` en EditOrderModal.jsx:41 — es decir, en React,
--             que por la regla #1 de CLAUDE.md NO es la frontera de seguridad.
--      Verde: p_items=[] → SIN_ITEMS · producto_id inventado → 23503 (el FK
--             contra `menu` es el guardarraíl que sí está) · detalle_id repetido
--             → 23505 · `mitades` no-array → se guarda NULL y success:true, tal
--             como documenta el CASE de la función · pedido_id con inyección →
--             PEDIDO_NO_ENCONTRADO · 500 ítems → 500 filas y total exacto (505.000).
--
--      OJO al orden de los casos: los de cantidad/precio usan PROD-019 (real) a
--      propósito. Con un producto_id inventado el FK dispara primero y el
--      hallazgo desaparece.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro)
values ('CLI-QA09','573000000950','QA Basura', now());
insert into pedidos (pedido_id, cliente_id, telefono, tipo_pedido, estado, metodo_pago, barrio, costo_domicilio)
values ('PED-QA09','CLI-QA09','573000000950','domicilio','pendiente','Efectivo','Centro',5000);
insert into detalle_pedidos (detalle_id, pedido_id, producto_id, nombre_producto, cantidad, precio_unitario)
values ('DET-QA09','PED-QA09','PROD-019','Pizza QA',1,30000);

-- 8a · formas de p_items que no son un array de objetos
select 'p_items = {}' as caso, pg_temp.probe($$select left(editar_pedido('PED-QA09','{}'::jsonb)::text,60)$$) as res
union all select 'p_items = "x"',        pg_temp.probe($$select left(editar_pedido('PED-QA09','"x"'::jsonb)::text,60)$$)
union all select 'p_items = 5',          pg_temp.probe($$select left(editar_pedido('PED-QA09','5'::jsonb)::text,60)$$)
union all select 'p_items = json null',  pg_temp.probe($$select left(editar_pedido('PED-QA09','null'::jsonb)::text,60)$$)
union all select 'p_items = []',         pg_temp.probe($$select editar_pedido('PED-QA09','[]'::jsonb)->>'error'$$)
union all select 'array de escalares',   pg_temp.probe($$select left(editar_pedido('PED-QA09','[1,2]'::jsonb)::text,60)$$)
union all select 'ítem sin cantidad',    pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","precio_unitario":1000}]'::jsonb)::text,60)$$)
union all select 'ítem sin precio',      pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":1}]'::jsonb)::text,60)$$)
union all select 'cantidad = "dos"',     pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":"dos","precio_unitario":1000}]'::jsonb)::text,60)$$)
union all select 'cantidad = 1.5',       pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":1.5,"precio_unitario":1000}]'::jsonb)::text,60)$$)
union all select 'cantidad = 2147483648',pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":2147483648,"precio_unitario":1000}]'::jsonb)::text,60)$$)
union all select 'producto_id inventado',pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"producto_id":"NO-EXISTE","nombre_producto":"Inventado","cantidad":1,"precio_unitario":99}]'::jsonb)::text,60)$$)
union all select 'detalle_id duplicado x2',pg_temp.probe($$select left(editar_pedido('PED-QA09','[{"detalle_id":"D1","producto_id":"PROD-019","nombre_producto":"N","cantidad":1,"precio_unitario":100},{"detalle_id":"D1","producto_id":"PROD-019","nombre_producto":"N","cantidad":1,"precio_unitario":100}]'::jsonb)::text,60)$$)
union all select 'mitades = "basura" (no-array)',pg_temp.probe($$select editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":1,"precio_unitario":100,"mitades":"basura"}]'::jsonb)->>'success'$$)
union all select 'pedido_id con inyección', pg_temp.probe($$select editar_pedido($i$PED-001'; delete from pedidos; --$i$,'[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":1,"precio_unitario":100}]'::jsonb)->>'error'$$);
rollback;

-- 8b · BUG-048 · cantidad y precio negativos. Se lee el TOTAL RESULTANTE, no si
--      lanzó: la función devuelve success:true en los tres casos.
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro)
values ('CLI-QA09','573000000950','QA Basura', now());
insert into pedidos (pedido_id, cliente_id, telefono, tipo_pedido, estado, metodo_pago, barrio, costo_domicilio)
values ('PED-QA09','CLI-QA09','573000000950','domicilio','pendiente','Efectivo','Centro',5000);
insert into detalle_pedidos (detalle_id, pedido_id, producto_id, nombre_producto, cantidad, precio_unitario)
values ('DET-QA09','PED-QA09','PROD-019','Pizza QA',1,30000);
create temp table r8(ord int, caso text, ok text, total_resultante text, filas int) on commit drop;

insert into r8 values (1,'cantidad = 0',
  pg_temp.probe($$select editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":0,"precio_unitario":1000}]'::jsonb)->>'success'$$), null,null);
update r8 set total_resultante=(select total::text from pedidos where pedido_id='PED-QA09'),
              filas=(select count(*) from detalle_pedidos where pedido_id='PED-QA09') where ord=1;

insert into r8 values (2,'cantidad = -3 · precio 10.000',
  pg_temp.probe($$select editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":-3,"precio_unitario":10000}]'::jsonb)->>'success'$$), null,null);
update r8 set total_resultante=(select total::text from pedidos where pedido_id='PED-QA09'),
              filas=(select count(*) from detalle_pedidos where pedido_id='PED-QA09') where ord=2;

insert into r8 values (3,'precio = -10.000',
  pg_temp.probe($$select editar_pedido('PED-QA09','[{"producto_id":"PROD-019","nombre_producto":"N","cantidad":1,"precio_unitario":-10000}]'::jsonb)->>'success'$$), null,null);
update r8 set total_resultante=(select total::text from pedidos where pedido_id='PED-QA09'),
              filas=(select count(*) from detalle_pedidos where pedido_id='PED-QA09') where ord=3;

insert into r8 values (4,'nombre_producto vacío + notas_item de 10k',
  pg_temp.probe($$select editar_pedido('PED-QA09', jsonb_build_array(jsonb_build_object('producto_id','PROD-019','nombre_producto','','cantidad',1,'precio_unitario',1000,'notas_item',repeat('x',10000))))->>'success'$$), null,null);
update r8 set total_resultante=(select total::text from pedidos where pedido_id='PED-QA09'),
              filas=(select count(*) from detalle_pedidos where pedido_id='PED-QA09') where ord=4;

insert into r8 values (5,'500 ítems de 1.000',
  pg_temp.probe($$select editar_pedido('PED-QA09',(select jsonb_agg(jsonb_build_object('producto_id','PROD-019','nombre_producto','N','cantidad',1,'precio_unitario',1000)) from generate_series(1,500)))->>'success'$$), null,null);
update r8 set total_resultante=(select total::text from pedidos where pedido_id='PED-QA09'),
              filas=(select count(*) from detalle_pedidos where pedido_id='PED-QA09') where ord=5;

-- Medido 2026-09-12: true/5000.00/1 · true/**-25000.00**/1 · true/**-5000.00**/1
--                    true/6000.00/1 · true/505000.00/500
select caso, ok, total_resultante, filas from r8 order by ord;
rollback;


-- ---------------------------------------------------------------------------
-- T9 · Basura contra las tablas directamente (lo que escribe el dashboard).
--      Verde: estado fuera de dominio, personas=0 y origen inventado rebotan
--             con 23514.
--      Rojo → BUG-049: `reservas` acepta **fecha en el pasado** (2020-01-01),
--             **hora 04:00** y **23:59** — horas a las que el local está cerrado.
--             La única validación de horario (12:00-21:00) vive en el subworkflow
--             n8n `OTQp2O8QDw1mMKOZ`, así que **sólo protege al bot**; el modal de
--             reservas del dashboard escribe directo a la tabla. Es el espejo de
--             BUG-044: allí el modal ofrece lo que la BD rechaza, aquí la BD
--             acepta lo que el negocio rechaza.
--      Observación: `pedidos.fecha_pedido` admite el año 3000. Un pendiente con
--             fecha futura nunca lo cierra `expirar_pedidos_pendientes` (sólo mira
--             días anteriores). Sin vía de explotación conocida; anotado.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro)
values ('CLI-QA09','573000000950','QA Basura', now());
create temp table r9(ord int, caso text, esperado text, res text) on commit drop;

insert into r9 values (1,'pedidos · estado=''entregadoo''','23514',
  pg_temp.run($$insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,metodo_pago,estado)
                values ('PED-QA09D','CLI-QA09','573000000950','domicilio','Efectivo','entregadoo')$$));
insert into r9 values (2,'pedidos · fecha_pedido año 3000','(sin guardarraíl)',
  pg_temp.run($$insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,metodo_pago,fecha_pedido)
                values ('PED-QA09E','CLI-QA09','573000000950','recoger','Efectivo', timestamp '3000-01-01')$$));
insert into r9 values (3,'reservas · personas=0','23514',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950','QA',current_date+400,'19:00',0,'confirmada','whatsapp')$$));
insert into r9 values (4,'reservas · fecha en el PASADO (2020)','debería rechazar',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950','QA',date '2020-01-01','19:00',4,'confirmada','whatsapp')$$));
insert into r9 values (5,'reservas · hora 04:00 (local cerrado)','debería rechazar',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950','QA',current_date+400,'04:00',4,'confirmada','whatsapp')$$));
insert into r9 values (6,'reservas · hora 23:59','debería rechazar',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950','QA',current_date+401,'23:59',4,'confirmada','whatsapp')$$));
insert into r9 values (7,'reservas · origen=''hackeado''','23514',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950','QA',current_date+400,'19:00',4,'confirmada','hackeado')$$));
insert into r9 values (8,'reservas · nombre_cliente de 10.000 chars','(sin guardarraíl)',
  pg_temp.run($$insert into reservas (telefono,nombre_cliente,fecha,hora,personas,estado,origen)
                values ('573000000950',repeat('x',10000),current_date+402,'19:00',4,'confirmada','whatsapp')$$));

select caso, esperado, res from r9 order by ord;
rollback;


-- ---------------------------------------------------------------------------
-- T10 · Las RPC que consume el dashboard, con texto libre hostil.
--       Rojo → BUG-045c: `historial_resumen` tampoco escapa el comodín. Buscar
--              '%' o '_' en el Historial devuelve los 116 pedidos en vez de 0.
--              Cosmético (no es fuga: la función NO es SECURITY DEFINER, así que
--              RLS sigue filtrando), pero el contador miente.
--       Verde: inyección, 10k, emoji, '.*', '\', estado/tipo fuera de dominio y
--              rango invertido → 0, sin reventar. `p_cliente_ids` con inyección
--              dentro del array → 0.
-- ---------------------------------------------------------------------------

-- 10a · EL CONTROL POSITIVO. Sin esto, los ceros de 10b no prueban nada (ver
--       LA TRAMPA del encabezado). El rango de fechas es OBLIGATORIO: con
--       p_from/p_to en NULL toda la cláusula WHERE es NULL y el total es 0
--       aunque el filtro de búsqueda no haya hecho nada.
with r as (select timestamp '2020-01-01' as f, timestamp '2030-01-01' as t)
select (historial_resumen(f,t,null,null,null,null,null)->>'total')   as sin_filtro      -- 116
     , (historial_resumen(f,t,null,null,'PED-0',null,null)->>'total') as busca_ped0      -- 4
     , (historial_resumen(f,t,null,null,'zzzz',null,null)->>'total')  as busca_nada      -- 0
     , (historial_resumen(f,t,null,null,'%',null,null)->>'total')     as comodin_pct     -- 0 (116 antes de BUG-045c)
     , (historial_resumen(f,t,null,null,'_',null,null)->>'total')     as comodin_guion   -- 0 (116 antes de BUG-045c)
     , (historial_resumen(f,t,null,null,'x','%',null)->>'total')      as digitos_comodin -- 0 (con p_search NULL no hay filtro: ver encabezado)
     , (historial_resumen(t,f,null,null,null,null,null)->>'total')    as rango_invertido -- 0
from r;

-- 10b · la basura restante, ya con rango real
with p(clase, v) as (values
  ('inyeccion', $x$' OR 1=1 --$x$), ('vacio',''), ('10k', repeat('a',10000)),
  ('emoji','🍕'), ('regex','.*'), ('backslash','\')
)
select clase,
  pg_temp.probe(format($$select historial_resumen(timestamp '2020-01-01', timestamp '2030-01-01',null,null,%L,null,null)->>'total'$$, v)) as historial,
  pg_temp.probe(format($$select count(*)::text from consultar_faq(%L, 40)$$, v))          as faq,
  pg_temp.probe(format($$select registrar_contexto_handoff(%L, 20)::text$$, v))           as handoff
from p
union all
select 'estado fuera de dominio',
  pg_temp.probe($$select historial_resumen(timestamp '2020-01-01', timestamp '2030-01-01','inventado',null,null,null,null)->>'total'$$),
  pg_temp.probe($$select historial_resumen(timestamp '2020-01-01', timestamp '2030-01-01',null,'inventado',null,null,null)->>'total'$$),
  pg_temp.probe($$select historial_resumen(timestamp '2020-01-01', timestamp '2030-01-01',null,null,null,null,array['X','''; drop table pedidos; --'])->>'total'$$)
union all
select 'resumen_entregas · uuid inexistente / rango invertido',
  pg_temp.probe($$select (select entregas from resumen_entregas('00000000-0000-0000-0000-000000000000'::uuid,null,null))::text$$),
  pg_temp.probe($$select (select entregas from resumen_entregas('acf3741f-6759-4326-b110-1bdee5b1e25d','2030-01-01'::timestamptz,'2020-01-01'::timestamptz))::text$$),
  '-';


-- ---------------------------------------------------------------------------
-- T11 · I3 · Ninguna inyección ejecutó nada. Se cuenta, no se confía.
--       Línea base de la batería 08 (2026-09-09), sin cambios el 2026-09-12:
--       116 pedidos · 214 detalles · 35 clientes · 16 reservas · 133 menu · 20 tablas.
--       Y los cuatro contadores de corrupción deben dar 0 — incluido
--       `pedidos_total_negativo`, que es el que atraparía BUG-048 si alguna vez
--       se ejecuta fuera de una transacción revertida.
-- ---------------------------------------------------------------------------
select
 (select count(*) from pedidos)   as pedidos,
 (select count(*) from detalle_pedidos) as detalles,
 (select count(*) from clientes)  as clientes,
 (select count(*) from carritos)  as carritos,
 (select count(*) from reservas)  as reservas,
 (select count(*) from menu)      as menu,
 (select count(*) from information_schema.tables where table_schema='public') as tablas,
 -- corrupción: los cuatro deben ser 0
 (select count(*) from pedidos where total < 0)                       as pedidos_total_negativo,
 (select count(*) from detalle_pedidos where cantidad <= 0 or precio_unitario < 0) as detalles_invalidos,
 (select count(*) from carritos where costo_domicilio < 0)            as carritos_envio_negativo,
 (select count(*) from carritos where telefono like '5730000009%')    as residuo_qa;
