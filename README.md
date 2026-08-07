# MCP Server for Drawing in Microsoft Paint from Node.js

[English](README.md) | [Español](README.es.md)

This project is a Node.js + TypeScript MCP server that controls Microsoft Paint on Windows.

It already included mouse-based drawing tools, and now adds a UI Automation proof of concept that can discover and use Paint's native `Ellipse` tool without selecting it through hardcoded toolbar coordinates.

## Purpose of This Experiment

The goal is to move from low-level coordinate-only automation toward a semantic pipeline:

```text
LLM / MCP Client
        │
        ▼
MCP Server
        │
        ▼
Paint Domain Adapter
        │
        ├── UI Inventory
        ├── Shape Resolver
        └── Canvas Resolver
        │
        ▼
Microsoft UI Automation + Win32
        │
        ▼
Microsoft Paint
```

Instead of clicking a fixed position on the toolbar, the server now attempts to:

- inspect the Paint accessibility tree
- locate the Shapes area semantically
- resolve the native Ellipse tool
- invoke it through UI Automation
- draw on the Paint canvas with `SendInput`

## Current MCP Tools

Existing tools preserved:

- `paint_draw_freehand`
- `paint_draw_polyline`
- `paint_draw_logarithmic_spiral`

New UI Automation POC tools:

- `paint_inventory`
- `paint_select_shape`
- `paint_draw_ellipse`

## Architecture

The server remains intentionally thin in `src/server.ts`.

Main layers:

```text
src/
  server.ts

  infrastructure/
    logging/
      logger.ts
    errors/
      paint-mcp-error.ts
    windows/
      process/
        window-locator.ts
      automation/
        automation-client.ts
        automation-element.ts
        automation-types.ts
    win32/
      user32.ts
      shell.ts
      process.ts
      paint.ts
    mcp/
      registry.ts
      operations/
        freehand.operation.ts
        polyline.operation.ts
        logarithmic-spiral.operation.ts
        paint-inventory.operation.ts
        paint-select-shape.operation.ts
        paint-draw-ellipse.operation.ts

  paint/
    paint-controller.ts
    session/
      paint-session.ts
    discovery/
      paint-ui-inventory.ts
      shape-tool-resolver.ts
      canvas-resolver.ts
    shapes/
      shape-tool.ts
      ellipse-tool.ts
    tools/
      paint-inventory-tool.ts
      paint-select-shape-tool.ts
      paint-draw-ellipse-tool.ts
```

## UI Automation Strategy

The current Paint build on the development machine is:

- Windows: `Windows 10 Pro 24H2`, build `26100`
- Paint: `Microsoft.Paint 11.2605.71.0 x64`

Manual observations from the validated build:

- the Shapes section is exposed as a semantic group named `Formas`
- the native ellipse tool is exposed as a `ListItem` named `Elipse`
- the drawing surface is better represented by a semantic canvas-like element with `automationId: "image"`
- in the validated session, the resolved canvas size was `794 x 723`

The project already used `Koffi` successfully for Win32 APIs.

For UI Automation, this POC uses:

- TypeScript as the main orchestration layer
- a small PowerShell bridge using the built-in .NET assemblies:
  - `UIAutomationClient`
  - `UIAutomationTypes`

Why this approach:

- direct Win32 with Koffi is already in place and preserved
- direct COM UI Automation through Koffi would be much larger and more brittle for a POC
- the machine does not have `dotnet` SDK installed, so a C# bridge would add a new environment dependency
- PowerShell 5.1 can access Microsoft UI Automation on Windows without adding a heavy external dependency

## Semantic Selection vs Fixed Coordinates

This repository now uses two different automation styles depending on the problem:

- semantic UI discovery and tool selection for the Ellipse tool
- screen-relative mouse input for the actual drawing gesture on the canvas

What is avoided for the Ellipse tool:

- fixed toolbar coordinates
- OCR
- screenshot recognition
- browser automation tools
- AutoHotkey / RobotJS style tool selection

What is still acceptable:

- coordinate-based dragging inside the validated Paint canvas

## Dependencies

Runtime dependencies:

- `@modelcontextprotocol/sdk`
- `koffi`
- `zod`

Development dependencies:

- `typescript`
- `tsx`
- `@types/node`
- `@modelcontextprotocol/inspector`

## Windows Requirements

- Windows 10 or 11
- Microsoft Paint installed
- interactive desktop session
- PowerShell available

Important limitations of the environment:

- the modern packaged Paint app may launch through `mspaint.exe` stubs
- UI Automation metadata may vary between Paint versions and OS languages
- canvas discovery may require a fallback when the canvas is not clearly exposed as a semantic automation element

## Installation

```bash
npm install
```

If your npm setup restricts native install scripts:

```bash
npm approve-scripts koffi
```

## Running

Development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run built server:

```bash
npm start
```

## Using MCP Inspector

```bash
npm run inspect
```

Suggested manual flow:

1. Start MCP Inspector.
2. Connect to the server.
3. Call `paint_inventory`.
4. Confirm that the inventory returns a shapes-related group and an ellipse-like candidate.
5. Call `paint_select_shape` with `ellipse`.
6. Call `paint_draw_ellipse`.
7. Confirm visually that Paint drew the ellipse.

## Tool Examples

### `paint_inventory`

Example input:

```json
{
  "maxDepth": 8,
  "includeBoundingRectangles": true
}
```

Note: localized Paint builds may expose shape names in a language other than English. For example, in the validated Spanish build, `ellipse` appears in inventory as `Elipse`.

Purpose:

- inspect the Paint accessibility tree
- summarize likely groups and controls
- diagnose version/language differences

### `paint_select_shape`

Example input:

```json
{
  "shape": "ellipse"
}
```

Purpose:

- verify Paint is running
- discover the shape semantically
- invoke the native Ellipse control through UI Automation

### `paint_draw_ellipse`

Example input:

```json
{
  "x": 100,
  "y": 120,
  "width": 300,
  "height": 180,
  "durationMs": 600
}
```

Purpose:

1. discover and select the Ellipse tool semantically
2. resolve the Paint canvas
3. validate that the requested ellipse fits inside the canvas
4. convert canvas-relative coordinates to screen coordinates
5. execute the drag gesture with `SendInput`

Typical successful response:

```json
{
  "success": true,
  "shape": "ellipse",
  "bounds": {
    "x": 100,
    "y": 120,
    "width": 300,
    "height": 180
  },
  "toolSelection": {
    "strategy": "accessible-name",
    "confidence": 0.6,
    "matchedProperties": {
      "name": "Elipse"
    }
  },
  "canvas": {
    "source": "automation",
    "width": 794,
    "height": 723,
    "automationId": "image",
    "elementName": "Usando la herramienta Brocha en el lienzo"
  }
}
```

## Error Model

The new UI Automation path distinguishes errors such as:

- `PAINT_NOT_RUNNING`
- `PAINT_WINDOW_NOT_FOUND`
- `UI_AUTOMATION_UNAVAILABLE`
- `SHAPES_GROUP_NOT_FOUND`
- `ELLIPSE_TOOL_NOT_FOUND`
- `AMBIGUOUS_SHAPE_TOOL`
- `CANVAS_NOT_FOUND`
- `INVALID_CANVAS_BOUNDS`
- `DRAW_BOUNDS_OUTSIDE_CANVAS`
- `PAINT_LOST_FOCUS`
- `INPUT_INJECTION_FAILED`

Errors are returned as MCP errors with `isError: true` and structured diagnostics.

## Tests

Build first:

```bash
npm run build
```

Run all tests:

```bash
npm test
```

Unit tests added for the UI Automation POC cover:

- alias resolution
- `AutomationId` prioritization
- ambiguous matches
- duration validation
- canvas bounds validation
- coordinate conversion
- handle serialization

These unit tests do not open real Paint windows.

## Known Limitations

- only `ellipse` is supported in this iteration
- shape discovery is heuristic and may vary across Paint builds
- localized accessible metadata may differ between Windows languages
- the canvas may not always be exposed cleanly through UI Automation
- when semantic canvas discovery is weak, the implementation falls back to the current fixed-layout canvas model already used by the project
- existing legacy drawing operations still contain older layout assumptions because they predate the UI Automation POC

## Compatibility Risks

The most fragile parts across Paint versions are:

- accessible names
- `AutomationId` values
- grouping of shape buttons
- canvas exposure in the UI Automation tree

In the validated build used during this experiment, the implementation had to adapt to this concrete structure:

- `Formas` is a `Group`
- the shape gallery lives inside a nested `GridView`
- `Elipse` is a `ListItem`, not a direct toolbar `Button`
- the correct canvas is the semantic `image` element, not the larger outer `ScrollViewer`

That is why `paint_inventory` exists: it provides a reproducible diagnostics path before changing the resolver.

## Suggested Media for a Future Post

If you want to publish this experiment later, the most useful media would be:

- a short GIF of `paint_inventory` -> `paint_select_shape` -> `paint_draw_ellipse`
- one screenshot of the Paint UI with the selected Ellipse tool
- one screenshot of the resulting ellipse on canvas
