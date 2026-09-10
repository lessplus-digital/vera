-- ============================================================================
-- QA · 05 · Totales del pedido
-- Cubre: trigger_actualizar_total, trigger_tarifa_domicilio, editar_pedido()
-- Todo dentro de BEGIN…ROLLBACK. Estado 2026-09-09: 14/14 verde.
--
-- Invariante rector:  pedidos.total = SUM(items) + costo_domicilio  — UNA sola vez.
-- Dos triggers lo mantienen con estrategias distintas y es ahí donde podría
-- haber doble conteo:
--   · trigger_actualizar_total (AFTER en detalle_pedidos) recalcula DESDE CERO
--   · trigger_tarifa_domicilio (BEFORE en pedidos)        ajusta POR DELTA
-- El delta es deliberado: hay pedidos históricos sin ítems cuyo total se escribió
-- a mano y un recálculo desde cero los reventaría (edge-case §23).
--
-- ⚠️ Este test hace UPDATE sobre `pedidos`, que dispara `notificar-estado-pedido`
--    (pg_net → n8n → WhatsApp al cliente). El ROLLBACK también revierte la fila
--    encolada por pg_net, así que no sale ningún mensaje — pero usa siempre un
--    teléfono ficticio (aquí 573000000900) por si acaso.
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity,
                         paso text, esperado numeric, valor numeric, extra text) on commit drop;

insert into clientes(cliente_id, nombre, telefono, fecha_registro)
 values ('CLI-QA9', 'QA Totales', '573000000900', current_date);
insert into pedidos(pedido_id, cliente_id, telefono, tipo_pedido, metodo_pago, barrio)
 values ('PED-QA9', 'CLI-QA9', '573000000900', 'domicilio', 'Efectivo', 'Niquía');

-- T1 · Un pedido recién creado tiene total 0 aunque ya tenga envío: el INSERT
--      NO toca `total` a propósito, lo escribe el trigger de detalle_pedidos.
insert into qa_out(paso, esperado, valor, extra)
select 'T1 sin items (por diseño total=0)', 0, total, 'envio='||costo_domicilio::text
from pedidos where pedido_id = 'PED-QA9';

insert into detalle_pedidos(detalle_id, pedido_id, producto_id, nombre_producto, cantidad, precio_unitario)
 values ('DET-QA1', 'PED-QA9', 'PROD-019', 'Bizancio', 1, 24500),
        ('DET-QA2', 'PED-QA9', 'PROD-020', 'Jamon y Queso Especial', 2, 11500);
insert into qa_out(paso, esperado, valor, extra)
select 'T2 2 items 47500+7500', 55000, total, '' from pedidos where pedido_id = 'PED-QA9';

-- T3 · REGRESIÓN edge-case §22: en DELETE, NEW es NULL. Sin el COALESCE el
--      UPDATE filtraba por pedido_id = NULL y el total se quedaba clavado.
delete from detalle_pedidos where detalle_id = 'DET-QA2';
insert into qa_out(paso, esperado, valor, extra)
select 'T3 BORRAR item (regresion §22)', 32000, total, '' from pedidos where pedido_id = 'PED-QA9';

update detalle_pedidos set cantidad = 3 where detalle_id = 'DET-QA1';
insert into qa_out(paso, esperado, valor, extra)
select 'T4 cantidad 1->3', 81000, total, '' from pedidos where pedido_id = 'PED-QA9';

-- T5-T6 · El combo peligroso: cambiar de zona (delta) y luego meter un ítem
--         (recálculo desde cero). El envío debe contarse UNA vez (edge-case §24).
update pedidos set barrio = 'Centro' where pedido_id = 'PED-QA9';
insert into qa_out(paso, esperado, valor, extra)
select 'T5 Niquía->Centro (delta)', 78500, total, 'envio='||costo_domicilio::text
from pedidos where pedido_id = 'PED-QA9';

insert into detalle_pedidos(detalle_id, pedido_id, producto_id, nombre_producto, cantidad, precio_unitario)
 values ('DET-QA3', 'PED-QA9', 'PROD-021', 'Vegetariana', 1, 36500);
insert into qa_out(paso, esperado, valor, extra)
select 'T6 item nuevo tras cambio barrio', 115000, total, '' from pedidos where pedido_id = 'PED-QA9';

update pedidos set tipo_pedido = 'recoger' where pedido_id = 'PED-QA9';
insert into qa_out(paso, esperado, valor, extra)
select 'T7 domicilio->recoger', 110000, total,
       'envio='||costo_domicilio::text||' barrio='||coalesce(barrio,'∅')
from pedidos where pedido_id = 'PED-QA9';

update pedidos set tipo_pedido = 'domicilio', barrio = 'Niquía' where pedido_id = 'PED-QA9';
insert into qa_out(paso, esperado, valor, extra)
select 'T8 recoger->domicilio', 117500, total, 'envio='||costo_domicilio::text
from pedidos where pedido_id = 'PED-QA9';

-- T9 · Override manual del envío (promo / envío gratis del admin): se respeta
--      el número y solo se corrige el total.
update pedidos set costo_domicilio = 0 where pedido_id = 'PED-QA9';
insert into qa_out(paso, esperado, valor, extra)
select 'T9 promo envio gratis', 110000, total, 'envio='||costo_domicilio::text
from pedidos where pedido_id = 'PED-QA9';

-- ── editar_pedido() — la RPC del dashboard ───────────────────────────────────
update pedidos set costo_domicilio = 7500 where pedido_id = 'PED-QA9';
select editar_pedido('PED-QA9',
  '[{"producto_id":"PROD-019","nombre_producto":"Bizancio","cantidad":2,"precio_unitario":24500,
     "notas_item":"sin cebolla","mitades":[{"producto_id":"PROD-019"},{"producto_id":"PROD-020"}]}]'::jsonb);
insert into qa_out(paso, esperado, valor, extra)
select 'T10 editar_pedido (49000+7500)', 56500, total, '' from pedidos where pedido_id = 'PED-QA9';

insert into qa_out(paso, esperado, valor, extra)
select 'T11 arrastra mitades y notas_item', 1,
       (select count(*) from detalle_pedidos
         where pedido_id = 'PED-QA9' and notas_item = 'sin cebolla'
           and jsonb_array_length(mitades) = 2), '';

insert into qa_out(paso, esperado, valor, extra)
select 'T12 items vacio -> SIN_ITEMS', 1,
       case when editar_pedido('PED-QA9', '[]'::jsonb)->>'error' = 'SIN_ITEMS' then 1 else 0 end, '';

insert into qa_out(paso, esperado, valor, extra)
select 'T13 pedido inexistente', 1,
       case when editar_pedido('PED-NOPE',
              '[{"producto_id":"PROD-019","cantidad":1,"precio_unitario":100}]'::jsonb
            )->>'error' = 'PEDIDO_NO_ENCONTRADO' then 1 else 0 end, '';

update pedidos set estado = 'en_cocina' where pedido_id = 'PED-QA9';
insert into qa_out(paso, esperado, valor, extra)
select 'T14 estado!=pendiente -> YA_PROCESADO', 1,
       case when editar_pedido('PED-QA9',
              '[{"producto_id":"PROD-019","nombre_producto":"B","cantidad":1,"precio_unitario":100}]'::jsonb
            )->>'error' = 'PEDIDO_YA_PROCESADO' then 1 else 0 end, '';

select paso, esperado, valor, extra,
       case when valor = esperado then '✓' else '✗ FALLA' end as ok
from qa_out order by n;

rollback;
