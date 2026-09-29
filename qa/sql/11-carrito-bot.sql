-- ============================================================================
-- QA · 11 · Carrito del bot Node (el precio lo pone la BD, nunca el LLM)
-- Cubre: precio_producto(), normalizar_tamano(), carrito_agregar_item(),
--        carrito_agregar_mitad(), carrito_quitar_item(), carrito_vaciar(),
--        tablas wa_eventos / bot_turnos / conversaciones (existencia + RLS)
-- Migración: supabase/migrations/20260929200000_bot_node_tablas_y_carrito.sql
-- Todo dentro de BEGIN…ROLLBACK. Teléfonos 5730000008xx, nunca uno real.
-- Devuelve SOLO las filas que fallan (vacío = verde).
--
-- Los precios esperados se leen de `menu` en la misma prueba (no se escriben a
-- mano), salvo en T3, que cambia un precio A PROPÓSITO dentro de la transacción.
--
-- ⚠️ TRAMPA ya conocida (batería 04): escribe en una sentencia y lee en la
--    siguiente; un subquery del mismo SELECT ve el snapshot previo.
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
delete from carritos where telefono like '5730000008%';

-- ---------------------------------------------------------------------------
-- T1 · precio_producto: de dónde sale el precio
-- ---------------------------------------------------------------------------
insert into qa_out(paso, esperado, valor)
select 'T1.1 pizza grande = tamaño.grande',
       (select "tamaño"::jsonb->>'grande' from menu where producto_id = 'PROD-006'),
       precio_producto('PROD-006', 'grande')->>'precio_unitario';
insert into qa_out(paso, esperado, valor)
select 'T1.2 alias "Personal" = pequena', 'pequena', precio_producto('PROD-006', 'Personal')->>'tamano';
insert into qa_out(paso, esperado, valor)
select 'T1.3 con tilde "Pequeña"', 'pequena', precio_producto('PROD-006', 'Pequeña')->>'tamano';
insert into qa_out(paso, esperado, valor)
select 'T1.4 pizza sin tamaño', 'TAMANO_REQUERIDO', precio_producto('PROD-006', null)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T1.5 un solo tamaño se asume', 'pequena', precio_producto('PROD-062', null)->>'tamano';
insert into qa_out(paso, esperado, valor)
select 'T1.6 tamaño que no existe', 'TAMANO_NO_DISPONIBLE', precio_producto('PROD-062', 'familiar')->>'error';
insert into qa_out(paso, esperado, valor)
select 'T1.7 bebida usa `precio`', (select precio::text from menu where producto_id = 'PROD-095'),
       precio_producto('PROD-095', null)->>'precio_unitario';
insert into qa_out(paso, esperado, valor)
select 'T1.8 bebida ignora el tamaño', 'Estándar', precio_producto('PROD-095', 'grande')->>'variante';
insert into qa_out(paso, esperado, valor)
select 'T1.9 producto inexistente', 'PRODUCTO_NO_ENCONTRADO', precio_producto('PROD-999999', null)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T1.10 id nulo', 'PRODUCTO_NO_ENCONTRADO', precio_producto(null, null)->>'error';

update menu set disponible = false where producto_id = 'PROD-016';
insert into qa_out(paso, esperado, valor)
select 'T1.11 agotado', 'PRODUCTO_AGOTADO', precio_producto('PROD-016', 'grande')->>'error';
update menu set disponible = true where producto_id = 'PROD-016';

-- ---------------------------------------------------------------------------
-- T2 · Agregar: precio del menú, líneas iguales se funden, total correcto
-- ---------------------------------------------------------------------------
select carrito_agregar_item('573000000811', 'PROD-006', 'grande', 2);
select carrito_agregar_item('573000000811', 'PROD-006', 'Grande', 1);                 -- misma línea
select carrito_agregar_item('573000000811', 'PROD-006', 'grande', 1, 'sin cebolla');  -- otra línea
select carrito_agregar_item('573000000811', 'PROD-095', null, 2);

insert into qa_out(paso, esperado, valor)
select 'T2.1 número de líneas', '3', jsonb_array_length(items)::text
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.2 la línea repetida suma cantidad', '3', items->0->>'cantidad'
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.3 las notas separan líneas', 'sin cebolla', items->1->>'notas_item'
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.4 subtotal = precio × cantidad',
       ((select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006') * 3)::text,
       items->0->>'subtotal'
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.5 total contra el menú',
       ((select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006') * 4
        + (select precio from menu where producto_id = 'PROD-095') * 2)::text,
       total::text
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.6 estado_pedido ve 3 líneas', '3', n_items::text
from estado_pedido where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T2.7 variante = tamaño legible', 'Grande', items->0->>'variante'
from carritos where telefono = '573000000811';

-- ---------------------------------------------------------------------------
-- T3 · El precio es el del menú EN ESE MOMENTO (el LLM no puede pasar uno).
--      Lo que ya estaba en un carrito conserva el precio con que entró: T6.3
--      depende de eso, por eso el precio se restaura al terminar.
-- ---------------------------------------------------------------------------
create temp table qa_precio on commit drop as select precio from menu where producto_id = 'PROD-095';
update menu set precio = 1234 where producto_id = 'PROD-095';
select carrito_agregar_item('573000000813', 'PROD-095', null, 1);
insert into qa_out(paso, esperado, valor)
select 'T3.1 precio cambiado en el menú', '1234', (items->0->>'precio_unitario')::numeric::int::text
from carritos where telefono = '573000000813';
insert into qa_out(paso, esperado, valor)
select 'T3.2 lo ya agregado no cambia', (select precio::int::text from qa_precio),
       (items->2->>'precio_unitario')::numeric::int::text
from carritos where telefono = '573000000811';
update menu set precio = (select precio from qa_precio) where producto_id = 'PROD-095';

-- ---------------------------------------------------------------------------
-- T4 · Errores: se devuelven como código, no revientan, no escriben
-- ---------------------------------------------------------------------------
insert into qa_out(paso, esperado, valor)
select 'T4.1 cantidad 0', 'CANTIDAD_INVALIDA', carrito_agregar_item('573000000814', 'PROD-006', 'grande', 0)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T4.2 cantidad 51', 'CANTIDAD_INVALIDA', carrito_agregar_item('573000000814', 'PROD-006', 'grande', 51)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T4.3 teléfono vacío', 'TELEFONO_REQUERIDO', carrito_agregar_item('  ', 'PROD-006', 'grande')->>'error';
insert into qa_out(paso, esperado, valor)
select 'T4.4 sin tamaño', 'TAMANO_REQUERIDO', carrito_agregar_item('573000000814', 'PROD-006', null)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T4.5 ningún error creó carrito', '0', count(*)::text from carritos where telefono = '573000000814';

-- ---------------------------------------------------------------------------
-- T5 · Mitad y mitad: se cobra la mitad más cara, mismas reglas del cotizador
-- ---------------------------------------------------------------------------
select carrito_agregar_mitad('573000000815', 'PROD-006', 'PROD-016', 'grande');
insert into qa_out(paso, esperado, valor)
select 'T5.1 precio = la mitad más cara',
       greatest((select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006'),
                (select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-016'))::text,
       items->0->>'precio_unitario'
from carritos where telefono = '573000000815';
insert into qa_out(paso, esperado, valor)
select 'T5.2 guarda las 2 mitades', '2', jsonb_array_length(items->0->'mitades')::text
from carritos where telefono = '573000000815';
insert into qa_out(paso, esperado, valor)
select 'T5.3 masas distintas', 'MASA_DISTINTA',
       carrito_agregar_mitad('573000000815', 'PROD-006', 'PROD-012', 'grande')->>'error';
select carrito_agregar_mitad('573000000816', 'PROD-006', 'PROD-016', 'grande');
select carrito_agregar_mitad('573000000816', 'PROD-006', 'PROD-016', 'grande');
insert into qa_out(paso, esperado, valor)
select 'T5.4 dos mitad-y-mitad = dos líneas', '2', jsonb_array_length(items)::text
from carritos where telefono = '573000000816';

-- ---------------------------------------------------------------------------
-- T6 · Quitar: parcial, completo, línea inválida, vaciar vuelve a 'armando'
-- ---------------------------------------------------------------------------
select carrito_quitar_item('573000000811', 1, 1);   -- 3 → 2 de la primera línea
insert into qa_out(paso, esperado, valor)
select 'T6.1 quitar 1 de 3', '2', items->0->>'cantidad' from carritos where telefono = '573000000811';
select carrito_quitar_item('573000000811', 2);      -- quita la línea "sin cebolla"
insert into qa_out(paso, esperado, valor)
select 'T6.2 quitar línea completa', '2', jsonb_array_length(items)::text from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T6.3 el total se recalcula',
       ((select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006') * 2
        + (select precio from menu where producto_id = 'PROD-095') * 2)::text,
       total::text
from carritos where telefono = '573000000811';
insert into qa_out(paso, esperado, valor)
select 'T6.4 línea fuera de rango', 'LINEA_INVALIDA', carrito_quitar_item('573000000811', 9)->>'error';
insert into qa_out(paso, esperado, valor)
select 'T6.5 carrito que no existe', 'CARRITO_VACIO', carrito_quitar_item('573000000899', 1)->>'error';

update carritos set paso_flujo = 'resumen' where telefono = '573000000811';
select carrito_vaciar('573000000811');
insert into qa_out(paso, esperado, valor)
select 'T6.6 vaciar → items [] total 0 paso armando', '[] 0 armando',
       items::text || ' ' || total::int::text || ' ' || paso_flujo
from carritos where telefono = '573000000811';

-- ---------------------------------------------------------------------------
-- T7 · Tablas nuevas: existen, con RLS, y el helper interno no es público
-- ---------------------------------------------------------------------------
insert into qa_out(paso, esperado, valor)
select 'T7.1 RLS en tablas nuevas', '3', count(*)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('wa_eventos', 'bot_turnos', 'conversaciones') and c.relrowsecurity;
insert into qa_out(paso, esperado, valor)
select 'T7.2 anon no ejecuta el helper interno', 'false',
       has_function_privilege('anon', 'public._carrito_guardar_items(text, jsonb)', 'execute')::text;

-- ---------------------------------------------------------------------------
-- Veredicto: SOLO lo que falla
-- ---------------------------------------------------------------------------
select paso, esperado, valor
from qa_out
where not (valor is not distinct from esperado)
order by n;

rollback;
