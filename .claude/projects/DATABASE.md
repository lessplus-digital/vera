# Esquema de Base de Datos — Supabase

> Todas las tablas, columnas y variables están en **español y minúsculas**.

## Tablas

### `menu`

Catálogo de productos disponibles.

| Columna | Tipo | Nullable | Descripción |
|---|---|---|---|
| `producto_id` | text (PK) | NO | Formato: PROD-001, PROD-087 |
| `nombre` | text | NO | Nombre del producto |
| `categoria` | text | NO | pizza, bebida, arepa, etc. |
| `variante` | text | SI | Ej: "Tradicional", "Estofada" |
| `descripcion` | text | SI | Ingredientes / descripción |
| `precio` | numeric | NO | Precio base del producto |
| `disponible` | bool | NO | true/false — filtra lo que ve el agente |
| `tamaño` | text | SI | JSON con precios por tamaño |

**Nota sobre `tamaño`:** Es un campo text que contiene JSON. Ejemplo:
```json
{"porcion": 10500, "mediana": 37500, "jumbo": 49900}
```
Si el producto no tiene tamaños, el campo es `null` y se usa `precio` directamente.

### `clientes`

Registro de clientes que han interactuado con el bot.

| Columna | Tipo | Nullable | Descripción |
|---|---|---|---|
| `cliente_id` | uuid (PK) | NO | Generado automáticamente |
| `telefono` | text (UNIQUE) | NO | Número completo con código de país |
| `nombre` | text | SI | "Pendiente" cuando es nuevo |
| `direccion` | text | SI | Última dirección conocida |
| `modo` | text | NO | `'bot'` o `'humano'` — default: `'bot'` |
| `created_at` | timestamptz | NO | Auto |

**Regla de `modo`:**
- `bot` → mensajes van al agente IA
- `humano` → mensajes van a `mensajes_soporte`, el agente NO los procesa

> **2026-06-09:** Las columnas `total_pedidos`, `gasto_total`, `ultimo_pedido_fecha` y `ultimo_pedido_detalle` se eliminaron — nada las escribía (siempre 0/null) y nada las leía. Cualquier acumulado de cliente se calcula agregando desde `pedidos`.

### `pedidos`

Cada pedido registrado por el bot o editado manualmente.

| Columna | Tipo | Nullable | Descripción |
|---|---|---|---|
| `pedido_id` | uuid (PK) | NO | Generado por Supabase |
| `cliente_id` | uuid (FK → clientes) | SI | Referencia al cliente |
| `telefono` | text | NO | Teléfono del cliente |
| `tipo_pedido` | text | NO | `'domicilio'` o `'recoger'` |
| `metodo_pago` | text | NO | `'transferencia'` o `'efectivo'` |
| `direccion_entrega` | text | SI | Solo si tipo_pedido = 'domicilio' |
| `total` | numeric | NO | **Calculado por trigger**, nunca por el LLM |
| `estado` | text | NO | `'pendiente'`, `'en_cocina'`, `'en_camino'`, `'recoger'`, `'entregado'`, `'cancelado'` |
| `estado_pago` | text | SI | Estado de verificación del pago |
| `comprobante_url` | text | SI | URL de imagen del comprobante |
| `motivo_rechazo` | text | SI | Si el pedido fue rechazado/cancelado |
| `notas` | text | SI | Observaciones del cliente |
| `fecha_pedido` | timestamp (sin tz) | NO | Auto. **Ojo:** el valor es UTC pero la columna no tiene timezone — el REST lo devuelve sin sufijo `Z` y JS lo parsearía como hora local. El frontend usa `parseDb()` (`src/utils/dateRanges.js`) para forzar UTC |
| `fecha_entrega` | timestamptz | SI | Escrita por el dashboard (`OrderCard.updateEstado`) al marcar entregado, desde 2026-06-09. Datos anteriores son incoherentes (de prueba) — las estadísticas descartan duraciones ≤0 o >3h |

### `detalle_pedidos`

Items individuales de cada pedido.

| Columna | Tipo | Nullable | Descripción |
|---|---|---|---|
| `detalle_id` | text (PK) | NO | Generado al insertar |
| `pedido_id` | uuid (FK → pedidos) | NO | Referencia al pedido |
| `producto_id` | text (FK → menu) | NO | **DEBE existir en tabla menu** |
| `nombre_producto` | text | NO | Desnormalizado para lectura rápida |
| `variante` | text | SI | Variante seleccionada |
| `cantidad` | int | NO | >= 1 |
| `precio_unitario` | numeric | NO | Precio al momento del pedido |

### `mensajes_soporte`

Mensajes del chat humano (cuando modo = 'humano').

| Columna | Tipo | Nullable | Descripción |
|---|---|---|---|
| `id` | uuid (PK) | NO | Auto |
| `telefono` | text | NO | Teléfono del cliente |
| `origen` | text | NO | `'cliente'`, `'admin'`, `'sistema'` |
| `mensaje` | text | NO | Contenido del mensaje |
| `created_at` | timestamptz | NO | Auto |

## Triggers

### `trigger_actualizar_total`

Se ejecuta en `AFTER INSERT OR UPDATE OR DELETE` en `detalle_pedidos`.

**Lógica:**
1. Suma `precio_unitario * cantidad` de todos los items del pedido
2. Si `tipo_pedido = 'domicilio'`, agrega $5.000 de costo de envío
3. Actualiza `pedidos.total`

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
    FROM detalle_pedidos WHERE pedido_id = NEW.pedido_id
  ) + CASE WHEN tipo = 'domicilio' THEN costo_domicilio ELSE 0 END
  WHERE pedido_id = NEW.pedido_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## RPCs (Funciones remotas)

### `editar_pedido(p_pedido_id, p_items)`

Permite al admin editar los items de un pedido pendiente desde el dashboard.

- Valida que el pedido esté en estado `'pendiente'`
- Borra los items existentes
- Inserta los nuevos items
- El trigger recalcula el total automáticamente
- Retorna `{ success: true/false, error: '...' }`

## Vistas / Queries frecuentes

### Pedidos del día (Dashboard)

```sql
SELECT pedidos.*, detalle_pedidos(*)
FROM pedidos
WHERE fecha_pedido >= hoy_5am_utc
  AND estado IN ('pendiente', 'en_cocina', 'en_camino', 'recoger')
ORDER BY fecha_pedido DESC
```

### Conversaciones activas (Soporte)

```sql
SELECT * FROM clientes WHERE modo = 'humano'
```

## Realtime habilitado

Las siguientes tablas tienen Realtime activado en Supabase:

- `pedidos` (INSERT, UPDATE, DELETE)
- `clientes` (UPDATE — para cambios de modo)
- `mensajes_soporte` (INSERT — mensajes nuevos)
