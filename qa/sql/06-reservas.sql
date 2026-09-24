-- ============================================================================
-- QA · 06 · Reservas
-- Cubre: trigger_validar_cupo, trigger_costo_motivo, constraints de `reservas`
-- Todo dentro de BEGIN…ROLLBACK. Usa fechas current_date+400 para no chocar
-- con reservas reales. Estado 2026-09-09: 10/11 verde, T4 falla (BUG-043).
-- Estado 2026-09-15: BUG-043 corregido → T4a/T4b ahora esperan el rechazo (+ control T4c).
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
-- T4 · SOBREVENTA (BUG-043, ✅ corregido 2026-09-15). Hasta entonces el trigger era
--      BEFORE **INSERT** solamente y cualquier UPDATE se saltaba el control de
--      cupo. Dos vías reales:
--        a) reactivar una reserva cancelada (estado → 'confirmada')
--        b) mover una reserva a una franja ya llena (cambiar fecha/hora)
--      Ambas dejaban 9 confirmadas con 8 mesas. Ahora el UPDATE revienta con
--      P0001 'No hay mesas…' y el conteo se queda en 8.
--      ⚠️ El UPDATE va dentro de un bloque con EXCEPTION: sin él, el rechazo
--      aborta la transacción y todo lo que sigue da "current transaction is aborted".
-- ---------------------------------------------------------------------------
update reservas set estado = 'cancelada'
 where reserva_id = (select min(reserva_id) from reservas where fecha = (select d from t) and hora = '19:00');
insert into reservas(telefono, nombre_cliente, fecha, hora, personas, estado, origen)
 values ('573000000901', 'QA-relleno', (select d from t), '19:00', 2, 'confirmada', 'whatsapp');
do $$ begin
  update reservas set estado = 'confirmada' where estado = 'cancelada' and fecha = (select d from t);
  insert into qa_out(paso, esperado, valor) values ('T4a reactivar cancelada rechaza', 'cupo_agotado', 'NO REVENTO');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T4a reactivar cancelada rechaza', 'cupo_agotado',
    case when sqlerrm like 'No hay mesas%' then 'cupo_agotado' else sqlstate || ' ' || left(sqlerrm, 60) end);
end $$;
insert into qa_out(paso, esperado, valor)
select 'T4a confirmadas a las 19:00', '8', count(*)::text
from reservas where fecha = (select d from t) and hora = '19:00' and estado = 'confirmada';
-- Control: lo que NO cambia la ocupación debe seguir pasando en una franja llena.
do $$ begin
  update reservas set nombre_cliente = 'QA renombrado' where nombre_cliente = 'QA-relleno';
  insert into qa_out(paso, esperado, valor) values ('T4c renombrar en franja llena', 'entra', 'entra');
exception when others then
  insert into qa_out(paso, esperado, valor) values ('T4c renombrar en franja llena', 'entra', 'REVENTO ' || left(sqlerrm, 50));
end $$;

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

create temp table r4b(res text) on commit drop;
do $$ begin
  update reservas set hora = '19:00' where reserva_id = 'RES-MOVE';   -- un admin la mueve
  insert into r4b values ('NO REVENTO');
exception when others then
  insert into r4b values (case when sqlerrm like 'No hay mesas%' then 'cupo_agotado' else sqlstate end);
end $$;

select 'T4b mover a franja llena' as caso, 'cupo_agotado · 8 confirmadas a las 19:00' as esperado,
       (select res from r4b) || ' · ' || count(*)::text || ' confirmadas a las 19:00' as valor
from reservas where fecha = (select d from t2) and hora = '19:00' and estado = 'confirmada';
rollback;

-- ---------------------------------------------------------------------------
-- T11-T18 · REGRESIÓN de BUG-049 · `trigger_validar_ventana_reserva`.
--       Hasta el 2026-09-22 la única validación de horario vivía en el subworkflow
--       n8n, así que el modal del dashboard —que escribe directo a la tabla— la
--       saltaba entera: `reservas` aceptaba fechas de 2020 y horas con el local
--       cerrado. Ahora la frontera está en la BD.
--       La regla: la mesa se aparta 90 min y debe caber ANTES del cierre (22:00
--       entre semana, 23:00 el finde) → última reserva 20:30 L-V y 21:30 S-D,
--       ambas INCLUSIVE. Apertura 12:00.
--
--       T18 es el control que de verdad importa: el trigger solo valida cuando
--       `fecha` u `hora` CAMBIAN. Sin esa condición, cancelar una reserva vieja
--       (operación legítima y diaria) quedaría bloqueada por su propia fecha
--       pasada — y eso no lo habría visto ningún caso de rechazo.
-- ---------------------------------------------------------------------------
begin;
create temp table qa_v(paso text, esperado text, valor text) on commit drop;
create or replace function pg_temp.intento(sql text) returns text language plpgsql as $$
begin execute sql; return 'ACEPTADO';
exception when others then return 'RECHAZADO'; end $$;

insert into clientes(cliente_id, telefono, nombre, fecha_registro)
 values ('CLI-QAV','573000000949','QA Ventana', now()) on conflict do nothing;

-- Un miércoles y un sábado, ambos siempre futuros, sea cual sea el día de hoy.
create temp table dv on commit drop as
select (current_date + ((3 - extract(isodow from current_date)::int + 7) % 7 + 7))::date as lv,
       (current_date + ((6 - extract(isodow from current_date)::int + 7) % 7 + 7))::date as sd;

create or replace function pg_temp.reservar(id text, f date, h text) returns text
language sql as $$
  select pg_temp.intento(format(
    $x$insert into reservas(reserva_id,cliente_id,telefono,nombre_cliente,fecha,hora,personas,estado,origen)
       values (%L,'CLI-QAV','573000000949','QA',%L,%L,2,'confirmada','dashboard')$x$, id, f, h));
$$;

insert into qa_v select 'T11 fecha en el PASADO (2020)',  'RECHAZADO', pg_temp.reservar('RSV-QV1','2020-01-15','13:00');
insert into qa_v select 'T12 hora 04:00 (sin abrir)',     'RECHAZADO', pg_temp.reservar('RSV-QV2',(select lv from dv),'04:00');
insert into qa_v select 'T13 hora 11:59 (un minuto antes)','RECHAZADO', pg_temp.reservar('RSV-QV3',(select lv from dv),'11:59');
insert into qa_v select 'T14 L-V 20:30 (borde, ENTRA)',   'ACEPTADO',  pg_temp.reservar('RSV-QV4',(select lv from dv),'20:30');
insert into qa_v select 'T15 L-V 20:31 (un minuto tarde)','RECHAZADO', pg_temp.reservar('RSV-QV5',(select lv from dv),'20:31');
insert into qa_v select 'T16 S-D 21:30 (borde finde, ENTRA)','ACEPTADO',pg_temp.reservar('RSV-QV6',(select sd from dv),'21:30');
insert into qa_v select 'T17 S-D 21:31',                  'RECHAZADO', pg_temp.reservar('RSV-QV7',(select sd from dv),'21:31');
insert into qa_v select 'T18 cancelar una reserva VIEJA sigue permitido', 'ACEPTADO',
  pg_temp.intento($x$update reservas set estado='cancelada'
                     where reserva_id = (select reserva_id from reservas
                                          where fecha < current_date order by fecha limit 1)$x$);

select paso, esperado, valor from qa_v where valor <> esperado order by paso;
rollback;
