-- ============================================================================
-- QA · 04 · Flujo del pedido (la máquina de estados que camina el cliente)
-- Cubre: guardar_datos_pedido(), vista estado_pedido, trigger
--        carritos_normalizar_estado()
-- Todo dentro de BEGIN…ROLLBACK. Usa teléfonos 5730000007xx, nunca uno real.
--
-- ⚠️ TRAMPA AL ESCRIBIR ESTOS TESTS (mordió el 2026-09-09):
--    NO leas la tabla en un subquery del mismo SELECT que ejecuta la función:
--        select (select barrio from carritos …) from (select guardar_datos_pedido(…)) _
--    Postgres evalúa el subquery con el snapshot PREVIO y devuelve el valor viejo,
--    lo que parece un bug del trigger y no lo es. Escribe en una sentencia y lee
--    en la siguiente.
--
-- ⚠️ SEGUNDA TRAMPA (mordió el 2026-09-15): `faltantes` es jsonb y Postgres lo
--    serializa con espacio tras la coma (`["a", "b"]`). Comparado como texto contra
--    `'["a","b"]'` da ✗ aunque sea idéntico. El veredicto compara como jsonb cuando
--    el esperado es JSON, y T1.1 espera NULL (sin carrito no hay estado).
-- ============================================================================

begin;
create temp table qa_out(n int generated always as identity, paso text, esperado text, valor text)
  on commit drop;
delete from carritos where telefono like '5730000007%';

-- ---------------------------------------------------------------------------
-- T1 · `faltantes` debe pedir los datos EN ORDEN:
--      carrito → tipo_pedido → barrio → cobertura → direccion_entrega → metodo_pago
--      Estado 2026-09-09: verde.
-- ---------------------------------------------------------------------------
insert into qa_out(paso, esperado, valor)
select 'T1.1 sin carrito', null, guardar_datos_pedido('573000000777')->'estado'->>'faltantes';

insert into carritos(telefono, items, total)
 values ('573000000777', '[{"producto_id":"PROD-019","cantidad":1,"precio_unitario":24500}]'::jsonb, 24500);
insert into qa_out(paso, esperado, valor)
select 'T1.2 con items', '["tipo_pedido","metodo_pago"]', faltantes::text
from estado_pedido where telefono = '573000000777';

insert into qa_out(paso, esperado, valor)
select 'T1.3 tipo="a domicilio"', '["barrio","direccion_entrega","metodo_pago"]',
       guardar_datos_pedido('573000000777', p_tipo_pedido := 'a domicilio')->'estado'->>'faltantes';
insert into qa_out(paso, esperado, valor)
select 'T1.4 +barrio', '["cobertura","direccion_entrega","metodo_pago"]',
       guardar_datos_pedido('573000000777', p_barrio := 'Niquía')->'estado'->>'faltantes';
insert into qa_out(paso, esperado, valor)
select 'T1.5 +cobertura', '["direccion_entrega","metodo_pago"]',
       guardar_datos_pedido('573000000777', p_costo_domicilio := 7500, p_cobertura_ok := true)->'estado'->>'faltantes';
insert into qa_out(paso, esperado, valor)
select 'T1.6 +direccion', '["metodo_pago"]',
       guardar_datos_pedido('573000000777', p_direccion_entrega := 'Cra 50 #20-15')->'estado'->>'faltantes';
insert into qa_out(paso, esperado, valor)
select 'T1.7 +pago "efectivo"', '[]',
       guardar_datos_pedido('573000000777', p_metodo_pago := 'efectivo')->'estado'->>'faltantes';

-- ---------------------------------------------------------------------------
-- T2 · Semántica COALESCE: guardar un campo NO puede borrar los demás.
-- ---------------------------------------------------------------------------
select guardar_datos_pedido('573000000777', p_notas := 'sin cebolla');
insert into qa_out(paso, esperado, valor)
select 'T2 tras guardar solo notas', 'domicilio / Niquía / Cra 50 #20-15 / Efectivo / 7500',
       tipo_pedido||' / '||barrio||' / '||direccion_entrega||' / '||metodo_pago||' / '||costo_domicilio::text
from carritos where telefono = '573000000777';

-- ---------------------------------------------------------------------------
-- T3 · domicilio → recoger debe limpiar barrio, dirección, envío y cobertura,
--      o se cobra un domicilio que ya no existe.
--      Incluye la normalización colombiana: "para llevar" = RECOGER.
-- ---------------------------------------------------------------------------
select guardar_datos_pedido('573000000777', p_tipo_pedido := 'para llevar');
insert into qa_out(paso, esperado, valor)
select 'T3 domicilio->"para llevar"', 'tipo=recoger barrio=∅ dir=∅ costo=∅ cobertura=∅',
       'tipo='||coalesce(tipo_pedido,'∅')||' barrio='||coalesce(barrio,'∅')||
       ' dir='||coalesce(direccion_entrega,'∅')||' costo='||coalesce(costo_domicilio::text,'∅')||
       ' cobertura='||coalesce(cobertura_ok::text,'∅')
from carritos where telefono = '573000000777';

-- ---------------------------------------------------------------------------
-- T4 · Cambio de barrio RECOTIZANDO la misma tarifa (dos barrios de la misma
--      zona). La recotización debería respetarse. Estado 2026-09-09: FALLA
--      (BUG-042) — se descarta y `faltantes` vuelve a pedir 'cobertura'.
--      Estado 2026-09-15: ✅ verde. El trigger contrasta con la tarifa real del
--      barrio nuevo en vez de inferir "recotizó" de que el precio cambie.
-- ---------------------------------------------------------------------------
insert into carritos(telefono, items, total, tipo_pedido, barrio, costo_domicilio, cobertura_ok)
 values ('573000000778', '[{"x":1}]'::jsonb, 1000, 'domicilio', 'Centro', 5000, true);
select guardar_datos_pedido('573000000778', p_barrio := 'La Milagrosa',
                            p_costo_domicilio := 5000, p_cobertura_ok := true);
insert into qa_out(paso, esperado, valor)
select 'T4 Centro->La Milagrosa recotizando 5000', 'barrio=La Milagrosa costo=5000 cobertura=true',
       'barrio='||coalesce(barrio,'∅')||' costo='||coalesce(costo_domicilio::text,'∅')||
       ' cobertura='||coalesce(cobertura_ok::text,'∅')
from carritos where telefono = '573000000778';

-- T4b · La otra cara del fix de BUG-042, la que la regla vieja protegía: pasar a
--       un barrio de OTRA zona repitiendo el precio viejo (el agente no recotizó
--       y reenvía lo que tenía). Centro $5.000 → Niquía $7.500 con costo=5000 y
--       cobertura_ok=true → debe invalidarse, o se cobraría la tarifa equivocada.
insert into carritos(telefono, items, total, tipo_pedido, barrio, costo_domicilio, cobertura_ok)
 values ('573000000781', '[{"x":1}]'::jsonb, 1000, 'domicilio', 'Centro', 5000, true);
select guardar_datos_pedido('573000000781', p_barrio := 'Niquía',
                            p_costo_domicilio := 5000, p_cobertura_ok := true);
insert into qa_out(paso, esperado, valor)
select 'T4b Centro->Niquía con precio VIEJO', 'barrio=Niquía costo=∅ cobertura=∅',
       'barrio='||coalesce(barrio,'∅')||' costo='||coalesce(costo_domicilio::text,'∅')||
       ' cobertura='||coalesce(cobertura_ok::text,'∅')
from carritos where telefono = '573000000781';

-- ---------------------------------------------------------------------------
-- T5 · Cambio de barrio SIN recotizar debe invalidar la tarifa anterior.
-- ---------------------------------------------------------------------------
insert into carritos(telefono, items, total, tipo_pedido, barrio, costo_domicilio, cobertura_ok)
 values ('573000000779', '[{"x":1}]'::jsonb, 1000, 'domicilio', 'Centro', 5000, true);
select guardar_datos_pedido('573000000779', p_barrio := 'Niquía');
insert into qa_out(paso, esperado, valor)
select 'T5 Centro->Niquía sin recotizar', 'barrio=Niquía costo=∅ cobertura=∅',
       'barrio='||coalesce(barrio,'∅')||' costo='||coalesce(costo_domicilio::text,'∅')||
       ' cobertura='||coalesce(cobertura_ok::text,'∅')
from carritos where telefono = '573000000779';

-- ---------------------------------------------------------------------------
-- T6 · Carrito vaciado → el flujo vuelve al principio (caso BUG-032 / §25:
--      una fila con items [] no es lo mismo que no tener carrito).
-- ---------------------------------------------------------------------------
insert into carritos(telefono, items, total, paso_flujo)
 values ('573000000780', '[{"x":1}]'::jsonb, 1000, 'resumen');
update carritos set items = '[]'::jsonb, total = 0 where telefono = '573000000780';
insert into qa_out(paso, esperado, valor)
select 'T6 carrito vaciado -> paso_flujo', 'armando', paso_flujo
from carritos where telefono = '573000000780';

select paso, esperado, valor,
       case when esperado is null and valor is null then '✓'
            when left(esperado, 1) = '[' and valor::jsonb = esperado::jsonb then '✓'
            when valor = esperado then '✓'
            else '✗' end as ok
from qa_out order by n;

rollback;
