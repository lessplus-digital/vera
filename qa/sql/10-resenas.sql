-- ============================================================================
-- QA · 10 · Flujo de reseñas / feedback
-- Oráculo: docs/bot/feedback.md · tablas `feedback`, `feedback_pendiente`,
--          `pedidos.feedback_solicitado`, `clientes.modo`
-- Estado 2026-09-12: 32 casos · 22 verde · 10 rojo (BUG-050, BUG-051).
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
-- T6 · 🔴 BUG-050 · La cola no caduca. Verde = 0 filas vencidas; hoy NO lo es.
--      Medido 2026-09-12 contra datos vivos: 9 filas, la más vieja de 108 días,
--      y 7 clientes atrapados en 'esperando_feedback'. Ningún job las toca
--      (cron.job tiene 3 jobs y ninguno es de feedback).
--      Este SELECT es la red permanente: en verde debe devolver 0 filas.
-- ---------------------------------------------------------------------------
select fp.telefono, fp.pedido_id, fp.estado,
       round(extract(epoch from (now()-fp.fecha_solicitud))/86400) as dias_en_cola,
       c.modo as modo_cliente,
       (select count(*) from feedback f where f.pedido_id=fp.pedido_id) as ya_tiene_feedback
from feedback_pendiente fp left join clientes c on c.cliente_id=fp.cliente_id
where fp.fecha_solicitud < now() - interval '48 hours'
order by fp.fecha_solicitud;


-- ---------------------------------------------------------------------------
-- T7 · Coherencia del estado vivo. Los cuatro contadores deben ser 0.
--      Medido 2026-09-12: **9 / 0 / 4 / 0** — (a) y (c) son BUG-050.
--      (b)=0 es verde real: no hay modo huérfano, porque el problema es el
--      contrario — hay cola de sobra, y apuntando al pedido equivocado.
--      Además: 7 clientes en 'esperando_feedback' ahora mismo.
--        a) filas en cola de más de 48 h
--        b) clientes en 'esperando_feedback' SIN fila en la cola
--           (el "modo huérfano" que el subworkflow dice limpiar)
--        c) filas en cola cuyo pedido YA tiene feedback (cola que debió borrarse)
--        d) feedback cuyo pedido no está 'entregado'
-- ---------------------------------------------------------------------------
select
 (select count(*) from feedback_pendiente where fecha_solicitud < now()-interval '48 hours') as a_cola_vencida,
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
