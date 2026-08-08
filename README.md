# MCP Server for Microsoft Paint

[English](README.md) · [Español](README.es.md)

## What if Paint were more than Paint?

Microsoft Paint is probably one of the least intimidating pieces of software ever shipped with Windows.

A blank canvas.
A pencil.
A few shapes.
A color palette.

For millions of people, it may have been one of the first places where a computer became something you could experiment with rather than simply operate.

That simplicity made me curious.

Not because Paint needed automation.

But because I wanted to understand a more interesting question:

**How far can an ordinary piece of software go when an AI is given a meaningful way to understand and interact with it?**

That question became this project.

---

## It started as a small experiment

The obvious way to automate Paint would have been to move a mouse to known screen coordinates and click buttons.

That works.

But it doesn't understand anything.

Change the window position, the display scale, the toolbar layout, or the environment, and coordinate-based automation quickly reveals what it really is: a script replaying gestures.

I wanted to approach the problem differently.

Before teaching an AI to draw with Paint, I wanted to understand Paint itself.

Its windows.

Its controls.

Its canvas.

Its coordinate systems.

Its accessibility tree.

Its behavior.

So the experiment moved downward before it moved upward.

Instead of asking:

> How can an AI click Paint?

I started asking:

> What does Paint expose about itself that software can actually understand?

That led to Windows UI Automation, inspection of the Paint accessibility tree, canvas discovery, window lifecycle management, coordinate transformations, Win32 input, and eventually a semantic interface between an AI and the application.

Curiosity became investigation.

Investigation became structure.

And structure eventually became an MCP server.

---

## Paint became the renderer, not the idea

Once the interaction layer existed, another question appeared.

If an AI no longer had to think primarily in mouse coordinates, what should it think in?

The answer was not:

```text
move pointer to x=412, y=287
press mouse button
move pointer to x=650, y=410
release
```

It was something closer to:

```json
{
  "kind": "circle",
  "cx": 300,
  "cy": 220,
  "radius": 120
}
```

Or:

```json
{
  "solid": "tesseract",
  "size": 110,
  "projection": "perspective"
}
```

That distinction changed the project.

Paint was no longer the abstraction.

It became the rendering surface beneath an emerging visual language.

The MCP server translates semantic and mathematical descriptions into geometry, geometry into logical canvas coordinates, and those coordinates into real mouse interaction with Microsoft Paint.

```text
Idea
  ↓
Semantic description
  ↓
Geometry
  ↓
Canvas coordinates
  ↓
Windows interaction
  ↓
Microsoft Paint
```

That is the part of the experiment I find most interesting.

---

## From circles to a tesseract

The drawing layer gradually became a small mathematical DSL.

It can currently express things such as:

* circles, ellipses and arcs;
* rectangles and rounded rectangles;
* regular and star polygons;
* logarithmic spirals;
* grids and repeated structures;
* arbitrary polylines;
* Platonic solids;
* toruses and torus knots;
* surfaces of revolution;
* custom wireframe meshes;
* and even a tesseract projected from 4D → 3D → 2D.

The shapes are not created through Paint's native Shape buttons.

They are generated mathematically as points and strokes and then physically drawn onto the canvas.

That constraint is intentional.

It keeps the experiment focused on the boundary between **abstract description** and **real application interaction**.

---

## Why do this with Paint?

Because Paint is deliberately ordinary.

If this experiment had started with Blender, AutoCAD, Mathematica or another sophisticated visual environment, much of the capability could be attributed to the application itself.

Paint gives us almost nothing.

And that makes it useful.

It forces the intelligence and abstraction to live somewhere else.

The result is a surprisingly flexible visual sandbox.

An AI can potentially use the same primitive canvas to explain:

**Geometry**

Construct polygons, transformations, projections and geometric relationships.

**Mathematics**

Turn equations and mathematical structures into visible objects.

**Spatial reasoning**

Explore three-dimensional objects through two-dimensional projections.

**Diagrams**

Express flows, relationships, timelines, maps and simple conceptual models.

**Education**

Build visual explanations step by step using one of the simplest applications available on Windows.

The interesting question is therefore no longer:

> Can an AI draw in Paint?

Clearly, it can.

The more useful question is:

> **What can an AI explain when drawing becomes part of its language?**

---

## An example: a four-dimensional object in Paint

One of the available generators is a **tesseract**.

A tesseract is the four-dimensional analogue of a cube.

The implementation begins with the sixteen vertices of the hypercube, projects them from four dimensions into three, projects the result again into two dimensions, and finally converts its thirty-two edges into strokes that Paint can physically draw.

From the MCP client's perspective, the request remains semantic:

```json
{
  "mode": "generator",
  "tool": "pencil",
  "fit": "contain",
  "generators": [
    {
      "kind": "solid",
      "solid": "tesseract",
      "size": 110,
      "rotX": 15,
      "rotY": -30,
      "projection": "perspective"
    }
  ]
}
```

Paint knows nothing about four-dimensional geometry.

It doesn't need to.

It is simply the final surface where an abstract idea becomes visible.

That separation is the architecture.

---

## Not blind automation

AI was used extensively while building this project.

But using AI was never the interesting part.

The interesting part was deciding **what had to be understood before something should be automated**.

Throughout the experiment the workflow repeatedly looked like this:

```text
observe
  ↓
question
  ↓
inspect
  ↓
model
  ↓
experiment
  ↓
specify
  ↓
implement
  ↓
verify
```

For example, the server does not assume that the Paint canvas lives at one permanent screen coordinate.

It discovers and resolves the application context, maintains the Paint session, maps logical drawing coordinates to the actual drawable canvas and uses Windows APIs to execute the interaction.

Drawing results can also be verified after execution rather than assuming that the absence of an exception means that ink actually appeared.

The goal is not to hide AI from the engineering process.

Nor is it to celebrate AI for producing code.

The experiment is about something else:

**using AI to explore a system more deeply while keeping understanding, architecture and verification explicit.**

---

## How it works

At a high level:

```text
LLM / MCP Client
        │
        ▼
     MCP Server
        │
        ▼
 PaintController
        │
        ├── Paint session management
        ├── UI Automation discovery
        ├── Semantic canvas resolution
        ├── Mathematical generators
        └── Coordinate transformation
        │
        ▼
 Win32 / SendInput adapter
        │
        ▼
 Microsoft Paint
```

The codebase follows a layered / hexagonal structure that keeps the mathematical domain independent from Windows-specific automation.

The pure geometry layer knows nothing about Paint.

The Paint orchestration layer knows nothing about MCP clients.

The Windows infrastructure implements the mechanics required to make the final interaction real.

For the deeper technical architecture, see the documentation below.

---

## MCP capabilities

The server currently exposes seven MCP tools.

| Tool                 | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `paint_draw`         | 2D freehand and mathematical drawing DSL  |
| `paint_draw_3d`      | Project and draw 3D/4D wireframe geometry |
| `paint_napkin`       | Simple visual-thinking primitives         |
| `paint_edit`         | Erase, fill, text and crop operations     |
| `paint_canvas`       | Resize and manage the canvas              |
| `paint_debug_ui`     | Inspect the Paint UI Automation tree      |
| `paint_debug_canvas` | Inspect resolved canvas geometry          |

The productive drawing APIs operate in logical drawing space rather than requiring the caller to know where Paint happens to be on the screen.

---

## The semantic drawing layer

The 2D DSL currently includes generators such as:

```text
ellipse
circle
disk
arc
rectangle
roundedRectangle
polyline
logarithmicSpiral
regularPolygon
starPolygon
grid
dotsAlongPath
```

The 3D layer includes:

```text
tetrahedron
cube
octahedron
dodecahedron
icosahedron
greatIcosahedron
starOctangula
tesseract
torus
torusKnot
revolution
wireframe
```

These descriptions are validated before reaching the drawing layer and transformed into pure geometry before any Windows interaction occurs.

The complete DSL reference lives in:

**[`docs/dsl-paint-draw.md`](docs/dsl-paint-draw.md)**

---

## Under the hood: understanding Paint

The project uses Windows UI Automation to discover application controls instead of relying entirely on fixed toolbar coordinates.

That investigation became useful enough to document independently.

If you are interested in understanding how a modern Windows application can be inspected and automated through its accessibility model, see:

**[`docs/windows-automation-uia.md`](docs/windows-automation-uia.md)**

There is also a practical PowerShell walkthrough:

**[`docs/tutorial-paint-powershell.md`](docs/tutorial-paint-powershell.md)**

These documents preserve the engineering investigation behind the MCP implementation rather than hiding it behind the final API.

---

## Quick start

### Requirements

* Windows
* Microsoft Paint
* Node.js
* PowerShell
* an MCP-compatible client

Clone the repository:

```bash
git clone https://github.com/miguelcespedes/mcp-server-microsoft-paint-nodejs.git
cd mcp-server-microsoft-paint-nodejs
```

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run the MCP server:

```bash
npm start
```

See `.mcp.json` for an example MCP configuration.

---

## A small experiment worth preserving

This repository is intentionally not an attempt to turn Microsoft Paint into professional graphics software.

There are already vastly better tools for that.

Paint is useful here precisely because of its limitations.

It provides a familiar, constrained environment in which several questions become easier to see:

How should an AI describe a visual idea?

Where should semantics end and application-specific automation begin?

How much application understanding is necessary before automation becomes reliable?

Can a simple canvas become a useful interface for mathematical or educational reasoning?

And what happens when we stop treating old software only according to the purpose for which it was originally designed?

I don't know where all of those questions lead.

That is part of why this repository exists.

---

## Documentation

| Document                                                                 | Purpose                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| [`docs/dsl-paint-draw.md`](docs/dsl-paint-draw.md)                       | Mathematical drawing DSL and generator reference     |
| [`docs/windows-automation-uia.md`](docs/windows-automation-uia.md)       | Investigation of Paint through Windows UI Automation |
| [`docs/tutorial-paint-powershell.md`](docs/tutorial-paint-powershell.md) | Practical Paint automation tutorial using PowerShell |

Additional architecture, examples, testing notes and implementation details may gradually move here as the experiment evolves.

---

## Status

This is an experimental project.

Some capabilities are intentionally exploratory and some parts of Microsoft Paint's UI remain less deterministic than others.

That is not hidden.

The limitations are part of the investigation.

If you find an edge case, a better semantic abstraction, an interesting mathematical generator, or simply another unexpected use for the canvas, contributions and experiments are welcome.

---

## One last thought

Curiosity is good at opening doors.

Discipline is what keeps what we find from disappearing.

And once a discovery is preserved, someone else can use it to begin another exploration.

Perhaps that is how curiosity becomes cumulative.

---

## License

See the repository license for details.
