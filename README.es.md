# Servidor MCP para dibujar en Microsoft Paint desde Node.js

[English](README.md) | [Español](README.es.md)

Un servidor MCP en Node.js + TypeScript que controla Microsoft Paint en Windows mediante un pipeline semántico: descubrimiento con UI Automation (sin coordenadas fijas del toolbar), un resolver de lienzo robusto y un **DSL de generadores matemáticos** que dibuja figuras con arrastres de mouse — sin depender de las herramientas de forma nativas.

## Arquitectura

```text
LLM / MCP Client
        │
        ▼
MCP Server
        │
        ▼
PaintController (orquestación)
        │
        ├── PaintSessionStore  → ciclo de vida de la ventana (abrir, restaurar, maximizar, foreground)
        ├── Paint UI Inventory → árbol UIA vía puente PowerShell
        └── Canvas Resolver    → lienzo semántico + tamaño lógico + mapeo de coordenadas
        │
        ▼
Adaptador PaintPort (Win32 + arrastres de mouse con SendInput)
        │
        ▼
Microsoft Paint
```

Capas (patrón hexagonal):

```text
src/
  server.ts                        raíz de composición (adapta + registra operaciones MCP)

  domain/                          puro, sin dependencias
    drawing.ts                     tipos, contrato PaintPort, PaintWindow
    figures.ts                     generadores matemáticos 2D + helpers de composición
    solids.ts                      sólidos 3D en alambre (proyección, poliedros, toro, tesseract)

  paint/
    paint-controller.ts            orquestación de cada operación
    session/paint-session.ts       PaintSessionStore (ensureReady)
    discovery/
      paint-ui-inventory.ts        descubrimiento del árbol UIA + resumen de grupos
      canvas-resolver.ts           resolución del lienzo + mapeo de coordenadas
    tools/
      paint-inventory-tool.ts

  infrastructure/
    logging/logger.ts
    errors/paint-mcp-error.ts      PaintMcpError + códigos de error
    windows/
      automation/                  cliente de automatización, elemento, tipos
      process/window-locator.ts
    win32/
      user32.ts  shell.ts  process.ts  paint.ts (adaptador PaintPort)
    mcp/
      registry.ts                  solo se registran 3 tools
      schemas.ts                   esquemas zod de entrada (el contrato del DSL)
      errors.ts  tool-logging.ts  debug-text.ts
      operations/
        paint-draw.operation.ts          → paint_draw
        paint-debug-ui.operation.ts      → paint_debug_ui
        paint-debug-canvas.operation.ts  → paint_debug_canvas
        (el resto de *.operation.ts existe en disco pero NO está registrado)

  test/unit/                       tests unitarios puros (sin Paint real)
scripts/
  paint-uia.ps1                    puente PowerShell de UI Automation
```

## Herramientas MCP actuales

Solo hay tres herramientas registradas. La API se consolidó: una herramienta productiva de dibujo y dos de diagnóstico.

### `paint_draw`

La única herramienta productiva. Dos modos, todos validados con zod:

| Modo | Propósito |
|---|---|
| `freehand` | Uno o más trazos libres, cada uno dibujado con un único arrastre de mouse |
| `generator` | El DSL: uno o más generadores matemáticos renderizados como arrastres |

Parámetros comunes:

- `tool`: `"brush"` (por defecto, la herramienta activa de Paint) o `"pencil"` (selecciona el Lápiz en la barra de herramientas antes de dibujar — trazo fino, ideal para contornos y órbitas).
- `fit`: `"none"` (por defecto, las coordenadas se usan tal cual), `"contain"` (escala y centra el dibujo dentro del lienzo preservando la proporción) o `"fill"` (lo estira para ocupar el lienzo). Se mantiene un margen del 5%. Con `fit` puedes diseñar en tu propio espacio de coordenadas sin conocer el tamaño del lienzo — el servidor lo conoce tras resolver la ventana.
- `stepDelayMs`: retraso entre movimientos del mouse, 0–200 ms, por defecto 10.

**Todo resultado** (`structuredContent`) incluye la geometría del `canvas` resuelto (`logicalWidth`/`logicalHeight`, orígenes, inset) y `canvasBounds`, la caja envolvente de lo que realmente se dibujó en coordenadas de lienzo — así el agente puede autoverificar sin otra llamada de debug.

**Modo `generator` — el DSL.** Un generador es una unión discriminada por `kind`. Todas las coordenadas son relativas al lienzo (ver Resolver del lienzo abajo).

| kind | Parámetros (valores por defecto entre paréntesis) | Resultado |
|---|---|---|
| `ellipse` | `x`, `y`, `width`, `height`, `stepCount` (72) | polilínea cerrada |
| `circle` | `cx`, `cy`, `radius`, `stepCount` (72) | polilínea cerrada |
| `disk` | `cx`, `cy`, `radius`, `rowStep` (4) | varios trazos (aspecto relleno) |
| `arc` | `cx`, `cy`, `radius`, `startDeg`, `endDeg`, `stepDeg` (4) | polilínea abierta |
| `rectangle` | `x`, `y`, `width`, `height` | polilínea cerrada |
| `roundedRectangle` | `x`, `y`, `width`, `height`, `radius` (24), `stepDeg` (12) | polilínea cerrada |
| `polyline` | `points[]` (2–1000 de `{x, y}`) | polilínea |
| `logarithmicSpiral` | `cx`, `cy`, `growth` (1.1), `turns` (6), `angleStep` (0.05), `scale` (7) | polilínea |
| `regularPolygon` | `cx`, `cy`, `radius`, `sides` (3–64), `rotationDeg` (-90) | polilínea cerrada |
| `starPolygon` | `cx`, `cy`, `outerRadius`, `innerRadius`, `points` (3–32), `rotationDeg` (-90) | polilínea cerrada |
| `grid` | `x` (0), `y` (0), `width`, `height`, `cols`, `rows`, `shape` (`circle`\|`disk`\|`rectangle`\|`ellipse`), `radius` (4), `itemWidth` (20), `itemHeight` (20), `stepCount` (24) | un stroke por ítem (mosaico, rejilla de tablero) |
| `dotsAlongPath` | `path[]` (2–1000 de `{x, y}`), `radius` (3), `spacing` (16), `stepCount` (24) | un círculo pequeño por stroke, espaciados a lo largo del sendero |

`grid` repite una figura en una retícula de `cols` × `rows` centrada en la región `[x, y, width, height]` — un mosaico de puntos, una rejilla de casillas, una cuadrícula en todo el lienzo. `cols × rows` está limitado a 400. `dotsAlongPath` distribuye círculos pequeños a intervalos de `spacing` a lo largo de un sendero polilínea — los puntos de un corredor de Pac-Man o una ruta punteada; el número de círculos está limitado a 500 (sube `spacing` o acorta el sendero).

**Sólidos 3D — proyección a alambre.** `src/domain/solids.ts` aporta matemática 3D pura (rotación X→Y→Z, proyección ortográfica/perspectiva) y los siguientes kinds, definidos centrados en el origen (se admiten coordenadas negativas; combínalos con `fit: "contain"`):

| kind | Parámetros (valores por defecto entre paréntesis) | Resultado |
|---|---|---|
| `solid` | `solid` (`tetrahedron`\|`cube`\|`octahedron`\|`dodecahedron`\|`icosahedron`\|`greatIcosahedron`\|`starOctangula`\|`tesseract`), `size` (120), `rotX` (-20), `rotY` (25), `rotZ` (0), `projection` (`ortho`\|`perspective`), `perspectiveDistance` (3), `starFaces` (false) | un stroke de 2 puntos por arista (tesseract = 4D→3D→2D, 32 aristas) |
| `torus` | `majorRadius` (100), `tubeRadius` (35), `segments` (16), `rings` (8), rotación/proyección | anillos de latitud + meridianos, un stroke cada uno |
| `torusKnot` | `p` (2), `q` (3), `radius` (100), `tubeRadius` (30), `steps` (400), rotación/proyección | un stroke, curva 3D cerrada sobre un toro |
| `revolution` | `profile[]` (2–100 de `{x = radio, y = altura}`), `segments` (16), rotación/proyección | anillos + meridianos de una superficie de revolución (jarrón, hiperboloide) |
| `wireframe` | `vertices[]` (1–256 de `{x, y, z}`), `edges[]` (1–500 pares de índices), `size` (120), rotación/proyección | un stroke de 2 puntos por arista explícita (mallas low-poly) |

`greatIcosahedron` comparte el esqueleto exacto del icosaedro (12 vértices / 30 aristas); `starFaces: true` añade sus 20 caras estrelladas que se cruzan (aproximación visual). La lista de `solid` cubre los sólidos platónicos más el poliedro estrellado de Kepler-Poinsot y el compuesto de la estrella octángula; `tesseract` proyecta 4D→3D con perspectiva (cámara a 2.5 en el eje w) y luego 3D→2D. Cada arista es un stroke de 2 puntos, muy por debajo del límite de 500 (dodecaedro: 30, tesseract: 32, toro 16×8: 24).

Composición: pasa `generators: [...]` (1–100) para dibujar figuras compuestas en una sola llamada — p. ej. una rosa de los vientos = `starPolygon` + `circle` + `arc` alrededor de un centro común. Un solo generador se dibuja con un arrastre; varios generadores se dibujan con un arrastre cada uno (`disk`, `grid` y `dotsAlongPath` se expanden a varios trazos). La salida repite `generators` junto con el resultado del dibujo (info de la ventana, `pointCount`/`strokeCount`/`totalPoints`, `startScreen`, `endScreen`, `canvas`, `canvasBounds`).

**Espacio de diseño + helpers de composición.** `src/domain/figures.ts` también exporta transformaciones puras — `translatePoints`, `scalePoints`, `rotatePoints`, `placePoints(angleDeg, radius, center)`, `boundingBox`, `fitStrokes` — para definir escenas en el origen y componerlas (p. ej. planetas colocados sobre órbitas) sin calcular coordenadas absolutas a mano.

**Cómo funciona el DSL** — el pipeline completo:

1. **Validación** — el JSON se valida con zod como unión discriminada por `kind`; aquí se aplican defaults y límites, así que una entrada inválida nunca llega al lienzo.
2. **Puntos** — cada `kind` mapea a una función matemática pura de `src/domain/figures.ts` o `src/domain/solids.ts` (sin efectos secundarios) que devuelve `Point2D[]` en coordenadas lógicas de lienzo: las curvas se aproximan con N puntos (`stepCount`/`stepDeg`), las formas cerradas repiten el primer punto, `disk` se expande a una fila de trazos para un aspecto relleno, `grid`/`dotsAlongPath` emiten un stroke por ítem, y los kinds 3D emiten un stroke de 2 puntos por arista (o por anillo/meridiano).
3. **Chequeo del lienzo** — cada punto debe caer dentro de los límites lógicos del lienzo (`DRAW_BOUNDS_OUTSIDE_CANVAS`).
4. **Mapeo** — puntos lógicos → área dibujable (menos el inset de 8 px) → píxeles de cliente → píxeles de pantalla.
5. **Arrastre** — un arrastre de mouse con `SendInput` por trazo (`dragPolyline`); el arrastre pasa por cada punto en orden.

Ver la [Galería de ejemplos](#galería-de-ejemplos) más abajo con llamadas listas para usar que cubren todas las familias de generadores.

### `paint_debug_ui`

Diagnóstico: inspecciona el árbol de UI Automation de Paint y resume grupos y controles. Parámetros: `maxDepth` (1–10, por defecto 6), `includeBoundingRectangles` (por defecto false), `filter` (insensible a mayúsculas, por defecto `"shape"`), `windowMode`. Devuelve `paint` (info), `uiLanguageHint`, `groups`, un resumen de `canvas` y los `elements` crudos.

### `paint_debug_canvas`

Diagnóstico: devuelve la geometría del lienzo activo — `source` (`automation` | `fixed-layout`), `width`/`height`, `logicalWidth`/`logicalHeight`, `clientOrigin`, `screenOrigin`, `drawableInset`, `elementName`, `automationId` — más el `activeCanvasElement` crudo. Úsala para entender dónde se está dibujando realmente.

Todas las herramientas comparten el mismo comportamiento: se escribe una línea de log en stderr (`tool started/finished`) y un beep del sistema avisa de que la operación terminó. Las herramientas de debug además imprimen el resultado completo como JSON en `content.text`; `paint_draw` devuelve una frase resumen (el resultado estructurado siempre está disponible en `structuredContent`).

## Galería de ejemplos

Cada ejemplo es una sola llamada a `paint_draw`. Con `fit: "contain"` diseñas en tu propio espacio de coordenadas (negativas incluidas) y el servidor escala y centra el dibujo en el lienzo.

### 1. Tesseract — hipercubo 4D en alambre

Los 16 vértices de un hipercubo (±1)⁴ se proyectan a 3D con perspectiva en el eje w y luego a 2D: 32 aristas, un stroke por arista. El clásico look de "cubo interior y exterior":

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "solid", "solid": "tesseract", "size": 110, "rotX": 15, "rotY": -30, "projection": "perspective" }
  ]
}
```

Variante: `rotX: 0, rotY: 45` alinea las dos celdas 4D una frente a otra (la vista de cubo doble perfecto).

### 2. Sistema solar — `fit` + `tool: "pencil"`

Sol con `disk`, órbitas como círculos y planetas en ángulos; diseñado en el origen y ajustado a cualquier lienzo:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "disk", "cx": 0, "cy": 0, "radius": 25 },
    { "kind": "circle", "cx": 0, "cy": 0, "radius": 80 },
    { "kind": "circle", "cx": 0, "cy": 0, "radius": 130 },
    { "kind": "circle", "cx": 0, "cy": 0, "radius": 180 },
    { "kind": "circle", "cx": 80, "cy": 0, "radius": 4 },
    { "kind": "circle", "cx": -130, "cy": 0, "radius": 7 }
  ]
}
```

### 3. Tablero de Pac-Man — `grid` + `dotsAlongPath`

Paredes del laberinto como rectángulos, puntos de los pasillos con `grid`, píldoras de poder como `disk` y una ruta punteada con `dotsAlongPath` (espacio de diseño `0..1000 × 0..600`, una sola llamada, 9 generadores):

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "rectangle", "x": 20, "y": 20, "width": 960, "height": 560 },
    { "kind": "rectangle", "x": 20, "y": 20, "width": 200, "height": 120 },
    { "kind": "rectangle", "x": 780, "y": 20, "width": 200, "height": 120 },
    { "kind": "rectangle", "x": 20, "y": 460, "width": 200, "height": 120 },
    { "kind": "rectangle", "x": 780, "y": 460, "width": 200, "height": 120 },
    {
      "kind": "grid",
      "x": 60,
      "y": 200,
      "width": 880,
      "height": 200,
      "cols": 22,
      "rows": 10,
      "shape": "circle",
      "radius": 3
    },
    { "kind": "disk", "cx": 100, "cy": 100, "radius": 12 },
    { "kind": "disk", "cx": 900, "cy": 500, "radius": 12 },
    {
      "kind": "dotsAlongPath",
      "path": [
        { "x": 240, "y": 60 },
        { "x": 760, "y": 60 }
      ],
      "radius": 3,
      "spacing": 24
    }
  ]
}
```

### 4. Composición de sólidos 3D — `solid` + `torus` + `torusKnot`

Cuatro sólidos 3D en alambre en una sola llamada, centrados en el origen y ajustados al lienzo — nótese que cada arista es un stroke de 2 puntos (30 + 32 + 24 + 1 = 87 trazos):

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "solid",
      "solid": "dodecahedron",
      "size": 100,
      "rotX": -20,
      "rotY": 25,
      "projection": "perspective"
    },
    {
      "kind": "solid",
      "solid": "tesseract",
      "size": 110,
      "rotX": 15,
      "rotY": -30,
      "projection": "perspective"
    },
    {
      "kind": "torus",
      "majorRadius": 90,
      "tubeRadius": 30,
      "segments": 16,
      "rings": 8
    },
    {
      "kind": "torusKnot",
      "p": 2,
      "q": 3,
      "radius": 80,
      "tubeRadius": 22,
      "steps": 400
    }
  ]
}
```

### 5. Trazos libres — `freehand`

`mode: "freehand"` con uno o más trazos (zigzag + línea base), cada uno con un único arrastre:

```json
{
  "mode": "freehand",
  "tool": "pencil",
  "fit": "contain",
  "strokes": [
    {
      "points": [
        { "x": 0, "y": 60 },
        { "x": 60, "y": 0 },
        { "x": 120, "y": 60 },
        { "x": 180, "y": 0 },
        { "x": 240, "y": 60 }
      ]
    },
    {
      "points": [
        { "x": 0, "y": 90 },
        { "x": 240, "y": 90 }
      ]
    }
  ]
}
```

### 6. Tablero de damas — `grid` de rectángulos + círculos

Dos grids sobre la misma región: las casillas del tablero y un punto en el centro de cada celda:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "grid", "x": 0, "y": 0, "width": 800, "height": 800, "cols": 8, "rows": 8, "shape": "rectangle", "itemWidth": 95, "itemHeight": 95 },
    { "kind": "grid", "x": 0, "y": 0, "width": 800, "height": 800, "cols": 8, "rows": 8, "shape": "circle", "radius": 10 }
  ]
}
```

### 7. Rosa de los vientos — `starPolygon`, `regularPolygon`, `arc`, `logarithmicSpiral`

Una mandala que mezcla los generadores 2D alrededor de un centro común:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "starPolygon", "cx": 0, "cy": 0, "outerRadius": 110, "innerRadius": 45, "points": 8, "rotationDeg": 22.5 },
    { "kind": "regularPolygon", "cx": 0, "cy": 0, "radius": 120, "sides": 8, "rotationDeg": 22.5 },
    { "kind": "circle", "cx": 0, "cy": 0, "radius": 140 },
    { "kind": "logarithmicSpiral", "cx": 0, "cy": 0, "growth": 1.12, "turns": 2.5, "angleStep": 0.05, "scale": 5 },
    { "kind": "arc", "cx": 0, "cy": 0, "radius": 160, "startDeg": 0, "endDeg": 270, "stepDeg": 6 }
  ]
}
```

### 8. Jarrón — superficie de `revolution`

El perfil `{x = radio, y = altura}` se rota alrededor del eje Y en 16 segmentos:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "revolution",
      "profile": [
        { "x": 15, "y": -70 },
        { "x": 55, "y": -40 },
        { "x": 75, "y": 0 },
        { "x": 45, "y": 35 },
        { "x": 65, "y": 60 },
        { "x": 40, "y": 75 },
        { "x": 8, "y": 80 }
      ],
      "segments": 16
    }
  ]
}
```

### 9. Diamante low-poly — malla `wireframe`

Vértices y aristas explícitos (pirámide superior, cuadrado central, pirámide inferior):

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "wireframe",
      "vertices": [
        { "x": 0, "y": 90, "z": 0 },
        { "x": -45, "y": 0, "z": -45 },
        { "x": 45, "y": 0, "z": -45 },
        { "x": 45, "y": 0, "z": 45 },
        { "x": -45, "y": 0, "z": 45 },
        { "x": 0, "y": -90, "z": 0 }
      ],
      "edges": [
        [0, 1], [0, 2], [0, 3], [0, 4],
        [1, 2], [2, 3], [3, 4], [4, 1],
        [1, 5], [2, 5], [3, 5], [4, 5]
      ],
      "size": 1.6,
      "rotX": -20,
      "rotY": 25
    }
  ]
}
```

### 10. Poliedro estrellado — `greatIcosahedron` con `starFaces`

Poliedro estrellado de Kepler-Poinsot en perspectiva: el esqueleto exacto de 30 aristas más las 20 caras estrelladas que se cruzan:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "solid", "solid": "greatIcosahedron", "starFaces": true, "projection": "perspective" }
  ]
}
```

### 11. Ruta punteada — `dotsAlongPath`

Círculos pequeños distribuidos a lo largo de un sendero polilínea (22 puntos en ~410 px):

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "dotsAlongPath",
      "path": [
        { "x": 0, "y": 0 },
        { "x": 120, "y": 40 },
        { "x": 200, "y": 0 },
        { "x": 300, "y": 60 },
        { "x": 400, "y": 20 }
      ],
      "radius": 4,
      "spacing": 18
    }
  ]
}
```

### 12. Hombre de Vitruvio — coordenadas negativas + `fit: "contain"`

Las proporciones de Leonardo como composición pura: el círculo está centrado en el ombligo (el origen del espacio de diseño), el cuadrado en el pubis (`y = -200`, con su borde superior a la altura de los hombros, `y = 200`), y la figura es un conjunto de `polyline`s — los brazos en cuadrado descansan sobre el borde superior del cuadrado, y las manos elevadas y los pies abiertos tocan el círculo (`240² + 320² = 400²`). Las coordenadas negativas están permitidas en el espacio de diseño; `fit: "contain"` lo mapea todo al lienzo (una sola llamada, 11 generadores, bounds verificados `70,25..430,475` sobre un lienzo de 500×500):

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "circle", "cx": 0, "cy": 0, "radius": 400 },
    { "kind": "rectangle", "x": -400, "y": -600, "width": 800, "height": 800 },
    { "kind": "circle", "cx": 0, "cy": 350, "radius": 50 },
    { "kind": "polyline", "points": [{ "x": -400, "y": 200 }, { "x": 400, "y": 200 }] },
    { "kind": "polyline", "points": [{ "x": -200, "y": 200 }, { "x": -240, "y": 320 }] },
    { "kind": "polyline", "points": [{ "x": 200, "y": 200 }, { "x": 240, "y": 320 }] },
    { "kind": "polyline", "points": [{ "x": 0, "y": 300 }, { "x": 0, "y": -200 }] },
    { "kind": "polyline", "points": [{ "x": 0, "y": -200 }, { "x": 0, "y": -600 }] },
    { "kind": "polyline", "points": [{ "x": 0, "y": -200 }, { "x": -240, "y": -320 }] },
    { "kind": "polyline", "points": [{ "x": 0, "y": -200 }, { "x": 240, "y": -320 }] },
    { "kind": "disk", "cx": 0, "cy": 0, "radius": 6 }
  ]
}
```

## El resolver del lienzo

Las coordenadas de dibujo son **relativas al lienzo**: `(0,0)` es la esquina superior izquierda de la página blanca y el espacio de dibujo es el tamaño lógico de la imagen (leído del elemento de automatización `CanvasSizeTextBlock`, p. ej. 500×500), no el tamaño de la ventana.

Estrategia de resolución (en orden):

1. **Elemento semántico** — un elemento con `automationId: "image"` o con nombre que contenga `lienzo`/`canvas`, mayor de 200×200. Los límites físicos se tratan como el lienzo más un `drawableInset` de 8 px (bordes/manijas de redimensionado).
2. **Candidatos puntuados** — elementos visibles `Pane`/`Custom`/`Document`/`Image`/`Group` puntuados por señales (id `image`, nombres tipo lienzo, tamaño plausible vs. cliente de la ventana, penalización por contenedores de ventana completa).
3. **Fallback de layout fijo** — un rectángulo derivado del layout cuando UIA no expone nada útil (`source: "fixed-layout"`).

Mapeo de coordenadas: lienzo lógico → área dibujable (menos el inset) → píxeles de cliente → píxeles de pantalla (`clientToScreen`). Cada punto se valida contra el lienzo y se rechaza con `DRAW_BOUNDS_OUTSIDE_CANVAS` antes de inyectar cualquier entrada de mouse.

## Ciclo de vida de la ventana

El driver mantiene **una única ventana de Paint gestionada**: la primera llamada a `paint_draw` la abre, y las siguientes la reutilizan vaciando antes su lienzo (`Ctrl+A`, `Supr`), de modo que no se acumulan procesos de `mspaint`. Al arrancar de nuevo, el driver adopta la ventana de Paint superior (normalmente la suya de un proceso anterior) en vez de abrir otra; nunca toca ventanas que no creó cuando son antiguas o de fondo.

Cada operación pasa por `PaintSessionStore.ensureReady`:

- localizar la ventana de Paint (`"current"`) o lanzar una nueva (`"new"`; `mspaint.exe` o el AUMID de la app empaquetada vía shell)
- restaurar si está minimizada, maximizar, traer al primer plano con reintentos
- esperar a que el rectángulo de la ventana y el tamaño del cliente sean estables (con período de gracia)
- refrescar el árbol UIA y resolver el lienzo

`paint_draw` dibuja sobre el lienzo resuelto con arrastres de `SendInput`. La entrada se valida contra los límites lógicos del lienzo antes de inyectar cualquier entrada (`DRAW_BOUNDS_OUTSIDE_CANVAS`).

## Estrategia de UI Automation

- Windows: `Windows 10 Pro 24H2` (build `26100`); Paint: `Microsoft.Paint 11.2605.71.0 x64`.
- El puente UIA es `scripts/paint-uia.ps1` (PowerShell 5.1 con los ensamblados `UIAutomationClient`/`UIAutomationTypes` incluidos; no hace falta el SDK de .NET).
- El puente soporta dos ámbitos: `window` (el árbol de la ventana de Paint) y `desktop-children` (niveles superiores/popups — se usa para inspeccionar los menús desplegables que no forman parte del árbol de la ventana).
- Los metadatos localizados se manejan con coincidencia de aliases normalizados (`lienzo`/`canvas`, `en el lienzo`/`on the canvas`, `herramienta brocha`/`brush tool`, `canvassizetextblock`).

Por qué el DSL de generadores: el dibujo se hace con trazos de mouse reales, así que el resultado siempre es visible — sin depender de las herramientas de forma nativas de Paint (que por defecto crean la forma sin contorno ni relleno) ni de sus menús de estilo (no capturables de forma fiable vía UIA).

## Integración con OpenCode

El repositorio incluye una configuración de OpenCode:

- `opencode.json` registra el servidor como cliente MCP local (`paint-local`, `node dist/server.js`) con permisos que permiten arrancar el servidor compilado pero deniegan build/test/install.
- `.opencode/agent/paint-mcp.md` — agente especializado en dibujar con las tools `paint_*`.
- `.opencode/command/paint-debug.md` — el comando `/paint-debug` para diagnosticar el estado de Paint/UI.

## Modelo de errores

`PaintMcpError` con códigos devueltos como errores MCP estructurados (`isError: true`, `structuredContent`):

`PAINT_NOT_RUNNING`, `PAINT_WINDOW_NOT_FOUND`, `UI_AUTOMATION_UNAVAILABLE`, `CANVAS_NOT_FOUND`, `INVALID_CANVAS_BOUNDS`, `DRAW_BOUNDS_OUTSIDE_CANVAS`, `INPUT_INJECTION_FAILED`.

## Dependencias

Runtime: `@modelcontextprotocol/sdk`, `koffi`, `zod`. Dev: `typescript`, `tsx`, `@types/node`, `@modelcontextprotocol/inspector`.

## Requisitos

- Windows 10 u 11, Microsoft Paint instalado, sesión de escritorio interactiva, PowerShell disponible.
- La app de Paint empaquetada puede lanzarse a través de stubs de `mspaint.exe`; los metadatos UIA varían entre versiones de Paint e idiomas del SO.

## Instalación y ejecución

```bash
npm install
npm run build      # compila a dist/
npm start          # ejecuta el servidor compilado (MCP por stdio)
npm run dev        # modo desarrollo
npm run inspect    # MCP Inspector
```

`npm install` puede requerir `npm approve-scripts koffi` si los scripts nativos de instalación están restringidos.

## Tests

```bash
npm run build
npm test
```

Los tests unitarios (`test/unit/*.test.mjs`) cubren la matemática de figuras 2D y los helpers de composición (`figures.test.mjs`), los sólidos 3D en alambre — conteos de vértices/aristas, longitudes de aristas exactas, proyección en perspectiva, tesseract, toro, nudo toroidal, revolución y mallas wireframe genéricas (`solids.test.mjs`) — además de la validación de puntos del lienzo, el mapeo de coordenadas con insets y la serialización de handles de ventana. No abren ventanas reales de Paint.
