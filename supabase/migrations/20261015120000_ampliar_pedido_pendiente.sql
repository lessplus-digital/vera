-- ============================================================================
-- Agregar productos a un pedido ya registrado que sigue 'pendiente' (2026-10-15)
--
-- Caso real (573184821317): tras crear PED-270 el cliente preguntó "¿todavía
-- puedo agregar algo?", el bot dijo que sí y metió el pan de ajo en un carrito
-- NUEVO, camino de un segundo pedido con su propio domicilio.
--
-- Diseño: el carrito puede ser la AMPLIACIÓN de un pedido (carritos.amplia_pedido).
-- Se arma igual que siempre (carrito_agregar_*), pero no pide entrega ni pago
-- (son los del pedido): la vista estado_pedido no los marca como faltantes. El
-- "sí" al resumen llama agregar_carrito_a_pedido, que re-cotiza, inserta las
-- líneas en detalle_pedidos (el total lo recalcula trigger_actualizar_total) y
-- borra el carrito. Si el pedido ya no está pendiente o ya tiene comprobante, el
-- carrito se suelta (amplia_pedido = null) y sigue como un pedido aparte.
-- Cubierto por qa/sql/12-pedido-reservas-bot.sql · T6.
-- ============================================================================

alter table public.carritos
  add column if not exists amplia_pedido text references public.pedidos(pedido_id) on delete set null;

comment on column public.carritos.amplia_pedido is
  'Pedido pendiente al que se sumará este carrito (agregar_carrito_a_pedido). null = carrito de un pedido nuevo.';

-- La vista: con amplia_pedido, entrega y pago no faltan (son los del pedido).
-- Columna nueva AL FINAL (create or replace view no permite reordenar).
create or replace view public.estado_pedido with (security_invoker = true) as
 SELECT c.telefono,
    c.items,
    c.total,
    c.tipo_pedido,
    c.barrio,
    c.direccion_entrega,
    c.metodo_pago,
    c.costo_domicilio,
    c.cobertura_ok,
    c.notas,
    c.paso_flujo,
    c.updated_at,
    k.n_items,
    f.faltantes,
    (jsonb_array_length(f.faltantes) = 0) AS listo_para_resumen,
    c.amplia_pedido
   FROM ((carritos c
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (jsonb_typeof(COALESCE(c.items, '[]'::jsonb)) = 'array'::text) THEN jsonb_array_length(COALESCE(c.items, '[]'::jsonb))
                    ELSE 0
                END AS n_items) k)
     CROSS JOIN LATERAL ( SELECT COALESCE(jsonb_agg(x.campo ORDER BY x.ord), '[]'::jsonb) AS faltantes
           FROM ( SELECT 'carrito'::text AS campo,
                    1 AS ord
                  WHERE (k.n_items = 0)
                UNION ALL
                 SELECT 'tipo_pedido'::text,
                    2
                  WHERE ((k.n_items > 0) AND (c.amplia_pedido IS NULL) AND (c.tipo_pedido IS NULL))
                UNION ALL
                 SELECT 'barrio'::text,
                    3
                  WHERE ((k.n_items > 0) AND (c.amplia_pedido IS NULL) AND (c.tipo_pedido = 'domicilio'::text) AND (c.barrio IS NULL))
                UNION ALL
                 SELECT 'cobertura'::text,
                    4
                  WHERE ((k.n_items > 0) AND (c.amplia_pedido IS NULL) AND (c.tipo_pedido = 'domicilio'::text) AND (c.barrio IS NOT NULL) AND (c.cobertura_ok IS DISTINCT FROM true))
                UNION ALL
                 SELECT 'direccion_entrega'::text,
                    5
                  WHERE ((k.n_items > 0) AND (c.amplia_pedido IS NULL) AND (c.tipo_pedido = 'domicilio'::text) AND (c.direccion_entrega IS NULL))
                UNION ALL
                 SELECT 'metodo_pago'::text,
                    6
                  WHERE ((k.n_items > 0) AND (c.amplia_pedido IS NULL) AND (c.metodo_pago IS NULL))) x) f);

-- ---------------------------------------------------------------------------
-- carrito_ampliar_pedido: marca el carrito (vacío) como ampliación de un pedido
-- pendiente del MISMO teléfono. Un carrito con productos no se convierte.
-- ---------------------------------------------------------------------------
create or replace function public.carrito_ampliar_pedido(p_telefono text, p_pedido_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tel text := btrim(coalesce(p_telefono, ''));
  p     record;
  v_amp text;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  select pedido_id, estado, comprobante_url into p
    from pedidos where pedido_id = p_pedido_id and telefono = v_tel;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PEDIDO_NO_ENCONTRADO');
  end if;
  if p.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'error', 'PEDIDO_YA_PROCESADO', 'estado_actual', p.estado);
  end if;
  if p.comprobante_url is not null then
    return jsonb_build_object('ok', false, 'error', 'PEDIDO_PAGADO');
  end if;

  insert into carritos as c (telefono, items, total, amplia_pedido)
  values (v_tel, '[]'::jsonb, 0, p.pedido_id)
  on conflict (telefono) do update
    set amplia_pedido = excluded.amplia_pedido,
        tipo_pedido = null, barrio = null, direccion_entrega = null, metodo_pago = null,
        costo_domicilio = null, cobertura_ok = null, paso_flujo = 'armando'
    where jsonb_typeof(c.items) <> 'array' or jsonb_array_length(c.items) = 0;

  select amplia_pedido into v_amp from carritos where telefono = v_tel;
  if v_amp is distinct from p.pedido_id then
    return jsonb_build_object('ok', false, 'error', 'CARRITO_OCUPADO',
      'message', 'Ya hay productos en el carrito de otro pedido.');
  end if;

  return jsonb_build_object('ok', true, 'pedido_id', p.pedido_id,
    'estado', (select to_jsonb(e) from estado_pedido e where e.telefono = v_tel));
end;
$function$;

-- ---------------------------------------------------------------------------
-- agregar_carrito_a_pedido: el "sí" al resumen de una ampliación.
-- ---------------------------------------------------------------------------
create or replace function public.agregar_carrito_a_pedido(p_telefono text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tel     text := btrim(coalesce(p_telefono, ''));
  c         record;
  p         record;
  v_item    jsonb;
  v_pos     integer;
  v_cot     jsonb;
  v_nuevo   numeric;
  v_items   jsonb := '[]'::jsonb;
  v_cambios jsonb := '[]'::jsonb;
  v_agregado numeric;
  v_lista   text;
  v_existe  boolean;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  select * into c from carritos where telefono = v_tel for update;
  if not found or jsonb_typeof(c.items) <> 'array' or jsonb_array_length(c.items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'CARRITO_VACIO', 'message', 'No hay productos en el carrito.');
  end if;
  if c.amplia_pedido is null then
    return jsonb_build_object('ok', false, 'error', 'NO_ES_AMPLIACION',
      'message', 'Este carrito es de un pedido nuevo: se crea con crear_orden_desde_carrito.');
  end if;
  if c.paso_flujo <> 'resumen' then
    return jsonb_build_object('ok', false, 'error', 'SIN_RESUMEN',
      'message', 'Primero hay que mostrarle el resumen al cliente y que lo confirme.');
  end if;

  select * into p from pedidos where pedido_id = c.amplia_pedido and telefono = v_tel for update;
  v_existe := found; -- el UPDATE de abajo pisa FOUND
  -- Ya no se puede sumar (lo aprobaron, lo cancelaron o ya pagó): el carrito se
  -- suelta y sigue como un pedido aparte, que pedirá su entrega y su pago.
  if not v_existe or p.estado <> 'pendiente' or p.comprobante_url is not null then
    update carritos set amplia_pedido = null, paso_flujo = 'datos' where telefono = v_tel;
    return jsonb_build_object('ok', false,
      'error', case when v_existe and p.estado = 'pendiente' then 'PEDIDO_PAGADO' else 'PEDIDO_YA_PROCESADO' end,
      'pedido_id', c.amplia_pedido,
      'estado_actual', case when v_existe then p.estado end);
  end if;

  -- Re-cotización, igual que crear_orden_desde_carrito.
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
      'cambios', v_cambios);
  end if;

  insert into detalle_pedidos (pedido_id, producto_id, nombre_producto, variante, cantidad, precio_unitario, notas_item, mitades)
  select p.pedido_id,
         x->>'producto_id',
         coalesce(nullif(btrim(x->>'nombre'), ''), (select m.nombre from menu m where m.producto_id = x->>'producto_id')),
         coalesce(nullif(x->>'variante', ''), 'Estándar'),
         (x->>'cantidad')::int,
         (x->>'precio_unitario')::numeric,
         x->>'notas_item',
         case when jsonb_typeof(x->'mitades') = 'array' then x->'mitades' end
    from jsonb_array_elements(v_items) x;

  select sum((x->>'cantidad')::int * (x->>'precio_unitario')::numeric),
         string_agg((x->>'cantidad') || 'x ' || coalesce(x->>'nombre', x->>'producto_id'), ', ')
    into v_agregado, v_lista
    from jsonb_array_elements(v_items) x;

  -- Para el equipo: el pedido cambió después de llegar al kanban.
  update pedidos
     set notas = concat_ws(E'\n', nullif(btrim(coalesce(notas, '')), ''), '➕ Agregado por WhatsApp: ' || v_lista)
   where pedido_id = p.pedido_id;

  delete from carritos where telefono = v_tel;

  select * into p from pedidos where pedido_id = p.pedido_id;
  return jsonb_build_object('ok', true,
    'pedido_id', p.pedido_id,
    'total', p.total,
    'agregado', v_agregado,
    'costo_domicilio', p.costo_domicilio,
    'tipo_pedido', p.tipo_pedido,
    'metodo_pago', p.metodo_pago,
    'items', v_items);
end;
$function$;

-- ---------------------------------------------------------------------------
-- crear_orden_desde_carrito: un carrito de ampliación no crea un pedido nuevo
-- (no tiene entrega ni pago propios: insertaría un pedido sin tipo_pedido).
-- Única diferencia con 20260929210000: el bloque ES_AMPLIACION.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_orden_desde_carrito(p_telefono text, p_cliente_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if c.amplia_pedido is not null then
    return jsonb_build_object('ok', false, 'error', 'ES_AMPLIACION',
      'message', 'Este carrito se suma al pedido ' || c.amplia_pedido || ': se confirma con agregar_carrito_a_pedido.',
      'pedido_id', c.amplia_pedido);
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

  begin
    insert into pedidos (cliente_id, telefono, tipo_pedido, direccion_entrega, barrio, metodo_pago, notas)
    values (p_cliente_id, v_tel, c.tipo_pedido,
            case when c.tipo_pedido = 'domicilio' then c.direccion_entrega end,
            case when c.tipo_pedido = 'domicilio' then c.barrio end,
            c.metodo_pago, c.notas)
    returning pedido_id into v_pedido_id;
  exception when unique_violation then
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
$function$;
