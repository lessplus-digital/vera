# infra/supabase — Seguridad como código (RLS)

`rls_reference.sql` es el script **idempotente** que activa Row Level Security y crea la
política `auth_full_access` (acceso total solo para el rol `authenticated`). Es la referencia
del modelo de permisos y el paso obligatorio antes de producción.

```
infra/supabase/
├── README.md
└── rls_reference.sql   ← ALTER … ENABLE RLS + política auth_full_access (idempotente)
```

## Aplicar

1. Supabase → **SQL Editor**.
2. Pega el contenido de [`rls_reference.sql`](rls_reference.sql) y **Run** (idempotente).

## Verificar

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Prueba real: abre el dashboard **sin iniciar sesión** → no debe cargar datos de las tablas con
RLS. Inicia sesión y reaparecen.

> ✅ **Estado real (2026-07-22, BUG-012):** RLS está habilitado en **todas** las tablas
> públicas. Este script cubre las 6 core (`menu`, `clientes`, `pedidos`, `detalle_pedidos`,
> `reservas`, `mensajes_soporte`); las otras 6 (`carritos`, `feedback`, `feedback_pendiente`,
> `info_negocio`, `n8n_chat_histories`, `n8n_mensajes_pendientes`) se cubrieron con la
> migración `bug012_enable_rls_exposed_tables`. Ver `docs/database/schema.md` (permisos) y
> `docs/shared/changelog.md`.

## Crear el primer usuario admin

Supabase no trae usuarios por defecto: **Dashboard → Authentication → Users → Add user**
(email + contraseña). Recomendado: **Authentication → Providers → Email → "Allow new users to
sign up" = OFF** (los usuarios del panel los creas tú, no es registro público).

## Modelo de seguridad

- **anon key** → pública, va en el frontend. En las tablas con RLS no da acceso sin sesión de Auth.
- **service_role key** → secreta, salta RLS. Debe vivir **solo en n8n** (servidor), nunca en el
  frontend ni en git.
- ⚠️ Hoy varios nodos n8n escriben con la **anon key hardcodeada** en vez de `service_role`
  (BUG-003), lo que ya rompe `detalle_pedidos` (BUG-007). El diseño correcto es: bot ⇒ `service_role`.

> Replicar este setup a nuevos clientes (un proyecto Supabase por cliente) se hará más adelante
> con el MCP de Supabase; por eso aquí no hay sistema de migraciones.
