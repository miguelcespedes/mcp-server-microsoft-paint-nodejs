---
description: Starts a Paint-focused debugging workflow using the connected paint-local MCP tools.
agent: paint-mcp
---

Use the connected `paint-local` MCP tools directly to debug Microsoft Paint in this repository.

Workflow:

1. Confirm which `paint_*` tools are available.
2. Prefer MCP tools over bash for validation.
3. If the user mentions invisible shapes, first inspect:
   - `paint_active_canvas_debug`
   - `paint_shape_style_debug`
   - `paint_layers_debug`
4. If the user mentions selection issues, inspect:
   - `paint_inventory`
   - `paint_select_shape`
5. Summarize findings from actual MCP responses only.

User request:

$ARGUMENTS
