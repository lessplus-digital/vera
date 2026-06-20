# infra/supabase — Esquema y seguridad como código

Esto es la base para **replicar el sistema en cada cliente nuevo** (vera, somos, usb…)
sin configurar nada a mano en el dashboard de Supabase.

## Contenido

```
infra/supabase/
├── README.md                       ← este archivo
└── migrations/
    └── 0001_enable_rls.sql         ← activa RLS en todas las tablas
```

> A medida que el esquema crezca, exporta tablas/triggers/RPCs como nuevas
> migraciones numeradas (`0002_…`, `0003_…`) para que un cliente nuevo se
> levante con un solo comando.

## Aplicar la migración de RLS (paso obligatorio antes de producción)

### Opción A — Rápida (SQL Editor del dashboard)
1. Abre tu proyecto en https://supabase.com/dashboard → **SQL Editor**.
2. Pega el contenido de [`migrations/0001_enable_rls.sql`](migrations/0001_enable_rls.sql).
3. **Run**. Es idempotente: puedes correrlo varias veces sin romper nada.

### Opción B — Reproducible (Supabase CLI, recomendada para escalar)
```bash
# una sola vez
npm i -g supabase

# enlazar el proyecto (te pedirá el project-ref y la db password)
supabase link --project-ref <TU_PROJECT_REF>

# aplicar todas las migraciones de esta carpeta
supabase db push
```

## Cómo verificar que quedó bien

En el **SQL Editor**, corre:
```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public';
```
`rowsecurity` debe ser `true` en todas las tablas de la app.

Prueba real: abre el dashboard **sin iniciar sesión** — no debe cargar ningún
dato. Inicia sesión y todo vuelve a aparecer.

## Crear el primer usuario admin

Supabase no trae usuarios por defecto. Crea el primero en:
**Dashboard → Authentication → Users → Add user** (email + contraseña).
Ese es el usuario con el que entrarás al panel.

> Recomendado: desactiva el registro abierto en **Authentication → Providers →
> Email → "Allow new users to sign up"** = OFF. Los usuarios del panel los
> creas tú manualmente; no es un registro público.

## Reglas del modelo de seguridad

- **anon key** → pública, va en el frontend. Por sí sola NO da acceso a datos
  (RLS lo bloquea). Solo sirve combinada con una sesión de Auth.
- **service_role key** → secreta, salta RLS. Va **solo en n8n** (servidor),
  nunca en el frontend ni en git.
- El bot escribe pedidos/clientes con la service_role; por eso sigue
  funcionando aunque RLS esté activo.
