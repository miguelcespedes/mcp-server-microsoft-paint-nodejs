# mcp-server-microsoft-paint-nodejs — Automatización de Paint con Win32

Servidor MCP (Model Context Protocol) en Node.js y TypeScript con herramientas de automatización de Paint:

- **`paint_draw_libre`**, **`paint_draw_polyline`** y **`paint_draw_espiral_logaritmica`** — automatización de Microsoft Paint usando la API Win32 (`user32.dll`) a través de [Koffi](https://koffi.dev/).

> **Importante: la automatización de Paint funciona únicamente en Windows.**
> Es una prueba de concepto (POC) educativa: la interacción con la ventana se hace
> mediante funciones Win32 invocadas desde Node.js con Koffi. No se usan RobotJS,
> Playwright, Puppeteer, AutoHotkey, ni captura/análisis visual de pantalla.

## Requisitos

- Windows 10 u 11 (64 bits).
- Node.js 18 o superior (probado con Node 24).
- Microsoft Paint instalado (incluido en Windows).

## Instalación

```bash
npm install
```

Nota: Koffi compila un binario nativo en la instalación. Si usas `npm` con
políticas de scripts restringidas, aprobá el script de instalación de Koffi:

```bash
npm approve-scripts koffi
```

## Estructura del proyecto

Patrón **hexagonal ligero**: el dominio es puro (no conoce Win32 ni MCP) y
los adaptadores implementan/usan los contratos del dominio. El punto de
composición es `src/server.ts`.

```text
src/
  server.ts                        # COMPOSICIÓN: crea el adaptador Win32 (PaintPort)
                                   # y lo inyecta al registro de operaciones MCP
  domain/                          # NÚCLEO puro (sin Win32 ni MCP)
    drawing.ts                     # Tipos del dibujo y puerto PaintPort (contrato)
    figures.ts                     # Matemática de figuras (funciones puras)
  infrastructure/
    win32/                         # ADAPTADOR de salida: implementa PaintPort con Win32
      user32.ts                    # Tipos nativos, constantes y bindings de user32.dll (Koffi)
      process.ts                   # Lógica genérica de Windows: procesos, ventanas, mouse
      paint.ts                     # Motor de dibujo (driver): PaintPort sobre Win32
    mcp/                           # ADAPTADOR de entrada: operaciones MCP
      schemas.ts                   # Esquemas zod de entrada (point, stepDelayMs, ...)
      errors.ts                    # Formateo de errores MCP (toolErrorResult)
      registry.ts                  # Registro central de operaciones MCP
      operations/                  # 1 operación por archivo (solo operaciones)
        freehand.operation.ts      # Operación: Dibujo Libre (paint_draw_libre)
        polyline.operation.ts      # Operación: Dibujar polilínea (paint_draw_polyline)
        logarithmic-spiral.operation.ts  # Operación (Ejemplo 1): Espiral Logarítmica
  test/                            # Pruebas de integración (node:test, por operación)
    helpers.mjs                    # Cliente MCP + generadores de figuras
    logarithmic-spiral.test.mjs    # Test de la espiral (fase 0°)
    polyline.test.mjs              # Test de polilínea (fase 120°)
    freehand.test.mjs              # Test de dibujo libre (6 trazos, fase 240°)
```

Flujo de dependencias (una sola dirección):

```text
src/server.ts ──→ infrastructure/mcp/* (operaciones, esquemas zod)
                        │
                        ▼ (usa el puerto, nunca Win32 directo)
                 domain/drawing.ts (PaintPort) ⇦── infrastructure/win32/paint.ts
                        ▲
                        │ (figuras puras)
                 domain/figures.ts
```

- **El dominio** (`src/domain/`) no importa nada del exterior: solo tipos,
  el puerto `PaintPort` (crea ventanas), la abstracción `PaintWindow`
  (analogía `Ext.window.Window`: una instancia = una ventana con su lienzo)
  y funciones puras de figuras (`logarithmicSpiral`, ...).
- **Las operaciones MCP** (`src/infrastructure/mcp/`) reciben `PaintPort` por
  inyección en su `register*(server, paint)`: cada llamada crea su propia
  instancia (`const window = await paint.createWindow()`) y dibuja sobre
  ella; solo definen nombre, descripción, esquema zod y handler.
- **El adaptador Win32** (`src/infrastructure/win32/paint.ts`) es la única
  implementación de `PaintPort`; `process.ts`/`user32.ts` son helpers genéricos.
- **`src/server.ts`** cablea todo: crea `createWin32PaintDriver()` y se lo
  pasa a `registerOperations(server, paint)`.

## Ejecución

Desarrollo (con `tsx`):

```bash
npm run dev
```

Compilar y ejecutar:

```bash
npm run build
npm start
```

## Agregar una operación

Patrón hexagonal del scaffolding: **cada operación MCP es un archivo
`<nombre>.operation.ts` en `src/infrastructure/mcp/operations/`** que
registra UNA herramienta contra el puerto `PaintPort`. Cada responsabilidad
tiene su propio archivo dentro de `src/infrastructure/mcp/`: `schemas.ts`
(esquemas zod), `errors.ts` (formateo de errores), `registry.ts` (registro
central). El motor (`src/infrastructure/win32/paint.ts`) es genérico y no
contiene dibujos concretos: las operaciones solo aportan esquema,
descripción y registro; la matemática de cada figura vive en
`src/domain/figures.ts` como función pura.

Patrón de ventana (analogía `Ext.window.Window`): cada llamada crea su
propia instancia de ventana con lienzo limpio:

```ts
const window = await paint.createWindow(); // ventana NUEVA de Paint
const result = await window.drawPolyline(points, { stepDelayMs: 8 });
```

Pasos:

1. Si la operación dibuja una figura, agrega su función pura en
   `src/domain/figures.ts` (p. ej. `logarithmicSpiral`).
2. Crea `src/infrastructure/mcp/operations/<nombre>.operation.ts` con una
   función `register<Nombre>(server: McpServer, paint: PaintPort)` que llame
   a `server.registerTool`.
3. Define el esquema de entrada con zod (reutiliza `pointSchema`,
   `skipToolSelectionSchema` y `stepDelayMsSchema` de `schemas.ts`; usa
   `toolErrorResult` de `errors.ts` para los errores).
4. En el handler, genera los puntos con la figura del dominio, crea su
   ventana con `paint.createWindow()` y dibuja con
   `window.drawPolyline(...)` / `window.drawFreehand(...)` — nunca Win32
   directo.
5. Regístrala en `src/infrastructure/mcp/registry.ts`.

Ejemplo mínimo:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../domain/drawing.js";
import { logarithmicSpiral } from "../../domain/figures.js";
import { toolErrorResult } from "../errors.js";

export function registerLogarithmicSpiral(
  server: McpServer,
  paint: PaintPort,
): void {
  server.registerTool(
    "paint_draw_espiral_logaritmica",
    { title: "Espiral Logarítmica", description: "...", inputSchema: {} },
    async () => {
      try {
        const points = logarithmicSpiral(SPIRAL_PARAMS);
        const window = await paint.createWindow();
        const result = await window.drawPolyline(points, { stepDelayMs: 8 });
        return {
          content: [{ type: "text", text: "Listo." }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_espiral_logaritmica", error);
      }
    },
  );
}
```

## MCP Inspector

```bash
npm run inspect
```

Se abrirá una interfaz web. Conecta con el servidor y prueba las herramientas:
empieza con `paint_draw_espiral_logaritmica` (sin argumentos) y sigue con
`paint_draw_libre` y `paint_draw_polyline`. Recuerda que las herramientas de
dibujo moverán el mouse real de tu sesión de Windows.

## Pruebas

Pruebas de integración con el runner nativo de Node (`node:test`, sin
dependencias extra): cada una arranca su propio servidor MCP y dibuja en
Paint real, por lo que **mueven el mouse real de la sesión**. Por defecto
cada operación dibuja en un lienzo nuevo, así que los tests no se superponen
entre sí.

```bash
npm run build
npm test
```

O un test en particular:

```bash
node --test test/polyline.test.mjs
```

```text
test/
  helpers.mjs                    # Cliente MCP + generadores de espiral compartidos
  logarithmic-spiral.test.mjs    # paint_draw_espiral_logaritmica (fase 0°)
  polyline.test.mjs              # paint_draw_polyline (fase 120°)
  freehand.test.mjs              # paint_draw_libre (6 trazos, fase 240°)
```

## Uso de las herramientas

### `paint_draw_espiral_logaritmica`

Ejemplo 1 — sin argumentos. Dibuja una espiral logarítmica `r = 1.1^θ`
(6 vueltas) en el lienzo con `paint_draw_polyline`. Es la forma más rápida
de probar el servidor desde el MCP Inspector: conectar → clic en
`paint_draw_espiral_logaritmica` → "Call" → mira el lienzo. Vive en
`src/infrastructure/mcp/operations/logarithmic-spiral.operation.ts`; la
matemática de la figura es pura (`src/domain/figures.ts`) y el motor sigue
sin dibujos concretos.

### `paint_draw_libre`

Dibujo Libre: una o varias pinceladas (trazos), cada una con un único
arrastre del mouse. **Cada llamada crea su propia ventana de Paint con
lienzo limpio** (si Paint no estaba abierto, lo abre): los dibujos de
llamadas distintas nunca se superponen.

| Parámetro   | Tipo  | Descripción                                              |
| ----------- | ----- | -------------------------------------------------------- |
| `trazos`    | array | 1–100 trazos `{puntos: [{x, y}, ...]}` (2–1000 puntos c/u). **Opcional**: si no se pasan se dibuja el ejemplo en zigzag (el Inspector pre-rellena este valor) |
| `stepDelayMs`| int  | Retraso entre movimientos del mouse (0–200 ms, por defecto 10) |
| `skipToolSelection` | bool | Opcional. `false` = selecciona la herramienta Lápiz antes de dibujar. Por defecto no toca el toolbar |

Formato del JSON (provisional, pendiente de especificación) — el JSON por
defecto que el Inspector pre-rellena:

```json
{
  "trazos": [
    { "puntos": [{"x": 100, "y": 100}, {"x": 200, "y": 300}, {"x": 300, "y": 100}, {"x": 400, "y": 300}, {"x": 500, "y": 100}] },
    { "puntos": [{"x": 550, "y": 300}, {"x": 650, "y": 100}] }
  ],
  "stepDelayMs": 10
}
```

**Las coordenadas son relativas al lienzo (área dibujable) de Paint, NO al
área cliente de la ventana.** Las operaciones fuerzan la ventana
**maximizada**; en ese estado el lienzo queda centrado y empieza en
un offset fijo del área cliente (`CANVAS_ORIGIN`, medido en Paint 11.2605 con
la ventana maximizada). Internamente se suma ese offset antes de convertir a
coordenadas absolutas de pantalla con `ClientToScreen`. Si dibujas cerca de la
parte inferior y el trazo se corta, es porque el punto excede el tamaño del
lienzo (892x723 px con el layout maximizado por defecto). La respuesta incluye
`windowHandle` (HWND en hexadecimal) y `createdBy`, que indica cómo se creó
la ventana de la operación: `opened` (Paint no estaba abierto y se lanzó),
`launched` (Paint ya estaba abierto y `mspaint.exe` sí creó una ventana nueva)
o `shell` (la instancia nueva se creó con `ShellExecuteW` sobre el AUMID de
Paint porque `mspaint.exe` no produjo ventana).

Secuencia interna de cada operación: `paint.createWindow()` (si Paint no
estaba abierto se lanza; si ya estaba abierto se intenta crear una ventana
nueva con `mspaint.exe` y, si no aparece, con `ShellExecuteW` sobre el
AUMID de Paint; si ninguna estrategia funciona, error) → **maximizar la
ventana** (el layout asume ventana maximizada) → llevarla al primer plano → convertir
lienzo→área cliente (`CANVAS_ORIGIN`) → validar que los puntos estén dentro
del área cliente → convertir a coordenadas de pantalla → `SetCursorPos` al
inicio → `SendInput` (botón izquierdo + movimiento progresivo absoluto) →
soltar el botón.

> **Por defecto no se toca la barra de herramientas**: Paint inicia con la
> herramienta **Brocha** (tinta negra), que dibuja con un arrastre normal del
> botón izquierdo. La selección del Lápiz por clics en coordenadas resultó
> poco fiable (depende del estado del ribbon y de otros desplegables), así que
> solo se usa cuando el cliente lo pide explícitamente con
> `skipToolSelection: false`.

### `paint_draw_polyline`

Dibuja una polilínea (serie de puntos conectados) en **un único arrastre** del
mouse. Ideal para curvas, espirales o dibujos generados: un solo arrastre es
mucho más rápido y fluido que varios arrastres separados (una sola
maximización, un solo clic inicial y un solo `SendInput`). **Cada llamada
crea su propia ventana de Paint con lienzo limpio** (si Paint no estaba
abierto, lo abre): los dibujos de llamadas distintas nunca se superponen.

| Parámetro   | Tipo  | Descripción                                              |
| ----------- | ----- | -------------------------------------------------------- |
| `points`    | array | 2–1000 puntos `{x, y}` (enteros) en orden de trazado. **Opcional**: si no se pasan se dibuja un rectángulo de ejemplo (el Inspector pre-rellena este valor) |
| `stepDelayMs`| int  | Retraso entre movimientos del mouse (0–200 ms, por defecto 10) |
| `skipToolSelection` | bool | Opcional. `false` = selecciona la herramienta Lápiz antes de dibujar. Por defecto no toca el toolbar |

Las coordenadas son relativas al lienzo, igual que en `paint_draw_libre`.
Ejemplo — rectángulo (el JSON por defecto que el Inspector pre-rellena):

```json
{
  "points": [{"x": 200, "y": 100}, {"x": 600, "y": 100}, {"x": 600, "y": 500}, {"x": 200, "y": 500}],
  "stepDelayMs": 10
}
```

Con `stepDelayMs: 0` el arrastre no duerme entre movimientos (máxima
velocidad); con valores altos se ve el trazo avanzar lentamente.

## Funciones Win32 usadas

`FindWindowW`, `EnumWindows`, `GetWindowTextW`, `GetClassNameW`,
`GetWindowThreadProcessId`, `GetForegroundWindow`, `IsWindow`,
`IsWindowVisible`, `IsIconic`, `SetForegroundWindow`, `ShowWindow`,
`AttachThreadInput`, `GetClientRect`, `ClientToScreen`, `SetCursorPos`,
`GetSystemMetrics`, `SetProcessDpiAwarenessContext`, `SendInput` y
`ShellExecuteW`. Los eventos de mouse se envían con `SendInput` (no con la
API antigua `mouse_event`); el movimiento del arrastre usa coordenadas
absolutas normalizadas (`MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`) para
soportar multi-monitor.

## Seguridad y validaciones

- Se comprueba que el `HWND` siga existiendo (`IsWindow`) antes de cada uso.
- Se valida que las coordenadas no sean negativas y que el punto resultante
  (lienzo + offset) quede dentro del área cliente de Paint: **la herramienta
  no dibuja fuera de Paint**.
- `stepDelayMs` se limita a 0–200 ms y `points`/`trazos` a 2–1000 puntos por trazo.
- Si la ventana no puede ir al primer plano, se devuelve una advertencia en la
  respuesta en lugar de fallar silenciosamente.

## Limitaciones de esta POC

- **Solo Windows** (usa `user32.dll` directamente).
- Mueve el mouse real de la sesión: mientras dibuja, no uses el mouse.
- El primer plano de la ventana depende de las restricciones de Windows; se
  usa `AttachThreadInput` para mejorarlo, pero puede fallar en sesiones no
  interactivas o con elevación de privilegios (UIPI).
- **Offsets de layout hardcodeados**: el origen del lienzo (`CANVAS_ORIGIN` =
  (513, 220), lienzo centrado de 892x723) y la posición del botón "Lápiz"
  (`PENCIL_BUTTON` = (328, 82), solo usado con `skipToolSelection: false`) se
  midieron con UI Automation en Paint
  **11.2605** (versión UWP de Windows 11) **con la ventana maximizada** en un
  monitor de 1920 px lógicos al 125% de DPI. Si usas otra versión de Paint,
  otro ancho de monitor o la ventana no se maximiza (p. ej. sesión sin
  escritorio interactivo), ajusta las constantes en
  `src/infrastructure/win32/paint.ts`.
- **Conciencia DPI obligatoria**: el proceso se marca como *per-monitor DPI
  aware* (`SetProcessDpiAwarenessContext`) al arrancar para que todas las
  coordenadas sean físicas. Sin esto, Windows virtualiza las coordenadas de
  los procesos DPI-unaware y el lienzo quedaría desplazado según la escala
  del monitor.
- La selección del Lápiz (opcional, `skipToolSelection: false`) es por clics
  en coordenadas porque el Paint moderno no responde a los atajos de teclado
  de herramientas. Es poco fiable: un desplegable abierto (p. ej. el de
  "Seleccionar") o el ribbon desplazado absorben el clic y cambian la
  herramienta equivocada. Por eso **por defecto no se toca el toolbar** y se
  dibuja con la herramienta activa (Paint inicia con la Brocha, que dibuja
  tinta con un arrastre normal).
- Las coordenadas son relativas al lienzo; dibujar más allá del lienzo
  (p. ej. `startY` > 720 con el layout maximizado por defecto) quedará
  cortado o devolverá un error si sale del área cliente.
- En Windows 11, `mspaint.exe` puede ser un stub de la app UWP; si no crea
  ventana, se lanza la app moderna con `ShellExecuteW` sobre su AUMID. Si no
  hay sesión interactiva activa esto puede fallar.
- Las operaciones localizan la ventana por PID y, como respaldo, por clase
  `MSPaintApp` o hosts UWP con "paint" en el título; si no hay ninguna,
  abren Paint automáticamente.
- No hay selección de color ni grosor: dibuja con el estado actual de Paint
  (tinta negra de la herramienta activa).
- Cada operación crea su propia ventana (patrón `Ext.window.Window`): si
  Paint ya estaba abierto se intenta crear una ventana nueva lanzando
  `mspaint.exe` y, si eso no abre una ventana, con `ShellExecuteW` sobre el
  AUMID de Paint. Si ninguna estrategia crea una ventana nueva, la operación
  devuelve un error en lugar de dibujar sobre una ventana existente. Las
  ventanas creadas se acumulan: ciérralas manualmente.

## Notas de implementación (Koffi)

- Los handles (`HWND`, `HANDLE`) son punteros de 64 bits; Koffi los devuelve
  como `BigInt` para no perder precisión y se muestran en hexadecimal.
- `INPUT`/`MOUSEINPUT` se definen como structs con el layout exacto de x64
  (40 bytes), incluyendo el padding de `dwExtraInfo` (`ULONG_PTR`).
- `EnumWindows` usa un callback transitorio de Koffi (`koffi.proto`), válido
  solo durante la llamada, que es exactamente el caso de uso.
