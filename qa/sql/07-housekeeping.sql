-- ============================================================================
-- QA · 07 · Housekeeping (los jobs que corren solos y en silencio)
-- Cubre: expirar_pedidos_pendientes(), limpiar_carritos_abandonados(),
--        registrar_contexto_handoff(), constraint unique_pedido_cliente_minuto
-- Todo dentro de BEGIN…ROLLBACK. Estado 2026-09-09: 19/19 verde.
--
-- Estos jobs son el escenario de edge-case §26: uno de limpieza que llevaba
-- meses sin limpiar nada y nadie lo notó, porque un job roto y uno que no tiene
-- trabajo se ven exactamente igual desde fuera.
--
-- Estado de pg_cron verificado el 2026-09-09 (cron.job_run_details):
--   · expirar-pedidos-pendientes    0 16 * * *  → 30 corridas, 30 OK
--   · limpiar-carritos-abandonados  0 8  * * *  → 655 corridas, 655 OK
--   · limpiar_historial_chat_semanal 0 3 * * 1  → 16 corridas, 16 OK
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
create temp table c(corte timestamp) on commit drop;
-- Corte = medianoche Colombia expresada en UTC (fecha_pedido es timestamp SIN
-- zona con valor UTC — convención del proyecto).
insert into c select (date_trunc('day', now() at time zone 'America/Bogota')
                      at time zone 'America/Bogota') at time zone 'UTC';

insert into clientes(cliente_id, nombre, telefono, fecha_registro)
 values ('CLI-QAH', 'QA Housekeeping', '573000000903', current_date);

-- ---------------------------------------------------------------------------
-- T1-T5 · Las tres fronteras de la expiración + que no toque otros estados.
-- ---------------------------------------------------------------------------
insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, estado, fecha_pedido)
select 'PED-QH1', 'CLI-QAH', '573000000903', 'recoger', 'Efectivo', 'pendiente', corte - interval '2 hours' from c;
insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, estado, fecha_pedido)
select 'PED-QH2', 'CLI-QAH', '573000000903', 'recoger', 'Efectivo', 'pendiente', corte + interval '5 minutes' from c;
insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, estado, fecha_pedido)
values ('PED-QH3', 'CLI-QAH', '573000000903', 'recoger', 'Efectivo', 'pendiente', (now() at time zone 'UTC'));
-- +7 min para no chocar con unique_pedido_cliente_minuto (ver T7)
insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, estado, fecha_pedido)
select 'PED-QH4', 'CLI-QAH', '573000000903', 'recoger', 'Efectivo', 'en_cocina', corte - interval '2 hours 7 minutes' from c;

insert into qa_out(paso, esperado, valor) select 'T1 expirados en la corrida', '1', expirar_pedidos_pendientes()::text;
insert into qa_out(paso, esperado, valor) select 'T2 -2h del corte -> cancelado', 'cancelado', estado from pedidos where pedido_id = 'PED-QH1';
insert into qa_out(paso, esperado, valor) select 'T3 00:05 de hoy -> sobrevive', 'pendiente', estado from pedidos where pedido_id = 'PED-QH2';
insert into qa_out(paso, esperado, valor) select 'T4 ahora mismo -> sobrevive', 'pendiente', estado from pedidos where pedido_id = 'PED-QH3';
insert into qa_out(paso, esperado, valor) select 'T5 en_cocina viejo -> intacto', 'en_cocina', estado from pedidos where pedido_id = 'PED-QH4';

-- T6 · El texto tiene que encajar en la plantilla de n8n, que lo envuelve.
insert into qa_out(paso, esperado, valor)
select 'T6 texto para la plantilla n8n',
       '❌ Tu pedido fue cancelado, no alcanzamos a procesarlo antes del cierre del día. Lamentamos los inconvenientes.',
       '❌ Tu pedido fue cancelado, '||motivo_rechazo||'. Lamentamos los inconvenientes.'
from pedidos where pedido_id = 'PED-QH1';

-- ---------------------------------------------------------------------------
-- T7 · Anti doble-confirmación: `unique_pedido_cliente_minuto` sobre
--      (telefono, date_trunc('minute', fecha_pedido)). Es lo que salva de que
--      un cliente impaciente diga "confirmo" dos veces y le entren 2 pedidos.
-- ---------------------------------------------------------------------------
do $$ begin
  insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, estado, fecha_pedido)
  values ('PED-QH5', 'CLI-QAH', '573000000903', 'recoger', 'Efectivo', 'pendiente',
          (select fecha_pedido from pedidos where pedido_id = 'PED-QH3'));
  insert into qa_out(paso, esperado, valor) values ('T7 2o pedido en el mismo minuto', 'rechaza', 'NO REVENTO');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T7 2o pedido en el mismo minuto', 'rechaza', 'rechaza');
end $$;

-- ---------------------------------------------------------------------------
-- T8-T11 · Carritos abandonados. REGRESIÓN de edge-case §26.
--
-- ⚠️ TRAMPA (mordió el 2026-09-09): NO se puede envejecer un carrito con un
--    UPDATE — el trigger `trg_carritos_touch_updated_at` es BEFORE UPDATE y
--    reescribe `updated_at` a now(), que es justo lo que este test verifica.
--    Hay que poner el `updated_at` viejo en el INSERT (el trigger no cubre INSERT).
-- ---------------------------------------------------------------------------
delete from carritos where telefono like '5730000009%';
insert into carritos(telefono, items, total, updated_at) values ('573000000904', '[{"x":1}]'::jsonb, 1000, now() - interval '30 hours');
insert into carritos(telefono, items, total, updated_at) values ('573000000907', '[{"x":1}]'::jsonb, 1000, now() - interval '25 hours');
insert into carritos(telefono, items, total, updated_at) values ('573000000908', '[{"x":1}]'::jsonb, 1000, now() - interval '23 hours');
insert into carritos(telefono, items, total)              values ('573000000905', '[{"x":1}]'::jsonb, 1000);

insert into qa_out(paso, esperado, valor) select 'T8 limpia los 2 de >24h', '2', limpiar_carritos_abandonados()::text;
insert into qa_out(paso, esperado, valor)
select 'T9 sobreviven el de 23h y el fresco', '573000000905,573000000908',
       string_agg(telefono, ',' order by telefono) from carritos where telefono like '5730000009%';

insert into carritos(telefono, items, total, updated_at) values ('573000000909', '[{"x":1}]'::jsonb, 1000, now() - interval '30 hours');
update carritos set total = 2000 where telefono = '573000000909';
insert into qa_out(paso, esperado, valor)
select 'T10 UPDATE refresca updated_at (§26)', 'fresco',
       case when updated_at > now() - interval '1 minute' then 'fresco' else 'CONGELADO' end
from carritos where telefono = '573000000909';
insert into qa_out(paso, esperado, valor) select 'T11 y por eso el job ya no lo borra', '0', limpiar_carritos_abandonados()::text;

select paso, esperado, valor, case when valor = esperado then '✓' else '✗ FALLA' end as ok
from qa_out order by n;
rollback;

-- ============================================================================
-- T12-T19 · registrar_contexto_handoff() — las cuatro trampas de edge-case §21
-- Se simula una conversación CON todo el ruido real de la memoria compartida:
-- el mismo mensaje del cliente guardado 3 veces por dos sesiones distintas, el
-- JSON de clasificación del orquestador, un mensaje `tool` y un `content` que
-- no es string.
-- ============================================================================
begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
delete from mensajes_soporte where telefono = '573000000910';
delete from n8n_chat_histories where session_id in ('573000000910', 'orq:573000000910');

insert into n8n_chat_histories(session_id, message, created_at) values
 ('orq:573000000910', '{"type":"human","content":"hola quiero pedir"}'::jsonb,                       now() - interval '10 min'),
 ('orq:573000000910', '{"type":"ai","content":"{\"agente\":\"menu\",\"razon\":\"pide productos\"}"}'::jsonb, now() - interval '9 min'),
 ('573000000910',     '{"type":"human","content":"hola quiero pedir"}'::jsonb,                       now() - interval '9 min'),
 ('573000000910',     '{"type":"human","content":"hola quiero pedir"}'::jsonb,                       now() - interval '9 min'),
 ('573000000910',     '{"type":"ai","content":"¡Hola! ¿Qué te provoca hoy?"}'::jsonb,                now() - interval '8 min'),
 ('573000000910',     '{"type":"tool","content":"{\"productos\":[]}"}'::jsonb,                         now() - interval '7 min'),
 ('573000000910',     '{"type":"ai","content":{"objeto":"no es string"}}'::jsonb,                     now() - interval '7 min'),
 ('573000000910',     '{"type":"human","content":"esto es un desastre, quiero hablar con alguien"}'::jsonb, now() - interval '6 min'),
 ('573000000910',     '{"type":"ai","content":"Te conecto con nuestro equipo. Un momento por favor 🙋"}'::jsonb, now() - interval '5 min');

insert into qa_out(paso, esperado, valor) select 'T12 vuelca 4 (9 filas - ruido - duplicados)', '4', registrar_contexto_handoff('573000000910')::text;
insert into qa_out(paso, esperado, valor) select 'T13 idempotente en la 2a corrida', '0', registrar_contexto_handoff('573000000910')::text;
insert into qa_out(paso, esperado, valor) select 'T14 filtra el JSON del orquestador', '0',
  count(*)::text from mensajes_soporte where telefono = '573000000910' and mensaje like '%"agente"%';
insert into qa_out(paso, esperado, valor) select 'T15 dedup de 3 copias -> 1', '1',
  count(*)::text from mensajes_soporte where telefono = '573000000910' and mensaje = 'hola quiero pedir';
insert into qa_out(paso, esperado, valor) select 'T16 filtra tipo tool y content no-string', '0',
  count(*)::text from mensajes_soporte where telefono = '573000000910' and (mensaje like '%productos%' or mensaje like '%objeto%');
insert into qa_out(paso, esperado, valor) select 'T17 lee las DOS sesiones', '1',
  count(*)::text from mensajes_soporte where telefono = '573000000910' and mensaje = 'hola quiero pedir';
insert into qa_out(paso, esperado, valor) select 'T18 orden cliente|bot|cliente|bot', 'cliente|bot|cliente|bot',
  string_agg(origen, '|' order by created_at) from mensajes_soporte where telefono = '573000000910';
-- La trampa del desempate por microsegundos: sin él, la respuesta del bot se
-- pintaba ANTES de la pregunta del cliente en el dashboard.
insert into qa_out(paso, esperado, valor) select 'T19 la queja va ANTES de la respuesta (§21)', 'si',
  case when (select created_at from mensajes_soporte where telefono = '573000000910' and mensaje like 'esto es un desastre%')
          < (select created_at from mensajes_soporte where telefono = '573000000910' and mensaje like 'Te conecto%')
       then 'si' else 'NO — el bot se pinta antes' end;

select paso, esperado, valor, case when valor = esperado then '✓' else '✗ FALLA' end as ok
from qa_out order by n;
rollback;
