-- ============================================================================
-- QA · 10 · Flujo de reseñas / feedback
-- Oráculo: docs/bot/feedback.md · tablas `feedback`, `feedback_pendiente`,
--          `pedidos.feedback_solicitado`, `clientes.modo`
-- Estado 2026-09-12: 32 casos · 22 verde · 10 rojo (BUG-050, BUG-051).
-- Estado 2026-09-16: +T10..T15. La máquina de estados ya no vive en n8n: se movió a
--   `procesar_respuesta_feedback()` y `solicitar_feedback_lote()` (BUG-057/058/059/060),
--   así que por primera vez se puede probar ENTERA desde aquí, no por sentencias sueltas.
--
-- El flujo tiene dos mitades en n8n (el job que PIDE la nota y el subworkflow que
-- la RECIBE), pero toda la máquina de estados se apoya en cuatro piezas de BD:
--   · `feedback_pendiente` — la cola, **PK = telefono** (un solo slot por cliente)
--   · `clientes.modo` — 'bot' | 'humano' | 'esperando_feedback'
--   · `pedidos.feedback_solicitado` — la marca de idempotencia
--   · `feedback` — el resultado, UNIQUE(pedido_id), calificacion 1..5
-- Esta batería prueba lo que se puede probar sin WhatsApp: las transiciones, la
-- idempotencia, los constraints y —sobre todo— **el choque de PK que rompe el job**.
-- El parseo de la nota y la redacción viven en el LLM/Code: van al guion G11.
--
-- ⚠️ LA TRAMPA DE ESTA BATERÍA: aquí el verde de un INSERT no significa nada. El
--    bug real (BUG-050) no es que algo falle, es **el orden en que se escribe**:
--    dos writes se confirman y el tercero revienta, dejando un estado intermedio
--    que nadie revierte. Para verlo hay que reproducir la SECUENCIA COMPLETA del
--    job, no cada sentencia por separado — T4 hace exactamente eso.
--
-- Teléfonos 5730000009xx. Todo dentro de BEGIN … ROLLBACK.
-- ============================================================================

create or replace function pg_temp.run(sql text) returns text language plpgsql as $$
begin execute sql; return 'ACEPTADO';
exception when others then return '💥 '||sqlstate||': '||left(sqlerrm,60); end $$;


-- ---------------------------------------------------------------------------
-- T1 · Constraints de `feedback`. Verde 6/6 (medido 2026-09-12).
--      calificacion 0 y 6 → 23514 · UNIQUE(pedido_id) impide dos reseñas del
--      mismo pedido · los FK a clientes y pedidos rechazan ids inventados ·
--      comentario NULL es legítimo (la ruta positiva no pide comentario).
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro)
values ('CLI-QA10','573000000970','QA Reseñas', now());
insert into pedidos (pedido_id, cliente_id, telefono, tipo_pedido, estado, metodo_pago, fecha_entrega)
values ('PED-QA10','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now() - interval '2 hours'),
       ('PED-QA10B','CLI-QA10','573000000970','recoger','entregado','Efectivo', now() - interval '3 hours');

select 'calificacion = 0' as caso, '23514' as esperado,
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10a','CLI-QA10','PED-QA10',now(),0)$$) as res
union all select 'calificacion = 6','23514',
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10b','CLI-QA10','PED-QA10',now(),6)$$)
union all select 'calificacion = 5 (válida)','ACEPTADO',
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10c','CLI-QA10','PED-QA10',now(),5)$$)
union all select 'segunda reseña del MISMO pedido','23505 UNIQUE(pedido_id)',
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10d','CLI-QA10','PED-QA10',now(),1)$$)
union all select 'pedido_id inventado','23503',
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10e','CLI-QA10','PED-NO-EXISTE',now(),4)$$)
-- OJO: este caso usa un pedido DISTINTO a propósito. Contra PED-QA10 el
-- UNIQUE(pedido_id) dispara antes que el FK y el test mide el constraint
-- equivocado (misma familia que la trampa del FK en la batería 09).
union all select 'cliente_id inventado','23503',
       pg_temp.run($$insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
                     values ('FB-QA10f','CLI-NO-EXISTE','PED-QA10B',now(),4)$$);
rollback;


-- ---------------------------------------------------------------------------
-- T2 · Constraints de `feedback_pendiente`. Verde 3/3.
--      estado fuera de dominio → 23514 · los dos estados válidos entran ·
--      y **la PK es `telefono`**, que es la pieza que todo lo demás asume.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro)
values ('CLI-QA10','573000000970','QA Reseñas', now());
insert into pedidos (pedido_id, cliente_id, telefono, tipo_pedido, estado, metodo_pago)
values ('PED-QA10','CLI-QA10','573000000970','domicilio','entregado','Efectivo');

select 'estado = ''esperando_nota''' as caso, 'ACEPTADO' as esperado,
       pg_temp.run($$insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
                     values ('573000000970','PED-QA10','CLI-QA10','esperando_nota')$$) as res
union all select 'estado = ''ya_califico'' (inventado)','23514',
       pg_temp.run($$insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
                     values ('573000000971','PED-QA10','CLI-QA10','ya_califico')$$)
union all select 'transición a ''esperando_comentario''','ACEPTADO',
       pg_temp.run($$update feedback_pendiente set estado='esperando_comentario'
                     where telefono='573000000970'$$);
rollback;


-- ---------------------------------------------------------------------------
-- T3 · La consulta del job, tal cual la hace n8n. Verde.
--      Ventana: entregado · feedback_solicitado=false · fecha_entrega entre
--      now()−6h y now()−1h. Se prueban las cuatro fronteras.
--      Medido: −30min NO entra (muy reciente) · −1h05 SÍ · −5h55 SÍ ·
--              −7h NO (muy viejo) · y un entregado ya marcado NO reaparece.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro) values
 ('CLI-QA10a','573000000971','QA a', now()), ('CLI-QA10b','573000000972','QA b', now()),
 ('CLI-QA10c','573000000973','QA c', now()), ('CLI-QA10d','573000000974','QA d', now()),
 ('CLI-QA10e','573000000975','QA e', now());
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega,feedback_solicitado) values
 ('PED-QA10a','CLI-QA10a','573000000971','domicilio','entregado','Efectivo', now()-interval '30 minutes', false),
 ('PED-QA10b','CLI-QA10b','573000000972','domicilio','entregado','Efectivo', now()-interval '65 minutes', false),
 ('PED-QA10c','CLI-QA10c','573000000973','domicilio','entregado','Efectivo', now()-interval '355 minutes', false),
 ('PED-QA10d','CLI-QA10d','573000000974','domicilio','entregado','Efectivo', now()-interval '7 hours', false),
 ('PED-QA10e','CLI-QA10e','573000000975','domicilio','entregado','Efectivo', now()-interval '2 hours', true);

select p.pedido_id,
       round(extract(epoch from (now()-p.fecha_entrega))/60) as minutos_desde_entrega,
       p.feedback_solicitado,
       case when p.fecha_entrega >= now()-interval '6 hours'
             and p.fecha_entrega <= now()-interval '1 hour'
             and not p.feedback_solicitado then '✓ el job lo toma' else '— lo ignora' end as veredicto
from pedidos p where p.pedido_id like 'PED-QA10%' order by p.pedido_id;
rollback;


-- ---------------------------------------------------------------------------
-- T4 · 🔴 BUG-050 · LA SECUENCIA COMPLETA DEL JOB contra un cliente repetido.
--      Esto es lo que ninguna prueba por sentencia suelta detecta.
--      El cliente ya tiene una fila zombi en la cola (pedido viejo). Llega un
--      pedido nuevo y el job ejecuta, EN ESTE ORDEN:
--        1. marcar feedback_solicitado = true   ← se confirma
--        2. modo = 'esperando_feedback'         ← se confirma
--        3. POST feedback_pendiente             ← 💥 23505, mata la ejecución
--        4. enviar WhatsApp                     ← NUNCA CORRE
--      Medido 2026-09-12 (ejecución real n8n 14816, PED-245/CLI-039):
--        el paso 3 devuelve 409 "Key (telefono)=(573184821317) already exists",
--        y los pasos 1 y 2 quedan escritos. El cliente queda mudo y sin que se
--        le haya preguntado nada.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo)
values ('CLI-QA10','573000000970','QA Reseñas', now(), 'bot');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_pedido,fecha_entrega,feedback_solicitado) values
 ('PED-QA10V','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '41 days', now()-interval '40 days', true),
 ('PED-QA10N','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '3 hours', now()-interval '2 hours',  false);
-- la fila zombi del pedido viejo, que nadie limpió
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado,fecha_solicitud)
values ('573000000970','PED-QA10V','CLI-QA10','esperando_nota', now()-interval '40 days');

create temp table j(paso int, accion text, resultado text) on commit drop;
insert into j values (1,'marcar feedback_solicitado del pedido NUEVO',
  pg_temp.run($$update pedidos set feedback_solicitado=true where pedido_id='PED-QA10N'$$));
insert into j values (2,'activar modo esperando_feedback',
  pg_temp.run($$update clientes set modo='esperando_feedback' where cliente_id='CLI-QA10'$$));
insert into j values (3,'POST feedback_pendiente (pedido NUEVO)',
  pg_temp.run($$insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
                values ('573000000970','PED-QA10N','CLI-QA10','esperando_nota')$$));
insert into j values (4,'enviar WhatsApp','(el workflow ya murió en el paso 3)');

select (select string_agg(paso||'. '||accion||' → '||resultado, E'\n' order by paso) from j) as secuencia,
       (select feedback_solicitado::text from pedidos where pedido_id='PED-QA10N') as pedido_nuevo_marcado,
       (select modo from clientes where cliente_id='CLI-QA10')                     as modo_cliente,
       (select pedido_id from feedback_pendiente where telefono='573000000970')    as a_que_pedido_apunta_la_cola;
-- Esperado (el bug): marcado=true · modo=esperando_feedback · la cola sigue
-- apuntando a PED-QA10V (el de hace 40 días). Si el cliente responde "5" ahora,
-- la nota se escribe contra el pedido VIEJO.
rollback;


-- ---------------------------------------------------------------------------
-- T5 · 🔴 BUG-050 · El upsert es el fix, y aquí se valida que funciona.
--      Mismo escenario que T4 pero con ON CONFLICT (telefono) DO UPDATE, que es
--      lo que hace la cabecera `Prefer: resolution=merge-duplicates` de PostgREST.
--      Medido: no revienta, y la cola queda apuntando al pedido NUEVO.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo)
values ('CLI-QA10','573000000970','QA Reseñas', now(), 'bot');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_pedido,fecha_entrega) values
 ('PED-QA10V','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '41 days', now()-interval '40 days'),
 ('PED-QA10N','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '3 hours', now()-interval '2 hours');
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado,fecha_solicitud)
values ('573000000970','PED-QA10V','CLI-QA10','esperando_nota', now()-interval '40 days');

-- ⚠️ El upsert va en su PROPIA sentencia y el resultado se lee en la siguiente.
--    Metido en un subquery del mismo SELECT devuelve el snapshot previo y parece
--    que el fix no funciona (me pasó: leí PED-QA10V y casi lo doy por roto).
--    Es la trampa del encabezado de `04-flujo-pedido.sql`.
create temp table t5(res text) on commit drop;
insert into t5 select pg_temp.run($$insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
                     values ('573000000970','PED-QA10N','CLI-QA10','esperando_nota')
                     on conflict (telefono) do update
                       set pedido_id = excluded.pedido_id,
                           cliente_id = excluded.cliente_id,
                           estado = 'esperando_nota',
                           fecha_solicitud = now()$$);

select 'upsert del pedido nuevo' as caso,
       (select res from t5) as res,
       (select pedido_id from feedback_pendiente where telefono='573000000970') as cola_apunta_a,
       (select count(*) from feedback_pendiente where telefono='573000000970')  as filas,
       (select round(extract(epoch from (now()-fecha_solicitud)))
          from feedback_pendiente where telefono='573000000970')                as antiguedad_seg;
-- Medido 2026-09-12: ACEPTADO · PED-QA10N · 1 fila · 0 seg (el reloj se reinicia,
-- así que el job de expiración del fix 3 tampoco la borraría por error).
rollback;


-- ---------------------------------------------------------------------------
-- T6 · BUG-050 · La cola no caduca. Verde = 0 filas vencidas.
--      2026-09-16: el umbral bajó de 48 h a **6 h** y el cron de diario a horario
--      (`7 * * * *`). 48 h con un job diario dejaba a un cliente hasta 3 días sin
--      bot — que es justo lo que pasó en BUG-057. La ventana real para responder
--      "califica tu pedido" son horas.
--      Medido 2026-09-12 contra datos vivos: 9 filas, la más vieja de 108 días,
--      y 7 clientes atrapados en 'esperando_feedback'. Ningún job las tocaba.
--      Medido 2026-09-15: **0 filas · 0 atrapados** — con el job
--      `expirar-feedback-pendiente` (30 7 * * *) corriendo 3/3 OK. OJO: no entra
--      ningún pedido desde el 2026-09-08, así que este verde prueba que la cola se
--      vació, NO que el job de solicitud ya no la atasque (eso lo prueba G11).
--      Este SELECT es la red permanente: en verde debe devolver 0 filas.
-- ---------------------------------------------------------------------------
select fp.telefono, fp.pedido_id, fp.estado,
       round(extract(epoch from (now()-fp.fecha_solicitud))/86400) as dias_en_cola,
       c.modo as modo_cliente,
       (select count(*) from feedback f where f.pedido_id=fp.pedido_id) as ya_tiene_feedback
from feedback_pendiente fp left join clientes c on c.cliente_id=fp.cliente_id
where fp.fecha_solicitud < now() - interval '6 hours'
order by fp.fecha_solicitud;


-- ---------------------------------------------------------------------------
-- T7 · Coherencia del estado vivo. Los cuatro contadores deben ser 0.
--      Medido 2026-09-12: **9 / 0 / 4 / 0** — (a) y (c) son BUG-050.
--      Medido 2026-09-15: **0 / 0 / 0 / 0**.
--      (b)=0 es verde real: no hay modo huérfano, porque el problema es el
--      contrario — hay cola de sobra, y apuntando al pedido equivocado.
--      Además: 7 clientes en 'esperando_feedback' ahora mismo.
--        a) filas en cola de más de 6 h
--        b) clientes en 'esperando_feedback' SIN fila en la cola
--           (el "modo huérfano" que el subworkflow dice limpiar)
--        c) filas en cola cuyo pedido YA tiene feedback (cola que debió borrarse)
--        d) feedback cuyo pedido no está 'entregado'
-- ---------------------------------------------------------------------------
select
 (select count(*) from feedback_pendiente where fecha_solicitud < now()-interval '6 hours') as a_cola_vencida,
 (select count(*) from clientes c where c.modo='esperando_feedback'
    and not exists (select 1 from feedback_pendiente fp where fp.cliente_id=c.cliente_id))   as b_modo_huerfano,
 (select count(*) from feedback_pendiente fp
    where exists (select 1 from feedback f where f.pedido_id=fp.pedido_id))                  as c_cola_ya_resuelta,
 (select count(*) from feedback f join pedidos p on p.pedido_id=f.pedido_id
    where p.estado <> 'entregado')                                                           as d_feedback_sin_entrega;


-- ---------------------------------------------------------------------------
-- T8 · 🔴 BUG-051 · El parser de la nota, replicado en SQL.
--      `Parsear calificación` hace `/[1-5]/` sobre el texto: **el primer dígito
--      1–5 que aparezca**, esté donde esté. Se contrasta con el parser estricto
--      propuesto (`^\s*[1-5]\s*$`).
--      Medido 2026-09-12: **6 de 11 mensajes realistas fabrican una nota.**
--        "quiero 2 pizzas"               → 2  (ruta NEGATIVA: le pide explicaciones
--                                             al cliente que solo quería comida)
--        "quiero 1 pizza hawaiana"       → 1
--        "me demoraron 45 minutos"       → 4  (¡ruta POSITIVA! le agradece y le pide
--                                             que deje reseña en Google por una queja)
--        "10/10"                         → 1  (el cliente da la nota máxima y queda
--                                             registrado como la mínima)
--        "el pedido PED-245 llegó frío"  → 2
--        "mi direccion es calle 52 # 3-21" → 5
--      El parser estricto acierta los 11: las notas reales pasan, el resto cae en
--      "responde solo 1–5". Nota: "cinco" y "👍" no los resuelve ninguno de los dos.
--      2026-09-15: el parser estricto ESTÁ EN VIVO (`Sub — Feedback Pendiente`,
--      activeVersionId `cb2ff4b5…` y luego `61dd4711…`). El de producción es más
--      amplio que este regex: quita puntuación/emoji y acepta también uno..cinco
--      ("cinco" sí pasa). Esta réplica SQL queda como documentación del bug; la
--      prueba del parser real es G11.
-- ---------------------------------------------------------------------------
select mensaje,
       substring(mensaje from '[1-5]')                    as parser_actual,
       substring(mensaje from '^\s*([1-5])\s*$')          as parser_estricto,
       case when substring(mensaje from '[1-5]') is not null
             and substring(mensaje from '^\s*([1-5])\s*$') is null
            then '⚠️ el parser actual inventa una nota' else '' end as veredicto
from (values
  ('5'), ('  4 '), ('3'),
  ('quiero 2 pizzas'),
  ('quiero 1 pizza hawaiana'),
  ('me demoraron 45 minutos'),
  ('excelente todo'),
  ('10/10'),
  ('el pedido PED-245 llegó frío'),
  ('mi direccion es calle 52 # 3-21'),
  ('👍'),
  ('cinco')
) v(mensaje);


-- ---------------------------------------------------------------------------
-- T9 · Fix 3 de BUG-050 · `expirar_feedback_pendiente()` (cron `7 * * * *`).
--      Tres clientes, tres casos que el job NO puede confundir:
--        QF1 · fila de 7 h, modo esperando_feedback → se borra y vuelve a 'bot'
--        QF2 · fila de 5 h, modo esperando_feedback → intacta (sigue esperando)
--        QF3 · fila de 7 h, modo 'humano'           → se borra, pero el modo NO
--              se pisa: hay un operador atendiendo (§33: ¿a quién daña cuando acierta?)
--      Medido 2026-09-15 (con umbral 48 h y fixtures 49/47/49 h): devuelto=1 ·
--      QF1 cola=0 modo=bot · QF2 cola=1 modo=esperando_feedback · QF3 cola=0
--      modo=humano. Verde. 2026-09-16 el umbral bajó a 6 h (BUG-057) y las
--      fixtures se reescalaron; las fronteras que prueba son las mismas.
--      Ojo: la función devuelve el ROW_COUNT del UPDATE de clientes (1), no las
--      filas borradas de la cola (2). No es un bug, pero no lo leas como "borró 1".
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo) values
 ('CLI-QF1','573000000981','QA 7h espera', now(),'esperando_feedback'),
 ('CLI-QF2','573000000982','QA 5h espera', now(),'esperando_feedback'),
 ('CLI-QF3','573000000983','QA 7h humano', now(),'humano');
insert into pedidos (pedido_id, cliente_id, telefono, tipo_pedido, estado, metodo_pago, fecha_pedido, fecha_entrega) values
 ('PED-QF1','CLI-QF1','573000000981','recoger','entregado','Efectivo', now()-interval '3 days', now()-interval '3 days'),
 ('PED-QF2','CLI-QF2','573000000982','recoger','entregado','Efectivo', now()-interval '2 days', now()-interval '2 days'),
 ('PED-QF3','CLI-QF3','573000000983','recoger','entregado','Efectivo', now()-interval '3 days', now()-interval '3 days');
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado,fecha_solicitud) values
 ('573000000981','PED-QF1','CLI-QF1','esperando_nota',       now()-interval '7 hours'),
 ('573000000982','PED-QF2','CLI-QF2','esperando_nota',       now()-interval '5 hours'),
 ('573000000983','PED-QF3','CLI-QF3','esperando_comentario', now()-interval '7 hours');
-- escribe en una sentencia, lee en la siguiente (trampa de 04-flujo-pedido.sql)
create temp table r9(n text) on commit drop;
insert into r9 select expirar_feedback_pendiente()::text;
select c.cliente_id,
       (select count(*) from feedback_pendiente fp where fp.cliente_id = c.cliente_id) as cola,
       c.modo,
       case c.cliente_id
         when 'CLI-QF1' then 'cola=0 modo=bot'
         when 'CLI-QF2' then 'cola=1 modo=esperando_feedback'
         when 'CLI-QF3' then 'cola=0 modo=humano' end as esperado,
       (select n from r9) as devuelto
from clientes c where c.cliente_id like 'CLI-QF%' order by c.cliente_id;
rollback;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-16 · La máquina de estados se movió de n8n a la BD (BUG-057/058/059/060)
--
-- Antes, responder "5" recorría 8 nodos de n8n sin transacción: cada paso podía
-- fallar en silencio (un filtro PostgREST que no matchea responde 204, y n8n lo
-- da por éxito) y dejar el estado a medias. Los tres bugs del incidente del
-- 2026-09-15 son tres variantes del mismo fallo. Ahora hay dos funciones:
--   · solicitar_feedback_lote(limite)           → elegir + marcar + encolar + modo
--   · procesar_respuesta_feedback(tel, mensaje) → parsear + escribir + qué contestar
-- Todo dentro de una transacción: o pasa entero, o no pasa.
--
-- Medido 2026-09-16 contra la BD real: T10 10/10 · T11 3/3 · T12 2/2 · T13 5/5 ·
-- T14 desfase 0 s · T15 0/0/0/0. Verde entero.
--
-- ⚠️ TRAMPA (costó un 42702 al escribir `solicitar_feedback_lote`): los nombres de
--    un `RETURNS TABLE` **son variables plpgsql**, así que chocan con las columnas
--    homónimas de un `ON CONFLICT … DO UPDATE SET` (ahí no se pueden calificar).
--    La función lleva `#variable_conflict use_column`. Si alguien la reescribe sin
--    esa línea, revienta en runtime, no al crearla.
-- ═══════════════════════════════════════════════════════════════════════════


-- ---------------------------------------------------------------------------
-- T10 · `procesar_respuesta_feedback` · las salidas de la Fase A.
--       Medido 2026-09-16: 10/10. "10/10" y "quiero 2 pizzas" caen en nota_invalida
--       (con el parser viejo eran nota 1 y nota 2) y "cinco" resuelve a 5.
--       Helper: cada caso reconstruye la cola desde cero, porque una nota 4–5
--       la borra y el siguiente caso vería 'sin_pendiente' por arrastre.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo)
values ('CLI-QA10','573000000970','QA Reseñas', now(), 'esperando_feedback');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega)
values ('PED-QA10','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '2 hours');

create or replace function pg_temp.responder(msg text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  delete from feedback where pedido_id = 'PED-QA10';
  insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
  values ('573000000970','PED-QA10','CLI-QA10','esperando_nota')
  on conflict (telefono) do update set estado='esperando_nota', fecha_solicitud=now();
  update clientes set modo='esperando_feedback' where cliente_id='CLI-QA10';
  v := procesar_respuesta_feedback('573000000970', msg);
  return v
    || jsonb_build_object(
         'cola_restante', (select count(*) from feedback_pendiente where telefono='573000000970'),
         'estado_cola',   (select estado from feedback_pendiente where telefono='573000000970'),
         'modo',          (select modo from clientes where cliente_id='CLI-QA10'),
         'nota_en_bd',    (select calificacion_general from feedback where pedido_id='PED-QA10'));
end $f$;

select v.mensaje,
       x.r->>'accion'        as accion,
       x.r->>'nota_en_bd'    as nota_guardada,
       x.r->>'cola_restante' as cola,
       x.r->>'estado_cola'   as estado_cola,
       x.r->>'modo'          as modo,
       v.esperado
from (values
  ('5',                       'positiva · nota 5 · cola 0 · modo bot'),
  ('cinco',                   'positiva · nota 5 · cola 0 · modo bot'),
  ('  4 ',                    'positiva · nota 4 · cola 0 · modo bot'),
  ('3',                       'pedir_comentario · nota 3 · cola 1 · esperando_comentario · modo esperando_feedback'),
  ('1',                       'pedir_comentario · nota 1 · cola 1 · esperando_comentario'),
  ('me demoraron 45 minutos', 'nota_invalida · sin nota · cola 1 · esperando_nota'),
  ('10/10',                   'nota_invalida (NO nota 1 — BUG-051)'),
  ('quiero 2 pizzas',         'nota_invalida (NO nota 2 — BUG-051)'),
  ('perfecto, gracias',       'nota_invalida'),
  ('',                        'nota_invalida')
) v(mensaje, esperado), lateral (select pg_temp.responder(v.mensaje) as r) x;
rollback;


-- ---------------------------------------------------------------------------
-- T11 · 🔴 REGRESIÓN BUG-057 · responder DOS veces no puede romper nada.
--       Medido 2026-09-16: los 3 pasos ACEPTADO · nota_final=2 · 1 fila · ningún
--       23505. Con el flujo viejo, los pasos 2 y 3 eran 💥 23505.
--       El incidente: el cliente contestó "5" a las 18:57 y "5" a las 18:59.
--       El INSERT plano chocó con la PK determinista FB-{pedido_id} (23505), el
--       subworkflow murió sin contestar ni limpiar, y el cliente quedó atrapado
--       en 'esperando_feedback' con TODOS sus mensajes futuros muriendo igual.
--       Se prueban los dos caminos por los que llegaba el choque:
--         a) dos respuestas seguidas → la segunda es 'sin_pendiente' y de paso le
--            devuelve el modo 'bot' en vez de dejarlo colgado.
--         b) cola reabierta sobre un pedido YA calificado → la nota se ACTUALIZA
--            (UPSERT). Este es el 23505 exacto de la ejecución 15688.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo)
values ('CLI-QA10','573000000970','QA Reseñas', now(), 'esperando_feedback');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega)
values ('PED-QA10','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '2 hours');
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
values ('573000000970','PED-QA10','CLI-QA10','esperando_nota');

create temp table t11(paso int, accion text) on commit drop;
insert into t11 select 1, pg_temp.run($$select procesar_respuesta_feedback('573000000970','5')$$);
insert into t11 select 2, pg_temp.run($$select procesar_respuesta_feedback('573000000970','5')$$);
-- (b) el escenario exacto del 409: el job reabre la cola de un pedido calificado
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
values ('573000000970','PED-QA10','CLI-QA10','esperando_nota');
update clientes set modo='esperando_feedback' where cliente_id='CLI-QA10';
insert into t11 select 3, pg_temp.run($$select procesar_respuesta_feedback('573000000970','2')$$);

select (select string_agg('resp '||paso||' → '||accion, E'\n' order by paso) from t11) as secuencia,
       (select calificacion_general from feedback where pedido_id='PED-QA10')          as nota_final,
       (select count(*) from feedback where pedido_id='PED-QA10')                      as filas_feedback,
       (select modo from clientes where cliente_id='CLI-QA10')                         as modo_final;
-- Esperado: los 3 pasos ACEPTADO (ninguno 💥 23505) · nota_final=2 (el UPSERT
-- actualizó) · filas_feedback=1 · modo_final=esperando_feedback (la 3ª fue nota
-- baja y pidió comentario). Con el flujo viejo, 2 y 3 eran 💥 23505.
rollback;


-- ---------------------------------------------------------------------------
-- T12 · 🔴 REGRESIÓN BUG-059 · la Fase B tiene que CERRAR, no medio cerrar.
--       Medido 2026-09-16: 2/2 · ambos cola=0 y modo=bot · "saltar" deja NULL.
--       El nodo `Eliminar feedback pendiente1` filtraba por $json.telefono sobre
--       la fila de `feedback`, que no tiene esa columna: borraba 0 filas y
--       devolvía éxito. `Restaurar modo bot1` sí funcionaba → el cliente volvía a
--       'bot' con la cola VIVA. Ese desfase es el que encadenó todo el incidente.
--       Invariante: tras la Fase B, cola=0 Y modo='bot'. Nunca uno sin el otro.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo) values
 ('CLI-QB1','573000000991','QA comenta', now(),'esperando_feedback'),
 ('CLI-QB2','573000000992','QA salta',   now(),'esperando_feedback');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega) values
 ('PED-QB1','CLI-QB1','573000000991','domicilio','entregado','Efectivo', now()-interval '2 hours'),
 ('PED-QB2','CLI-QB2','573000000992','domicilio','entregado','Efectivo', now()-interval '2 hours');
insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general) values
 ('FB-PED-QB1','CLI-QB1','PED-QB1', now() at time zone 'utc', 2),
 ('FB-PED-QB2','CLI-QB2','PED-QB2', now() at time zone 'utc', 2);
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado) values
 ('573000000991','PED-QB1','CLI-QB1','esperando_comentario'),
 ('573000000992','PED-QB2','CLI-QB2','esperando_comentario');

create temp table t12(cli text, accion text) on commit drop;
insert into t12 select 'CLI-QB1', procesar_respuesta_feedback('573000000991','La pizza llegó fría')::text;
insert into t12 select 'CLI-QB2', procesar_respuesta_feedback('573000000992','saltar')::text;

select c.cliente_id,
       (select accion from t12 where cli=c.cliente_id)                              as respuesta,
       (select count(*) from feedback_pendiente fp where fp.cliente_id=c.cliente_id) as cola,
       c.modo,
       (select comentario from feedback f where f.cliente_id=c.cliente_id)           as comentario,
       case c.cliente_id
         when 'CLI-QB1' then 'agradecer · cola=0 · modo=bot · comentario guardado'
         when 'CLI-QB2' then 'agradecer · cola=0 · modo=bot · comentario NULL (saltar)' end as esperado
from clientes c where c.cliente_id like 'CLI-QB%' order by 1;
rollback;


-- ---------------------------------------------------------------------------
-- T13 · 🔴 REGRESIÓN BUG-058 · `solicitar_feedback_lote` es todo-o-nada.
--       Medido 2026-09-16: 5/5 · solo QL1 se toma, y queda marcado + encolado +
--       modo cambiado en la misma transacción.
--       El PATCH de `feedback_solicitado` apuntaba a `pedido_id=eq.undefined`:
--       0 filas, 204, verde. El flag nunca se marcaba y el cron repreguntaba el
--       mismo pedido cada 15 min. Ahora las tres escrituras van en la misma
--       transacción que el SELECT que devuelve las filas. Las cinco guardas:
--         QL1 · entregado hace 2 h, cliente en 'bot'      → SÍ lo toma
--         QL2 · entregado hace 30 min                     → no (muy reciente)
--         QL3 · entregado hace 2 h pero YA tiene feedback → no (la guarda nueva:
--               el hecho manda sobre el flag, aunque feedback_solicitado=false)
--         QL4 · entregado hace 2 h pero el cliente está en 'humano' → no
--         QL5 · entregado hace 2 h pero ya tiene cola abierta       → no
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo) values
 ('CLI-QL1','573000000951','QA lote 1', now(),'bot'),
 ('CLI-QL2','573000000952','QA lote 2', now(),'bot'),
 ('CLI-QL3','573000000953','QA lote 3', now(),'bot'),
 ('CLI-QL4','573000000954','QA lote 4', now(),'humano'),
 ('CLI-QL5','573000000955','QA lote 5', now(),'bot');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega,feedback_solicitado) values
 ('PED-QL1','CLI-QL1','573000000951','domicilio','entregado','Efectivo', now()-interval '2 hours',   false),
 ('PED-QL2','CLI-QL2','573000000952','domicilio','entregado','Efectivo', now()-interval '30 minutes',false),
 ('PED-QL3','CLI-QL3','573000000953','domicilio','entregado','Efectivo', now()-interval '2 hours',   false),
 ('PED-QL4','CLI-QL4','573000000954','domicilio','entregado','Efectivo', now()-interval '2 hours',   false),
 ('PED-QL5','CLI-QL5','573000000955','domicilio','entregado','Efectivo', now()-interval '2 hours',   false);
insert into feedback (feedback_id,cliente_id,pedido_id,fecha,calificacion_general)
values ('FB-PED-QL3','CLI-QL3','PED-QL3', now() at time zone 'utc', 4);
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
values ('573000000955','PED-QL5','CLI-QL5','esperando_nota');

-- escribe en una sentencia, lee en la siguiente (trampa de 04-flujo-pedido.sql)
create temp table t13(pedido_id text, cliente_id text, telefono text, nombre text) on commit drop;
insert into t13 select * from solicitar_feedback_lote(50);

select p.pedido_id,
       (select count(*) from t13 where t13.pedido_id = p.pedido_id) > 0 as lo_tomo,
       p.feedback_solicitado                                            as marcado,
       (select modo from clientes c where c.cliente_id=p.cliente_id)    as modo_cliente,
       (select fp.pedido_id from feedback_pendiente fp where fp.cliente_id=p.cliente_id) as cola,
       case p.pedido_id
         when 'PED-QL1' then 'lo_tomo=t · marcado=t · modo=esperando_feedback · cola=PED-QL1'
         when 'PED-QL2' then 'lo_tomo=f · marcado=f · modo=bot · cola=NULL (muy reciente)'
         when 'PED-QL3' then 'lo_tomo=f · marcado=f · modo=bot · cola=NULL (ya calificado)'
         when 'PED-QL4' then 'lo_tomo=f · marcado=f · modo=humano · cola=NULL'
         when 'PED-QL5' then 'lo_tomo=f · marcado=f · modo=bot · cola=PED-QL5 (ya en cola)' end as esperado
from pedidos p where p.pedido_id like 'PED-QL%' order by 1;
rollback;


-- ---------------------------------------------------------------------------
-- T14 · BUG-060 · `feedback.fecha` es `timestamp` SIN zona y por convención
--       guarda UTC (CLAUDE.md · parseDb()). n8n escribía `$now.toISO()`, que
--       resuelve en el huso de la INSTANCIA (UTC+2): la ejecución 15674 corrió a
--       las 23:22:35.677 UTC y la fila quedó con 01:22:35.841. Mismos ms, +2 h.
--       Verde = desfase < 5 segundos. Medido 2026-09-16: 0 s.
-- ---------------------------------------------------------------------------
begin;
insert into clientes (cliente_id, telefono, nombre, fecha_registro, modo)
values ('CLI-QA10','573000000970','QA Reseñas', now(), 'esperando_feedback');
insert into pedidos (pedido_id,cliente_id,telefono,tipo_pedido,estado,metodo_pago,fecha_entrega)
values ('PED-QA10','CLI-QA10','573000000970','domicilio','entregado','Efectivo', now()-interval '2 hours');
insert into feedback_pendiente (telefono,pedido_id,cliente_id,estado)
values ('573000000970','PED-QA10','CLI-QA10','esperando_nota');

create temp table t14(x text) on commit drop;
insert into t14 select procesar_respuesta_feedback('573000000970','5')::text;

select f.fecha                    as fecha_guardada,
       (now() at time zone 'utc') as ahora_utc,
       round(extract(epoch from ((now() at time zone 'utc') - f.fecha)))::text || ' s' as desfase,
       case when abs(extract(epoch from ((now() at time zone 'utc') - f.fecha))) < 5
            then 'verde' else '⚠️ la fecha no está en UTC' end as veredicto
from feedback f where f.pedido_id='PED-QA10';
rollback;


-- ---------------------------------------------------------------------------
-- T15 · La invariante que resume el incidente entero, como red permanente.
--       Medido 2026-09-16 contra datos vivos: 0 / 0 / 0 / 0.
--       Ningún cliente puede quedar en un estado del que el sistema no lo saque.
--       Los cuatro contadores deben ser 0 contra datos VIVOS (sin transacción).
--         a) en 'esperando_feedback' sin fila en la cola  → modo huérfano
--         b) fila en la cola con el cliente NO en 'esperando_feedback' ni 'humano'
--            → el desfase exacto de BUG-059
--         c) fila en la cola cuyo pedido ya tiene feedback → el 23505 esperando
--         d) fila en la cola de más de 6 h → el job de expiración no corrió
-- ---------------------------------------------------------------------------
select
 (select count(*) from clientes c where c.modo='esperando_feedback'
    and not exists (select 1 from feedback_pendiente fp where fp.cliente_id=c.cliente_id))  as a_modo_huerfano,
 (select count(*) from feedback_pendiente fp join clientes c on c.cliente_id=fp.cliente_id
    where c.modo not in ('esperando_feedback','humano'))                                    as b_cola_sin_modo,
 (select count(*) from feedback_pendiente fp
    where exists (select 1 from feedback f where f.pedido_id=fp.pedido_id))                 as c_cola_ya_calificada,
 (select count(*) from feedback_pendiente where fecha_solicitud < now()-interval '6 hours') as d_cola_vencida;
