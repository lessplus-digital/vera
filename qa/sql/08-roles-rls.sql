-- ============================================================================
-- QA · 08 · Roles, RLS y triggers de columna
-- Oráculo: docs/database/schema.md §Modelo de permisos
-- Estado 2026-09-09: verde. Todo con BEGIN…ROLLBACK.
--
-- ⚠️ LA TRAMPA DE ESTA BATERÍA (falso verde que mordió el 2026-09-09):
--    Un UPDATE o DELETE bloqueado por RLS **NO lanza error**: afecta 0 filas y
--    devuelve éxito. Un test que solo pregunte "¿lanzó excepción?" da verde
--    aunque la política no exista. Hay que **contar filas antes y después**.
--    Es la misma familia que edge-case §11 ("RLS no avisa").
--    Los triggers de columna SÍ lanzan (42501 / 23514); las políticas, no.
--
-- ⚠️ SEGUNDA TRAMPA: el rol `authenticated` no puede escribir en una tabla temp
--    creada por el superusuario. Haz los intentos suplantando, `reset role`, y
--    lee el estado después.
--
-- Usuarios de prueba (sembrados el 2026-08-12, ver backlog §Housekeeping):
--   admin        Juan Clavijo          0dee3453-cfb6-423a-92a3-86ed844cc94b
--   mesero       Laura Mesera          e31bdee5-3b5b-494e-8d81-fdbb527d2a34
--   domiciliario Carlos Domiciliario   acf3741f-6759-4326-b110-1bdee5b1e25d
--   domiciliario Andrea Domiciliaria   7d62550b-c19d-463c-a607-636386c80b4e
-- ============================================================================

-- ---------------------------------------------------------------------------
-- T1 · Visibilidad por rol. Regla #1 de CLAUDE.md: un domiciliario NO puede
--      leer el restaurante entero por la API.
--      Medido 2026-09-09 (de 116 pedidos / 35 clientes / 214 detalles):
--        domiciliario → 34 pedidos · 17 clientes · 71 detalles · 1 perfil
--                       0 soporte · 0 carritos · 0 reservas · 0 chat · 0 feedback
--        mesero       → 116 pedidos · 35 clientes · 214 detalles · 16 reservas
--                       0 soporte · 0 carritos · 0 chat · 0 feedback · 1 perfil
--        sin perfil   → 0 en todo, EXCEPTO menu = 133 (política
--                       `menu_lectura_publica`, intencional: el menú es público)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"acf3741f-6759-4326-b110-1bdee5b1e25d","role":"authenticated"}';
select 'domiciliario Carlos' as quien, mi_rol() as rol, es_admin() as admin,
       (select count(*) from pedidos) as pedidos,
       (select count(*) from clientes) as clientes,
       (select count(*) from detalle_pedidos) as detalles,
       (select count(*) from mensajes_soporte) as soporte,
       (select count(*) from carritos) as carritos,
       (select count(*) from perfiles) as perfiles,
       (select count(*) from reservas) as reservas,
       (select count(*) from n8n_chat_histories) as chat,
       (select count(*) from feedback) as feedback;
rollback;

-- T2 · Y los que ve son SUYOS: 34 asignados a él, 0 sin asignar, 0 de otro.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"acf3741f-6759-4326-b110-1bdee5b1e25d","role":"authenticated"}';
select 'aislamiento del domiciliario' as check,
       count(*) filter (where domiciliario_id = 'acf3741f-6759-4326-b110-1bdee5b1e25d') as suyos,
       count(*) filter (where domiciliario_id is null) as sin_asignar,
       count(*) filter (where domiciliario_id is not null
                          and domiciliario_id <> 'acf3741f-6759-4326-b110-1bdee5b1e25d') as de_otro,
       count(*) as total_visible
from pedidos;
rollback;

-- ---------------------------------------------------------------------------
-- T3 · Triggers de columna. Estos SÍ lanzan excepción (RLS filtra FILAS, los
--      triggers protegen COLUMNAS — regla #2 de CLAUDE.md).
--      Medido: ambos 42501.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.intento(sql text) returns text language plpgsql as $$
begin execute sql; return 'sin error'; exception when others then return sqlstate||': '||left(sqlerrm,55); end $$;

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e31bdee5-3b5b-494e-8d81-fdbb527d2a34","role":"authenticated"}';
select 'mesero asigna domiciliario' as intento, '42501' as esperado,
       pg_temp.intento($$update pedidos set domiciliario_id='acf3741f-6759-4326-b110-1bdee5b1e25d'
                          where pedido_id=(select pedido_id from pedidos where tipo_pedido='domicilio' limit 1)$$) as res
union all
select 'mesero se hace admin', '42501',
       pg_temp.intento($$update perfiles set rol='admin' where usuario_id='e31bdee5-3b5b-494e-8d81-fdbb527d2a34'$$)
union all
select 'mesero: listar_usuarios', '42501',   -- (la sesión es la de Laura; antes decía "domiciliario")
       pg_temp.intento($$select * from listar_usuarios()$$);
rollback;

-- ---------------------------------------------------------------------------
-- T4 · Escrituras bloqueadas por RLS: NO lanzan, afectan 0 filas.
--      Se comprueba contando antes y después. Medido: nada cambió.
-- ---------------------------------------------------------------------------
begin;
create temp table snap(k text, v text) on commit drop;
insert into snap select 'A estados ANTES', string_agg(pedido_id||'='||estado, ',' order by pedido_id)
  from pedidos where pedido_id in ('PED-245', 'PED-100');   -- ambos de Andrea
insert into snap select 'B asignados a Carlos ANTES', count(*)::text
  from pedidos where domiciliario_id = 'acf3741f-6759-4326-b110-1bdee5b1e25d';

set local role authenticated;
set local request.jwt.claims to '{"sub":"acf3741f-6759-4326-b110-1bdee5b1e25d","role":"authenticated"}';
update pedidos set estado = 'cancelado' where pedido_id in ('PED-245', 'PED-100');
update pedidos set domiciliario_id = 'acf3741f-6759-4326-b110-1bdee5b1e25d' where pedido_id = 'PED-245';
reset role;

insert into snap select 'C estados DESPUES', string_agg(pedido_id||'='||estado, ',' order by pedido_id)
  from pedidos where pedido_id in ('PED-245', 'PED-100');
insert into snap select 'D asignados a Carlos DESPUES', count(*)::text
  from pedidos where domiciliario_id = 'acf3741f-6759-4326-b110-1bdee5b1e25d';
select k, v from snap order by k;   -- A debe ser igual a C, y B igual a D
rollback;

-- T5 · Lo mismo para el DELETE del mesero (`pedidos_delete` exige es_admin()).
begin;
create temp table snap2(antes int, despues int) on commit drop;
insert into snap2 select count(*), 0 from pedidos;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e31bdee5-3b5b-494e-8d81-fdbb527d2a34","role":"authenticated"}';
delete from pedidos where pedido_id = (select pedido_id from pedidos order by pedido_id limit 1);
reset role;
update snap2 set despues = (select count(*) from pedidos);
select antes, despues,
       case when antes = despues then '✓ el mesero NO borró nada'
            else '✗ FUGA: borró '||(antes - despues)::text end as veredicto
from snap2;
rollback;

-- ---------------------------------------------------------------------------
-- T6 · El camino de n8n. Todas las SECURITY DEFINER usan el patrón
--      `auth.uid() IS NULL → dejar pasar`, para que el bot (service_role, sin
--      JWT de usuario) siga funcionando. Sin sesión, las tools deben responder.
--      Medido: mi_rol()=NULL y las cuatro tools funcionan.
--      ⚠️ Si esto se corre DENTRO de una transacción que antes suplantó a alguien,
--      `reset role` NO borra `request.jwt.claims`: auth.uid() sigue devolviendo el
--      último `sub` y guardar_datos_pedido lanza 'no autorizado' (falso rojo,
--      2026-09-15). Hay que hacer también `set local request.jwt.claims to ''`.
-- ---------------------------------------------------------------------------
select 'sin sesion (n8n/service_role)' as quien,
       mi_rol() as mi_rol,
       (consultar_cobertura('Niquía')->>'cubierto') as cobertura,
       (guardar_datos_pedido('573000000998')->>'ok') as guardar,
       (select count(*) from buscar_menu('pizza', 0.2, 3, true)) as menu,
       (cotizar_mitad_y_mitad('PROD-019', 'PROD-020', 'mediana')->>'ok') as mitad;

-- T7 · Y con sesión de un rol que NO es admin, esas mismas tools se cierran.
--      Medido: guardar_datos_pedido → P0001 'no autorizado'.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"acf3741f-6759-4326-b110-1bdee5b1e25d","role":"authenticated"}';
select 'domiciliario llama una tool del bot' as intento, 'no autorizado' as esperado,
       pg_temp.intento($$select guardar_datos_pedido('573000000999', p_tipo_pedido:='recoger')$$) as res;
rollback;
