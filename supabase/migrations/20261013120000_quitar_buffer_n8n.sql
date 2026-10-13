-- El buffer de mensajes de n8n ya no existe: el servidor Node junta los mensajes en memoria.
-- Verificado antes de aplicar (2026-10-13): la tabla tenía 0 filas y ninguna función ni vista la usaba.
select cron.unschedule('limpiar-mensajes-pendientes');
drop table if exists public.n8n_mensajes_pendientes;
