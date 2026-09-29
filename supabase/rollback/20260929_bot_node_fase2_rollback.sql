-- ============================================================================
-- DESHACER las migraciones de la Fase 2 del bot Node
--   20260929200000_bot_node_tablas_y_carrito
--   20260929210000_bot_node_pedido_y_reservas
--
-- Solo borra lo que esas migraciones CREARON (verificado el 2026-09-29: ninguno
-- de estos nombres existía antes). No toca clientes, pedidos, carritos, menú ni
-- reservas. Las filas de wa_eventos / bot_turnos / conversaciones se pierden
-- (son log y estado del bot nuevo, no datos del negocio).
--
-- Uso: correrlo entero por el MCP de Supabase o en el SQL Editor.
-- ============================================================================
begin;

select cron.unschedule(jobid) from cron.job where jobname in ('limpiar-wa-eventos', 'limpiar-bot-turnos');

drop function if exists public.reservas_del_cliente(text);
drop function if exists public.cancelar_reserva_bot(text, text);
drop function if exists public.crear_reserva_bot(text, text, text, date, time, integer, text, text);
drop function if exists public.consultar_disponibilidad_reserva(date, time, integer);
drop function if exists public.crear_orden_desde_carrito(text, text);

drop function if exists public.carrito_vaciar(text);
drop function if exists public.carrito_quitar_item(text, integer, integer);
drop function if exists public.carrito_agregar_mitad(text, text, text, text, integer, text);
drop function if exists public.carrito_agregar_item(text, text, text, integer, text);
drop function if exists public._carrito_guardar_items(text, jsonb);
drop function if exists public.precio_producto(text, text);
drop function if exists public.normalizar_tamano(text);

drop table if exists public.conversaciones;
drop table if exists public.bot_turnos;
drop table if exists public.wa_eventos;

-- apply_migration registra su propia versión (hora de aplicación): se borra por nombre.
delete from supabase_migrations.schema_migrations
 where name in ('bot_node_tablas_y_carrito', 'bot_node_pedido_y_reservas');

commit;
