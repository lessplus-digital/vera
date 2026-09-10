-- ============================================================================
-- QA · 06 · Reservas
-- Cubre: trigger_validar_cupo, trigger_costo_motivo, constraints de `reservas`
-- Todo dentro de BEGIN…ROLLBACK. Usa fechas current_date+400 para no chocar
-- con reservas reales. Estado 2026-09-09: 10/11 verde, T4 falla (BUG-043).
--
-- NOTA: `consultar_disponibilidad` (horario 12:00-21:00, máx 14 días, mín 5h de
-- anticipación) vive en el subworkflow n8n `OTQp2O8QDw1mMKOZ`, NO en la BD.
-- Esas reglas se prueban en la Capa B (guion G9), no aquí.
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
create temp table t(d date) on commit drop;
insert into t select (current_date + 400);

insert into clientes(cliente_id, nombre, telefono, fecha_registro)
 values ('CLI-QAR', 'QA Reservas', '573000000901', current_date);

-- ---------------------------------------------------------------------------
-- T1/T2 · 8 mesas: la octava entra, la novena revienta.
-- ---------------------------------------------------------------------------
do $$ declare i int; d date := (select d from t); begin
  for i in 1..8 loop
    insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
    values ('573000000901', 'QA', d, '19:00', 2, 'confirmada', 'whatsapp');
  end loop;
end $$;
insert into qa_out(paso, esperado, valor)
select 'T1 8 reservas solapadas entran', '8', count(*)::text from reservas where fecha = (select d from t);

do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d, '19:00', 2, 'confirmada', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T2 la 9a revienta', 'cupo_agotado', 'NO REVENTO');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T2 la 9a revienta', 'cupo_agotado', 'cupo_agotado');
end $$;

-- ---------------------------------------------------------------------------
-- T3 · Frontera del bloque de 90 min. OVERLAPS es semiabierto: 20:30 exactas
--      ya NO solapan con el bloque 19:00–20:30, pero 20:29 sí.
-- ---------------------------------------------------------------------------
do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d, '20:30', 2, 'confirmada', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T3 20:30 no solapa', 'entra', 'entra');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T3 20:30 no solapa', 'entra', 'REVENTO');
end $$;

do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d, '20:29', 2, 'confirmada', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T3b 20:29 si solapa', 'cupo_agotado', 'NO REVENTO');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T3b 20:29 si solapa', 'cupo_agotado', 'cupo_agotado');
end $$;

-- ---------------------------------------------------------------------------
-- T4 · SOBREVENTA (BUG-043). El trigger es BEFORE **INSERT** solamente, así que
--      cualquier UPDATE se salta el control de cupo. Dos vías reales:
--        a) reactivar una reserva cancelada (estado → 'confirmada')
--        b) mover una reserva a una franja ya llena (cambiar fecha/hora)
--      Ambas dejan 9 confirmadas con 8 mesas.
-- ---------------------------------------------------------------------------
update reservas set estado = 'cancelada'
 where reserva_id = (select min(reserva_id) from reservas where fecha = (select d from t) and hora = '19:00');
insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
 values ('573000000901', 'QA-relleno', (select d from t), '19:00', 2, 'confirmada', 'whatsapp');
update reservas set estado = 'confirmada' where estado = 'cancelada' and fecha = (select d from t);
insert into qa_out(paso, esperado, valor)
select 'T4a reactivar cancelada', '8', count(*)::text
from reservas where fecha = (select d from t) and hora = '19:00' and estado = 'confirmada';

-- ---------------------------------------------------------------------------
-- T5/T6 · costo_motivo lo escribe el trigger, NUNCA el LLM ni el dashboard.
-- ---------------------------------------------------------------------------
insert into reservas(reserva_id, telefono, nombre_cliente, fecha, hora, personas, estado, origen, motivo, costo_motivo)
 values ('RES-QAM', '573000000901', 'QA', (select d from t) + 1, '13:00', 4, 'confirmada', 'whatsapp', 'cumpleanos', 999);
insert into qa_out(paso, esperado, valor)
select 'T5 costo_motivo ignora el 999 del LLM', '80000', costo_motivo::text
from reservas where reserva_id = 'RES-QAM';

insert into reservas(reserva_id, telefono, nombre_cliente, fecha, hora, personas, estado, origen, motivo)
 values ('RES-QAN', '573000000901', 'QA', (select d from t) + 1, '13:00', 4, 'confirmada', 'whatsapp', '');
insert into qa_out(paso, esperado, valor)
select 'T6 motivo vacio', 'motivo=∅ costo=0',
       'motivo='||coalesce(motivo,'∅')||' costo='||costo_motivo::text
from reservas where reserva_id = 'RES-QAN';

-- ---------------------------------------------------------------------------
-- T7-T10 · Constraints. T9 documenta el desajuste con el dashboard (BUG-044):
--          `RESERVATION_STATES` ofrece 'pendiente', que el CHECK rechaza.
-- ---------------------------------------------------------------------------
do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d + 2, '13:00', 13, 'confirmada', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T7 personas=13', 'rechaza', 'NO REVENTO');
exception when others then insert into qa_out(paso, esperado, valor) values ('T7 personas=13', 'rechaza', 'rechaza'); end $$;

do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d + 2, '13:00', 0, 'confirmada', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T8 personas=0', 'rechaza', 'NO REVENTO');
exception when others then insert into qa_out(paso, esperado, valor) values ('T8 personas=0', 'rechaza', 'rechaza'); end $$;

do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
  values ('573000000901', 'QA', d + 2, '13:00', 4, 'pendiente', 'whatsapp');
  insert into qa_out(paso, esperado, valor) values ('T9 estado=pendiente', 'rechaza', 'NO REVENTO');
exception when others then insert into qa_out(paso, esperado, valor) values ('T9 estado=pendiente', 'rechaza', 'rechaza'); end $$;

do $$ declare d date := (select d from t); begin
  insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen, motivo)
  values ('573000000901', 'QA', d + 2, '13:00', 4, 'confirmada', 'whatsapp', 'boda_inventada');
  insert into qa_out(paso, esperado, valor) values ('T10 motivo inexistente', 'rechaza', 'NO REVENTO');
exception when others then insert into qa_out(paso, esperado, valor) values ('T10 motivo inexistente', 'rechaza', 'rechaza'); end $$;

select paso, esperado, valor, case when valor = esperado then '✓' else '✗ FALLA' end as ok
from qa_out order by n;

rollback;

-- ---------------------------------------------------------------------------
-- T4b · La otra vía de sobreventa: mover una reserva a una franja llena.
--       Se ejecuta aparte porque necesita su propio escenario limpio.
-- ---------------------------------------------------------------------------
begin;
create temp table t2(d date) on commit drop; insert into t2 select current_date + 401;
insert into clientes(cliente_id, nombre, telefono, fecha_registro)
 values ('CLI-QAR2', 'QA', '573000000902', current_date);
do $$ declare i int; d date := (select d from t2); begin
  for i in 1..8 loop
    insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
    values ('573000000902', 'QA', d, '19:00', 2, 'confirmada', 'whatsapp');
  end loop;
end $$;
insert into reservas(reserva_id, telefono, nombre_cliente, fecha, hora, personas, estado, origen)
 values ('RES-MOVE', '573000000902', 'QA a mover', (select d from t2), '13:00', 4, 'confirmada', 'whatsapp');

update reservas set hora = '19:00' where reserva_id = 'RES-MOVE';   -- un admin la mueve

select 'T4b mover a franja llena' as caso, '8 (tope)' as esperado,
       count(*)::text || ' confirmadas a las 19:00' as valor
from reservas where fecha = (select d from t2) and hora = '19:00' and estado = 'confirmada';
rollback;
