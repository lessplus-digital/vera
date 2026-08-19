# Pendiente — cablear las zonas de domicilio en el bot

> **Estado:** la BD y el dashboard están **completos y en producción** desde el 2026-08-18
> (ver [changelog](../shared/changelog.md)). Falta solo la parte del workflow principal de n8n,
> bloqueada por **[BUG-030](../shared/bug-tracker.md)**: la API pública rechaza toda escritura
> sobre `Pizzeria Vera` (`8LI3J7PLi35zf4EJ`) porque su `settings` tiene tres claves fuera del
> esquema (`binaryMode`, `timeSavedMode`, `callerPolicy`). Las cuatro vías por API están
> descartadas con evidencia en el tracker.
>
> **Nada está roto mientras esto no se aplique.** El bot cobra $5.000 por la tarifa base, que es
> justo lo que dice su prompt. La incoherencia aparece el día que el restaurante cree su primera
> zona con un precio distinto: el bot diría un número y la BD cobraría otro.
>
> **Atajo:** `/zonas-bot` en Claude Code retoma esta tarea, reintenta por MCP y, si sigue
> bloqueado, guía la aplicación manual y verifica el resultado.

Ya listo del lado del bot: `Sub — Crear_orden_completa` acepta `barrio` en el `filtro` y lo
propaga hasta el INSERT. Si el agente no lo manda, no se rompe nada — la BD cobra la tarifa base.

Contexto de por qué se diseñó así: [ai-agents.md](ai-agents.md) ·
[schema.md](../database/schema.md) §`zonas_entrega` · [agent-prompts.md](agent-prompts.md).

---

## 1 · Nodo `consultar_cobertura` (Agente Pedidos)

Canvas → **+** → **HTTP Request Tool** → conéctalo a la entrada **Tool** del `AGENTE PEDIDOS`.

| Campo | Valor |
|---|---|
| **Name** | `consultar_cobertura` |
| **Description** | cambiar a **manual** y pegar el texto de abajo |
| **Method** | `POST` |
| **URL** | `https://lwigogymjoyyzwiyewgi.supabase.co/rest/v1/rpc/consultar_cobertura` |
| **Authentication** | `Predefined Credential Type` → `Supabase API` → credencial **Supabase account** |
| **Send Headers** | ON · `Content-Type` = `application/json` |
| **Send Body** | ON · **Specify Body** = `Using JSON` |

JSON body (con el `=` de expresión activo, igual que `consultar_faq`):

```
={
  "p_barrio": "{{ $fromAI('barrio', 'El barrio que dijo el cliente, tal cual lo escribio. Vacio para pedir la lista completa de zonas cubiertas.', 'string') }}"
}
```

Description:

```
Devuelve cuanto cuesta el domicilio a un barrio, y a que zona pertenece.

Usala SIEMPRE antes de darle un total a un cliente que pidio a domicilio, y NUNCA recuerdes de memoria un costo de envio: las tarifas cambian y son distintas por barrio.

Parametros:
- barrio: el barrio que dijo el cliente, tal cual lo escribio. Si lo dejas vacio, te devuelve la lista completa de zonas cubiertas con sus barrios y tarifas (util para "a donde llevan?").

Te devuelve: cubierto (true/false), barrio, zona, costo_domicilio (numero en pesos) y tiempo_estimado.

IMPORTANTE: cubierto=false NO significa que haya que rechazar el pedido. Significa que ese barrio todavia no esta mapeado, y el costo_domicilio que viene en la respuesta (la tarifa base) es el que se cobra igual. Toma SIEMPRE el numero de costo_domicilio que devuelve esta herramienta, pase lo que pase.
```

## 2 · Nodo `consultar_cobertura1` (Agente Soporte)

Idéntico (misma URL, credencial, headers y body), conectado al `AGENTE SOPORTE`. Cambian nombre y
descripción:

```
Zonas de domicilio que cubre el restaurante y cuanto cuesta el envio a cada barrio.

Usala SIEMPRE que el cliente pregunte si llegan a algun lado, hasta donde llevan, o cuanto cuesta el domicilio. Esa informacion ya NO esta en info_local.

Parametros:
- barrio: el barrio por el que pregunto, tal cual lo escribio. Vacio para la lista completa de zonas y barrios cubiertos.

Te devuelve: cubierto (true/false), barrio, zona, costo_domicilio (numero en pesos) y tiempo_estimado.

Si cubierto=false, el barrio no esta mapeado todavia: NO le digas al cliente que no llegan. Dile que si le llegan y que el envio le sale en el costo_domicilio que devuelve la herramienta (la tarifa base).
```

> Se duplica el nodo en vez de conectar uno solo a los dos agentes porque es la convención que ya
> sigue este workflow (`leer_carrito`/`leer_carrito1`, `actualizar_cliente`/`actualizar_cliente1`).

## 3 · Prompt del `AGENTE PEDIDOS` — 5 reemplazos

**3.1 — PASO 2a.** Buscar:

```
   → Si dice DOMICILIO:
     PRIMERO responde anunciando el costo:
     "Perfecto, el domicilio tiene un costo adicional de $5.000."
```

Reemplazar por:

```
   → Si dice DOMICILIO:
     PRIMERO necesitas el BARRIO: de él depende el costo del envío.
     Pregunta "¿En qué barrio estás?" (si ya te lo dijo en esta
     conversación, no lo repreguntes).

     Con el barrio, llama consultar_cobertura y anuncia lo que te
     devolvió en costo_domicilio:
     "Perfecto, el domicilio a [barrio] tiene un costo adicional de $[costo_domicilio]."

     NUNCA digas un costo de envío que no venga de consultar_cobertura.
     Si cubierto=false NO rechaces el pedido: se cobra igual el
     costo_domicilio que trae la respuesta.
```

**3.2 — PASO 3.** `- Domicilio = $5.000` → `- Domicilio = el costo_domicilio que devolvió consultar_cobertura`

**3.3 — Casos A y C del resumen** (son idénticos, están los dos):

```
🛵 Domicilio: $5.000              →  🛵 Domicilio: $[costo_domicilio]
💰 *Total a pagar: $[Total + 5000]*  →  💰 *Total a pagar: $[Total + costo_domicilio]*
```

**3.4 — Parámetros de `crear_orden_completa`.** Después de la línea de `direccion_entrega`:

```
- barrio: el barrio que confirmó el cliente (solo si domicilio)
```

Y en la lista de verificación, después de `✓ Si es domicilio, tengo dirección`:

```
✓ Si es domicilio, tengo el barrio y llamé consultar_cobertura
```

**3.5 — PASO 5.** `💰 Total a pagar: $[total + 5000] (con domicilio)` → `💰 Total a pagar: $[total] (con domicilio)`

## 4 · Descripción de la tool `crear_orden_completa`

En su JSON de ejemplo, junto a `direccion_entrega`:

```
  "direccion_entrega": "dirección del cliente, solo si es domicilio",
  "barrio": "el barrio del cliente, solo si es domicilio",
```

## 5 · Prompt del `AGENTE SOPORTE`

En la sección de `info_local`, quitar **"Zonas de domicilio cubiertas"** de la lista (esas claves
ya no existen en `info_negocio`) y agregar un bloque para la tool nueva:

```
### `consultar_cobertura`
Úsala cuando el cliente pregunte a dónde llevan domicilio o cuánto cuesta el envío
a un barrio. Esa información ya NO está en `info_local`.
Nunca cites un costo de envío de memoria.
```

También aparece en *"Preguntas fuera de alcance"*: `(y info_local si es horario/dirección/pagos/zonas)`
→ quitar `/zonas`.

## 6 · Opcional — que el bot no repregunte el barrio

`clientes.barrio` ya existe y el dashboard lo llena, pero el bot no lo ve: el nodo **Edit Fields**
(el que arma el contexto) no lo pasa. Agregarle un campo `barrio` = `{{ $json.barrio }}`, exponerlo
en el prompt como `barrio_registrado` y cambiar la pregunta por *"¿Sigue siendo el barrio
[barrio_registrado]?"*. Queda igual que el flujo de `direccion_registrada`. **No es necesario** para
que funcione.

---

## Al terminar

1. Verificar el workflow real por MCP (`n8n_get_workflow` mode `filtered`) contra lo de arriba.
2. Sincronizar [`agent-prompts.md`](agent-prompts.md) con el texto final y **quitar el bloque de
   deuda conocida** de su cabecera.
3. Quitar los marcadores ⏳ de la tabla de tools en [`ai-agents.md`](ai-agents.md).
4. Cerrar la sección *Pendiente* de la entrada 2026-08-18 del
   [changelog](../shared/changelog.md), y BUG-030 si además se resolvió la causa de fondo.
5. Prueba de humo: crear una zona con tarifa distinta de $5.000, pedir por WhatsApp a un barrio de
   esa zona y confirmar que el total que dice el bot coincide con `pedidos.total`.
