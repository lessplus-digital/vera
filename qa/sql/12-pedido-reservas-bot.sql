-- ============================================================================
-- QA · 12 · Crear pedido y reservas del bot Node
-- Cubre: crear_orden_desde_carrito(), consultar_disponibilidad_reserva(),
--        crear_reserva_bot(), cancelar_reserva_bot(), reservas_del_cliente()
-- Migración: supabase/migrations/20260929210000_bot_node_pedido_y_reservas.sql
--            (depende de 20260929200000: precio_producto, carrito_agregar_*)
-- Todo dentro de BEGIN…ROLLBACK. Teléfonos 5730000008xx, nunca uno real.
-- Devuelve SOLO las filas que fallan (vacío = verde).
--
-- ⚠️ TRAMPAS DE MONTAJE
--  * now() no avanza dentro de una transacción: todos los pedidos de esta
--    batería tienen la MISMA fecha_pedido. El índice unique_pedido_cliente_minuto
--    (telefono, minuto) hace que el segundo pedido de un mismo teléfono choque.
--    Cada pedido que se espera crear usa su propio teléfono; T1.6 usa eso a
--    propósito para probar PEDIDO_DUPLICADO.
--  * Las fechas de reserva se calculan relativas a HOY en Colombia, nunca fijas.
--  * Escribe en una sentencia y lee en la siguiente (snapshot, batería 04).
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
delete from carritos where telefono like '5730000008%';

-- Clientes de prueba (uno por teléfono que va a crear pedido o reserva)
create temp table qa_cli(telefono text, cliente_id text) on commit drop;
with nuevos as (
  insert into clientes (nombre, telefono, fecha_registro)
  select 'QA 12 ' || t, t, current_date
  from unnest(array['573000000821','573000000822','573000000823','573000000824',
                    '573000000825','573000000826','573000000827','573000000828']) t
  returning telefono, cliente_id
) insert into qa_cli select telefono, cliente_id from nuevos;

create function pg_temp.cli(t text) returns text language sql as
  $$ select cliente_id from qa_cli where telefono = t $$;
-- Arma un carrito "listo para resumen" para recoger, con una pizza grande.
create function pg_temp.carrito_recoger(t text) returns void language plpgsql as $$
begin
  perform carrito_agregar_item(t, 'PROD-006', 'grande', 1);
  perform guardar_datos_pedido(t, p_tipo_pedido := 'recoger', p_metodo_pago := 'Efectivo');
end $$;

-- ---------------------------------------------------------------------------
-- T1 · crear_orden_desde_carrito: barreras antes de crear
-- ---------------------------------------------------------------------------
insert into qa_out(paso, esperado, valor)
select 'T1.1 sin carrito', 'CARRITO_VACIO',
       crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000821'))->>'error';

select carrito_agregar_item('573000000821', 'PROD-006', 'grande', 1);
insert into qa_out(paso, esperado, valor)
select 'T1.2 faltan datos', 'DATOS_INCOMPLETOS',
       crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000821'))->>'error';

select guardar_datos_pedido('573000000821', p_tipo_pedido := 'recoger', p_metodo_pago := 'Efectivo');
insert into qa_out(paso, esperado, valor)
select 'T1.3 sin resumen mostrado', 'SIN_RESUMEN',
       crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000821'))->>'error';

update carritos set paso_flujo = 'resumen' where telefono = '573000000821';
insert into qa_out(paso, esperado, valor)
select 'T1.4 cliente de otro teléfono', 'CLIENTE_INVALIDO',
       crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000822'))->>'error';

-- ---------------------------------------------------------------------------
-- T1.5 · Camino feliz (recoger): una transacción, total del trigger, carrito borrado
-- ---------------------------------------------------------------------------
create temp table qa_r on commit drop as
select crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000821')) r;

insert into qa_out(paso, esperado, valor)
select 'T1.5a ok', 'true', r->>'ok' from qa_r;
insert into qa_out(paso, esperado, valor)
select 'T1.5b total devuelto = total en pedidos', (select total::text from pedidos where pedido_id = r->>'pedido_id'),
       r->>'total' from qa_r;
insert into qa_out(paso, esperado, valor)
select 'T1.5c total = precio del menú (recoger, sin domicilio)',
       (select ("tamaño"::jsonb->>'grande')::numeric(12,2) from menu where producto_id = 'PROD-006')::text,
       (select total::numeric(12,2)::text from pedidos where pedido_id = r->>'pedido_id') from qa_r;
insert into qa_out(paso, esperado, valor)
select 'T1.5d una línea de detalle', '1',
       (select count(*)::text from detalle_pedidos where pedido_id = r->>'pedido_id') from qa_r;
insert into qa_out(paso, esperado, valor)
select 'T1.5e carrito borrado', '0', count(*)::text from carritos where telefono = '573000000821';

-- T1.6 · Segundo pedido del mismo teléfono en el mismo minuto → no se duplica
select pg_temp.carrito_recoger('573000000821');
update carritos set paso_flujo = 'resumen' where telefono = '573000000821';
insert into qa_out(paso, esperado, valor)
select 'T1.6 doble "sí" en el mismo minuto', 'PEDIDO_DUPLICADO',
       crear_orden_desde_carrito('573000000821', pg_temp.cli('573000000821'))->>'error';
insert into qa_out(paso, esperado, valor)
select 'T1.6b sigue habiendo un solo pedido', '1', count(*)::text from pedidos where telefono = '573000000821';

-- ---------------------------------------------------------------------------
-- T2 · Domicilio: tarifa real del barrio, barrio no resuelto, tarifa desactualizada
-- ---------------------------------------------------------------------------
select carrito_agregar_item('573000000822', 'PROD-006', 'grande', 1);
select guardar_datos_pedido('573000000822', p_tipo_pedido := 'domicilio', p_barrio := 'Niquía',
         p_costo_domicilio := (select costo from resolver_barrio('Niquía')), p_cobertura_ok := true,
         p_direccion_entrega := 'Cra 50 #20-15', p_metodo_pago := 'Transferencia', p_paso_flujo := 'resumen');
create temp table qa_r2 on commit drop as
select crear_orden_desde_carrito('573000000822', pg_temp.cli('573000000822')) r;
insert into qa_out(paso, esperado, valor)
select 'T2.1 domicilio ok', 'true', r->>'ok' from qa_r2;
insert into qa_out(paso, esperado, valor)
select 'T2.2 costo_domicilio = tarifa del barrio', (select costo::text from resolver_barrio('Niquía')),
       (select costo_domicilio::text from pedidos where pedido_id = r->>'pedido_id') from qa_r2;
insert into qa_out(paso, esperado, valor)
select 'T2.3 total = ítems + domicilio',
       ((select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006')
        + (select costo from resolver_barrio('Niquía')))::numeric(12,2)::text,
       (r->>'total')::numeric(12,2)::text from qa_r2;

-- BUG-061: barrio crudo con errata guardado sin confirmar → antes cobraba tarifa base
select carrito_agregar_item('573000000823', 'PROD-006', 'grande', 1);
select guardar_datos_pedido('573000000823', p_tipo_pedido := 'domicilio', p_barrio := 'niqia',
         p_costo_domicilio := 7500, p_cobertura_ok := true,
         p_direccion_entrega := 'Cra 50 #20-15', p_metodo_pago := 'Efectivo', p_paso_flujo := 'resumen');
insert into qa_out(paso, esperado, valor)
select 'T2.4 barrio no resuelto no se cobra a ciegas', 'BARRIO_NO_RESUELTO',
       crear_orden_desde_carrito('573000000823', pg_temp.cli('573000000823'))->>'error';

-- Tarifa que se le dijo al cliente ≠ tarifa real → se corrige y se vuelve a mostrar el resumen
update carritos set barrio = 'Niquía', costo_domicilio = 1, cobertura_ok = true where telefono = '573000000823';
insert into qa_out(paso, esperado, valor)
select 'T2.5 tarifa desactualizada', 'TARIFA_ACTUALIZADA',
       crear_orden_desde_carrito('573000000823', pg_temp.cli('573000000823'))->>'error';
insert into qa_out(paso, esperado, valor)
select 'T2.6 el carrito queda con la tarifa real y vuelve a datos',
       (select costo::text from resolver_barrio('Niquía')) || ' datos',
       costo_domicilio::text || ' ' || paso_flujo from carritos where telefono = '573000000823';

-- ---------------------------------------------------------------------------
-- T3 · Re-cotización al cerrar: precio cambiado y producto agotado
-- ---------------------------------------------------------------------------
select pg_temp.carrito_recoger('573000000824');
update carritos set paso_flujo = 'resumen' where telefono = '573000000824';
-- Precio "viejo" en el carrito (como si el menú hubiera subido después de agregarlo)
update carritos set items = jsonb_set(items, '{0,precio_unitario}', '1000'::jsonb) where telefono = '573000000824';
insert into qa_out(paso, esperado, valor)
select 'T3.1 precio distinto al del menú', 'PRECIOS_ACTUALIZADOS',
       crear_orden_desde_carrito('573000000824', pg_temp.cli('573000000824'))->>'error';
insert into qa_out(paso, esperado, valor)
select 'T3.2 el carrito queda con el precio del menú',
       (select ("tamaño"::jsonb->>'grande')::numeric from menu where producto_id = 'PROD-006')::text,
       (items->0->>'precio_unitario') from carritos where telefono = '573000000824';
insert into qa_out(paso, esperado, valor)
select 'T3.3 y vuelve a paso datos (hay que re-mostrar el resumen)', 'datos', paso_flujo
from carritos where telefono = '573000000824';
insert into qa_out(paso, esperado, valor)
select 'T3.4 no se creó pedido', '0', count(*)::text from pedidos where telefono = '573000000824';

select pg_temp.carrito_recoger('573000000825');
update carritos set paso_flujo = 'resumen' where telefono = '573000000825';
update menu set disponible = false where producto_id = 'PROD-006';
insert into qa_out(paso, esperado, valor)
select 'T3.5 producto agotado al cerrar', 'PRODUCTO_NO_DISPONIBLE',
       crear_orden_desde_carrito('573000000825', pg_temp.cli('573000000825'))->>'error';
update menu set disponible = true where producto_id = 'PROD-006';

-- Mitad y mitad se re-cotiza con el cotizador y se guarda con sus mitades
select carrito_agregar_mitad('573000000826', 'PROD-006', 'PROD-016', 'grande');
select guardar_datos_pedido('573000000826', p_tipo_pedido := 'recoger', p_metodo_pago := 'Efectivo',
                            p_paso_flujo := 'resumen');
create temp table qa_r3 on commit drop as
select crear_orden_desde_carrito('573000000826', pg_temp.cli('573000000826')) r;
insert into qa_out(paso, esperado, valor)
select 'T3.6 mitad y mitad crea pedido', 'true', r->>'ok' from qa_r3;
insert into qa_out(paso, esperado, valor)
select 'T3.7 detalle guarda las 2 mitades', '2',
       (select jsonb_array_length(mitades)::text from detalle_pedidos where pedido_id = r->>'pedido_id') from qa_r3;

-- ---------------------------------------------------------------------------
-- T4 · Disponibilidad de reservas (fechas relativas a hoy en Colombia)
-- ---------------------------------------------------------------------------
create temp table qa_f on commit drop as
select (now() at time zone 'America/Bogota')::date + 1 as manana,
       (select d from generate_series((now() at time zone 'America/Bogota')::date + 1,
                                      (now() at time zone 'America/Bogota')::date + 7, interval '1 day') d
         where extract(isodow from d) between 1 and 5 limit 1)::date as entre_semana,
       (select d from generate_series((now() at time zone 'America/Bogota')::date + 1,
                                      (now() at time zone 'America/Bogota')::date + 7, interval '1 day') d
         where extract(isodow from d) > 5 limit 1)::date as finde;

insert into qa_out(paso, esperado, valor)
select 'T4.1 mañana 13:00 disponible', 'true',
       consultar_disponibilidad_reserva(manana, '13:00', 4)->>'disponible' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.2 ayer', 'FECHA_PASADA',
       consultar_disponibilidad_reserva(manana - 2, '13:00')->>'error' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.3 a 15 días', 'MUY_LEJOS',
       consultar_disponibilidad_reserva(manana + 14, '13:00')->>'error' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.4 11:00 (no ha abierto)', 'FUERA_DE_HORARIO',
       consultar_disponibilidad_reserva(manana, '11:00')->>'error' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.5 21:00 entre semana (límite 20:30, BUG-049)', 'FUERA_DE_HORARIO',
       consultar_disponibilidad_reserva(entre_semana, '21:00')->>'error' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.6 21:00 fin de semana (límite 21:30)', 'true',
       consultar_disponibilidad_reserva(finde, '21:00')->>'ok' from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T4.7 13 personas', 'PERSONAS_FUERA_DE_RANGO',
       consultar_disponibilidad_reserva(manana, '13:00', 13)->>'error' from qa_f;

-- ---------------------------------------------------------------------------
-- T5 · Crear, repetir, cupo lleno, cancelar
-- ---------------------------------------------------------------------------
create temp table qa_res on commit drop as
select crear_reserva_bot('573000000827', pg_temp.cli('573000000827'), 'QA', manana, '13:00', 4,
                         null, 'mesa cerca a la ventana') r from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T5.1 crea', 'true', r->>'ok' from qa_res;
insert into qa_out(paso, esperado, valor)
select 'T5.2 guarda las notas (BUG-029)', 'mesa cerca a la ventana',
       (select notas from reservas where reserva_id = r->>'reserva_id') from qa_res;
insert into qa_out(paso, esperado, valor)
select 'T5.3 sin motivo = sin_ocasion', 'sin_ocasion', r->>'motivo' from qa_res;

insert into qa_out(paso, esperado, valor)
select 'T5.4 repetir = la misma reserva', 'true',
       crear_reserva_bot('573000000827', pg_temp.cli('573000000827'), 'QA', manana, '13:00', 4)->>'ya_existia'
from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T5.5 sigue habiendo una', '1', count(*)::text from reservas where telefono = '573000000827';

insert into qa_out(paso, esperado, valor)
select 'T5.6 motivo inventado', 'MOTIVO_INVALIDO',
       crear_reserva_bot('573000000828', pg_temp.cli('573000000828'), 'QA', manana, '14:00', 2, 'boda')->>'error'
from qa_f;
insert into qa_out(paso, esperado, valor)
select 'T5.7 motivo con costo', (select costo::text from motivos_reserva where clave = 'cumpleanos'),
       crear_reserva_bot('573000000828', pg_temp.cli('573000000828'), 'QA', manana, '14:00', 2, 'Cumpleanos')->>'costo_motivo'
from qa_f;

-- Llenar las 8 mesas de las 19:00 de mañana y pedir una más
insert into reservas (telefono, nombre_cliente, fecha, hora, personas, estado, origen)
select '5730000008' || (50 + g)::text, 'QA relleno', manana, '19:00', 2, 'confirmada', 'dashboard'
from qa_f, generate_series(1, 8) g;
insert into qa_out(paso, esperado, valor)
select 'T5.8 cupo lleno', 'SIN_CUPO',
       crear_reserva_bot('573000000828', pg_temp.cli('573000000828'), 'QA', manana, '19:30', 2)->>'error'
from qa_f;

insert into qa_out(paso, esperado, valor)
select 'T5.9 cancelar reserva ajena = no encontrada', 'RESERVA_NO_ENCONTRADA',
       cancelar_reserva_bot('573000000828', r->>'reserva_id')->>'error' from qa_res;
insert into qa_out(paso, esperado, valor)
select 'T5.10 reservas_del_cliente la lista', '1',
       jsonb_array_length(reservas_del_cliente('573000000827'))::text;
insert into qa_out(paso, esperado, valor)
select 'T5.11 cancelar la propia', 'true',
       cancelar_reserva_bot('573000000827', r->>'reserva_id')->>'ok' from qa_res;
insert into qa_out(paso, esperado, valor)
select 'T5.12 cancelar otra vez', 'RESERVA_YA_CANCELADA',
       cancelar_reserva_bot('573000000827', r->>'reserva_id')->>'error' from qa_res;
insert into qa_out(paso, esperado, valor)
select 'T5.13 ya no aparece en sus reservas', '0',
       jsonb_array_length(reservas_del_cliente('573000000827'))::text;

-- ---------------------------------------------------------------------------
-- Veredicto: SOLO lo que falla
-- ---------------------------------------------------------------------------
select paso, esperado, valor
from qa_out
where not (valor is not distinct from esperado)
order by n;

rollback;
