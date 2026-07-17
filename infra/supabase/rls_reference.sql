-- ════════════════════════════════════════════════════════════════════════
--  0001_enable_rls.sql
--  Activa Row Level Security (RLS) en todas las tablas del proyecto.
--
--  MODELO DE SEGURIDAD (proyecto single-tenant, ej. Vera):
--    • El DASHBOARD usa la anon key + sesión de Supabase Auth. Solo usuarios
--      AUTENTICADOS (rol `authenticated`) pueden leer/escribir.
--    • El rol `anon` (sin sesión) NO puede tocar ningún dato.
--    • n8n / el bot escriben con la SERVICE_ROLE key, que IGNORA RLS por
--      diseño — no necesita políticas. Esa key vive solo en el servidor
--      (n8n), NUNCA en el frontend.
--
--  Sin esto, cualquiera con la anon key (que es pública) puede leer toda la
--  base de datos. Esta migración es OBLIGATORIA antes de salir a producción.
--
--  Idempotente: se puede correr varias veces sin error.
-- ════════════════════════════════════════════════════════════════════════

-- Tablas a proteger. Si agregas una tabla nueva, añádela aquí.
do $$
declare
  t text;
  tablas text[] := array[
    'menu',
    'clientes',
    'pedidos',
    'detalle_pedidos',
    'reservas',
    'mensajes_soporte'
  ];
begin
  foreach t in array tablas loop
    -- 1) Activa RLS (deniega todo por defecto).
    execute format('alter table public.%I enable row level security;', t);

    -- 2) Política única: acceso total SOLO para usuarios autenticados.
    --    Recreamos para que la migración sea idempotente.
    execute format('drop policy if exists "auth_full_access" on public.%I;', t);
    execute format($f$
      create policy "auth_full_access" on public.%I
        for all
        to authenticated
        using (true)
        with check (true);
    $f$, t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────
--  NOTA PARA EL FUTURO (multi-tenant en modelo pool, NO aplica todavía):
--
--  Si algún día varios clientes comparten esta misma base de datos, NO basta
--  con `using (true)`. Cada tabla llevaría una columna `tenant_id` y la
--  política filtraría por el tenant del JWT, p. ej.:
--
--    create policy "tenant_isolation" on public.pedidos
--      for all to authenticated
--      using  (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'))
--      with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));
--
--  Mientras cada cliente tenga su PROPIO proyecto Supabase (modelo actual
--  recomendado), `using (true)` para authenticated es correcto y suficiente.
-- ────────────────────────────────────────────────────────────────────────
