-- ============================================================================
-- Migración · Servidor Node del bot (Fase 2a): tablas propias + escritura del carrito
--
-- Contexto: el bot deja n8n (docs/bot/servidor.md). Principio: la IA conversa,
-- el código decide. Aquí se baja a la BD lo que antes armaba el LLM:
--   * el PRECIO de cada línea del carrito (antes el LLM mandaba items con
--     precio_unitario y subtotal calculados por él — BUG-032, BUG-048);
--   * la fusión de líneas repetidas y el total del carrito.
-- Todo es ADITIVO: n8n sigue funcionando igual si se vuelve a él.
--
-- Cubierto por qa/sql/11-carrito-bot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. wa_eventos · dedupe persistente de webhooks de Meta (sobrevive reinicios)
-- ---------------------------------------------------------------------------
create table if not exists public.wa_eventos (
  wamid        text primary key,
  telefono     text not null,
  recibido_el  timestamptz not null default now()
);
create index if not exists wa_eventos_recibido_idx on public.wa_eventos (recibido_el);
alter table public.wa_eventos enable row level security;
drop policy if exists wa_eventos_admin on public.wa_eventos;
create policy wa_eventos_admin on public.wa_eventos
  for all to authenticated using (es_admin()) with check (es_admin());

comment on table public.wa_eventos is
  'Servidor Node del bot: wamid ya procesados (Meta reintenta webhooks). Se purga a los 7 días.';

-- ---------------------------------------------------------------------------
-- 2. bot_turnos · un registro por turno de conversación (la "caja negra")
--    Qué entró, qué se decidió, qué herramientas corrieron, qué salió.
--    Reemplaza a "abrir la ejecución de n8n" para depurar.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_turnos (
  id             bigint generated always as identity primary key,
  telefono       text not null,
  inicio         timestamptz not null default now(),
  duracion_ms    integer,
  entrada        jsonb not null default '[]'::jsonb,   -- mensajes del cliente del turno
  contexto       jsonb,                                -- modo, estado del carrito, etc.
  clasificacion  jsonb,                                -- salida del clasificador
  decision       jsonb,                                -- handler + acciones de la política
  herramientas   jsonb not null default '[]'::jsonb,   -- [{nombre, args, resultado, ms}]
  salida         jsonb not null default '[]'::jsonb,   -- textos enviados
  guardia        jsonb,                                -- reglas violadas / regeneraciones
  error          text,
  costo          jsonb                                 -- tokens y modelo
);
create index if not exists bot_turnos_tel_inicio_idx on public.bot_turnos (telefono, inicio desc);
alter table public.bot_turnos enable row level security;
drop policy if exists bot_turnos_admin on public.bot_turnos;
create policy bot_turnos_admin on public.bot_turnos
  for all to authenticated using (es_admin()) with check (es_admin());

comment on table public.bot_turnos is
  'Servidor Node del bot: log de cada turno (entrada, clasificación, decisión, tools, salida). Se purga a los 30 días.';

-- ---------------------------------------------------------------------------
-- 3. conversaciones · estado corto de la conversación que NO es del carrito
--    (qué preguntó el bot por última vez, qué handler lleva el hilo).
--    La política de decisión lo lee para interpretar un "sí" / "dale".
-- ---------------------------------------------------------------------------
create table if not exists public.conversaciones (
  telefono         text primary key,
  handler          text,
  ultima_pregunta  text,
  pendiente        jsonb,
  actualizado_el   timestamptz not null default now()
);
alter table public.conversaciones enable row level security;
drop policy if exists conversaciones_admin on public.conversaciones;
create policy conversaciones_admin on public.conversaciones
  for all to authenticated using (es_admin()) with check (es_admin());

comment on table public.conversaciones is
  'Servidor Node del bot: último handler y última pregunta hecha al cliente.';

-- ---------------------------------------------------------------------------
-- 4. Precio de un producto en un tamaño. Única fuente de precio del bot.
--    En `menu`, las pizzas y adiciones guardan el precio por tamaño en la
--    columna `tamaño` como JSON ({"porcion":…, "pequena":…, …}); el resto de
--    productos usa `precio`. Mismos alias de tamaño que cotizar_mitad_y_mitad.
-- ---------------------------------------------------------------------------
create or replace function public.normalizar_tamano(p_tamano text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case normalizar_texto(coalesce(p_tamano, ''))
    when ''         then null
    when 'pequena'  then 'pequena'
    when 'personal' then 'pequena'
    when 'peque'    then 'pequena'
    when 'mediana'  then 'mediana'
    when 'media'    then 'mediana'
    when 'grande'   then 'grande'
    when 'familiar' then 'familiar'
    when 'familia'  then 'familiar'
    when 'porcion'  then 'porcion'
    when 'porciones' then 'porcion'
    else normalizar_texto(p_tamano)
  end
$$;

create or replace function public.precio_producto(p_producto_id text, p_tamano text default null)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  m        record;
  v_tams   jsonb;
  v_tam    text := normalizar_tamano(p_tamano);
  v_precio numeric;
begin
  select * into m from menu where producto_id = p_producto_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PRODUCTO_NO_ENCONTRADO',
      'message', 'El producto ' || coalesce(p_producto_id, '(vacío)') || ' no existe en el menú.');
  end if;
  if not m.disponible then
    return jsonb_build_object('ok', false, 'error', 'PRODUCTO_AGOTADO',
      'message', m.nombre || ' está agotado hoy.', 'nombre', m.nombre);
  end if;

  begin
    v_tams := case when m."tamaño" like '{%' then m."tamaño"::jsonb end;
  exception when others then
    v_tams := null;
  end;

  if v_tams is not null and jsonb_typeof(v_tams) = 'object' then
    -- Producto con precio por tamaño.
    if v_tam is null then
      if (select count(*) from jsonb_object_keys(v_tams)) = 1 then
        v_tam := (select k from jsonb_object_keys(v_tams) k limit 1);
      else
        return jsonb_build_object('ok', false, 'error', 'TAMANO_REQUERIDO',
          'message', 'Falta el tamaño de ' || m.nombre || '.', 'nombre', m.nombre,
          'tamanos', v_tams);
      end if;
    end if;
    v_precio := (v_tams ->> v_tam)::numeric;
    if v_precio is null then
      return jsonb_build_object('ok', false, 'error', 'TAMANO_NO_DISPONIBLE',
        'message', m.nombre || ' no se maneja en tamaño ' || v_tam || '.', 'nombre', m.nombre,
        'tamanos', v_tams);
    end if;
    return jsonb_build_object('ok', true, 'producto_id', m.producto_id, 'nombre', m.nombre,
      'categoria', m.categoria, 'masa', m.variante, 'tamano', v_tam,
      'variante', upper(left(v_tam, 1)) || substr(v_tam, 2),
      'precio_unitario', v_precio);
  end if;

  if m.precio is null then
    return jsonb_build_object('ok', false, 'error', 'PRECIO_NO_DISPONIBLE',
      'message', m.nombre || ' no tiene precio en el menú.', 'nombre', m.nombre);
  end if;
  return jsonb_build_object('ok', true, 'producto_id', m.producto_id, 'nombre', m.nombre,
    'categoria', m.categoria, 'masa', m.variante, 'tamano', null,
    'variante', 'Estándar', 'precio_unitario', m.precio);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Escritura del carrito. Todas devuelven el estado guardado (vista
--    estado_pedido) para que el bot responda con lo que DE VERDAD quedó.
--    Patrón de autorización del proyecto: auth.uid() nulo = backend (bot).
-- ---------------------------------------------------------------------------

-- Recalcula subtotales y total a partir de los items y guarda.
create or replace function public._carrito_guardar_items(p_telefono text, p_items jsonb)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(
           e.value || jsonb_build_object('subtotal',
             (e.value->>'precio_unitario')::numeric * (e.value->>'cantidad')::int)
           order by e.ordinality), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality e;

  insert into carritos as c (telefono, items, total)
  values (p_telefono, v_items,
          (select coalesce(sum((x->>'subtotal')::numeric), 0) from jsonb_array_elements(v_items) x))
  on conflict (telefono) do update
    set items = excluded.items, total = excluded.total;
end;
$$;

create or replace function public.carrito_agregar_item(
  p_telefono    text,
  p_producto_id text,
  p_tamano      text default null,
  p_cantidad    integer default 1,
  p_notas       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel    text := btrim(coalesce(p_telefono, ''));
  v_precio jsonb;
  v_notas  text := nullif(btrim(coalesce(p_notas, '')), '');
  v_items  jsonb;
  v_pos    integer;
  v_linea  jsonb;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if v_tel = '' then
    return jsonb_build_object('ok', false, 'error', 'TELEFONO_REQUERIDO');
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 50 then
    return jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA',
      'message', 'La cantidad debe estar entre 1 y 50.');
  end if;

  v_precio := precio_producto(p_producto_id, p_tamano);
  if not (v_precio->>'ok')::boolean then
    return v_precio;
  end if;

  select coalesce(items, '[]'::jsonb) into v_items from carritos where telefono = v_tel for update;
  v_items := coalesce(v_items, '[]'::jsonb);

  -- Misma línea (mismo producto, tamaño y notas, sin mitades) → se suma la cantidad.
  select e.ordinality - 1 into v_pos
    from jsonb_array_elements(v_items) with ordinality e
   where e.value->>'producto_id' = v_precio->>'producto_id'
     and e.value->>'variante' = v_precio->>'variante'
     and coalesce(e.value->>'notas_item', '') = coalesce(v_notas, '')
     and e.value->'mitades' is null
   limit 1;

  if v_pos is not null then
    v_items := jsonb_set(v_items, array[v_pos::text, 'cantidad'],
                 to_jsonb((v_items->v_pos->>'cantidad')::int + p_cantidad));
    v_linea := v_items->v_pos;
  else
    v_linea := jsonb_build_object(
      'producto_id', v_precio->>'producto_id',
      'nombre', v_precio->>'nombre',
      'variante', v_precio->>'variante',
      'cantidad', p_cantidad,
      'precio_unitario', (v_precio->>'precio_unitario')::numeric)
      || case when v_notas is not null then jsonb_build_object('notas_item', v_notas) else '{}'::jsonb end;
    v_items := v_items || jsonb_build_array(v_linea);
  end if;

  perform _carrito_guardar_items(v_tel, v_items);

  return jsonb_build_object('ok', true, 'agregado', v_linea,
    'estado', (select to_jsonb(e) from estado_pedido e where e.telefono = v_tel));
end;
$$;

create or replace function public.carrito_agregar_mitad(
  p_telefono   text,
  p_producto_a text,
  p_producto_b text,
  p_tamano     text,
  p_cantidad   integer default 1,
  p_notas      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel   text := btrim(coalesce(p_telefono, ''));
  v_cot   jsonb;
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_linea jsonb;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if v_tel = '' then
    return jsonb_build_object('ok', false, 'error', 'TELEFONO_REQUERIDO');
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 50 then
    return jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA',
      'message', 'La cantidad debe estar entre 1 y 50.');
  end if;

  v_cot := cotizar_mitad_y_mitad(p_producto_a, p_producto_b, p_tamano);
  if not (v_cot->>'ok')::boolean then
    return v_cot;
  end if;

  v_linea := jsonb_build_object(
    'producto_id', v_cot->>'producto_id',
    'nombre', v_cot->>'nombre_producto',
    'variante', v_cot->>'variante',
    'cantidad', p_cantidad,
    'precio_unitario', (v_cot->>'precio_unitario')::numeric,
    'mitades', v_cot->'mitades')
    || case when v_notas is not null then jsonb_build_object('notas_item', v_notas) else '{}'::jsonb end;

  perform 1 from carritos where telefono = v_tel for update;
  perform _carrito_guardar_items(v_tel,
    coalesce((select items from carritos where telefono = v_tel), '[]'::jsonb) || jsonb_build_array(v_linea));

  return jsonb_build_object('ok', true, 'agregado', v_linea, 'explicacion', v_cot->>'explicacion',
    'estado', (select to_jsonb(e) from estado_pedido e where e.telefono = v_tel));
end;
$$;

-- Quita una línea (1 = la primera, como se le muestra al cliente) o reduce su cantidad.
create or replace function public.carrito_quitar_item(
  p_telefono text,
  p_linea    integer,
  p_cantidad integer default null   -- null = quitar la línea completa
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel   text := btrim(coalesce(p_telefono, ''));
  v_items jsonb;
  v_n     integer;
  v_cant  integer;
  v_linea jsonb;
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  select items into v_items from carritos where telefono = v_tel for update;
  v_n := case when jsonb_typeof(v_items) = 'array' then jsonb_array_length(v_items) else 0 end;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'CARRITO_VACIO', 'message', 'El carrito está vacío.');
  end if;
  if p_linea is null or p_linea < 1 or p_linea > v_n then
    return jsonb_build_object('ok', false, 'error', 'LINEA_INVALIDA',
      'message', 'El carrito tiene ' || v_n || ' línea(s).', 'lineas', v_n);
  end if;
  if p_cantidad is not null and p_cantidad < 1 then
    return jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA');
  end if;

  v_linea := v_items->(p_linea - 1);
  v_cant  := (v_linea->>'cantidad')::int;

  if p_cantidad is null or p_cantidad >= v_cant then
    v_items := v_items - (p_linea - 1);
  else
    v_items := jsonb_set(v_items, array[(p_linea - 1)::text, 'cantidad'], to_jsonb(v_cant - p_cantidad));
  end if;

  perform _carrito_guardar_items(v_tel, v_items);

  return jsonb_build_object('ok', true, 'quitado', v_linea,
    'estado', (select to_jsonb(e) from estado_pedido e where e.telefono = v_tel));
end;
$$;

create or replace function public.carrito_vaciar(p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not es_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  update carritos set items = '[]'::jsonb, total = 0 where telefono = btrim(coalesce(p_telefono, ''));
  return jsonb_build_object('ok', true,
    'estado', (select to_jsonb(e) from estado_pedido e where e.telefono = btrim(coalesce(p_telefono, ''))));
end;
$$;

-- El helper interno no se expone por la API.
revoke all on function public._carrito_guardar_items(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Limpieza periódica de las tablas nuevas
-- ---------------------------------------------------------------------------
select cron.schedule('limpiar-wa-eventos', '20 3 * * *',
  $$delete from public.wa_eventos where recibido_el < now() - interval '7 days'$$);
select cron.schedule('limpiar-bot-turnos', '25 3 * * *',
  $$delete from public.bot_turnos where inicio < now() - interval '30 days'$$);
