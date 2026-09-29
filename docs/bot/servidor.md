# Servidor del bot (Node) — reemplazo de n8n

> **Estado (2026-09-29): en construcción — Fase 1 de 9.** El bot en producción sigue siendo el
> de n8n (`n8n-workflow.md` y compañía) hasta el corte de la Fase 8. Plan completo y fases:
> `docs/changelog.md` § 2026-09-29. Punto de vuelta atrás: tag git `pre-migracion-node`.

## Por qué

En n8n el **orquestador es un LLM que decide solo**, guiado por reglas en texto, y no las
respeta de forma fiable: BUG-061/062 necesitaron tres rondas de prompt y al final se
resolvieron con un override en código. Tampoco había pruebas unitarias ni forma de automatizar
las pruebas de WhatsApp. Principio del servidor nuevo: **la IA conversa, el código decide.**
Las acciones críticas (crear pedido, crear/cancelar reserva, handoff, cobertura) las ejecuta
código probado; el LLM clasifica y redacta.

## Dónde vive

- Código: `server/` en este repo (paquete aparte; no afecta el build del dashboard).
- Producción: Docker en el VPS de Hostinger donde corre n8n (`docker-compose.yml`), detrás
  del proxy HTTPS que ya publica n8n → `bot.plateo.cloud`. n8n queda apagado como respaldo.

## Comandos (desde `server/`)

```bash
npm run dev        # servidor con recarga (lee server/.env; ver .env.example)
npm test           # pruebas unitarias (Vitest, sin red, ~2 s)
npm run typecheck  # chequeo de tipos
npm run sim        # simulador de WhatsApp: escenarios de test/escenarios/*.yaml, 5 corridas c/u
npm run sim -- g3 --veces 1     # filtrar por nombre de archivo / una sola corrida
npm run chat       # conversar con el bot desde la terminal, sin WhatsApp
npm run build && npm start      # producción local
```

El subagente **`bot-sim`** corre el simulador y devuelve solo lo que falla.

## Cómo fluye un mensaje (Fase 1)

```
Meta ─POST─▶ /webhook/whatsapp  (src/http/app.ts)
  1. Verifica X-Hub-Signature-256 con WA_APP_SECRET        → 401 si no cuadra
  2. parsearWebhook(): texto · imagen · botón (remapeado) · no_soportado; ignora `statuses`
  3. Dedupe por wamid (Meta reintenta)                     → src/cola/dedupe.ts
  4. BufferPorTelefono: espera BUFFER_MS desde el ÚLTIMO mensaje y junta el turno;
     nunca dos turnos del mismo teléfono a la vez           → src/cola/buffer.ts
  5. Procesador de turno — hoy un ECO provisional           → src/turno/eco.ts
  6. Envío por la Graph API (o FakeWhatsApp en pruebas)     → src/whatsapp/cliente.ts
  Responde 200 a Meta en el paso 3; el turno corre después.
```

`src/bot.ts` es el **único punto de ensamblado**: lo usan `index.ts` (producción), el
simulador y las pruebas, así que el simulador ejercita exactamente el código de producción
cambiando solo lo externo (WhatsApp, y en fases siguientes BD y LLM).

Diferencias deliberadas con n8n ya resueltas en la Fase 1:

| n8n | Servidor |
|---|---|
| Sin verificación de firma de Meta | Firma HMAC obligatoria |
| Audio/ubicación/stickers se descartaban en silencio (edge-case 19) | Se contestan con un texto amable |
| Dos ejecuciones del mismo cliente podían correr en paralelo | Turnos en serie por teléfono |
| Buffer en tabla + Wait + cron de limpieza (BUG-053) | Buffer en memoria por teléfono |

## Simulador y escenarios

Los escenarios reemplazan a `qa/guiones-bot.md` de forma automatizada. Formato:

```yaml
nombre: Cobertura con errata
critico: true            # invariante de negocio: debe pasar en TODAS las corridas
telefono: "573000000901" # rango de prueba 5730000009xx (nunca un número real)
pasos:
  - envia: ["hola", "¿llegan a Niquía?"]   # varios seguidos = un turno
    debe:
      contiene: ["7.500"]
      no_contiene: ["sin problema"]
      coincide: "30.*45"   # regex, sin distinguir mayúsculas
      respuestas: 1        # número exacto de mensajes del bot
  - envia_boton: Confirmar
  - envia_imagen: { id: img-1 }
  - envia_tipo: audio
```

El esquema es **estricto**: una clave con errata hace fallar la carga en vez de "pasar" sin
verificar nada. Umbral: crítico = 100% de las corridas; normal = ≥ 90%. Las verificaciones de
BD (`bd:`) y del log de turnos (`turno:`) llegan con las Fases 2–4.

## Variables de entorno

Ver `server/.env.example`. Obligatorias: `WA_VERIFY_TOKEN`, `WA_APP_SECRET` y, con
`WA_MODO=graph`, `WA_ACCESS_TOKEN` + `WA_PHONE_NUMBER_ID`. `WA_MODO=fake` no envía nada
(desarrollo). El proceso no arranca si falta algo (validación con zod en `src/config.ts`).

## Pendiente por fase

- **Fase 1 (esta):** ✅ probado contra WhatsApp real el 2026-09-29 con el número de pruebas de
  Plateo (322 681 7466, sin clientes reales), apuntando el webhook de Meta a un túnel
  `npx cloudflared tunnel --url http://localhost:3000`. Mientras el webhook apunta al servidor,
  n8n no recibe mensajes de ese número; volver = restaurar la URL de n8n en Meta. Si Meta dice
  "no se pudo validar", el log `verificación de Meta rechazada` indica si el token coincidió
  (registra solo su largo, nunca el valor). Falta: construir la imagen de Docker.
- **Fase 2:** RPCs nuevas (`carrito_agregar_item`/`quitar`, `crear_orden_desde_carrito`,
  reservas), tablas `wa_eventos`, `bot_turnos`, `conversaciones`.
- **Fases 3–6:** núcleo determinista, clasificador + política + guardia, handlers, escenarios
  G1–G11 en verde. **Fase 7:** proxy de envíos del dashboard. **Fase 8:** corte.
