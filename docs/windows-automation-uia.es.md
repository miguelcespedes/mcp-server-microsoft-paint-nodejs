# Windows Automation (UIA) con PowerShell: guía y descubrimientos

Este documento explica cómo funciona UI Automation, qué dependencias necesita,
cómo está construido el puente PowerShell de este repositorio
(`scripts/paint-uia-bridge.ps1`) y registra **todo lo descubierto
empíricamente** durante el desarrollo (entorno de prueba: Paint 11.2605.71.0,
Windows 11, idioma español).

---

## Índice

1. [Qué es UI Automation](#1-que-es-ui-automation)
2. [Dependencias](#2-dependencias)
3. [El árbol de accesibilidad](#3-el-arbol-de-accesibilidad)
4. [Patrones (patterns)](#4-patrones-patterns)
5. [runtimeId y localización de elementos](#5-runtimeid-y-localizacion-de-elementos)
6. [Cómo funciona el puente del repositorio](#6-como-funciona-el-puente-del-repositorio)
7. [El lado servidor (Node.js)](#7-el-lado-servidor-nodejs)
8. [Bitácora de descubrimientos](#8-bitacora-de-descubrimientos)
9. [Referencias](#9-referencias)

---

## 1. Qué es UI Automation

UI Automation (UIA) es el framework de accesibilidad de Windows (desde Vista).
Cada control expone un **elemento de automatización** (un "peer") que describe
su rol, su nombre y los **patrones** de comportamiento que soporta. El mismo
árbol que usa el Narrador (lector de pantalla) es el que usamos para
automatizar: si un control es accesible para un usuario ciego, es
automatizable con código.

Puntos clave:

- Es una API **COM** con envoltura .NET: en PowerShell usamos los tipos del
  ensamblado `UIAutomationClient` (namespace `Windows.Automation`).
- Es **independiente del framework del control**: Win32 clásico, WinForms,
  WPF, XAML/UWP (WinUI) y web (Chrome/Edge) exponen peers UIA.
- Hay dos modelos de consumo: **cliente** (nosotros: leemos el árbol y
  operamos patrones) y **proveedor** (el control: implementa peers).

## 2. Dependencias

| Dependencia | Qué aporta | ¿Hay que instalarla? |
|---|---|---|
| PowerShell 5.1 | El host de scripts | Viene con Windows |
| .NET Framework 4.8 | CLR donde corren los ensamblados UIA | Viene con Windows 11 |
| `UIAutomationClient.dll` | Tipos de cliente: `AutomationElement`, patrones | En el GAC; se carga con `Add-Type -AssemblyName UIAutomationClient` |
| `UIAutomationTypes.dll` | Enums y tipos de soporte (`TreeScope`, `Condition`…) | Ídem |
| `user32.dll` | `EnumWindows`, `SendInput`, `SetCursorPos`, `ClientToScreen`… | Sistema |

Carga mínima:

```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
```

> Nota: el paquete NuGet `UIAutomationClient` solo existe para las versiones
> .NET Core 3.0+/5+; en PowerShell 5.1 los ensamblados ya están en el GAC de
> .NET Framework y no hace falta descargar nada.

## 3. El árbol de accesibilidad

El escritorio es la raíz (`AutomationElement.RootElement`). Cada ventana es un
hijo; dentro, paneles, botones, campos, etc. Se recorre con `FindAll` /
`FindFirst` indicando un `TreeScope`:

| TreeScope | Alcance |
|---|---|
| `Element` | Solo el elemento mismo |
| `Children` | Hijos directos |
| `Descendants` | Todo el subárbol (el más usado) |
| `Subtree` | Elemento + descendientes |

```powershell
$desktop = [Windows.Automation.AutomationElement]::RootElement

# 1) Localizar la ventana de Paint desde el escritorio
$cond = New-Object Windows.Automation.PropertyCondition(
  [Windows.Automation.AutomationElement]::ClassNameProperty, 'MSPaintApp')
$paintEl = $desktop.FindFirst([Windows.Automation.TreeScope]::Children, $cond)

# 2) O bien, directo desde un HWND
$paintEl = [Windows.Automation.AutomationElement]::FromHandle($paintHwnd)

# 3) Todos los controles del árbol
$all = $paintEl.FindAll([Windows.Automation.TreeScope]::Descendants,
                        [Windows.Automation.Condition]::TrueCondition)
```

Condiciones útiles:

- `TrueCondition` — todo (recorrer todo el árbol).
- `PropertyCondition(propiedad, valor)` — filtrar por `AutomationIdProperty`,
  `NameProperty`, `ControlTypeProperty`, `ClassNameProperty`…
- `AndCondition` / `OrCondition` — combinar.

Las propiedades se leen de `.Current`:

```powershell
$e = $all.Item(0)
$e.Current.Name                    # texto visible
$e.Current.AutomationId            # id estable del control
$e.Current.ControlType.ProgrammaticName   # 'Button', 'Edit', 'Spinner'...
$e.Current.ClassName               # clase interna del framework
$e.Current.FrameworkId             # 'XAML', 'Win32'...
$e.Current.IsEnabled / .IsOffscreen
$e.Current.BoundingRectangle       # rect en píxeles de pantalla
$e.Current.NativeWindowHandle      # HWND (si tiene)
```

## 4. Patrones (patterns)

Un patrón es una interfaz que implementa el peer para exponer un
comportamiento. Se obtiene con `GetCurrentPattern(Patron::Pattern)` y se
convierte al tipo .NET correspondiente.

| Patrón | Se usa en | Métodos clave |
|---|---|---|
| `InvokePattern` | Botones | `Invoke()` |
| `ValuePattern` | TextBox/Edit, ComboBox | `SetValue(texto)`, `Current.Value` |
| `RangeValuePattern` | Sliders, Spinners, NumberBox | `SetValue(double)`, `Current.Value` |
| `SelectionItemPattern` | RadioButtons, items de listas | `Select()`, `Current.IsSelected` |
| `TogglePattern` | ToggleButtons, checkboxes | `Toggle()` |
| `ExpandCollapsePattern` | Menús, SplitButtons, ComboBox | `Expand()`, `Collapse()` |
| `TextPattern` | TextBlocks | `DocumentRange.GetText(-1)` |
| `ScrollPattern` | ScrollViewers | `Scroll()`, `SetScrollPercent()` |
| `WindowPattern` | Ventanas/popups | `Close()`, `SetWindowVisualState()` |

Ejemplo — escribir en un campo (el caso del lienzo):

```powershell
$vp = $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue('1920')
```

Ejemplo — invocar un botón con fallbacks (si no hay Invoke, probar
SelectionItem; si no, LegacyIAccessible). Esto es exactamente lo que hace
`Invoke-Element` del puente:

```powershell
function Invoke-UiaElement($element) {
  try {
    $p = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $p.Invoke(); return 'Invoke'
  } catch {}
  try {
    $p = $element.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
    $p.Select(); return 'SelectionItem'
  } catch {}
  $p = $element.GetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern)
  $p.DoDefaultAction(); return 'LegacyIAccessible'
}
```

> Regla práctica: el patrón que soporta el control aparece en
> `GetSupportedPatterns()`. Antes de operar, lee `supportedPatterns` y elige.

## 5. runtimeId y localización de elementos

`AutomationElement.GetRuntimeId()` devuelve un array de enteros que identifica
unívocamente al elemento en el árbol **dentro de la misma sesión/proceso de
UI Automation**. No es estable entre reinicios, pero sí dentro de una
operación: por eso el puente lo usa como "dirección" del elemento.

Estrategia del puente (`Find-ElementByRuntimeId`): recorre el árbol completo
desde la raíz comparando runtimeIds hasta encontrar el target, y luego opera
sobre él. Así el servidor Node puede "recordar" un elemento de un escaneo
anterior (ej. el Edit del ancho) sin depender de nombres localizados.

## 6. Cómo funciona el puente del repositorio

`scripts/paint-uia-bridge.ps1` soporta dos modos:

- **One-shot** (por defecto): cada invocación es un proceso PowerShell nuevo
  que recibe una acción + payload JSON en base64 y devuelve JSON por stdout.
- **Servidor persistente** (`-Server`): lee comandos JSONL de stdin y escribe
  respuestas JSONL por stdout, amortizando el arranque de `powershell.exe`
  (~1–2 s) entre comandos. Es el modo que usa el servidor Node.

```
node (automation-client.ts)
  │  spawn("powershell", ["-NoProfile","-NonInteractive","-ExecutionPolicy",
  │        "Bypass","-File","scripts/paint-uia-bridge.ps1","-Server"])
  ▼
scripts/paint-uia-bridge.ps1 (proceso persistente)
  │  por cada línea JSON de stdin { id, action, payload }:
  ├─ Get-PaintRootElement → localiza la ventana (processId | className | título)
  └─ según action:
       ├─ inventory   → Build-Inventory (BFS con profundidad máx.) o
       │                Get-DesktopChildrenInventory (scope desktop-children)
       ├─ invoke      → Find-ElementByRuntimeId + Invoke-Element (fallbacks)
       └─ set-value   → Find-ElementByRuntimeId + Set-ElementValue
                        (Value → RangeValue → descendiente con ValuePattern)
```

Decisiones de diseño:

- **Base64 + JSON**: evita problemas de encoding en argv de Windows
  (los nombres con acentos de Paint español lo justifican). En modo servidor
  el JSON va por stdin y no hace falta base64.
- **Servidor persistente**: la clase `PersistentPowerShellBridge` de
  `automation-client.ts` mantiene un solo proceso PowerShell y correlaciona
  respuestas con `id`. Eliminó el coste de ~1–2 s por llamada que pagaba el
  modo one-shot.
- **Actions atómicas**: una acción por comando; el servidor decide la
  secuencia (abrir popup → escanear → escribir → confirmar → verificar).
- **Scope `desktop-children`**: variante del inventario que enumera los
  top-levels del escritorio (usado para inspeccionar popups que SÍ son
  ventanas separadas).
- **Profundidad máxima** (`maxDepth`): el árbol XAML de Paint es profundo
  (el ribbon relevante vive a profundidad 7–8); el escaneo completo es caro,
  por eso se limita.
- **BoundingRectangle opcional**: activarlo para diagnóstico
  (`includeBoundingRectangles`) porque duplica el costo del JSON.

## 7. El lado servidor (Node.js)

- `src/infrastructure/windows/automation/automation-client.ts` — spawn del
  puente, parseo, normalización y errores tipados.
- `automation-types.ts` — contratos: `AutomationInventoryPayload`,
  `AutomationInvokePayload`, `AutomationSetValuePayload` (nuevo en la
  feature `paint_canvas`).
- `src/infrastructure/win32/process.ts` — el complemento **no-UIA**:
  `EnumWindows`, `SendInput` (teclas/ratón), `SetCursorPos`, `ClientToScreen`,
  `SetForegroundWindow`, maximizar, lanzar procesos y AUMID.
- División de responsabilidades:
  - **UIA** → leer estado, operar controles (diálogos, ribbons, zoom).
  - **Win32 directo** → dibujar (drag de mouse), teclas, foco, ventanas.

## 8. Bitácora de descubrimientos

Todo lo siguiente fue comprobado empíricamente en Paint 11.2605.71.0
(español, Windows 11). Fecha: agosto 2026.

### 8.1 El diálogo "Propiedades de la imagen" es un popup in-window

- `Ctrl+E` sí abre el diálogo, pero como **Popup XAML dentro del árbol de la
  ventana** (`ControlType = Window`, `ClassName = Popup`, `FrameworkId =
  XAML`), no como ventana top-level. `EnumWindows` NO lo ve.
- El tree UIA de la ventana contiene el popup a poca profundidad (visible con
  `maxDepth ≥ 6`), pero sus controles (NumberBox, radios) viven a
  profundidad 4–5 bajo el popup.
- Identificadores verificados: spinners `WidthNumberBox` / `HeightNumberBox`
  (con `RangeValuePattern`), edits internos `InputBox` (con `ValuePattern`),
  botón `PrimaryButton` ("Aceptar"), `CloseButton` ("Cancelar"), grupo
  `Unidades` con radios `Pulgadas` / `Centímetros` / `Píxeles`.

### 8.2 Mojibake en nombres UIA (acentos)

- El radio "Píxeles" llega con nombre `P�xeles` (U+FFFD por encoding). La
  comparación por `AutomationId` no sufre este problema; la comparación por
  nombre SÍ. Solución: sanitizar con
  `name -replace '[^\x20-\x7e]',''` y comparar subcadenas ASCII
  (p. ej. `xeles`).

### 8.3 El ribbon SÍ se expone por UIA (a profundidad ≥ 7)

- Contrario a notas viejas del código, el ribbon del Paint moderno es
  accesible: `PencilTool`, `EraserTool`, `BrushesSplitButton`, `CropButton`,
  `RotateDropdown`, `Flip`, `ZoomValuesComboBox`, `ZoomSliderControl`,
  grupos `Selección`, `Imagen`, `Herramientas`, `Pinceles`, `Formas`,
  `Colores`, `Copilot`, `Capas`.
- El control de estado "usando la herramienta … en el lienzo"
  (`AutomationId = image`) es un Group dentro del `scrollViewer`.

### 8.4 El tamaño lógico del lienzo

- El único elemento que resuelve el tamaño lógico es
  `CanvasSizeTextBlock` (Text, `TextPattern`), texto del estilo
  `"500 × 500píxeles"`. El driver lo usa para escalar coordenadas de dibujo
  y para `fit`.
- `Ajustar a la ventana` (botón "Fit to window"), `Zoom` (ComboBox editable),
  `Alejar`/`Acercar` y `ZoomSliderControl` también están expuestos.

### 8.5 mspaint.exe es un stub UWP

- Lanzar `mspaint.exe` puede quedarse sin ventana (proceso vivo, sin HWND).
- Respaldo probado: `ShellExecuteW` con AUMID
  `shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App`, y matar el stub.
- El proceso UWP crea además ventanas ocultas tituladas
  "Sin título - Default" (hosts de popups); filtrar por visibilidad y clase.

### 8.6 Atajos

- Funcionan: `Ctrl+E` (Propiedades de la imagen), `Ctrl+W` (Redimensionar y
  sesgar), `Ctrl+Shift+X` (Recortar a selección), `Ctrl+A`, `Ctrl+Z`,
  `Ctrl+N` (nuevo documento — **hereda el último tamaño de lienzo**).
- NO funcionan como tecla suelta los atajos clásicos de herramientas
  (B/P/E), pero **las KeyTips de la cinta sí**: pulsar y soltar `Alt` y luego
  la letra selecciona la herramienta (p. ej. `B` = Brocha, `P` = Lápiz) sin
  depender de coordenadas ni de InvokePattern (que en split-buttons solo
  abre el flyout). El driver lo usa en `pressKeyTip()` /
  `pressKeyTipSequence()` (`src/infrastructure/win32/process.ts`).
- `Ctrl + +` / `Ctrl + -` ajustan el grosor de la brocha en pasos de 1 px.

### 8.7 Escribir valores en NumberBox

- `ValuePattern.SetValue` sobre el Edit interno (`InputBox`) funciona y
  reemplaza el texto; `RangeValuePattern` está disponible en el Spinner padre.
- El puente implementa la cadena de fallback
  Value → RangeValue → descendiente con ValuePattern (feature `paint_canvas`,
  ver `Set-ElementValue` en `scripts/paint-uia-bridge.ps1`).

### 8.8 Rendimiento

- El modo **one-shot** pagaba ~1–2 s de arranque de `powershell.exe` por
  llamada. Eso ya no: `automation-client.ts` usa un **proceso PowerShell
  persistente** (`PersistentPowerShellBridge`, modo `-Server` del puente)
  que amortiza el arranque entre comandos JSONL.
- Los escaneos `inventory` con `maxDepth: 8` siguen dominando el tiempo de
  las operaciones de diagnóstico (`paint_debug_ui`, `paint_canvas`). El
  dibujo (`paint_draw`) no escanea: va por SendInput y es rápido.

## 9. Referencias

- Documentación oficial: "UI Automation" (learn.microsoft.com/windows/win32/winauto/entry-uiauto-win32)
- Clases .NET: `System.Windows.Automation.AutomationElement` (docs .NET Framework)
- Código fuente de este repo:
  - `scripts/paint-uia-bridge.ps1` — puente UIA (inventory / invoke / set-value)
  - `src/infrastructure/windows/automation/` — cliente Node del puente
  - `src/infrastructure/win32/process.ts` — Win32 (teclado, ratón, ventanas)
  - `src/infrastructure/win32/user32.ts` — constantes VK y P/Invoke
  - `src/paint/discovery/` — resolución del lienzo desde el inventario
- Tutorial complementario: [`tutorial-paint-powershell.es.md`](./tutorial-paint-powershell.es.md) (versión en inglés: [`tutorial-paint-powershell.md`](./tutorial-paint-powershell.md))
