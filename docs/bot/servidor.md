# Servidor del bot (Node) — reemplazo de n8n

> **Estado (2026-09-29): en construcción — Fases 1–3 de 9 hechas.** El bot en producción sigue siendo el
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
  5. Procesador de turno (determinista, sin LLM)            → src/turno/procesador.ts
  6. Envío por la Graph API (o FakeWhatsApp en pruebas)     → src/whatsapp/cliente.ts
  7. Registro del turno en bot_turnos                        → src/log/turnos.ts
  Responde 200 a Meta en el paso 3; el turno corre después.
```

### El procesador de turno (Fase 3)

Decide por el **modo del cliente** (`clientes.modo`) y el **tipo de mensaje**; no hay LLM aquí.
Toda la BD pasa por la interfaz `Repo` (`src/bd/repo.ts`): `RepoSupabase` en producción y
`RepoMemoria` (`src/sim/`) en pruebas y simulador. Los textos fijos viven en `src/textos.ts`.

| Modo | Texto | Foto | Audio / ubicación / sticker |
|---|---|---|---|
| `humano` | al chat de soporte (`mensajes_soporte`), el bot no contesta | se sube a `comprobantes/soporte/<tel>/…` y va a soporte como imagen | nota para el operador en soporte |
| `esperando_feedback` | RPC `procesar_respuesta_feedback` → texto fijo según la acción. Si ya no había calificación pendiente (`sin_pendiente`), **el texto sigue al bot** (en n8n se perdía) | "No aceptamos imágenes…" | igual que foto |
| `bot` | `Conversador` (hoy un eco; Fases 4–5 = clasificador → política → agentes), con historial en `n8n_chat_histories` | **comprobante**: pedido pendiente por transferencia más reciente sin comprobante → `comprobantes/<PED>.<ext>` + `pedidos.comprobante_url` | texto "solo puedo leer texto y fotos" |

- **Nunca silencio:** si el conversador falla, el cliente recibe `ERROR_GENERICO`; si la descarga
  de un comprobante falla, `COMPROBANTE_ERROR`. Ambos quedan con `error` en `bot_turnos`.
- **Avisos de estado del pedido:** `POST /hooks/estado-pedido` (`src/http/hooks.ts`), autenticado
  con `x-webhook-token` = `HOOK_TOKEN`. Solo avisa si cambió `estado`. En el corte (Fase 8) el
  trigger `notificar-estado-pedido` se apunta aquí. Mejora: un cancelado sin motivo ya no dice "null".
- **Calificaciones:** `src/cron/feedback.ts` cada 15 min (RPC `solicitar_feedback_lote`, tandas de 5
  con 2 s de pausa). **Apagado por defecto** (`FEEDBACK_ACTIVO=false`) mientras n8n tenga su propio
  job; se enciende en el corte.
- **Paso a humano:** `repo.pasarAHumano()` pone `modo='humano'` y el trigger `trigger_contexto_handoff`
  copia el historial al chat de soporte. Lo dispara la política de la Fase 4 (y el Agente Soporte).

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
- **Fase 2:** ✅ RPCs y tablas aplicadas en la BD el 2026-09-29 (`docs/database.md` §RPC del
  servidor Node; QA 11 y 12 verdes). El servidor ya las usa: dedupe en capas (memoria →
  `wa_eventos`; si la BD falla se procesa igual para no perder mensajes) y un registro por turno
  en `bot_turnos` (clase `Turno` en `src/log/turnos.ts`: entrada, decisión, herramientas con
  resultado y duración, salida). Sin `SUPABASE_URL`/`SUPABASE_SECRET_KEY` arranca en modo
  desarrollo (memoria + log). Pruebas de integración en `test/integracion/` (se saltan sin claves).
- **Fase 3:** ✅ núcleo determinista (2026-09-29): modos, soporte, calificaciones, comprobantes,
  avisos de estado, historial. 86 pruebas (79 unitarias + 7 de integración contra Supabase real).
- **Fases 4–6:** clasificador + política + guardia, agentes, escenarios G1–G11 en verde. **Fase 7:** proxy de envíos del dashboard. **Fase 8:** corte.
