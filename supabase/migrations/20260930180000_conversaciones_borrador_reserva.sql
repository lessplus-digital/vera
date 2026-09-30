-- ============================================================================
-- Bot Node · Fase 5 — el borrador de la reserva vive en la BD
--
-- El agente de Reservas pregunta un dato por mensaje (personas → día → hora →
-- ocasión → resumen). Lo ya respondido se guarda aquí, en la misma fila que
-- dice qué preguntó el bot por última vez, para que:
--  - el "sí" al resumen cree EXACTAMENTE la reserva que el cliente vio
--    (crear_reserva_bot recibe este borrador, no lo que el LLM recuerde);
--  - un desvío ("¿y a qué hora abren?") no borre lo que ya dijo.
-- Forma: { personas, fecha 'YYYY-MM-DD', hora 'HH:MM', motivo (clave de
-- motivos_reserva), verificado 'fecha|hora|personas' de la última consulta de
-- disponibilidad que dio cupo }. NULL = no hay reserva en curso.
-- Solo la usa el servidor Node (service_role); n8n no toca `conversaciones`.
-- ============================================================================

alter table public.conversaciones add column if not exists reserva jsonb;

comment on column public.conversaciones.reserva is
  'Borrador de la reserva en curso del bot Node (personas, fecha, hora, motivo, verificado). NULL = ninguna.';
