# Tutorial: manipular Microsoft Paint con PowerShell

Versión de Paint objetivo: **11.2605.71.0 (Windows 11, app moderna UWP)**.
Entorno: PowerShell 5.1 (el que trae Windows), sin instalar nada.

Este tutorial enseña, con scripts probados, las tres operaciones que importan:
localizar la ventana, leer/redimensionar el lienzo y dibujar con el mouse.
Todo el conocimiento viene de la automatización real documentada en
`scripts/paint-uia.ps1` y `src/infrastructure/win32/` de este repositorio.

---

## Índice

1. [Requisitos y lanzar Paint](#1-requisitos-y-lanzar-paint)
2. [Localizar la ventana de Paint](#2-localizar-la-ventana-de-paint)
3. [Windows Automation en 5 minutos](#3-windows-automation-en-5-minutos)
4. [Leer el tamaño del lienzo](#4-leer-el-tamano-del-lienzo)
5. [Redimensionar el lienzo (tamaño customizado)](#5-redimensionar-el-lienzo-tamano-customizado)
6. [Dibujar con el mouse](#6-dibujar-con-el-mouse)
7. [Scripts completos reutilizables](#7-scripts-completos-reutilizables)
8. [Trampas y tips](#8-trampas-y-tips)

---

## 1. Requisitos y lanzar Paint

No hace falta instalar nada: PowerShell 5.1 y .NET Framework 4.8 ya incluyen los
ensamblados de UI Automation en el GAC (`UIAutomationClient.dll`,
`UIAutomationTypes.dll`). Solo hay que cargarlos:

```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
```

### Lanzar Paint

En Windows 11 `mspaint.exe` es un **stub UWP**: a veces se queda vivo sin
crear ventana. La forma robusta de arrancar la app moderna es por su AUMID:

```powershell
$AUMID = 'shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App'
Start-Process $AUMID
```

### Máximo de atención

Antes de cualquier automatización, maximiza y trae al frente la ventana; las
animaciones de maximización de las apps UWP tardan cientos de ms en
recalcular el layout:

```powershell
Start-Sleep -Milliseconds 1500
```

---

## 2. Localizar la ventana de Paint

Para encontrar la ventana usamos `EnumWindows` + `IsWindowVisible` +
`GetWindowText` (P/Invoke). La clase de ventana **`MSPaintApp`** identifica a
Paint de forma fiable y sin depender del idioma.

```powershell
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PaintWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@

$windows = @()
[PaintWin]::EnumWindows({
  param($h, $l)
  if ([PaintWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [PaintWin]::GetWindowText($h, $sb, 256) | Out-Null
    $title = $sb.ToString()
    $pid2 = 0
    [PaintWin]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
    $script:windows += [pscustomobject]@{ Hwnd = $h; Pid = $pid2; Title = $title }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

# Ventanas de Paint (clase MSPaintApp o título con "Paint")
$paint = $windows | Where-Object { $_.Pid -eq (Get-Process mspaint -ErrorAction SilentlyContinue).Id } |
  Select-Object -First 1
$paint
```

> Nota: la app UWP crea además varias ventanas secundarias ocultas con título
> "Sin título - Default" (hosts de popups). Fíltralas por clase o por
> `IsWindowVisible` + la principal.

---

## 3. Windows Automation en 5 minutos

UI Automation (UIA) es un **árbol de accesibilidad**: cada ventana y control
expone un elemento (`AutomationElement`) con propiedades y "patterns"
(comportamientos). Desde la raíz del escritorio bajamos al árbol de la ventana:

```powershell
# Desde el HWND encontrado arriba
$el = [Windows.Automation.AutomationElement]::FromHandle($paint.Hwnd)

# Todos los descendientes (controles accesibles de Paint)
$all = $el.FindAll([Windows.Automation.TreeScope]::Descendants,
                   [Windows.Automation.Condition]::TrueCondition)

$all | ForEach-Object {
  [pscustomobject]@{
    Name     = $_.Current.Name
    AutoId   = $_.Current.AutomationId
    Control  = $_.Current.ControlType.ProgrammaticName
    Patterns = (($_.GetSupportedPatterns() | ForEach-Object ProgrammaticName) -join ', ')
  }
} | Format-Table -AutoSize
```

Propiedades clave de `$_.Current`:

| Propiedad | Para qué sirve |
|---|---|
| `Name` | Texto visible (ej. "Ancho:") |
| `AutomationId` | Identificador estable del control (ej. `WidthNumberBox`) |
| `ControlType` | Tipo (Button, Edit, Spinner, RadioButton...) |
| `ClassName` | Clase interna (XAML: `Microsoft.UI.Xaml.Controls.NumberBox`) |
| `FrameworkId` | `XAML`, `Win32`... |
| `IsEnabled` / `IsOffscreen` | Estado (activo / visible) |
| `BoundingRectangle` | Rectángulo en pantalla (para clics) |
| `NativeWindowHandle` | HWND asociado |

Cada elemento tiene además un **`runtimeId`**: un array de enteros que lo
identifica de forma única en el árbol. Sirve para localizarlo después sin
volver a recorrer todo (lo usa el puente del repo).

---

## 4. Leer el tamaño del lienzo

El Paint moderno expone el tamaño lógico actual del lienzo en un TextBlock con
`AutomationId = "CanvasSizeTextBlock"` (ej. `"500 × 500píxeles"`):

```powershell
$el = [Windows.Automation.AutomationElement]::FromHandle($paint.Hwnd)
$all = $el.FindAll([Windows.Automation.TreeScope]::Descendants,
                   [Windows.Automation.Condition]::TrueCondition)

$sizeBlock = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  if ($all.Item($i).Current.AutomationId -eq 'CanvasSizeTextBlock') {
    $sizeBlock = $all.Item($i)
    break
  }
}
if ($sizeBlock) {
  $text = $sizeBlock.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1)
  $text   # → "500 × 500píxeles"
}
```

> Este es el equivalente a `logicalWidth × logicalHeight` que usa el driver del
> repo (`src/paint/discovery/canvas-resolver.ts`).

---

## 5. Redimensionar el lienzo (tamaño customizado)

El diálogo "Propiedades de la imagen" **existe** en esta versión, pero NO es
una ventana top-level: es un **popup XAML dentro del árbol de la ventana**.
Por eso `EnumWindows` no lo ve. Se abre con `Ctrl+E`.

Los controles clave del popup (verificados):

| Control | AutomationId | Patterns |
|---|---|---|
| Spinner "Ancho:" | `WidthNumberBox` | `RangeValuePattern` |
| Spinner "Altura:" | `HeightNumberBox` | `RangeValuePattern` |
| Edit interno de ancho | `InputBox` (hijo del spinner) | `ValuePattern` |
| Radio "Píxeles" | — (hijos del grupo `Unidades`) | `SelectionItemPattern` |
| Botón "Aceptar" | `PrimaryButton` | `InvokePattern` |

### 5.1 Enviar Ctrl+E

El envío de teclas se hace con `SendInput` (P/Invoke de `user32.dll`):

```powershell
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Input {
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public struct INPUT { public uint type; public KEYBDINPUT ki; }
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
}
'@
```

O más simple, con el objeto COM `WScript.Shell` (WScript.Shell → AppActivate + SendKeys):

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($paint.Pid) | Out-Null
Start-Sleep -Milliseconds 300
$ws.SendKeys('^e')   # Ctrl+E → Propiedades de la imagen
Start-Sleep -Milliseconds 1500
```

> Cuidado: `AppActivate` puede fallar si la ventana está en otro monitor.
> Verifica el foco con `GetForegroundWindow` y reintenta con
> `SetForegroundWindow(hwnd)`.

### 5.2 Escribir ancho/alto con ValuePattern

Localizamos el popup por `AutomationId` y escribimos los valores en los
Edits internos (el `ValuePattern` reemplaza el texto completo):

```powershell
$all = $el.FindAll([Windows.Automation.TreeScope]::Descendants,
                   [Windows.Automation.Condition]::TrueCondition)

function Set-UiaText($element, [string]$value) {
  $vp = $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue($value)
}

$widthSpinner = $null; $heightSpinner = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $id = $all.Item($i).Current.AutomationId
  if ($id -eq 'WidthNumberBox')  { $widthSpinner  = $all.Item($i) }
  if ($id -eq 'HeightNumberBox') { $heightSpinner = $all.Item($i) }
}

# Hijo Edit (AutomationId "InputBox") de cada spinner
$widthEdit  = $widthSpinner.FindFirst([Windows.Automation.TreeScope]::Children,
              [Windows.Automation.Condition]::TrueCondition)
$heightEdit = $heightSpinner.FindFirst([Windows.Automation.TreeScope]::Children,
              [Windows.Automation.Condition]::TrueCondition)

Set-UiaText $widthEdit  '1920'
Set-UiaText $heightEdit '1080'
```

### 5.3 Asegurar la unidad "Píxeles"

Los radios del grupo "Unidades" llegan con nombre corrupto por encoding
(`P�xeles` en vez de `Píxeles`). Filtra por `ControlType = RadioButton` y
subcadena `"xeles"` tras quitar caracteres no-ASCII:

```powershell
$pixelRadio = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $name = $e.Current.Name -replace '[^\x20-\x7e]', ''
  if ($e.Current.ControlType.ProgrammaticName -like '*RadioButton*' -and
      $name -like '*xeles*') {
    $pixelRadio = $e
    break
  }
}
$pixelRadio.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
```

### 5.4 Confirmar con "Aceptar"

```powershell
for ($i = 0; $i -lt $all.Count; $i++) {
  if ($all.Item($i).Current.AutomationId -eq 'PrimaryButton') {
    $all.Item($i).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    break
  }
}
Start-Sleep -Milliseconds 1000
# Vuelve a leer CanvasSizeTextBlock → "1920 × 1080píxeles"
```

> **Bonus:** Paint recuerda el último tamaño de lienzo. Una vez fijado,
> `Ctrl+N` (nuevo documento) lo hereda.

---

## 6. Dibujar con el mouse

El dibujo real no usa UIA: va por `SetCursorPos` + eventos de botón con
`SendInput`, convirtiendo coordenadas del lienzo → cliente → pantalla.

### 6.1 Convertir coordenadas

```powershell
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Cnv {
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public struct POINT { public int X; public int Y; }
}
'@

function ConvertTo-Screen([IntPtr]$hwnd, [int]$clientX, [int]$clientY) {
  $p = New-Object Cnv+POINT
  $p.X = $clientX; $p.Y = $clientY
  [Cnv]::ClientToScreen($hwnd, [ref]$p) | Out-Null
  return [pscustomobject]@{ X = $p.X; Y = $p.Y }
}
```

### 6.2 Arrastrar (dibujar) una polilínea

```powershell
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@

function Invoke-PaintDrag {
  param([IntPtr]$Hwnd, [int[][]]$Points, [int]$StepMs = 10)

  # Punto inicial: mueve y baja el botón
  $p0 = ConvertTo-Screen $Hwnd $Points[0][0] $Points[0][1]
  [Mouse]::SetCursorPos($p0.X, $p0.Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # MOUSEEVENTF_LEFTDOWN

  for ($i = 1; $i -lt $Points.Count; $i++) {
    $p = ConvertTo-Screen $Hwnd $Points[$i][0] $Points[$i][1]
    [Mouse]::SetCursorPos($p.X, $p.Y) | Out-Null
    Start-Sleep -Milliseconds $StepMs
  }

  [Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # MOUSEEVENTF_LEFTUP
}

# Ejemplo: una "M" en un lienzo 1920×1080 (coordenadas lógicas)
Invoke-PaintDrag -Hwnd $paint.Hwnd -Points @(
  @(200, 200), @(400, 700), @(600, 300), @(800, 700), @(1000, 200)
)
```

> El driver del repo hace exactamente esto en `dragPolyline`
> (`src/infrastructure/win32/process.ts`), incluyendo pasos intermedios con
> delay configurable y la conversión lienzo→cliente según el tamaño lógico.

### 6.3 Teclado: limpiar el lienzo y deshacer

```powershell
$ws.SendKeys('^a')     # Ctrl+A → seleccionar todo
Start-Sleep -Milliseconds 150
$ws.SendKeys('{DEL}')  # Supr    → borrar
Start-Sleep -Milliseconds 300
$ws.SendKeys('^z')     # Ctrl+Z  → deshacer
```

---

## 7. Scripts completos reutilizables

Fichero `PaintAutomation.psm1` (módulo) con las funciones:

```powershell
function Get-PaintWindow {
  # …EnumWindows (sección 2)…
  return $paint
}

function Get-PaintCanvasSize {
  param([IntPtr]$Hwnd)
  # …CanvasSizeTextBlock + TextPattern (sección 4)…
}

function Set-PaintCanvasSize {
  param([IntPtr]$Hwnd, [int]$Width, [int]$Height)
  # …Ctrl+E, radio Píxeles, ValuePattern, PrimaryButton (sección 5)…
  # Devuelve el tamaño verificado leído de CanvasSizeTextBlock
}

function Invoke-PaintDrag {
  param([IntPtr]$Hwnd, [int[][]]$Points, [int]$StepMs = 10)
  # …SetCursorPos + mouse_event (sección 6)…
}
```

Flujo típico:

```powershell
$paint = Get-PaintWindow
Set-PaintCanvasSize $paint.Hwnd 1920 1080
Get-PaintCanvasSize $paint.Hwnd        # → 1920 × 1080
Invoke-PaintDrag $paint.Hwnd @(@(100,100), @(900,900))
```

---

## 8. Trampas y tips

1. **El diálogo de propiedades es un popup in-window** — no aparece en
   `EnumWindows`; escanéalo por UIA dentro del árbol de la ventana.
2. **Mojibake en nombres UIA** — los acentos (Píxeles) llegan corruptos
   (`P�xeles`). Sanea con `-replace '[^\x20-\x7e]', ''` antes de comparar.
3. **mspaint.exe es un stub UWP** — lanza por AUMID
   (`shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App`) o mata el stub.
4. **Espera las animaciones** — maximizar y abrir popups tardan; usa
   `Start-Sleep` (500–1500 ms) y relee el estado antes de seguir.
5. **Atajos de herramienta clásicos (B/P/E) ya no existen** — la selección de
   herramienta se hace clicando el ribbon (coordenadas fijas) o con el
   estado por defecto (la Brocha dibuja sin tocar el toolbar).
6. **`Ctrl+E` (propiedades) y `Ctrl+W` (redimensionar/sesgar) sí funcionan**.
7. **El ribbon se expone a profundidad ≥ 7** — `PencilTool`, `EraserTool`,
   `CropButton`, `RotateDropdown`, `BrushesSplitButton`, etc. Scanea con
   `TreeScope::Descendants` sin filtro.
8. **`Ctrl + +` / `Ctrl + -`** cambian el grosor de la brocha en pasos de 1 px.
9. **Dibujo = mouse (SendInput), no UIA** — UIA sirve para leer estado y
   operar controles; para trazos usa `SetCursorPos` + `mouse_event`.
10. **Coordenadas**: lienzo (lógicas) → cliente → pantalla. Si dibujas en
    coordenadas lógicas, multiplica por la escala real del lienzo dentro de
    la ventana (`CanvasSizeTextBlock` te da la medida lógica).
