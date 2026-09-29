-- ============================================================================
-- Migración · Servidor Node del bot (Fase 2b): crear pedido y reservas en la BD
--
-- Reemplaza los subworkflows de n8n Crear_orden_completa, consultar_disponibilidad,
-- Crear Reserva y Cancelar Reserva por funciones transaccionales. Lo que corrige
-- respecto de n8n (leído del workflow publicado el 2026-09-29):
--   * n8n aceptaba el precio_unitario que mandaba el LLM para los productos
--     normales (solo validaba > 0). Aquí cada línea se re-cotiza contra el menú.
--   * n8n hacía 3 escrituras sueltas (pedido, detalle, borrar carrito): si una
--     fallaba quedaba un pedido a medias. Aquí es una sola transacción.
--   * n8n no devolvía el total; el agente lo sumaba a mano. Aquí se devuelve el
--     total que dejó el trigger (ítems + domicilio).
--   * Un barrio que resolver_barrio no reconoce se cobraba con la tarifa base en
--     silencio (BUG-061, efecto en dinero). Aquí se rechaza: BARRIO_NO_RESUELTO.
--   * Un pedido solo se crea si el carrito está en paso 'resumen' (el cliente
--     vio el resumen). Es la barrera de BD de "nunca un pedido sin confirmar".
--   * Reservas: la ventana horaria queda alineada con trigger_validar_ventana_reserva
--     (BUG-049), `notas` por fin se guarda (BUG-029), y cancelar una reserva ajena
--     responde igual que una inexistente (no revela que existe).
-- Todo es ADITIVO. Cubierto por qa/sql/12-pedido-reservas-bot.sql.
-- Depende de precio_producto()/normalizar_tamano() (migración 20260929200000).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. crear_orden_desde_carrito
-- ---------------------------------------------------------------------------
create or replace function public.crear_orden_desde_carrito(p_telefono text, p_cliente_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel       text := btrim(coalesce(p_telefono, ''));
  c           record;
  e           record;
  v_item      jsonb;
  v_pos       integer;
  v_cot       jsonb;
  v_nuevo     numeric;
  v_items     jsonb := '[]'::jsonb;
  v_cambios   jsonb := '[]'::jsonb;
  v_barrio    record;
  v_pedido_id text;
  p           record;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  select * into c from carritos where telefono = v_tel for update;
  if not found or jsonb_typeof(c.items) <> 'array' or jsonb_array_length(c.items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'CARRITO_VACIO', 'message', 'No hay productos en el carrito.');
  end if;

  select * into e from estado_pedido where telefono = v_tel;
  if jsonb_array_length(e.faltantes) > 0 then
    return jsonb_build_object('ok', false, 'error', 'DATOS_INCOMPLETOS',
      'message', 'Faltan datos del pedido.', 'faltantes', e.faltantes);
  end if;

  if c.paso_flujo <> 'resumen' then
    return jsonb_build_object('ok', false, 'error', 'SIN_RESUMEN',
      'message', 'Primero hay que mostrarle el resumen al cliente y que lo confirme.');
  end if;

  if not exists (select 1 from clientes where cliente_id = p_cliente_id and telefono = v_tel) then
    return jsonb_build_object('ok', false, 'error', 'CLIENTE_INVALIDO',
      'message', 'El cliente no corresponde a este teléfono.');
  end if;

  -- Domicilio: el barrio tiene que estar en el catálogo y la tarifa que se le
  -- dijo al cliente tiene que ser la real. Si no, no se cobra a ciegas.
  if c.tipo_pedido = 'domicilio' then
    select * into v_barrio from resolver_barrio(c.barrio);
    if not found then
      return jsonb_build_object('ok', false, 'error', 'BARRIO_NO_RESUELTO',
        'message', 'El barrio "' || coalesce(c.barrio, '') || '" no está en la cobertura. Confirma el barrio con consultar_cobertura.');
    end if;
    if c.costo_domicilio is distinct from v_barrio.costo then
      update carritos set costo_domicilio = v_barrio.costo, barrio = v_barrio.nombre, paso_flujo = 'datos'
       where telefono = v_tel;
      return jsonb_build_object('ok', false, 'error', 'TARIFA_ACTUALIZADA',
        'message', 'El domicilio a ' || v_barrio.nombre || ' cuesta ' || v_barrio.costo || '. Muestra el resumen de nuevo.',
        'costo_domicilio', v_barrio.costo,
        'estado', (select to_jsonb(x) from estado_pedido x where x.telefono = v_tel));
    end if;
  end if;

  -- Re-cotizar cada línea contra el menú: disponibilidad y precio de HOY.
  for v_item, v_pos in select x.value, x.ordinality from jsonb_array_elements(c.items) with ordinality x loop
    if jsonb_typeof(v_item->'mitades') = 'array' and jsonb_array_length(v_item->'mitades') = 2 then
      v_cot := cotizar_mitad_y_mitad(v_item->'mitades'->0->>'producto_id',
                                     v_item->'mitades'->1->>'producto_id', v_item->>'variante');
    else
      v_cot := precio_producto(v_item->>'producto_id', v_item->>'variante');
    end if;

    if not (v_cot->>'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', 'PRODUCTO_NO_DISPONIBLE',
        'message', coalesce(v_item->>'nombre', v_item->>'producto_id') || ': ' || coalesce(v_cot->>'message', v_cot->>'error'),
        'linea', v_pos, 'detalle', v_cot);
    end if;

    v_nuevo := (v_cot->>'precio_unitario')::numeric;
    if v_nuevo is distinct from (v_item->>'precio_unitario')::numeric then
      v_cambios := v_cambios || jsonb_build_object('linea', v_pos, 'nombre', v_item->>'nombre',
        'antes', (v_item->>'precio_unitario')::numeric, 'ahora', v_nuevo);
      v_item := jsonb_set(v_item, '{precio_unitario}', to_jsonb(v_nuevo));
    end if;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  if jsonb_array_length(v_cambios) > 0 then
    perform _carrito_guardar_items(v_tel, v_items);
    update carritos set paso_flujo = 'datos' where telefono = v_tel;
    return jsonb_build_object('ok', false, 'error', 'PRECIOS_ACTUALIZADOS',
      'message', 'Algunos precios cambiaron desde que se armó el carrito. Muestra el resumen de nuevo.',
      'cambios', v_cambios,
      'estado', (select to_jsonb(x) from estado_pedido x where x.telefono = v_tel));
  end if;

  -- Crear el pedido. costo_domicilio, zona y barrio canónico los pone
  -- trigger_tarifa_domicilio; el total lo pone trigger_actualizar_total.
  begin
    insert into pedidos (cliente_id, telefono, tipo_pedido, direccion_entrega, barrio, metodo_pago, notas)
    values (p_cliente_id, v_tel, c.tipo_pedido,
            case when c.tipo_pedido = 'domicilio' then c.direccion_entrega end,
            case when c.tipo_pedido = 'domicilio' then c.barrio end,
            c.metodo_pago, c.notas)
    returning pedido_id into v_pedido_id;
  exception when unique_violation then
    -- unique_pedido_cliente_minuto: el mismo cliente ya creó un pedido este minuto
    -- (doble "sí", reintento). No se crea otro: se devuelve el existente.
    select pedido_id into v_pedido_id from pedidos where telefono = v_tel order by fecha_pedido desc limit 1;
    return jsonb_build_object('ok', false, 'error', 'PEDIDO_DUPLICADO',
      'message', 'Ya se creó un pedido hace menos de un minuto.', 'pedido_id', v_pedido_id);
  end;

  insert into detalle_pedidos (pedido_id, producto_id, nombre_producto, variante, cantidad, precio_unitario, notas_item, mitades)
  select v_pedido_id,
         x->>'producto_id',
         coalesce(nullif(btrim(x->>'nombre'), ''), (select m.nombre from menu m where m.producto_id = x->>'producto_id')),
         coalesce(nullif(x->>'variante', ''), 'Estándar'),
         (x->>'cantidad')::int,
         (x->>'precio_unitario')::numeric,
         x->>'notas_item',
         case when jsonb_typeof(x->'mitades') = 'array' then x->'mitades' end
    from jsonb_array_elements(v_items) x;

  delete from carritos where telefono = v_tel;

  select * into p from pedidos where pedido_id = v_pedido_id;
  return jsonb_build_object('ok', true,
    'pedido_id', p.pedido_id,
    'total', p.total,
    'costo_domicilio', p.costo_domicilio,
    'tipo_pedido', p.tipo_pedido,
    'metodo_pago', p.metodo_pago,
    'barrio', p.barrio,
    'direccion_entrega', p.direccion_entrega,
    'items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reservas
--    Reglas del negocio para reservar por WhatsApp (las mismas de n8n, con la
--    ventana horaria del trigger): 12:00 → 20:30 L-V / 21:30 S-D, máximo 14
--    días adelante, mínimo 5 horas de anticipación si es hoy, 1–12 personas,
--    8 mesas de 90 minutos. Hora de Colombia.
-- ---------------------------------------------------------------------------
create or replace function public.consultar_disponibilidad_reserva(
  p_fecha    date,
  p_hora     time,
  p_personas integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_mesas     constant int := 8;
  c_duracion  constant interval := interval '90 minutes';
  v_ahora     timestamp := now() at time zone 'America/Bogota';
  v_limite    time;
  v_ocupadas  int;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if p_fecha is null or p_hora is null then
    return jsonb_build_object('ok', false, 'error', 'FALTAN_DATOS', 'message', 'Falta la fecha o la hora.');
  end if;
  if p_personas is not null and (p_personas < 1 or p_personas > 12) then
    return jsonb_build_object('ok', false, 'error', 'PERSONAS_FUERA_DE_RANGO',
      'message', 'Por WhatsApp se reserva para 1 a 12 personas; grupos más grandes los atiende el equipo.');
  end if;

  v_limite := case when extract(isodow from p_fecha) > 5 then time '21:30' else time '20:30' end;

  if (p_fecha + p_hora) < v_ahora then
    return jsonb_build_object('ok', false, 'error', 'FECHA_PASADA', 'message', 'Esa fecha y hora ya pasaron.');
  end if;
  if p_fecha > v_ahora::date + 14 then
    return jsonb_build_object('ok', false, 'error', 'MUY_LEJOS',
      'message', 'Se reserva con máximo 14 días de anticipación.');
  end if;
  if p_hora < time '12:00' or p_hora > v_limite then
    return jsonb_build_object('ok', false, 'error', 'FUERA_DE_HORARIO',
      'message', 'Ese día se reserva de 12:00 a ' || to_char(v_limite, 'HH24:MI') || '.',
      'hora_limite', to_char(v_limite, 'HH24:MI'));
  end if;
  if p_fecha = v_ahora::date and (p_fecha + p_hora) < v_ahora + interval '5 hours' then
    return jsonb_build_object('ok', false, 'error', 'POCA_ANTICIPACION',
      'message', 'Las reservas para hoy necesitan mínimo 5 horas de anticipación.');
  end if;

  select count(*) into v_ocupadas
    from reservas r
   where r.fecha = p_fecha and r.estado = 'confirmada'
     and (r.hora, r.hora + c_duracion) overlaps (p_hora, p_hora + c_duracion);

  return jsonb_build_object('ok', true,
    'disponible', v_ocupadas < c_mesas,
    'mesas_libres', greatest(c_mesas - v_ocupadas, 0),
    'fecha', p_fecha, 'hora', to_char(p_hora, 'HH24:MI'));
end;
$$;

create or replace function public.crear_reserva_bot(
  p_telefono   text,
  p_cliente_id text,
  p_nombre     text,
  p_fecha      date,
  p_hora       time,
  p_personas   integer,
  p_motivo     text default null,
  p_notas      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel    text := btrim(coalesce(p_telefono, ''));
  v_motivo text := nullif(lower(btrim(coalesce(p_motivo, ''))), '');
  v_disp   jsonb;
  r        record;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from clientes where cliente_id = p_cliente_id and telefono = v_tel) then
    return jsonb_build_object('ok', false, 'error', 'CLIENTE_INVALIDO');
  end if;
  if p_personas is null then
    return jsonb_build_object('ok', false, 'error', 'FALTAN_DATOS', 'message', 'Falta el número de personas.');
  end if;

  v_motivo := coalesce(v_motivo, 'sin_ocasion');
  if not exists (select 1 from motivos_reserva where clave = v_motivo and activo) then
    return jsonb_build_object('ok', false, 'error', 'MOTIVO_INVALIDO',
      'motivos_validos', (select jsonb_agg(clave order by orden) from motivos_reserva where activo));
  end if;

  -- Idempotente: el mismo cliente, misma fecha y hora → la reserva que ya existe.
  select * into r from reservas
   where telefono = v_tel and fecha = p_fecha and hora = p_hora and estado = 'confirmada' limit 1;
  if found then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'reserva_id', r.reserva_id,
      'fecha', r.fecha, 'hora', to_char(r.hora, 'HH24:MI'), 'personas', r.personas,
      'motivo', r.motivo, 'costo_motivo', r.costo_motivo);
  end if;

  v_disp := consultar_disponibilidad_reserva(p_fecha, p_hora, p_personas);
  if not (v_disp->>'ok')::boolean then
    return v_disp;
  end if;
  if not (v_disp->>'disponible')::boolean then
    return jsonb_build_object('ok', false, 'error', 'SIN_CUPO', 'message', 'No hay mesas para esa hora.');
  end if;

  begin
    insert into reservas (cliente_id, telefono, nombre_cliente, fecha, hora, personas, estado, origen, motivo, notas)
    values (p_cliente_id, v_tel, coalesce(nullif(btrim(p_nombre), ''), 'Cliente'), p_fecha, p_hora, p_personas,
            'confirmada', 'whatsapp', v_motivo, nullif(btrim(coalesce(p_notas, '')), ''))
    returning * into r;
  exception
    when raise_exception then   -- trigger_validar_cupo: carrera por la última mesa
      return jsonb_build_object('ok', false, 'error', 'SIN_CUPO', 'message', 'No hay mesas para esa hora.');
    when check_violation then   -- trigger_validar_ventana_reserva / CHECK de personas
      return jsonb_build_object('ok', false, 'error', 'RESERVA_INVALIDA', 'message', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'ya_existia', false, 'reserva_id', r.reserva_id,
    'fecha', r.fecha, 'hora', to_char(r.hora, 'HH24:MI'), 'personas', r.personas,
    'motivo', r.motivo, 'costo_motivo', r.costo_motivo, 'notas', r.notas);
end;
$$;

create or replace function public.cancelar_reserva_bot(p_telefono text, p_reserva_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  select * into r from reservas where reserva_id = p_reserva_id for update;
  -- Ajena = inexistente: no se confirma que exista una reserva de otra persona.
  if not found or r.telefono is distinct from btrim(coalesce(p_telefono, '')) then
    return jsonb_build_object('ok', false, 'error', 'RESERVA_NO_ENCONTRADA');
  end if;
  if r.estado <> 'confirmada' then
    return jsonb_build_object('ok', false, 'error', 'RESERVA_YA_CANCELADA');
  end if;
  update reservas set estado = 'cancelada' where reserva_id = r.reserva_id;
  return jsonb_build_object('ok', true, 'reserva_id', r.reserva_id,
    'fecha', r.fecha, 'hora', to_char(r.hora, 'HH24:MI'));
end;
$$;

create or replace function public.reservas_del_cliente(p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('reserva_id', reserva_id, 'fecha', fecha, 'hora', to_char(hora, 'HH24:MI'),
                       'personas', personas, 'motivo', motivo, 'costo_motivo', costo_motivo) order by fecha, hora)
      from reservas
     where telefono = btrim(coalesce(p_telefono, '')) and estado = 'confirmada'
       and fecha >= (now() at time zone 'America/Bogota')::date), '[]'::jsonb);
end;
$$;
