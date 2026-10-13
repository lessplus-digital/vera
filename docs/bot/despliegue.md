# Despliegue y corte del bot Node (Fase 8)

> Estado (2026-10-13): **el corte está hecho** (2026-10-05) y el bot corre en el VPS en
> `bot.plateo.cloud`. Esta guía queda como referencia del orden y de las trampas. **Para
> actualizar con código nuevo** basta, en el VPS: `cd ~/vera && git pull --ff-only && cd server &&
> docker compose up -d --build`, y comprobar `docker ps` (healthy) y `curl https://bot.plateo.cloud/salud`.
> Contexto: `docs/bot/servidor.md`.
> **El repo es público:** ningún token, clave ni IP va en este archivo.

## Cómo encajan las piezas (en simple)

```
Cliente (WhatsApp) → Meta → https://bot.plateo.cloud/webhook/whatsapp
                                      │  (DNS: el nombre apunta a la IP del VPS)
                                      ▼
                       VPS Hostinger: proxy HTTPS (el mismo que ya sirve n8n)
                                      │  (reenvía a 127.0.0.1:3000)
                                      ▼
                       contenedor `plateo-bot` (server/) → Supabase + OpenAI
```

El **nombre del servidor** (hostname, hoy `vps`) es solo una etiqueta de la máquina: nadie lo usa
para llegar al bot. Meta y el dashboard lo llaman por **su propio nombre**, `bot.plateo.cloud`,
un registro DNS que apunta a la IP del VPS.

## Antes de empezar: lo que se necesita tener a mano

| Qué | Dónde se saca |
|---|---|
| Acceso SSH al VPS | Hostinger → VPS → "Acceso SSH" (o el Terminal del panel) |
| Acceso al DNS de `plateo.cloud` | donde se compró el dominio (ahí está `vera.plateo.cloud`) |
| `WA_APP_SECRET`, `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID` | Meta → la app de WhatsApp |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys → nueva "bot-node" |
| `OPENAI_API_KEY` | platform.openai.com → API keys → nueva "bot-node" |
| `WA_VERIFY_TOKEN` y `HOOK_TOKEN` | **los inventas tú**: cualquier texto largo (≥ 16 caracteres). `HOOK_TOKEN` distinto del que usa n8n hoy |

## Pasos

### 1. Mirar el VPS (solo lectura)
Por SSH: `docker ps` y `cat` del `docker-compose.yml` donde está n8n. Hay que ver **qué proxy
usa** (en la plantilla de n8n de Hostinger suele ser Traefik) y **a qué red Docker está
conectado**. Con eso se ajusta el paso 4. También `free -h` y `df -h` (memoria y disco libres;
el bot necesita ~300 MB) — tarea f8-1 del tablero.

### 2. DNS
En el proveedor del dominio, crear un registro **A**: nombre `bot`, valor = la IP pública del
VPS (Hostinger → VPS → la IP, en la fila "IPv4").
Tarda de minutos a un par de horas. Se comprueba con `nslookup bot.plateo.cloud`.

### 3. Subir el código y la configuración
```bash
git clone <URL del repo> && cd vera/server   # en el VPS vive en ~/vera
cp .env.example .env && nano .env      # llenar con la tabla de arriba
```
Dejar `WA_MODO=graph`, `FEEDBACK_ACTIVO=false` y `DASHBOARD_ORIGENES=https://vera.plateo.cloud`
**hasta el corte** (ver paso 7).

### 4. Levantar el contenedor
```bash
docker compose up -d --build
docker logs plateo-bot --tail 50       # debe decir que escucha en el 3000, sin errores de config
curl http://127.0.0.1:3000/salud       # → ok
```
El proxy es **Traefik**, con su propio compose en `server/traefik/docker-compose.yml` (desde el
2026-10-13; antes vivía dentro del proyecto de n8n). Se levanta una vez:
`cd ~/vera/server/traefik && echo "SSL_EMAIL=<correo>" > .env && docker compose up -d`.
`server/docker-compose.yml` ya trae las etiquetas del bot y se une a la red `n8n_default`
(nombre heredado, la crea Traefik); antes de levantar, comprobar con `docker network ls`. El
certificado HTTPS lo pide Traefik solo, una vez el DNS resuelva y **vive en el volumen
`traefik_data`: no borrarlo**. Prueba desde fuera: `curl https://bot.plateo.cloud/salud` → ok (con candado válido).

### 5. Prueba sin cortar a n8n
Con el servidor ya público, probar con el **número de pruebas de Plateo** (322 681 7466, sin
clientes reales) apuntando solo su webhook… En la práctica Meta tiene **un** webhook por app, así
que esta prueba **es** el corte (paso 6). Por eso se hace en horario tranquilo y con el paso 8
(vigilancia) listo.

### 6. El corte
1. Meta → WhatsApp → Configuración → Webhook: URL `https://bot.plateo.cloud/webhook/whatsapp` y
   el `WA_VERIFY_TOKEN`; "Verificar y guardar". Suscribir solo el campo `messages`.
   **Trampa vista el 2026-10-05:** el primer "hola" llegó, pero los siguientes no: Meta no tenía
   suscrito el campo `messages` hasta que se volvió a guardar la configuración ("Se suscribió
   automáticamente a messages v26.0"). Si el bot calla tras el primer mensaje, `wa_eventos` sin filas
   nuevas = Meta no entrega; revisar esa suscripción.
2. Escribir al bot desde un teléfono: debe contestar, y en Supabase debe aparecer la fila en
   `bot_turnos` y `wa_eventos`.
3. Apuntar el aviso de estado al servidor (SQL de abajo) y cambiar un pedido de estado en el
   dashboard: el cliente debe recibir el aviso una sola vez.
4. En `server/.env` del VPS: `FEEDBACK_ACTIVO=true` y `docker compose up -d`.
5. **Apagar el workflow de n8n** (si no, las calificaciones salen dos veces). Claude lo hace
   por el MCP; no se borra.

### SQL del paso 6.3 (aplicar con el MCP de Supabase, reemplazando `<HOOK_TOKEN>`)
```sql
DROP TRIGGER IF EXISTS "notificar-estado-pedido" ON public.pedidos;
CREATE TRIGGER "notificar-estado-pedido" AFTER UPDATE ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://bot.plateo.cloud/hooks/estado-pedido', 'POST',
  '{"Content-type":"application/json","x-webhook-token":"<HOOK_TOKEN>"}', '{}', '5000');
```
El valor real nunca se escribe en el repo ni en el chat: se pasa directo al MCP.

### 7. Dashboard (justo después del paso 6.2)
En Vercel: `VITE_WA_PROXY_URL=https://bot.plateo.cloud`, **borrar** `VITE_WA_ACCESS_TOKEN`,
redesplegar y probar un envío (resolver un chat de soporte). **Solo después** rotar el token en
Meta y poner el nuevo en el `.env` del VPS (`docker compose up -d`). Si se rota antes, los
envíos del dashboard en producción se caen.

### 8. Vigilancia 48 h
Revisar `bot_turnos` (columna `error` no nula, `guardia`) y `docker logs plateo-bot`. La
prueba de **Reservas** por WhatsApp real sigue pendiente: verificar que "el sábado" se resuelve
bien en hora Colombia.

## Pruebas manuales por WhatsApp (después del corte)
1. "hola" → saludo y pide el nombre si no lo conoce.
2. "¿qué horario tienen?" → horario real, sin modelo.
3. "quiero una hawaiana" → carrito 🛒 con precio exacto.
4. Pedido completo a domicilio por transferencia: resumen → "sí" → `PED-…` y cuenta para pagar.
5. Enviar foto del comprobante → queda en el pedido.
6. "¿llegan a Niquía?" y a un barrio sin cobertura.
7. "quiero reservar el sábado a las 7 para 4" → resumen → confirmar → `RES-…`.
8. "quiero hablar con una persona" → el chat pasa a Soporte y el bot calla.
9. Cambiar el estado de un pedido en el dashboard → llega el aviso.
10. Calificación: tras entregar un pedido, esperar el job (≤ 15 min) y responder "5".

## Si algo sale mal
Volver a n8n **no** es el plan (decisión 2026-09-30); se arregla hacia adelante: leer
`bot_turnos` (skill `debug-bot`) y los logs del contenedor. Lo único que sí es reversible en un
minuto es el webhook de Meta (apuntarlo a otra URL).
