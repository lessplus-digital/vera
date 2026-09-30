-- ============================================================================
-- Bot Node · Fase 5 — cambiar el pedido después del resumen lo saca del resumen
--
-- Antes: `paso_flujo` solo volvía a 'armando' cuando el carrito quedaba vacío.
-- Si el cliente veía el resumen y luego agregaba, quitaba o cambiaba un dato de
-- entrega, la fila seguía en 'resumen', y crear_orden_desde_carrito aceptaba
-- crear el pedido con un contenido que el cliente nunca vio resumido.
-- El código del bot ya lo impide (la "última pregunta" deja de ser el resumen);
-- esto es la segunda barrera, en la BD: SIN_RESUMEN vuelve a significar algo.
--
-- Regla: en un UPDATE que deja paso_flujo en 'resumen' (sin que el mismo UPDATE
-- lo haya puesto ahí), si cambian items, tipo_pedido, barrio, dirección, método
-- de pago o tarifa → 'datos'. Mostrar el resumen de nuevo lo devuelve a 'resumen'.
-- Cubierto por qa/sql/11-carrito-bot.sql §T8.
-- ============================================================================

create or replace function public.carritos_normalizar_estado()
 returns trigger
 language plpgsql
as $function$
declare
  v text;
  n_items integer;
begin
  -- El LLM manda '' con la misma facilidad que null.
  new.tipo_pedido       := nullif(btrim(coalesce(new.tipo_pedido, '')), '');
  new.barrio            := nullif(btrim(coalesce(new.barrio, '')), '');
  new.direccion_entrega := nullif(btrim(coalesce(new.direccion_entrega, '')), '');
  new.metodo_pago       := nullif(btrim(coalesce(new.metodo_pago, '')), '');
  new.notas             := nullif(btrim(coalesce(new.notas, '')), '');
  new.paso_flujo        := coalesce(nullif(btrim(lower(coalesce(new.paso_flujo, ''))), ''), 'armando');

  -- tipo_pedido -> minuscula canonica. OJO: "para llevar" en Colombia es RECOGER.
  if new.tipo_pedido is not null then
    v := lower(new.tipo_pedido);
    new.tipo_pedido := case
      when v like '%domicil%' or v like '%delivery%' or v like '%envi%' then 'domicilio'
      when v like '%recog%' or v like '%recoj%' or v like '%llevar%'
        or v like '%local%'  or v like '%pasar%'                        then 'recoger'
      else v
    end;
  end if;

  -- metodo_pago -> capitalizado canonico (la convencion del schema).
  -- A proposito NO interpreta jerga ('nequi', 'contra entrega'): eso es trabajo del
  -- extractor de senales, no de la BD. Aqui solo se arregla el casing.
  if new.metodo_pago is not null then
    v := lower(new.metodo_pago);
    new.metodo_pago := case
      when v like '%efectiv%'  then 'Efectivo'
      when v like '%transfer%' then 'Transferencia'
      else new.metodo_pago
    end;
  end if;

  -- Recoger no lleva barrio, direccion ni domicilio: si el cliente cambia de opinion,
  -- esos datos deben desaparecer o se cobra un envio que ya no existe.
  if new.tipo_pedido = 'recoger' then
    new.barrio            := null;
    new.direccion_entrega := null;
    new.costo_domicilio   := null;
    new.cobertura_ok      := null;
  end if;

  -- Cambio de barrio sin recotizar -> la cobertura y la tarifa anteriores dejan de valer.
  -- (Si la tarifa cambia en el MISMO update, es que ya se recotizo: se respeta.)
  -- BUG-042: la tarifa es por ZONA, no por barrio. Entre dos barrios de la misma zona
  -- recotizar da el MISMO numero, y "no cambio el precio" no distingue "no recotizo"
  -- de "recotizo y dio igual". En vez de inferirlo del precio se comprueba contra la
  -- tarifa real del barrio nuevo: si coincide y viene cobertura_ok, es una cotizacion
  -- valida y se respeta. Un precio viejo repetido para un barrio de otra zona sigue
  -- invalidandose, que es justo lo que esta regla protege.
  if tg_op = 'UPDATE'
     and new.barrio is distinct from old.barrio
     and new.costo_domicilio is not distinct from old.costo_domicilio
     and not (
       new.cobertura_ok is true
       and exists (select 1 from public.resolver_barrio(new.barrio) rb
                   where rb.costo = new.costo_domicilio)
     ) then
    new.costo_domicilio := null;
    new.cobertura_ok    := null;
  end if;

  -- 2026-09-30 · Cambiar el pedido con el resumen a la vista lo saca del resumen:
  -- el cliente tiene que ver el resumen nuevo antes de confirmarlo.
  if tg_op = 'UPDATE'
     and old.paso_flujo = 'resumen'
     and new.paso_flujo = 'resumen'
     and (new.items             is distinct from old.items
       or new.tipo_pedido       is distinct from old.tipo_pedido
       or new.barrio            is distinct from old.barrio
       or new.direccion_entrega is distinct from old.direccion_entrega
       or new.metodo_pago       is distinct from old.metodo_pago
       or new.costo_domicilio   is distinct from old.costo_domicilio) then
    new.paso_flujo := 'datos';
  end if;

  -- Carrito vacio -> el flujo vuelve al principio (caso BUG-032: la fila existe con items []).
  n_items := case
    when jsonb_typeof(coalesce(new.items, '[]'::jsonb)) = 'array'
      then jsonb_array_length(coalesce(new.items, '[]'::jsonb))
    else 0
  end;
  if n_items = 0 then
    new.paso_flujo := 'armando';
  end if;

  return new;
end;
$function$;
