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
    figures.ts                     math generators (points in canvas coordinates)

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

- `windowMode`: `"current"` (reuse the open Paint window) or `"new"` (open a fresh clean canvas). Default `"current"`.
- `stepDelayMs`: delay between mouse moves, 0–200 ms, default 10.

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

Composition: pass `generators: [...]` (1–100) to draw compound figures in one call — e.g. a house = `rectangle` + `regularPolygon`(3 sides). A single generator is rendered as one drag; multiple generators become one drag each (`disk` expands to several strokes). Output echoes `generators` plus the draw result (window info, `pointCount`/`strokeCount`/`totalPoints`, `startScreen`, `endScreen`).

**How the DSL works** — the full pipeline:

1. **Validation** — the JSON is validated by zod as a discriminated union on `kind`; defaults and bounds are applied here, so invalid input never reaches the canvas.
2. **Points** — each `kind` maps to one pure math function in `src/domain/figures.ts` (no side effects) that returns `Point2D[]` in logical canvas coordinates: curves are approximated by N points (`stepCount`/`stepDeg`), closed shapes repeat the first point, `disk` expands to a row of strokes for a filled look.
3. **Canvas check** — every point must fall inside the canvas logical bounds (`DRAW_BOUNDS_OUTSIDE_CANVAS`).
4. **Mapping** — logical points → drawable area (minus the 8 px inset) → client pixels → screen pixels.
5. **Drag** — one `SendInput` mouse drag per stroke (`dragPolyline`); the drag moves through every point in order.

Example — a house:

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

Diagnostics: inspects the Paint UI Automation tree and summarizes groups/controls. Parameters: `maxDepth` (1–10, default 6), `includeBoundingRectangles` (default false), `filter` (case-insensitive, default `"shape"`), `windowMode`. Returns `paint` info, `uiLanguageHint`, `groups`, a `canvas` summary and the raw `elements`.

### `paint_debug_canvas`

Diagnostics: returns the active canvas geometry — `source` (`automation` | `fixed-layout`), `width`/`height`, `logicalWidth`/`logicalHeight`, `clientOrigin`, `screenOrigin`, `drawableInset`, `elementName`, `automationId` — plus the raw `activeCanvasElement`. Use it to understand where drawing actually lands.

All tools share the same behavior: a log line is written to stderr (`tool started/finished`) and a system beep notifies that the operation finished. The debug tools additionally print the full result as JSON in `content.text`; `paint_draw` returns a summary sentence (the structured result is always available in `structuredContent`).

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

Unit tests (`test/unit/*.test.mjs`) cover canvas point validation, coordinate mapping with insets and window handle serialization. They do not open real Paint windows.
