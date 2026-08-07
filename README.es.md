# Servidor MCP para dibujar en Microsoft Paint desde Node.js

[English](README.md) | [Español](README.es.md)

Este proyecto es un servidor MCP en Node.js + TypeScript que controla Microsoft Paint en Windows.

Ya incluía herramientas de dibujo basadas en mouse y ahora agrega una prueba de concepto con UI Automation para descubrir y usar la herramienta nativa `Ellipse` de Paint sin seleccionarla mediante coordenadas fijas del toolbar.

## Propósito de Este Experimento

La meta es pasar de una automatización basada solo en coordenadas a un pipeline semántico:

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

En lugar de hacer clic en una posición fija del toolbar, el servidor ahora intenta:

- inspeccionar el árbol de accesibilidad de Paint
- localizar semánticamente la zona de formas
- resolver la herramienta nativa Elipse
- invocarla con UI Automation
- dibujar sobre el lienzo con `SendInput`

## Herramientas MCP Actuales

Herramientas existentes preservadas:

- `paint_draw_freehand`
- `paint_draw_polyline`
- `paint_draw_logarithmic_spiral`

Herramientas nuevas de la POC con UI Automation:

- `paint_inventory`
- `paint_select_shape`
- `paint_draw_ellipse`

## Arquitectura

El servidor sigue siendo deliberadamente delgado en `src/server.ts`.

Capas principales:

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

## Estrategia de UI Automation

La build actual usada para esta POC es:

- Windows: `Windows 10 Pro 24H2`, build `26100`
- Paint: `Microsoft.Paint 11.2605.71.0 x64`

Observaciones manuales de la build validada:

- la sección de shapes aparece como un grupo semántico llamado `Formas`
- la herramienta nativa de elipse aparece como un `ListItem` llamado `Elipse`
- la superficie de dibujo se representa mejor por un elemento semántico tipo canvas con `automationId: "image"`
- en la sesión validada, el canvas resuelto midió `794 x 723`

El proyecto ya usaba `Koffi` con éxito para APIs Win32.

Para UI Automation, esta POC usa:

- TypeScript como capa principal de orquestación
- un bridge pequeño en PowerShell usando ensamblados .NET incluidos en Windows:
  - `UIAutomationClient`
  - `UIAutomationTypes`

Motivos de esta decisión:

- el acceso Win32 directo ya existe y se conserva
- consumir COM UI Automation directamente con Koffi sería mucho más grande y frágil para una POC
- esta máquina no tiene instalado el SDK de `dotnet`, así que un bridge en C# agregaría una dependencia de entorno nueva
- PowerShell 5.1 puede acceder a Microsoft UI Automation sin añadir una dependencia externa pesada

## Selección Semántica vs Coordenadas Fijas

Este repositorio ahora usa dos estilos distintos de automatización según el problema:

- descubrimiento semántico de la UI y selección de herramienta para Elipse
- input de mouse relativo a pantalla para el gesto final sobre el lienzo

Lo que se evita para la herramienta Elipse:

- coordenadas fijas del toolbar
- OCR
- reconocimiento visual por screenshots
- automatización web
- selección al estilo AutoHotkey / RobotJS

Lo que sigue siendo válido:

- arrastre por coordenadas dentro del lienzo validado de Paint

## Dependencias

Dependencias de runtime:

- `@modelcontextprotocol/sdk`
- `koffi`
- `zod`

Dependencias de desarrollo:

- `typescript`
- `tsx`
- `@types/node`
- `@modelcontextprotocol/inspector`

## Requisitos de Windows

- Windows 10 u 11
- Microsoft Paint instalado
- sesión interactiva de escritorio
- PowerShell disponible

Limitaciones importantes del entorno:

- la app moderna de Paint puede abrirse a través de stubs `mspaint.exe`
- los metadatos de UI Automation pueden variar entre versiones de Paint e idiomas del SO
- el lienzo puede requerir un fallback si no aparece como un elemento semántico claro en la UI

## Instalación

```bash
npm install
```

Si tu configuración de npm restringe scripts nativos:

```bash
npm approve-scripts koffi
```

## Ejecución

Desarrollo:

```bash
npm run dev
```

Compilar:

```bash
npm run build
```

Ejecutar la versión compilada:

```bash
npm start
```

## Uso con MCP Inspector

```bash
npm run inspect
```

Flujo manual recomendado:

1. Inicia MCP Inspector.
2. Conéctate al servidor.
3. Ejecuta `paint_inventory`.
4. Confirma que el inventario devuelve un grupo relacionado con formas y una candidata tipo elipse.
5. Ejecuta `paint_select_shape` con `ellipse`.
6. Ejecuta `paint_draw_ellipse`.
7. Confirma visualmente que Paint dibujó la elipse.

## Ejemplos de Herramientas

### `paint_inventory`

Entrada de ejemplo:

```json
{
  "maxDepth": 8,
  "includeBoundingRectangles": true
}
```

Nota: una build localizada de Paint puede exponer los nombres de shapes en otro idioma. Por ejemplo, en la build validada en español, `ellipse` aparece en el inventario como `Elipse`.

Propósito:

- inspeccionar el árbol de accesibilidad de Paint
- resumir grupos y controles probables
- diagnosticar diferencias entre versiones e idiomas

### `paint_select_shape`

Entrada de ejemplo:

```json
{
  "shape": "ellipse"
}
```

Propósito:

- verificar que Paint está abierto
- descubrir la forma semánticamente
- invocar el control nativo Elipse a través de UI Automation

### `paint_draw_ellipse`

Entrada de ejemplo:

```json
{
  "x": 100,
  "y": 120,
  "width": 300,
  "height": 180,
  "durationMs": 600
}
```

Propósito:

1. descubrir y seleccionar la herramienta Elipse semánticamente
2. resolver el lienzo de Paint
3. validar que la elipse solicitada cabe dentro del lienzo
4. convertir coordenadas relativas al lienzo en coordenadas de pantalla
5. ejecutar el gesto de arrastre con `SendInput`

Forma típica de una respuesta correcta:

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

## Modelo de Errores

La nueva ruta de UI Automation distingue errores como:

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

Los errores se devuelven como respuestas MCP con `isError: true` y diagnóstico estructurado.

## Pruebas

Primero compila:

```bash
npm run build
```

Ejecuta todas las pruebas:

```bash
npm test
```

Las pruebas unitarias agregadas para esta POC cubren:

- resolución de aliases
- priorización por `AutomationId`
- coincidencias ambiguas
- validación de duración
- validación de límites del lienzo
- conversión de coordenadas
- serialización de handles

Estas pruebas unitarias no abren ventanas reales de Paint.

## Limitaciones Conocidas

- solo `ellipse` está soportada en esta iteración
- el descubrimiento de shapes es heurístico y puede variar entre builds de Paint
- los metadatos accesibles localizados pueden cambiar según el idioma de Windows
- el lienzo no siempre estará expuesto limpiamente vía UI Automation
- cuando la detección semántica del lienzo es débil, la implementación cae al modelo geométrico fijo que ya usaba el proyecto
- las operaciones legacy siguen teniendo supuestos de layout previos a esta POC de UI Automation

## Riesgos de Compatibilidad

Las partes más frágiles entre versiones de Paint son:

- nombres accesibles
- valores de `AutomationId`
- agrupación de los botones de formas
- exposición del lienzo en el árbol de UI Automation

En la build validada durante este experimento, la implementación tuvo que adaptarse a esta estructura concreta:

- `Formas` es un `Group`
- la galería de shapes vive dentro de un `GridView` anidado
- `Elipse` es un `ListItem`, no un `Button` directo del toolbar
- el canvas correcto es el elemento semántico `image`, no el `ScrollViewer` exterior más grande

Por eso existe `paint_inventory`: ofrece una ruta de diagnóstico reproducible antes de cambiar el resolver.

## Material Sugerido para una Publicación Posterior

Si más adelante quieres publicar este experimento, el material más útil sería:

- un GIF corto de `paint_inventory` -> `paint_select_shape` -> `paint_draw_ellipse`
- una captura de la UI de Paint con la herramienta Elipse seleccionada
- una captura del resultado final dibujado sobre el lienzo
