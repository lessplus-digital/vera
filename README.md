# 🍕 Vera Pizzería — Dashboard Admin

Dashboard en tiempo real para gestión de pedidos.

## Configuración rápida

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar Supabase
Abre `src/lib/supabase.js` y reemplaza:
```js
const SUPABASE_URL = 'https://lwigogymjoyyzwiyewgi.supabase.co'
const SUPABASE_ANON_KEY = 'TU_ANON_KEY_AQUI'  // ← cambia esto
```

Encuentra tu anon key en: Supabase → Project Settings → API → anon public

### 3. Correr en desarrollo
```bash
npm run dev
```
Abre http://localhost:5173

---

## Deploy en Vercel (gratis)

1. Sube el proyecto a GitHub
2. Ve a vercel.com → New Project → importa el repo
3. Deploy automático ✅

## Deploy en tu VPS

```bash
# Construir
npm run build

# Copiar la carpeta /dist a tu servidor
# Configurar Nginx para servir los archivos estáticos
```

### Config Nginx para VPS:
```nginx
server {
    listen 80;
    server_name admin.tudominio.com;

    root /var/www/pizza-dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Para un nuevo cliente

1. Crea nuevo proyecto en Supabase
2. Copia este proyecto
3. Cambia la URL y anon key en `src/lib/supabase.js`
4. `npm run build`
5. Deploy en un nuevo subdominio

---

## Funcionalidades

- ✅ Kanban en tiempo real con Supabase Realtime
- ✅ 3 columnas: Por aprobar / En cocina / En camino
- ✅ Aprobar/Rechazar pedidos con 1 clic
- ✅ Ver comprobante de pago
- ✅ Sonido cuando llega pedido nuevo
- ✅ Stats del día en el header
- ✅ Diferencia entre Domicilio y Recoger
