-- ============================================================================
-- QA · 03 · Pizza mitad y mitad
-- Cubre: cotizar_mitad_y_mitad()
-- Cierra el "falta probar" del changelog (2026-08-10, entrada mitad y mitad).
-- T1-T2 solo lectura. T3 escribe dentro de BEGIN…ROLLBACK.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- T1 · EXHAUSTIVO. Todos los pares válidos de pizza salada con la misma masa,
--      por los 4 tamaños. Invariantes que deben cumplirse SIEMPRE:
--        · precio_unitario = precio de la mitad MÁS CARA (ni promedio ni suma)
--        · producto_id     = el de la mitad más cara
--        · mitades         = exactamente 2 elementos
--      Estado 2026-09-09: 3024 pares, 3024 correctos, 0 fallos.
-- ---------------------------------------------------------------------------
with salada as (
  select producto_id, nombre, categoria, variante, "tamaño"::jsonb tam
  from menu
  where categoria in ('pizza_tradicional', 'pizza_especial',
                      'pizza_premium', 'pizza_premium_especial')
    and disponible
),
pares as (
  select a.producto_id pa, b.producto_id pb, a.nombre na, b.nombre nb,
         a.variante, t.tam,
         (a.tam->>t.tam)::numeric prec_a, (b.tam->>t.tam)::numeric prec_b
  from salada a
  join salada b on a.producto_id < b.producto_id
               and a.variante is not distinct from b.variante
  cross join (values ('pequena'), ('mediana'), ('grande'), ('familiar')) t(tam)
),
res as (select p.*, cotizar_mitad_y_mitad(p.pa, p.pb, p.tam) r from pares p)
select count(*) as pares_probados,
       count(*) filter (where (r->>'ok')::bool) as ok_true,
       count(*) filter (where not (r->>'ok')::bool) as ok_false_INESPERADO,
       count(*) filter (where (r->>'ok')::bool
                          and (r->>'precio_unitario')::numeric <> greatest(prec_a, prec_b))
         as precio_no_es_el_mas_caro,
       count(*) filter (where (r->>'ok')::bool
                          and r->>'producto_id' <> case when prec_a >= prec_b then pa else pb end)
         as producto_id_mal,
       count(*) filter (where (r->>'ok')::bool and jsonb_array_length(r->'mitades') <> 2)
         as mitades_distinto_de_2
from res;

-- ---------------------------------------------------------------------------
-- T2 · Rechazos y alias. Los 6 errores documentados + entrada basura + los
--      alias de tamaño que dice un cliente real.
--      Estado 2026-09-09: 21/21 correctos.
-- ---------------------------------------------------------------------------
with casos(caso, a, b, tam, esperado) as (values
 ('masa distinta (Trad + Estof)', 'PROD-019', 'PROD-024', 'mediana', 'MASA_DISTINTA'),
 ('porcion no se parte',          'PROD-019', 'PROD-020', 'porcion', 'TAMANO_NO_PERMITIDO'),
 ('dulce + salada',               'PROD-062', 'PROD-019', 'mediana', 'CATEGORIA_NO_PERMITIDA'),
 ('dulce + dulce',                'PROD-062', 'PROD-063', 'pequena', 'CATEGORIA_NO_PERMITIDA'),
 ('mitades iguales',              'PROD-019', 'PROD-019', 'mediana', 'MITADES_IGUALES'),
 ('producto inexistente',         'PROD-999', 'PROD-019', 'mediana', 'PRODUCTO_NO_ENCONTRADO'),
 ('LLM inventa id',               'PIZZA-HAWA-MED', 'PROD-019', 'mediana', 'PRODUCTO_NO_ENCONTRADO'),
 ('tamaño inventado',             'PROD-019', 'PROD-020', 'gigante', 'TAMANO_INVALIDO'),
 ('tamaño vacio',                 'PROD-019', 'PROD-020', '', 'TAMANO_INVALIDO'),
 ('tamaño null',                  'PROD-019', 'PROD-020', null, 'TAMANO_INVALIDO'),
 ('producto null',                null, 'PROD-019', 'mediana', 'FALTAN_PRODUCTOS'),
 ('ambos null',                   null, null, 'mediana', 'FALTAN_PRODUCTOS'),
 ('emoji como tamaño',            'PROD-019', 'PROD-020', '🍕', 'TAMANO_INVALIDO'),
 ('inyeccion en tamaño',          'PROD-019', 'PROD-020', ''' OR 1=1 --', 'TAMANO_INVALIDO'),
 ('alias personal',               'PROD-019', 'PROD-020', 'personal', 'OK'),
 ('alias peque',                  'PROD-019', 'PROD-020', 'peque', 'OK'),
 ('alias media',                  'PROD-019', 'PROD-020', 'media', 'OK'),
 ('alias familia',                'PROD-019', 'PROD-020', 'familia', 'OK'),
 ('MAYUSCULAS',                   'PROD-019', 'PROD-020', 'MEDIANA', 'OK'),
 ('con tilde',                    'PROD-019', 'PROD-020', 'pequeña', 'OK'),
 ('cruce de categorias',          'PROD-019', 'PROD-037', 'grande', 'OK')
)
select c.caso, c.esperado, coalesce(r->>'error', 'OK') as obtenido,
       left(coalesce(r->>'message', r->>'explicacion', ''), 70) as mensaje
from casos c, lateral cotizar_mitad_y_mitad(c.a, c.b, c.tam) r
where coalesce(r->>'error', 'OK') <> c.esperado
order by c.caso;

-- ---------------------------------------------------------------------------
-- T3 · PRODUCTO_AGOTADO. No hay pizzas agotadas en el menú, así que se agota
--      una temporalmente. Se revierte: la transacción no se confirma.
--      Estado 2026-09-09: correcto en ambos órdenes de los argumentos.
-- ---------------------------------------------------------------------------
begin;
update menu set disponible = false where producto_id = 'PROD-019';

select 'agotado en posicion A' as caso, coalesce(r->>'error', 'OK') as obtenido,
       left(r->>'message', 80) as mensaje
from cotizar_mitad_y_mitad('PROD-019', 'PROD-020', 'mediana') r
union all
select 'agotado en posicion B', coalesce(r->>'error', 'OK'), left(r->>'message', 80)
from cotizar_mitad_y_mitad('PROD-020', 'PROD-019', 'mediana') r;

rollback;

-- Comprobación de que el rollback surtió efecto (debe decir disponible = true):
select producto_id, nombre, disponible from menu where producto_id = 'PROD-019';
