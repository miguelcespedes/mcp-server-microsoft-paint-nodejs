---
description: Starts a Paint-focused debugging workflow using the connected paint-local MCP tools.
agent: paint-mcp
---

Use the connected `paint-local` MCP tools directly to debug Microsoft Paint in this repository.

Workflow:

1. Confirm which `paint_*` tools are available.
2. Prefer MCP tools over bash for validation.
3. To understand where drawing lands, inspect:
   - `paint_debug_canvas`
4. To inspect the general UI tree (groups, language, controls), inspect:
   - `paint_debug_ui`
5. Draw with `paint_draw` (mode `generator` with `generators[]`, or `freehand`).
6. Summarize findings from actual MCP responses only.

User request:

$ARGUMENTS
