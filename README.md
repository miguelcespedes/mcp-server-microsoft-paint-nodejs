# MCP Server for Drawing in Microsoft Paint from Node.js

[English](README.md) | [Español](README.es.md)

A Node.js + TypeScript MCP server that controls Microsoft Paint on Windows through a semantic pipeline: UI Automation discovery (no hardcoded toolbar coordinates), a robust canvas resolver, and a **mathematical generator DSL** that draws figures as mouse drags — no native shape tools required.

## Architecture

```text
LLM / MCP Client
        │
        ▼
MCP Server
        │
        ▼
PaintController (orchestration)
        │
        ├── PaintSessionStore  → window lifecycle (open, restore, maximize, foreground)
        ├── Paint UI Inventory → UIA tree via PowerShell bridge
        └── Canvas Resolver    → semantic canvas + logical size + coordinate mapping
        │
        ▼
PaintPort adapter (Win32 + SendInput mouse drags)
        │
        ▼
Microsoft Paint
```

Layers (hexagonal):

```text
src/
  server.ts                        composition root (wires adapter + MCP ops)

  domain/                          pure, dependency-free
    drawing.ts                     types, PaintPort contract, PaintWindow
    figures.ts                     2D math generators + composition helpers
    solids.ts                      3D wireframe solids (projection, polyhedra, torus, tesseract)

  paint/
    paint-controller.ts            orchestration for every operation
    session/paint-session.ts       PaintSessionStore (ensureReady)
    discovery/
      paint-ui-inventory.ts        UIA tree discovery + group summaries
      canvas-resolver.ts           canvas resolution + coordinate mapping
    tools/
      paint-inventory-tool.ts

  infrastructure/
    logging/logger.ts
    errors/paint-mcp-error.ts      PaintMcpError + error codes
    windows/
      automation/                  automation client, element, types
      process/window-locator.ts
    win32/
      user32.ts  shell.ts  process.ts  paint.ts (PaintPort adapter)
    mcp/
      registry.ts                  only 3 tools are registered
      schemas.ts                   zod input schemas (the DSL contract)
      errors.ts  tool-logging.ts  debug-text.ts
      operations/
        paint-draw.operation.ts          → paint_draw
        paint-debug-ui.operation.ts      → paint_debug_ui
        paint-debug-canvas.operation.ts  → paint_debug_canvas
        (other *.operation.ts files exist but are NOT registered)

  test/unit/                       pure unit tests (no real Paint)
scripts/
  paint-uia.ps1                    PowerShell UIA bridge
```

## Current MCP Tools

Only three tools are registered. The API was consolidated: one productive drawing tool plus two diagnostics.

### `paint_draw`

The single productive tool. Two modes, all validated with zod:

| Mode | Purpose |
|---|---|
| `freehand` | One or more freehand strokes, each drawn with a single mouse drag |
| `generator` | The DSL: one or more mathematical generators rendered as drags |

Common parameters:

- `tool`: `"brush"` (default, Paint's active tool) or `"pencil"` (selects the Pencil in the toolbar before drawing — thin strokes, ideal for outlines and orbits).
- `fit`: `"none"` (default, coordinates used as-is), `"contain"` (scales and centers the drawing inside the canvas preserving aspect ratio), or `"fill"` (stretches to fill the canvas). A 5% margin is kept. With `fit` you can design in your own coordinate space without knowing the canvas size — the server knows it after resolving the window.
- `stepDelayMs`: delay between mouse moves, 0–200 ms, default 10.

**Every result** (`structuredContent`) includes the resolved `canvas` geometry (`logicalWidth`/`logicalHeight`, origins, inset) and `canvasBounds`, the bounding box of what was actually drawn in canvas coordinates — so the agent can self-verify without an extra debug call.

**Mode `generator` — the DSL.** A generator is a discriminated union on `kind`. All coordinates are canvas-relative (see Canvas Resolver below).

| kind | Parameters (defaults in parentheses) | Result |
|---|---|---|
| `ellipse` | `x`, `y`, `width`, `height`, `stepCount` (72) | closed polyline |
| `circle` | `cx`, `cy`, `radius`, `stepCount` (72) | closed polyline |
| `disk` | `cx`, `cy`, `radius`, `rowStep` (4) | multiple strokes (filled look) |
| `arc` | `cx`, `cy`, `radius`, `startDeg`, `endDeg`, `stepDeg` (4) | open polyline |
| `rectangle` | `x`, `y`, `width`, `height` | closed polyline |
| `roundedRectangle` | `x`, `y`, `width`, `height`, `radius` (24), `stepDeg` (12) | closed polyline |
| `polyline` | `points[]` (2–1000 of `{x, y}`) | polyline |
| `logarithmicSpiral` | `cx`, `cy`, `growth` (1.1), `turns` (6), `angleStep` (0.05), `scale` (7) | polyline |
| `regularPolygon` | `cx`, `cy`, `radius`, `sides` (3–64), `rotationDeg` (-90) | closed polyline |
| `starPolygon` | `cx`, `cy`, `outerRadius`, `innerRadius`, `points` (3–32), `rotationDeg` (-90) | closed polyline |
| `grid` | `x` (0), `y` (0), `width`, `height`, `cols`, `rows`, `shape` (`circle`\|`disk`\|`rectangle`\|`ellipse`), `radius` (4), `itemWidth` (20), `itemHeight` (20), `stepCount` (24) | one stroke per item (mosaic, board grid) |
| `dotsAlongPath` | `path[]` (2–1000 of `{x, y}`), `radius` (3), `spacing` (16), `stepCount` (24) | one small circle per stroke, evenly spaced along the path |

`grid` repeats a figure across a `cols` × `rows` lattice centered in the region `[x, y, width, height]` — a mosaic of dots, a board of cells, a full-canvas lattice. `cols × rows` is capped at 400. `dotsAlongPath` distributes small circles at `spacing` intervals along a polyline path — the dots of a Pac-Man corridor or a dotted route; the dot count is capped at 500 (raise `spacing` or shorten the path).

**3D solids — wireframe projection.** `src/domain/solids.ts` provides pure 3D math (rotation X→Y→Z, orthographic/perspective projection) and the following wireframe kinds, defined centered at the origin (negative coordinates allowed; pair them with `fit: "contain"`):

| kind | Parameters (defaults in parentheses) | Result |
|---|---|---|
| `solid` | `solid` (`tetrahedron`\|`cube`\|`octahedron`\|`dodecahedron`\|`icosahedron`\|`greatIcosahedron`\|`starOctangula`\|`tesseract`), `size` (120), `rotX` (-20), `rotY` (25), `rotZ` (0), `projection` (`ortho`\|`perspective`), `perspectiveDistance` (3), `starFaces` (false) | one 2-point stroke per edge (tesseract = 4D→3D→2D, 32 edges) |
| `torus` | `majorRadius` (100), `tubeRadius` (35), `segments` (16), `rings` (8), rotation/projection | latitude rings + meridians, one stroke each |
| `torusKnot` | `p` (2), `q` (3), `radius` (100), `tubeRadius` (30), `steps` (400), rotation/projection | one stroke, closed 3D curve on a torus |
| `revolution` | `profile[]` (2–100 of `{x = radius, y = height}`), `segments` (16), rotation/projection | rings + meridians of a surface of revolution (vase, hyperboloid) |
| `wireframe` | `vertices[]` (1–256 of `{x, y, z}`), `edges[]` (1–500 index pairs), `size` (120), rotation/projection | one 2-point stroke per explicit edge (low-poly meshes) |

`greatIcosahedron` shares the icosahedron's exact 12-vertex/30-edge wireframe; `starFaces: true` adds its 20 crossing star faces (visual approximation). The `solid` list covers the platonic solids plus the Kepler-Poinsot star polyhedron and the Stella Octangula compound; `tesseract` projects 4D→3D with perspective (camera at 2.5 in the w axis) then 3D→2D. Every edge is a single 2-point stroke, well under the 500-stroke limit (dodecahedron: 30, tesseract: 32, torus 16×8: 24).

Composition: pass `generators: [...]` (1–100) to draw compound figures in one call — e.g. a house = `rectangle` + `regularPolygon`(3 sides). A single generator is rendered as one drag; multiple generators become one drag each (`disk`, `grid` and `dotsAlongPath` expand to several strokes). Output echoes `generators` plus the draw result (window info, `pointCount`/`strokeCount`/`totalPoints`, `startScreen`, `endScreen`, `canvas`, `canvasBounds`).

**Design space + composition helpers.** `src/domain/figures.ts` also exports pure transforms — `translatePoints`, `scalePoints`, `rotatePoints`, `placePoints(angleDeg, radius, center)`, `boundingBox`, `fitStrokes` — so scenes can be defined locally at the origin and composed (e.g. planets placed on orbits) without computing absolute coordinates by hand.

**How the DSL works** — the full pipeline:

1. **Validation** — the JSON is validated by zod as a discriminated union on `kind`; defaults and bounds are applied here, so invalid input never reaches the canvas.
2. **Points** — each `kind` maps to one pure math function in `src/domain/figures.ts` or `src/domain/solids.ts` (no side effects) that returns `Point2D[]` in logical canvas coordinates: curves are approximated by N points (`stepCount`/`stepDeg`), closed shapes repeat the first point, `disk` expands to a row of strokes for a filled look, `grid` and `dotsAlongPath` emit one stroke per item, and the 3D kinds emit one 2-point stroke per edge (or per ring/meridian).
3. **Canvas check** — every point must fall inside the canvas logical bounds (`DRAW_BOUNDS_OUTSIDE_CANVAS`).
4. **Mapping** — logical points → drawable area (minus the 8 px inset) → client pixels → screen pixels.
5. **Drag** — one `SendInput` mouse drag per stroke (`dragPolyline`); the drag moves through every point in order.

See the [Examples Gallery](#examples-gallery) below for ready-to-use calls covering every family of generators.

### `paint_debug_ui`

Diagnostics: inspects the Paint UI Automation tree and summarizes groups/controls. Parameters: `maxDepth` (1–10, default 6), `includeBoundingRectangles` (default false), `filter` (case-insensitive, default `"shape"`), `windowMode`. Returns `paint` info, `uiLanguageHint`, `groups`, a `canvas` summary and the raw `elements`.

### `paint_debug_canvas`

Diagnostics: returns the active canvas geometry — `source` (`automation` | `fixed-layout`), `width`/`height`, `logicalWidth`/`logicalHeight`, `clientOrigin`, `screenOrigin`, `drawableInset`, `elementName`, `automationId` — plus the raw `activeCanvasElement`. Use it to understand where drawing actually lands.

All tools share the same behavior: a log line is written to stderr (`tool started/finished`) and a system beep notifies that the operation finished. The debug tools additionally print the full result as JSON in `content.text`; `paint_draw` returns a summary sentence (the structured result is always available in `structuredContent`).

## Examples Gallery

Every example is a single `paint_draw` call. With `fit: "contain"` you design in your own coordinate space (negative coordinates included) and the server scales and centers the drawing on the canvas.

### 1. House — 2D composition

```json
{
  "mode": "generator",
  "generators": [
    { "kind": "rectangle", "x": 150, "y": 240, "width": 200, "height": 140 },
    { "kind": "regularPolygon", "cx": 250, "cy": 180, "radius": 120, "sides": 3 }
  ]
}
```

### 2. Solar system — `fit` + `tool: "pencil"`

Disk sun, orbits as circles, planets placed at angles; designed at the origin and fitted to any canvas:

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

### 3. Pac-Man board — `grid` + `dotsAlongPath`

Maze walls as rectangles, pellet dots in corridors via `grid`, power pellets as `disk`, and a dotted route with `dotsAlongPath` (design space `0..1000 × 0..600`):

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
    { "kind": "grid", "x": 60, "y": 200, "width": 880, "height": 200, "cols": 22, "rows": 10, "shape": "circle", "radius": 3 },
    { "kind": "disk", "cx": 100, "cy": 100, "radius": 12 },
    { "kind": "disk", "cx": 900, "cy": 500, "radius": 12 },
    { "kind": "dotsAlongPath", "path": [{ "x": 240, "y": 60 }, { "x": 760, "y": 60 }], "radius": 3, "spacing": 24 }
  ]
}
```

### 4. 3D solids composition — `solid` + `torus` + `torusKnot`

Dodecahedron with perspective, tesseract in 4D perspective, torus and a (2, 3) torus knot:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    { "kind": "solid", "solid": "dodecahedron", "size": 100, "rotX": -20, "rotY": 25, "projection": "perspective" },
    { "kind": "solid", "solid": "tesseract", "size": 110, "rotX": 15, "rotY": -30, "projection": "perspective" },
    { "kind": "torus", "majorRadius": 90, "tubeRadius": 30, "segments": 16, "rings": 8 },
    { "kind": "torusKnot", "p": 2, "q": 3, "radius": 80, "tubeRadius": 22, "steps": 400 }
  ]
}
```

### 5. Freehand strokes

`mode: "freehand"` with one or more strokes (zigzag + baseline), each drawn with a single drag:

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

### 6. Checkerboard — `grid` of rectangles + circles

Two grids over the same region: board cells and a dot in the center of every cell:

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

### 7. Compass rose — `starPolygon`, `regularPolygon`, `arc`, `logarithmicSpiral`

A mandala mixing the 2D shape generators around a common center:

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

### 8. Vase — surface of `revolution`

The profile `{x = radius, y = height}` is rotated around the Y axis into 16 segments:

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

### 9. Low-poly diamond — `wireframe` mesh

Explicit vertices + edges (top pyramid, mid square, bottom pyramid):

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

### 10. Star polyhedron — `greatIcosahedron` with `starFaces`

Kepler-Poinsot star polyhedron in perspective: the exact 30-edge wireframe plus the 20 crossing star faces:

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

### 11. Dotted route — `dotsAlongPath`

Small circles scattered along a polyline path (22 dots over ~410 px):

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

## The Canvas Resolver

Drawing coordinates are **canvas-relative**: `(0,0)` is the top-left of the white page, and the drawing space is the image's logical size (read from the `CanvasSizeTextBlock` automation element, e.g. 500×500), not the window size.

Resolution strategy (in order):

1. **Semantic element** — an element with `automationId: "image"` or a name containing `lienzo`/`canvas`, bigger than 200×200. The physical bounds are treated as the canvas plus an 8 px `drawableInset` (resize handles/border).
2. **Scored candidates** — visible `Pane`/`Custom`/`Document`/`Image`/`Group` elements scored by signals (`image` id, canvas-ish names, plausible size vs. window client size, penalty for full-window hosts).
3. **Fixed-layout fallback** — a layout-derived rectangle when UIA exposes nothing usable (`source: "fixed-layout"`).

Coordinate mapping: logical canvas → drawable area (minus inset) → client pixels → screen pixels (`clientToScreen`). Every point is validated against the canvas and rejected with `DRAW_BOUNDS_OUTSIDE_CANVAS` before any mouse input is injected.

## Window Lifecycle

Each operation goes through `PaintSessionStore.ensureReady`:

- locate the Paint window (`"current"`) or launch a new one (`"new"`; `mspaint.exe` or the packaged app AUMID via shell)
- restore if minimized, maximize, bring to foreground with retries
- wait until the window rect and client size are stable (grace period included)
- refresh the UIA tree and resolve the canvas

`paint_draw` draws on the resolved canvas with `SendInput` mouse drags. Input is validated against the canvas logical bounds before any input is injected (`DRAW_BOUNDS_OUTSIDE_CANVAS`).

## UI Automation Strategy

- Windows: `Windows 10 Pro 24H2` (build `26100`); Paint: `Microsoft.Paint 11.2605.71.0 x64`.
- The UIA bridge is `scripts/paint-uia.ps1` (PowerShell 5.1 + built-in `UIAutomationClient`/`UIAutomationTypes`, no .NET SDK needed).
- The bridge supports two scopes: `window` (the Paint window tree) and `desktop-children` (top-levels/popups — used to inspect dropdown popups that are not part of the window tree).
- Localized metadata is handled with normalized alias matching (`lienzo`/`canvas`, `en el lienzo`/`on the canvas`, `herramienta brocha`/`brush tool`, `canvassizetextblock`).

Why the generator DSL: the drawing is done with real mouse strokes, so the result is always visible — no reliance on Paint's native shape tools (which default to no outline and no fill) or on their style flyouts (not reliably capturable through UIA).

## OpenCode Integration

The repository ships an OpenCode configuration:

- `opencode.json` registers the server as a local MCP client (`paint-local`, `node dist/server.js`) with permissions that allow starting the built server but deny build/test/install commands.
- `.opencode/agent/paint-mcp.md` — agent specialized in drawing with the `paint_*` tools.
- `.opencode/command/paint-debug.md` — the `/paint-debug` command for diagnosing Paint/UI state.

## Error Model

`PaintMcpError` with codes returned as structured MCP errors (`isError: true`, `structuredContent`):

`PAINT_NOT_RUNNING`, `PAINT_WINDOW_NOT_FOUND`, `UI_AUTOMATION_UNAVAILABLE`, `CANVAS_NOT_FOUND`, `INVALID_CANVAS_BOUNDS`, `DRAW_BOUNDS_OUTSIDE_CANVAS`, `INPUT_INJECTION_FAILED`.

## Dependencies

Runtime: `@modelcontextprotocol/sdk`, `koffi`, `zod`. Dev: `typescript`, `tsx`, `@types/node`, `@modelcontextprotocol/inspector`.

## Requirements

- Windows 10 or 11, Microsoft Paint installed, interactive desktop session, PowerShell available.
- The packaged Paint app may launch through `mspaint.exe` stubs; UIA metadata varies between Paint versions and OS languages.

## Installation and Running

```bash
npm install
npm run build      # compile to dist/
npm start          # run the built server (stdio MCP)
npm run dev        # run in development mode
npm run inspect    # MCP Inspector
```

`npm install` may require `npm approve-scripts koffi` if native install scripts are restricted.

## Tests

```bash
npm run build
npm test
```

Unit tests (`test/unit/*.test.mjs`) cover the 2D figure math and composition helpers (`figures.test.mjs`), the 3D wireframe solids — vertex/edge counts, exact edge lengths, perspective projection, tesseract, torus, torus knot, revolution and generic wireframe meshes (`solids.test.mjs`) — plus canvas point validation, coordinate mapping with insets and window handle serialization. They do not open real Paint windows.
