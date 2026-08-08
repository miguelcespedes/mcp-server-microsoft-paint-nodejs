# Tutorial: driving Microsoft Paint with PowerShell

Target Paint version: **11.2605.71.0 (Windows 11, modern UWP app)**.
Environment: PowerShell 5.1 (the one shipped with Windows), nothing to
install.

This tutorial teaches, with tested scripts, the three operations that matter:
locating the window, reading/resizing the canvas, and drawing with the mouse.
All the knowledge comes from the real automation documented in
`scripts/paint-uia-bridge.ps1` and `src/infrastructure/win32/` of this
repository.

---

## Table of contents

1. [Requirements and launching Paint](#1-requirements-and-launching-paint)
2. [Locating the Paint window](#2-locating-the-paint-window)
3. [Windows Automation in 5 minutes](#3-windows-automation-in-5-minutes)
4. [Reading the canvas size](#4-reading-the-canvas-size)
5. [Resizing the canvas (custom size)](#5-resizing-the-canvas-custom-size)
6. [Drawing with the mouse](#6-drawing-with-the-mouse)
7. [Reusable complete scripts](#7-reusable-complete-scripts)
8. [Pitfalls and tips](#8-pitfalls-and-tips)

---

## 1. Requirements and launching Paint

Nothing to install: PowerShell 5.1 and .NET Framework 4.8 already ship the
UI Automation assemblies in the GAC (`UIAutomationClient.dll`,
`UIAutomationTypes.dll`). You just load them:

```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
```

### Launching Paint

On Windows 11 `mspaint.exe` is a **UWP stub**: it can stay alive without
creating a window. The robust way to start the modern app is by its AUMID:

```powershell
$AUMID = 'shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App'
Start-Process $AUMID
```

### Foreground attention

Before any automation, maximize and bring the window to the front; UWP
maximize animations take hundreds of ms to recompute the layout:

```powershell
Start-Sleep -Milliseconds 1500
```

---

## 2. Locating the Paint window

To find the window we use `EnumWindows` + `IsWindowVisible` +
`GetWindowText` (P/Invoke). The **`MSPaintApp`** window class identifies
Paint reliably and regardless of language.

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

# Paint windows (MSPaintApp class or title containing "Paint")
$paint = $windows | Where-Object { $_.Pid -eq (Get-Process mspaint -ErrorAction SilentlyContinue).Id } |
  Select-Object -First 1
$paint
```

> Note: the UWP app also creates several hidden secondary windows titled
> "Untitled - Default" (popup hosts). Filter them by class or by
> `IsWindowVisible` + the main window.

---

## 3. Windows Automation in 5 minutes

UI Automation (UIA) is an **accessibility tree**: every window and control
exposes an element (`AutomationElement`) with properties and "patterns"
(behaviors). From the desktop root we descend into the window's tree:

```powershell
# From the HWND found above
$el = [Windows.Automation.AutomationElement]::FromHandle($paint.Hwnd)

# All descendants (Paint's accessible controls)
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

Key properties of `$_.Current`:

| Property | Purpose |
|---|---|
| `Name` | Visible text (e.g. "Width:") |
| `AutomationId` | Stable control identifier (e.g. `WidthNumberBox`) |
| `ControlType` | Type (Button, Edit, Spinner, RadioButton...) |
| `ClassName` | Internal class (XAML: `Microsoft.UI.Xaml.Controls.NumberBox`) |
| `FrameworkId` | `XAML`, `Win32`... |
| `IsEnabled` / `IsOffscreen` | State (enabled / visible) |
| `BoundingRectangle` | On-screen rectangle (for clicks) |
| `NativeWindowHandle` | Associated HWND |

Each element also has a **`runtimeId`**: an array of integers that uniquely
identifies it in the tree. It is used to relocate it later without rescanning
(the repo's bridge uses it).

---

## 4. Reading the canvas size

Modern Paint exposes the current logical canvas size in a TextBlock with
`AutomationId = "CanvasSizeTextBlock"` (e.g. `"500 × 500píxeles"`):

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

> This is the equivalent of the `logicalWidth × logicalHeight` used by the
> repo's driver (`src/paint/discovery/canvas-resolver.ts`).

---

## 5. Resizing the canvas (custom size)

The "Image Properties" dialog **does exist** in this version, but it is NOT
a top-level window: it is an **XAML popup inside the window's tree**. That
is why `EnumWindows` cannot see it. It opens with `Ctrl+E`.

The popup's key controls (verified):

| Control | AutomationId | Patterns |
|---|---|---|
| "Width:" spinner | `WidthNumberBox` | `RangeValuePattern` |
| "Height:" spinner | `HeightNumberBox` | `RangeValuePattern` |
| Internal width edit | `InputBox` (child of the spinner) | `ValuePattern` |
| "Pixels" radio | — (children of the `Units` group) | `SelectionItemPattern` |
| "OK" button | `PrimaryButton` | `InvokePattern` |

### 5.1 Sending Ctrl+E

Key presses are sent with `SendInput` (P/Invoke of `user32.dll`):

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

Or simpler, with the COM object `WScript.Shell` (WScript.Shell → AppActivate + SendKeys):

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate($paint.Pid) | Out-Null
Start-Sleep -Milliseconds 300
$ws.SendKeys('^e')   # Ctrl+E → Image Properties
Start-Sleep -Milliseconds 1500
```

> Caution: `AppActivate` can fail if the window is on another monitor.
> Verify focus with `GetForegroundWindow` and retry with
> `SetForegroundWindow(hwnd)`.

### 5.2 Writing width/height with ValuePattern

We locate the popup by `AutomationId` and write the values into the internal
Edits (`ValuePattern` replaces the entire text):

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

# Edit child (AutomationId "InputBox") of each spinner
$widthEdit  = $widthSpinner.FindFirst([Windows.Automation.TreeScope]::Children,
              [Windows.Automation.Condition]::TrueCondition)
$heightEdit = $heightSpinner.FindFirst([Windows.Automation.TreeScope]::Children,
              [Windows.Automation.Condition]::TrueCondition)

Set-UiaText $widthEdit  '1920'
Set-UiaText $heightEdit '1080'
```

### 5.3 Ensuring the "Pixels" unit

The radios of the "Units" group arrive with a mojibake name due to encoding
(`P�xeles` instead of `Píxeles`). Filter by `ControlType = RadioButton` and
substring `"xeles"` after stripping non-ASCII characters:

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

### 5.4 Confirming with "OK"

```powershell
for ($i = 0; $i -lt $all.Count; $i++) {
  if ($all.Item($i).Current.AutomationId -eq 'PrimaryButton') {
    $all.Item($i).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    break
  }
}
Start-Sleep -Milliseconds 1000
# Re-read CanvasSizeTextBlock → "1920 × 1080píxeles"
```

> **Bonus:** Paint remembers the last canvas size. Once set, `Ctrl+N` (new
> document) inherits it.

---

## 6. Drawing with the mouse

Real drawing does not use UIA: it goes through `SendInput` (absolute
position + button events), converting canvas → client → screen coordinates.

### 6.1 Converting coordinates

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

### 6.2 Dragging (drawing) a polyline

The repo's driver injects the **entire gesture through `SendInput`**: initial
absolute position, button down, absolute moves and button up (`dragPolyline`
in `src/infrastructure/win32/process.ts`). Mixing `SetCursorPos` with
`SendInput` breaks the stroke in modern Paint (the mouse-down is not synced
with the position), so here we use `SendInput` for everything:

```powershell
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern uint GetSystemMetrics(int nIndex);
  public struct INPUT { public uint type; public MOUSEINPUT mi; }
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
}
'@
$MOUSEEVENTF_MOVE       = 0x0001
$MOUSEEVENTF_LEFTDOWN   = 0x0002
$MOUSEEVENTF_LEFTUP     = 0x0004
$MOUSEEVENTF_ABSOLUTE   = 0x8000

function Move-MouseAbsolute([int]$x, [int]$y) {
  $w = [Mouse]::GetSystemMetrics(0); $h = [Mouse]::GetSystemMetrics(1)
  $in = New-Object Mouse+INPUT
  $in.type = 0  # INPUT_MOUSE
  $in.mi = New-Object Mouse+MOUSEINPUT
  $in.mi.dx = [int](($x * 65535) / ($w - 1))
  $in.mi.dy = [int](($y * 65535) / ($h - 1))
  $in.mi.dwFlags = $MOUSEEVENTF_MOVE -bor $MOUSEEVENTF_ABSOLUTE
  [Mouse]::SendInput(1, @($in), [System.Runtime.InteropServices.Marshal]::SizeOf([type][Mouse+INPUT])) | Out-Null
}
function Invoke-PaintDrag {
  param([IntPtr]$Hwnd, [int[][]]$Points, [int]$StepMs = 10)
  $p0 = ConvertTo-Screen $Hwnd $Points[0][0] $Points[0][1]
  Move-MouseAbsolute $p0.X $p0.Y
  Start-Sleep -Milliseconds 60
  # Button down (SendInput)
  $down = New-Object Mouse+INPUT; $down.type = 0
  $down.mi = New-Object Mouse+MOUSEINPUT
  $down.mi.dwFlags = $MOUSEEVENTF_LEFTDOWN
  [Mouse]::SendInput(1, @($down), [System.Runtime.InteropServices.Marshal]::SizeOf([type][Mouse+INPUT])) | Out-Null
  Start-Sleep -Milliseconds 90
  for ($i = 1; $i -lt $Points.Count; $i++) {
    $p = ConvertTo-Screen $Hwnd $Points[$i][0] $Points[$i][1]
    Move-MouseAbsolute $p.X $p.Y
    Start-Sleep -Milliseconds $StepMs
  }
  $up = New-Object Mouse+INPUT; $up.type = 0
  $up.mi = New-Object Mouse+MOUSEINPUT
  $up.mi.dwFlags = $MOUSEEVENTF_LEFTUP
  [Mouse]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf([type][Mouse+INPUT])) | Out-Null
}

# Example: an "M" on a 1920×1080 canvas (logical coordinates)
Invoke-PaintDrag -Hwnd $paint.Hwnd -Points @(
  @(200, 200), @(400, 700), @(600, 300), @(800, 700), @(1000, 200)
)
```

> The repo's driver does exactly this in `dragPolyline`
> (`src/infrastructure/win32/process.ts`), including intermediate steps with
> configurable delay, 60/90 ms dwells before the stroke, and the
> canvas→client conversion based on the logical size.

### 6.3 Keyboard: clearing the canvas and undoing

```powershell
$ws.SendKeys('^a')     # Ctrl+A → select all
Start-Sleep -Milliseconds 150
$ws.SendKeys('{DEL}')  # Del    → delete
Start-Sleep -Milliseconds 300
$ws.SendKeys('^z')     # Ctrl+Z → undo
```

---

## 7. Reusable complete scripts

File `PaintAutomation.psm1` (module) with the functions:

```powershell
function Get-PaintWindow {
  # …EnumWindows (section 2)…
  return $paint
}

function Get-PaintCanvasSize {
  param([IntPtr]$Hwnd)
  # …CanvasSizeTextBlock + TextPattern (section 4)…
}

function Set-PaintCanvasSize {
  param([IntPtr]$Hwnd, [int]$Width, [int]$Height)
  # …Ctrl+E, Pixels radio, ValuePattern, PrimaryButton (section 5)…
  # Returns the verified size read from CanvasSizeTextBlock
}

function Invoke-PaintDrag {
  param([IntPtr]$Hwnd, [int[][]]$Points, [int]$StepMs = 10)
  # …SendInput: absolute position + LEFTDOWN/LEFTUP (section 6)…
}
```

Typical flow:

```powershell
$paint = Get-PaintWindow
Set-PaintCanvasSize $paint.Hwnd 1920 1080
Get-PaintCanvasSize $paint.Hwnd        # → 1920 × 1080
Invoke-PaintDrag $paint.Hwnd @(@(100,100), @(900,900))
```

---

## 8. Pitfalls and tips

1. **The properties dialog is an in-window popup** — it does not appear in
   `EnumWindows`; scan it with UIA inside the window's tree.
2. **Mojibake in UIA names** — accents (Píxeles) arrive corrupted
   (`P�xeles`). Sanitize with `-replace '[^\x20-\x7e]', ''` before comparing.
3. **mspaint.exe is a UWP stub** — launch by AUMID
   (`shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App`) or kill the stub.
4. **Wait for animations** — maximizing and opening popups take time; use
   `Start-Sleep` (500–1500 ms) and re-read state before continuing.
5. **Classic tool shortcuts (B/P/E) as a bare key no longer exist** — but
   **ribbon KeyTips do work**: press and release `Alt`, wait ~250 ms, then
   the letter (e.g. `B` for the Brush, which lives in a split-button whose
   UIA InvokePattern only opens the flyout). The repo's driver uses them
   (`pressKeyTip` in `src/infrastructure/win32/process.ts`), and they are
   independent of language and window position.
6. **`Ctrl+E` (properties) and `Ctrl+W` (resize/skew) do work**.
7. **The ribbon is exposed at depth ≥ 7** — `PencilTool`, `EraserTool`,
   `CropButton`, `RotateDropdown`, `BrushesSplitButton`, etc. Scan with
   `TreeScope::Descendants` without filtering.
8. **`Ctrl + +` / `Ctrl + -`** change the brush thickness in 1 px steps.
9. **Drawing = mouse (SendInput), not UIA** — UIA is for reading state and
   operating controls; for strokes use `SendInput` with absolute position
   and button events (the whole gesture through the same mechanism).
10. **Coordinates**: canvas (logical) → client → screen. If you draw in
    logical coordinates, multiply by the canvas's actual scale inside the
    window (`CanvasSizeTextBlock` gives you the logical measure).
