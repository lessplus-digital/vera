---
name: debug-bot
description: Depura un fallo del bot de WhatsApp NODE (server/) — lee el turno real en bot_turnos (clasificación, decisión, herramientas, guardia, costo), lo reproduce en el simulador y lo cierra en código con su prueba. Úsalo cuando el bot Node conteste mal, invente, no conteste, pase a una persona sin motivo, cree o no cree un pedido/reserva, o cuando un escenario de server/test/escenarios falle. Para el bot de n8n (hasta el corte) usa debug-n8n.
---

Depura el fallo del bot Node que se esté investigando (el teléfono, el escenario o el síntoma que
nombró el usuario). Principio del servidor: **la IA conversa, el código decide**. Casi todo arreglo
de verdad termina en código (política, herramienta, guardia, texto fijo), no en el prompt.

## 1. Traer el turno real (no suponer)

Cada turno queda en `bot_turnos` (`id, telefono, inicio, duracion_ms, entrada, contexto,
clasificacion, decision, herramientas, salida, guardia, error, costo`). Por el MCP de Supabase,
solo lectura:

```sql
select inicio, entrada, clasificacion, decision, herramientas, salida, guardia, error, costo
from bot_turnos where telefono = '<tel>' order by inicio desc limit 5;
```

Qué mirar, en este orden:
- `error` y `salida`: ¿el cliente recibió `ERROR_GENERICO` / `TEXTO_SEGURO`?
- `clasificacion`: intención, `confirma`, entidades. Un "sí" mal leído o una intención equivocada
  explica la mayoría de los ruteos raros.
- `decision`: `handler`, `regla` y `acciones`. La tabla de reglas está en
  `server/src/decision/politica.ts` y sus casos en `test/unit/politica.test.ts`.
- `herramientas`: qué corrió y qué devolvió (`PRODUCTO_SIN_CONSULTAR`, `MASA_NO_PEDIDA`,
  `cita_sin_respaldo`, un `ok:false` de una RPC…).
- `guardia`: `intentos_fallidos` y `violaciones` (2 = salió el texto seguro).
- `costo`: tokens por llamada (`llamadas[]`) y cuántos vinieron del caché.

## 2. Reproducirlo en el simulador

Desde `server/`, con un escenario (temporal o nuevo) en `test/escenarios/`:

```bash
npm run sim -- <filtro> --veces 1 --ver   # conversación, herramientas (🔧) y tokens por paso
```

- `datos: real` en el YAML usa el menú, la cobertura, la info del local y la FAQ reales (solo
  lectura); el resto vive en memoria.
- `bd:` verifica la fila (carrito, calificaciones, modo, chat de soporte), no el texto.
- **Lee la conversación, no solo el veredicto** (edge-case §41): un ✅ no ve lo que el escenario
  no mira. Cada corrida gasta OpenAI real: itera con `--veces 1`; ×5 solo para cerrar (umbral:
  crítico 5/5, normal ≥ 90%). Para corridas largas, el subagente `bot-sim`.

## 3. Dónde va el arreglo

| Síntoma | Lugar |
|---|---|
| fue al agente equivocado / un "sí" se tomó mal | `decision/politica.ts` (+ caso en `politica.test.ts`) |
| inventó un dato (precio, producto, horario, tiempo) | `guardia/guardia.ts`, o que lo diga el código (`textos.ts`, respuestas fijas de Soporte) |
| eligió otro producto / otra masa / un id adivinado | `herramientas/menu.ts` (rechazo con código de error que el modelo lee) |
| la frase del modelo repite o contradice al código | que ese caso salga sin modelo (ver `soloDatos` en Pedidos, `soloCobertura` en Soporte, `plan.fijo` en Reservas) |
| crea o no crea un pedido/reserva cuando no debía | política + ejecutor; nunca el modelo |
| el simulador no se parece a producción | `sim/repo-memoria.ts` debe imitar la RPC real: compárala con `pg_get_functiondef` |

## 4. Cerrar

- Prueba unitaria del arreglo (`npm test`) **y** el escenario que lo destapó, ×5.
- Cuidado con verificar dentro del guion del LLM falso (`FakeLLM`): un `expect` que falla ahí se
  traga (el turno responde `ERROR_GENERICO`). Verifica después del turno, en `registro.herramientas`.
- Docs: `docs/bot/servidor.md` (la sección del agente o de la guardia), una línea en
  `docs/changelog.md`; si es una lección que se repetirá, `docs/edge-cases.md`.
