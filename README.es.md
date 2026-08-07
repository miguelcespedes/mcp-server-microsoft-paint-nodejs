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
    figures.ts                     generadores matemáticos (puntos en coordenadas de lienzo)

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

- `windowMode`: `"current"` (reutiliza la ventana de Paint abierta) o `"new"` (abre un lienzo limpio nuevo). Por defecto `"current"`.
- `stepDelayMs`: retraso entre movimientos del mouse, 0–200 ms, por defecto 10.

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

Composición: pasa `generators: [...]` (1–100) para dibujar figuras compuestas en una sola llamada — p. ej. una casa = `rectangle` + `regularPolygon`(3 lados). Un solo generador se dibuja con un arrastre; varios generadores se dibujan con un arrastre cada uno (`disk` se expande a varios trazos). La salida repite `generators` junto con el resultado del dibujo (info de la ventana, `pointCount`/`strokeCount`/`totalPoints`, `startScreen`, `endScreen`).

**Cómo funciona el DSL** — el pipeline completo:

1. **Validación** — el JSON se valida con zod como unión discriminada por `kind`; aquí se aplican defaults y límites, así que una entrada inválida nunca llega al lienzo.
2. **Puntos** — cada `kind` mapea a una función matemática pura de `src/domain/figures.ts` (sin efectos secundarios) que devuelve `Point2D[]` en coordenadas lógicas de lienzo: las curvas se aproximan con N puntos (`stepCount`/`stepDeg`), las formas cerradas repiten el primer punto, `disk` se expande a una fila de trazos para un aspecto relleno.
3. **Chequeo del lienzo** — cada punto debe caer dentro de los límites lógicos del lienzo (`DRAW_BOUNDS_OUTSIDE_CANVAS`).
4. **Mapeo** — puntos lógicos → área dibujable (menos el inset de 8 px) → píxeles de cliente → píxeles de pantalla.
5. **Arrastre** — un arrastre de mouse con `SendInput` por trazo (`dragPolyline`); el arrastre pasa por cada punto en orden.

Ejemplo — una casa:

```json
{
  "mode": "generator",
  "generators": [
    { "kind": "rectangle", "x": 150, "y": 240, "width": 200, "height": 140 },
    { "kind": "regularPolygon", "cx": 250, "cy": 180, "radius": 120, "sides": 3 }
  ]
}
```

### `paint_debug_ui`

Diagnóstico: inspecciona el árbol de UI Automation de Paint y resume grupos y controles. Parámetros: `maxDepth` (1–10, por defecto 6), `includeBoundingRectangles` (por defecto false), `filter` (insensible a mayúsculas, por defecto `"shape"`), `windowMode`. Devuelve `paint` (info), `uiLanguageHint`, `groups`, un resumen de `canvas` y los `elements` crudos.

### `paint_debug_canvas`

Diagnóstico: devuelve la geometría del lienzo activo — `source` (`automation` | `fixed-layout`), `width`/`height`, `logicalWidth`/`logicalHeight`, `clientOrigin`, `screenOrigin`, `drawableInset`, `elementName`, `automationId` — más el `activeCanvasElement` crudo. Úsala para entender dónde se está dibujando realmente.

Todas las herramientas comparten el mismo comportamiento: se escribe una línea de log en stderr (`tool started/finished`) y un beep del sistema avisa de que la operación terminó. Las herramientas de debug además imprimen el resultado completo como JSON en `content.text`; `paint_draw` devuelve una frase resumen (el resultado estructurado siempre está disponible en `structuredContent`).

## El resolver del lienzo

Las coordenadas de dibujo son **relativas al lienzo**: `(0,0)` es la esquina superior izquierda de la página blanca y el espacio de dibujo es el tamaño lógico de la imagen (leído del elemento de automatización `CanvasSizeTextBlock`, p. ej. 500×500), no el tamaño de la ventana.

Estrategia de resolución (en orden):

1. **Elemento semántico** — un elemento con `automationId: "image"` o con nombre que contenga `lienzo`/`canvas`, mayor de 200×200. Los límites físicos se tratan como el lienzo más un `drawableInset` de 8 px (bordes/manijas de redimensionado).
2. **Candidatos puntuados** — elementos visibles `Pane`/`Custom`/`Document`/`Image`/`Group` puntuados por señales (id `image`, nombres tipo lienzo, tamaño plausible vs. cliente de la ventana, penalización por contenedores de ventana completa).
3. **Fallback de layout fijo** — un rectángulo derivado del layout cuando UIA no expone nada útil (`source: "fixed-layout"`).

Mapeo de coordenadas: lienzo lógico → área dibujable (menos el inset) → píxeles de cliente → píxeles de pantalla (`clientToScreen`). Cada punto se valida contra el lienzo y se rechaza con `DRAW_BOUNDS_OUTSIDE_CANVAS` antes de inyectar cualquier entrada de mouse.

## Ciclo de vida de la ventana

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

Los tests unitarios (`test/unit/*.test.mjs`) cubren la validación de puntos del lienzo, el mapeo de coordenadas con insets y la serialización de handles de ventana. No abren ventanas reales de Paint.
