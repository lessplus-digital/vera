# Vera Pizzería — Bot WhatsApp con n8n + Supabase

## Resumen del proyecto

Bot de WhatsApp para gestión de pedidos de Vera Pizzería. El cliente escribe por WhatsApp, el bot atiende de forma natural (sin parecer bot), consulta el menú en tiempo real, toma el pedido y lo registra en base de datos.

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Automatización | n8n (self-hosted) |
| Base de datos | Supabase (PostgreSQL) |
| Canal de comunicación | WhatsApp (vía API) |
| IA del agente | OpenAI (GPT) con memoria Postgres |
| Memoria conversacional | Postgres Chat Memory (n8n) |

---

## Arquitectura general

```
WhatsApp
   ↓
n8n — Workflow principal
   ├── Obtener datos cliente (Supabase)
   ├── ¿Cliente existe? → Si no: Crear cliente
   ├── Merge Data Cliente
   ├── Edit Fields
   └── Agente IA (INTENCION_CLIENTE)
         ├── OpenAI Chat Model
         ├── Postgres Chat Memory
         └── Tools:
               ├── consultar_menu    → Subworkflow
               ├── crear_pedido      → Supabase insert
               ├── agregar_items     → Supabase insert
               └── actualizar_cliente → Supabase update
```

---

## Base de datos (Supabase)

### Tabla: `menu`

| Columna | Tipo | Descripción |
|---|---|---|
| producto_id | text (PK) | Ej: PROD-001, PROD-087 |
| nombre | text | Nombre del producto |
| categoria | text | pizza, bebida, arepa, etc. |
| variante | text | Opcional |
| descripcion | text | Ingredientes / descripción |
| precio | numeric | Precio base |
| disponible | bool | true/false |
| tamaño | text | JSON con precios por tamaño: `{"porcion":10500,"mediana":37500}` |

### Tabla: `pedidos`

Campos clave: `pedido_id`, `cliente_id`, `telefono`, `tipo_pedido` ('domicilio' \| 'recoger'), `metodo_pago` ('transferencia' \| 'efectivo'), `direccion_entrega`, `total`, `estado`, `estado_pago`, `notas`.

### Tabla: `detalle_pedidos`

Campos clave: `pedido_id` (FK), `producto_id` (FK → menu), `nombre_producto`, `variante`, `cantidad`, `precio_unitario`.

### Trigger: cálculo automático del total

Se ejecuta automáticamente al insertar/actualizar/eliminar items en `detalle_pedidos`. Suma `precio_unitario * cantidad` y agrega $5.000 si el pedido es domicilio.

```sql
CREATE OR REPLACE FUNCTION actualizar_total_pedido()
RETURNS TRIGGER AS $$
DECLARE
  costo_domicilio NUMERIC := 5000;
  tipo TEXT;
BEGIN
  SELECT tipo_pedido INTO tipo FROM pedidos WHERE pedido_id = NEW.pedido_id;

  UPDATE pedidos
  SET total = (
    SELECT COALESCE(SUM(precio_unitario * cantidad), 0)
    FROM detalle_pedidos
    WHERE pedido_id = NEW.pedido_id
  ) + CASE WHEN tipo = 'domicilio' THEN costo_domicilio ELSE 0 END
  WHERE pedido_id = NEW.pedido_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_total
AFTER INSERT OR UPDATE OR DELETE ON detalle_pedidos
FOR EACH ROW EXECUTE FUNCTION actualizar_total_pedido();
```

> ⚠️ El total NUNCA lo calcula el LLM — siempre lo calcula el trigger.

---

## Subworkflow: consultar_menu

### Estructura

```
When Executed by Another Workflow
   ↓
Code node (construir filtros)
   ↓
HTTP Request (Supabase REST API)
   ↓
Code node (formatear respuesta)
```

### Code node 1 — Construir filtros

```javascript
const input = $input.first().json;

let busqueda = null;
if (input.filtro && typeof input.filtro === 'string') {
  busqueda = input.filtro.trim();
} else if (input.nombre) {
  busqueda = input.nombre.trim();
}

const queryParams = {
  select: 'producto_id,nombre,categoria,variante,descripcion,precio,disponible,tamaño',
  order: 'categoria.asc,nombre.asc',
  disponible: 'eq.true',
  limit: '30'
};

if (busqueda) {
  const palabras = busqueda.toLowerCase().split(' ').filter(p => p.length > 2);

  if (palabras.length === 1) {
    const p = palabras[0];
    queryParams.or = `(nombre.ilike.*${p}*,categoria.ilike.*${p}*,descripcion.ilike.*${p}*)`;
  } else {
    const p = palabras[0];
    queryParams.or = `(nombre.ilike.*${p}*,descripcion.ilike.*${p}*)`;
    queryParams._filtrar_palabras = palabras.slice(1).join(',');
  }
}

return [{ json: queryParams }];
```

### HTTP Request

| Campo | Valor |
|---|---|
| Method | GET |
| URL | `https://TU_PROYECTO.supabase.co/rest/v1/menu` |
| Send Query Parameters | ✅ activado (usando Fields Below) |
| Headers | `apikey: TU_ANON_KEY` / `Authorization: Bearer TU_ANON_KEY` |

Parámetros configurados como expresiones: `select`, `order`, `disponible`, `limit`, `or`. Los campos `categoria` y `precio` solo se agregan si el Code node los incluye.

### Code node 2 — Formatear respuesta

```javascript
let lista = $input.all().map(item => item.json);

// Filtro post-proceso para búsquedas de múltiples palabras
const palabrasExtra = $('Code in JavaScript').first().json._filtrar_palabras;
if (palabrasExtra) {
  const palabras = palabrasExtra.split(',');
  lista = lista.filter(item => {
    const texto = `${item.nombre} ${item.descripcion || ''} ${item.categoria || ''}`.toLowerCase();
    return palabras.every(p => texto.includes(p));
  });
}

if (lista.length === 0) {
  return [{ json: { encontrados: 0, mensaje: 'No se encontraron productos con esos filtros.', productos: [] } }];
}

const porCategoria = {};
for (const item of lista) {
  const cat = item.categoria || 'Sin categoría';
  if (!porCategoria[cat]) porCategoria[cat] = [];
  porCategoria[cat].push({
    producto_id: item.producto_id,
    nombre: item.nombre,
    variante: item.variante || null,
    descripcion: item.descripcion || null,
    precio: item.precio,
    tamaño: item.tamaño || null,
    disponible: item.disponible
  });
}

return [{ json: { encontrados: lista.length, productos_por_categoria: porCategoria } }];
```

### Tool en el agente

El tool `consultar_menu` tiene un solo Workflow Input llamado `filtro`. El LLM pasa el término de búsqueda ahí. Ejemplos: `{ filtro: "hawaiana" }`, `{ filtro: "arepa" }`.

**Nunca debe pasar:** `{ filtro: "%hawaiana%" }` ni `{ input: "hawaiana" }`.

---

## Lecciones aprendidas / errores comunes

### 1. El LLM inventaba producto_ids
El LLM construía IDs falsos como `PIZZA-DULCE-JUMB-PQ` en lugar de usar los reales. Solución: regla explícita en el prompt y siempre llamar `consultar_menu` antes de `agregar_items`.

### 2. Filtros OR en Supabase con múltiples palabras
Buscar "hawaiana premium" fallaba porque en BD está como "Premium Hawaiana". Solución: dividir la búsqueda en palabras, filtrar la primera en Supabase y las restantes en el Code node con `.filter()` local.

### 3. n8n no tiene URLSearchParams, fetch, ni $helpers
En Code nodes de n8n no están disponibles las APIs de browser ni `$helpers.httpRequest`. Usar el nodo HTTP Request separado con Query Parameters configurados por Fields Below.

### 4. n8n envía `undefined` como texto en query params
Si un campo del JSON no existe, n8n lo envía como string `"undefined"` a Supabase, causando errores de parseo. Solución: no incluir los campos en el objeto si no tienen valor (no usar `null` tampoco).

### 5. El LLM se saltaba consultar_menu
A veces "creía saber" el producto y respondía sin consultar. Solución: mover la llamada a `consultar_menu` al momento de confirmar tamaños (cuando ya tiene el nombre exacto) y agregar regla ABSOLUTA en el prompt.

### 6. Total del pedido llegaba como 0
El LLM pasaba `total: 0` en `crear_pedido` porque aún no tenía los precios de los items. Solución: trigger en Supabase que recalcula automáticamente el total.

### 7. El bot mencionaba "el sistema"
Cuando un producto no existía, el bot decía cosas como "el sistema se trabó". Solución: regla en prompt prohibiendo mencionar herramientas, sistemas o procesos internos.

---

## System prompt del agente

```
VERA PIZZERIA — ASISTENTE WHATSAPP

Eres un empleado real de Vera Pizzería atendiendo por WhatsApp.
Habla natural, cálido e informal. Nunca suenes como un bot.
Teléfono/SessionId del cliente: {{ $json.telefono }}

---
1. NOMBRE DEL CLIENTE
---
Nombre registrado: {{ $json.nombre }}

A) Si nombre es "Pendiente" o null:
   - Pregúntale su nombre primero.
   - Regístralo con tool "actualizar_cliente".
B) Si tiene nombre, usa solo el primer nombre.
C) Si el nombre parece raro, religioso, emoji o no real: saluda sin nombre.

---
2. TONO Y FORMATO
---
- Máximo 4 líneas por respuesta. Sé concreto.
- Emojis con moderación.
- Nunca datos crudos, listas técnicas ni guiones largos.

PROHIBIDO:
- Dar precios aproximados ("aprox", "alrededor de", "entre X y Y").
- Asumir precios sin consultar consultar_menu.
- Ofrecer productos sin saber su precio exacto.
- Mencionar "el sistema", "herramientas", "buscar" ni nada técnico.

CUANDO UN PRODUCTO NO EXISTE:
"No tenemos Red Bull, pero te puedo ofrecer [alternativa consultada]."

---
3. MENÚ
---
REGLA ABSOLUTA — SIN EXCEPCIONES:
Antes de mencionar CUALQUIER producto, precio, ingrediente o disponibilidad,
DEBES llamar consultar_menu. Siempre. Sin excepción.
Aunque creas saber el precio. SIEMPRE consulta primero.

Si el cliente pide ver el menú completo:
"Aquí tienes nuestro menú: [URL] — Te ayudo con algo en particular?"
Este es el ÚNICO caso donde NO usas consultar_menu.

CÓMO usar consultar_menu:
- Correcto:   { "filtro": "hawaiana" }
- Incorrecto: { "filtro": "%hawaiana%" }

PRODUCTOS CON TAMAÑO:
Si el campo "tamaño" tiene valores JSON, pregunta el tamaño antes de cotizar.

PRESUPUESTOS:
Solo ofrece productos con precio exacto confirmado por consultar_menu.
Nunca digas "aprox" ni rangos de precio.

ORDEN ESTRICTO para pizzas:
PASO A — "¿Tradicional o Premium?" → esperar respuesta
PASO B — "¿Tradicional o Estofada?" → esperar respuesta
PASO C — Llamar consultar_menu con nombre exacto → preguntar tamaño

NUNCA hagas B o C sin confirmar el anterior.

---
4. FLUJO DE PEDIDO
---
PASO 1: Confirmar productos + cantidades + variantes + tamaños + domicilio/recoger + pago.
PASO 2: Mostrar resumen completo y pedir confirmación explícita.
PASO 3 (solo tras confirmación):
  1. crear_pedido → obtener pedido_id
  2. agregar_items → una llamada por producto
  3. Confirmar al cliente con #pedido_id y tiempo estimado.

VALORES EXACTOS:
  tipo_pedido:  'domicilio' | 'recoger'
  metodo_pago:  'transferencia' | 'efectivo'

REGLA CRÍTICA:
NUNCA inventes un producto_id.
SIEMPRE llama consultar_menu antes de agregar_items.
Solo usa producto_ids recibidos de consultar_menu.

---
5. OTRAS ACCIONES
---
Actualizar nombre o dirección: tool "actualizar_cliente".
```

---

## Variables de entorno requeridas en n8n

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase (sin https://) |
| `SUPABASE_KEY` | Anon key de Supabase |
| `OPENAI_API_KEY` | API key de OpenAI |
