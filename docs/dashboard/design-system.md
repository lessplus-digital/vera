# Design System — Vera Pizzería Dashboard

> **Fuente de verdad del diseño visual.** Todo cambio de UI se hace contra este
> documento. Los valores viven como tokens CSS en `src/styles/index.css`; este doc
> explica las **reglas de uso**. Si un cambio necesita algo que no existe aquí,
> primero se agrega el token/patrón aquí y luego se usa.
>
> Origen: feedback de experto UX/UI (2026-07-22) + estandarización posterior.
> Versión visual publicada en claude.ai/design (proyecto *Vera Pizzería DS*).

---

## 1. Principios

1. **Superficies planas para la información.** Cards, tablas, modales y cualquier
   contenedor con texto usan colores sólidos (`--bg-card`, `--bg-modal`). El
   glassmorphism (blur + translucidez) queda **solo en el shell**: sidebar y topbar
   (`--bg-surface`). Nada de degradados sobre texto.
2. **Un color de acción.** El naranja de marca es el único color de acción. Verde y
   rojo son **estado** (éxito/positivo, error/destructivo/cancelación), nunca
   decoración. Purple/blue solo en badges semánticos ya definidos (`mode-badge`) y
   en la paleta de charts.
3. **Una acción primaria por pantalla.** Exactamente un botón `primary` visible por
   vista (el CTA); todo lo demás baja de jerarquía.
4. **Una sola familia tipográfica.** Plus Jakarta Sans para todo. Las cifras usan
   `font-variant-numeric: tabular-nums` (clase `.tnum`), no la fuente mono.
   `--font-mono` (JetBrains Mono) queda reservada a IDs técnicos si hiciera falta —
   por defecto, no usarla.
5. **Escalas fijas.** Tamaños de fuente, espaciado y radios salen de los tokens.
   No inventar valores nuevos (`13.5px`, `gap: 7px`…) — elegir el token más cercano.

## 2. Tokens (referencia rápida)

Definidos en `src/styles/index.css` (`:root` dark + override `[data-theme="light"]`).

| Grupo | Tokens | Regla |
|---|---|---|
| Superficies | `--bg-base`, `--bg-card`, `--bg-card-hover`, `--bg-modal`, `--bg-inset` | planas/sólidas; `--bg-inset` para elementos internos de una card (inputs, headers de tabla, tracks) |
| Shell | `--bg-surface`, `--glass-blur`, `--glass-edge` | SOLO sidebar/topbar |
| Marca/Acción | `--amber`, `--amber-dim`, `--amber-border` | acentos, badges, focus ring y botón primary (tinted, vía `color-mix`) |
| Estado | `--green*`, `--red*` | éxito / error·destructivo·cancelación |
| Semánticos | `--purple*`, `--blue*` | solo `mode-badge` (bot/humano/feedback) |
| Charts | `--chart-1..3` | ver §6 |
| Texto | `--text-primary`, `--text-secondary`, `--text-muted` | jerarquía de tinta |
| Tipografía | `--fs-caption` 11 · `--fs-body-sm` 12 · `--fs-body` 13 · `--fs-title` 14 · `--fs-heading` 16 · `--fs-metric` 22 | escala cerrada |
| Espaciado | `--sp-1..6` (4·8·12·16·20·24), `--page-pad` | grids de página: gap 16; padding de card: 16px 18px |
| Radios/sombras | `--radius-*`, `--shadow-card`, `--shadow-float` | sin halos/glows nuevos |

## 3. Botones — jerarquía (`.btn` en `index.css`)

```html
<button class="btn primary">…</button>   <!-- LA acción de la pantalla (tinted amber) -->
<button class="btn secondary">…</button> <!-- acciones normales (borde + inset) -->
<button class="btn ghost">…</button>     <!-- cancelar / cerrar / bajo compromiso -->
<button class="btn danger">…</button>    <!-- destructivas (rojo) -->
<!-- modificador de tamaño: class="btn primary sm" -->
```

**Primary = tinted amber** (decisión 2026-07-22, tras probar naranja sólido): fondo
`color-mix(amber 16%)`, borde `color-mix(amber 55%)`, texto `--amber`, peso 700;
hover rellena a 26% + borde pleno. Es el MISMO botón en todas las pantallas:
«Nuevo cliente», «+ Crear» (kanban, versión `sm`), «+ Nueva reserva» y el confirmar
de los modales.

Reglas:
- **1 `primary` por pantalla/modal.** En modales, el botón de confirmar es `primary`
  y cancelar es `ghost`. Nunca dos primaries visibles a la vez.
- Deshabilitado = mismo botón con `disabled` (opacidad), **no** un botón gris
  distinto que "se vuelve" de color al estar listo.
- No crear clases de botón ad-hoc por página; si falta una variante, se agrega aquí.

## 4. Formularios (`.field` en `index.css`)

```html
<label class="field">
  <span class="field-label">Teléfono</span>
  <input … />
  <span class="field-help">Con código de país, sin + ni espacios.</span>
</label>
```

- **El label es solo el nombre del campo.** Los helpers van **debajo** del input en
  `.field-help` (11px, muted) — nunca dentro del título ni entre paréntesis.
- **Marcar la minoría:** si hay más requeridos que opcionales → tag
  `<span class="field-optional">Opcional</span>` junto al label de los opcionales
  (y ningún asterisco). Si hay más opcionales → asterisco solo en los requeridos.
- Errores de formulario: bloque rojo (`--red-dim`/`--red-border`) debajo del cuerpo.

**Dropdowns:** todo `<select>` hereda el diseño global de `index.css` — `appearance:
none`, chevron SVG propio, superficie `--bg-inset`, focus ring ámbar y `color-scheme`
por tema para el popup nativo. Los overrides por página **solo ajustan tamaño**
(font-size/padding). ⚠️ Nunca usar el shorthand `background:` sobre un select — borra
el chevron (usar `background-color`).

## 5. Tipografía

- **Todo** en Plus Jakarta Sans. Cifras (precios, teléfonos, fechas, KPIs, rangos
  de paginación) en sans + `tabular-nums`, no en mono.
- Pesos: 400 texto · 500/600 énfasis y labels · 700 títulos y valores KPI.
- Labels de sección/tabla: `--fs-caption`, uppercase, `letter-spacing: 0.04em`,
  `--text-muted`.

## 6. Charts (estadísticas)

Paleta categórica **validada** contra daltonismo y contraste (script del skill
dataviz — seis checks en dark y light):

- `--chart-1` (naranja) → **ingresos / serie de marca**
- `--chart-2` (azul) → **conteos / pedidos**
- `--chart-3` (verde oscuro) → tercera serie
- Más allá del top 3 → agrupar en «otras» con `--text-muted`. **Nunca ciclar** la
  paleta ni inventar un cuarto hue.
- Verde/rojo de estado quedan para polaridad (top/flop, deltas ↑↓, cancelaciones).
- KPIs: valor en tinta neutra; el color lo lleva el delta (verde/rojo). Excepción:
  «Cancelados» en rojo cuando > 0 (señal de estado).
- Texto de charts (ejes, tooltips, leyendas) en tokens de texto, nunca en el color
  de la serie.

Si se cambia la paleta, re-validar:
`node <skill dataviz>/scripts/validate_palette.js "#hex,#hex,#hex" --mode dark|light`

## 7. Layout

- Padding de página: `20px 24px 40px` (`--page-pad`). Gap entre cards/grids: **16px**.
- Padding interno de card: **16px 18px** (KPI y stats por igual).
- Grids de 2 columnas: `align-items: stretch` + la última card de cada stack crece
  (`flex: 1`) para que no queden huecos.
- Estados vacíos: mensaje centrado en muted, mínimo `24px` de padding vertical —
  nunca una card colapsada.

## 8. Toasts — feedback de acciones (`.toast` en `index.css`)

Toda acción que muta datos y no deja rastro visible inmediato (crear/editar/eliminar
que cierra un modal) confirma con un toast. Patrón global desde 2026-07-22
(promovido del toast local de Reservas):

- **Uso:** `useToast()` (`src/hooks/useToast.js`) en la página + `<Toast toast={toast} />`
  (`src/components/Toast.jsx`) al final del JSX. No reimplementar estado/timers locales.
- **Variantes:** `success` (green) · `warn` (amber, operación OK pero algo falló — ej. WhatsApp)
  · `error` (red). Fijo abajo-derecha, auto-dismiss 4.5s, un solo toast a la vez (el nuevo
  reemplaza al anterior).
- **Sonido:** solo en eventos que ocurren sin interacción (pedido nuevo → `playNotification`)
  o destructivos irreversibles (cliente eliminado → `playDeleted`, en `src/utils/audio.js`).
  No sonar en saves rutinarios.

## 9. Qué NO hacer (resumen del feedback origen)

- ❌ Degradados en cards/contenedores de info · ❌ dos fuentes mezcladas en una vista
- ❌ Helpers dentro del label · ❌ asterisco en todos los campos
- ❌ CTA con color "dim" que compite con botones secundarios
- ❌ Colores decorativos en KPIs/tablas · ❌ glows de neón en hover
- ❌ Valores fuera de escala (`13.5px`, `gap: 7px`, radios nuevos)
