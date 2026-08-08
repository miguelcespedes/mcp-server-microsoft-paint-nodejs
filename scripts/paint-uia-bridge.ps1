<#
.SYNOPSIS
    UI Automation bridge for Microsoft Paint (persistent JSONL server mode).
.DESCRIPTION
    Provides inventory, invoke, and set-value operations against Paint's UIA tree.
    Can run as a one-shot CLI or as a persistent server reading JSONL from stdin.
.PARAMETER Server
    Run as persistent server. Reads commands from stdin (one JSON per line), writes responses to stdout.
.PARAMETER Action
    One-shot action: inventory, invoke, set-value.
.PARAMETER PayloadBase64
    Base64-encoded JSON payload for one-shot mode.
.EXAMPLE
    # One-shot
    powershell -File paint-uia-bridge.ps1 -Action inventory -PayloadBase64 "eyJ3aW5kb3dIYW5kbGVIZXgiOiIweDAwMDAwMDAwMDAwZDE3NDYifQ=="
.EXAMPLE
    # Persistent server
    powershell -File paint-uia-bridge.ps1 -Server
#>

param(
    [switch]$Server,
    [ValidateSet('inventory', 'invoke', 'set-value')]
    [string]$Action,
    [string]$PayloadBase64
)

if (-not $Server) {
    if (-not $Action -or -not $PayloadBase64) {
        Write-Error "Action and PayloadBase64 are required in one-shot mode"
        exit 1
    }
}

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$legacyPatternType = $null
try {
    $legacyPatternType = [type]'Windows.Automation.LegacyIAccessiblePattern'
} catch {
    $legacyPatternType = $null
}

function ConvertFrom-Base64Json {
    param([string]$Value)
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
    return $json | ConvertFrom-Json
}

function ConvertTo-NormalizedControlType {
    param($ControlType)
    if ($null -eq $ControlType) { return $null }
    $programmaticName = $ControlType.ProgrammaticName
    if ([string]::IsNullOrWhiteSpace($programmaticName)) { return $null }
    return $programmaticName.Replace('ControlType.', '')
}

function Get-PaintRootElement {
    param($Payload)
    $root = [Windows.Automation.AutomationElement]::RootElement
    $children = $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
    $processId = if ($null -ne $Payload.processId) { [int]$Payload.processId } else { $null }
    $className = if ($null -ne $Payload.className) { [string]$Payload.className } else { '' }
    $windowTitle = if ($null -ne $Payload.windowTitle) { [string]$Payload.windowTitle } else { '' }

    $candidates = @()
    for ($i = 0; $i -lt $children.Count; $i += 1) {
        $element = $children.Item($i)
        $current = $element.Current
        if ($processId -ne $null -and $current.ProcessId -eq $processId) {
            $candidates += $element; continue
        }
        if (-not [string]::IsNullOrWhiteSpace($className) -and $current.ClassName -eq $className) {
            $candidates += $element; continue
        }
        if (-not [string]::IsNullOrWhiteSpace($windowTitle) -and $current.Name -eq $windowTitle) {
            $candidates += $element; continue
        }
    }
    if ($candidates.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($className)) {
        for ($i = 0; $i -lt $children.Count; $i += 1) {
            $element = $children.Item($i)
            if ($element.Current.ClassName -eq $className) { $candidates += $element }
        }
    }
    if ($candidates.Count -eq 0) {
        throw 'UI Automation could not locate the Paint root element among desktop children.'
    }
    if ($candidates.Count -eq 1) { return $candidates[0] }
    foreach ($candidate in $candidates) {
        if (-not [bool]$candidate.Current.IsOffscreen) { return $candidate }
    }
    return $candidates[0]
}

function Get-SupportedPatterns {
    param($Element)
    $supported = New-Object System.Collections.Generic.List[string]
    try { $patterns = @($Element.GetSupportedPatterns()) } catch { return @($supported) }
    foreach ($pattern in $patterns) {
        if ($null -eq $pattern) { continue }
        $programmaticName = $pattern.ProgrammaticName
        if ([string]::IsNullOrWhiteSpace($programmaticName)) { continue }
        $normalized = $programmaticName.Replace('Identifiers.Pattern: ', '')
        if (-not [string]::IsNullOrWhiteSpace($normalized)) { $supported.Add($normalized) }
    }
    return @($supported)
}

function ConvertTo-RectangleObject {
    param($Rect, [bool]$Include)
    if (-not $Include) { return $null }
    $values = @($Rect.Left, $Rect.Top, $Rect.Width, $Rect.Height)
    foreach ($value in $values) {
        if ([double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) { return $null }
        if ($value -lt -2147483648 -or $value -gt 2147483647) { return $null }
    }
    return [pscustomobject]@{
        left = [int][math]::Round($Rect.Left)
        top = [int][math]::Round($Rect.Top)
        width = [int][math]::Round($Rect.Width)
        height = [int][math]::Round($Rect.Height)
    }
}

function Get-ElementRecord {
    param(
        [Windows.Automation.AutomationElement]$Element,
        [string]$Id,
        [string]$ParentId,
        [int]$Depth,
        [bool]$IncludeBoundingRectangles
    )
    $current = $Element.Current
    $runtimeId = @()
    try { $runtimeId = @($Element.GetRuntimeId()) } catch { $runtimeId = @() }
    return [pscustomobject]@{
        id = $Id
        parentId = $ParentId
        depth = $Depth
        runtimeId = $runtimeId
        name = $current.Name
        automationId = $current.AutomationId
        controlType = ConvertTo-NormalizedControlType $current.ControlType
        className = $current.ClassName
        frameworkId = $current.FrameworkId
        enabled = [bool]$current.IsEnabled
        visible = -not [bool]$current.IsOffscreen
        nativeWindowHandle = ('0x{0:X16}' -f [uint64]$current.NativeWindowHandle)
        boundingRectangle = ConvertTo-RectangleObject $current.BoundingRectangle $IncludeBoundingRectangles
        supportedPatterns = Get-SupportedPatterns $Element
    }
}

function Build-Inventory {
    param(
        [Windows.Automation.AutomationElement]$Root,
        [int]$MaxDepth,
        [bool]$IncludeBoundingRectangles
    )
    $results = New-Object System.Collections.Generic.List[object]
    $queue = New-Object System.Collections.Queue
    $nextId = 1
    $queue.Enqueue([pscustomobject]@{ Element = $Root; ParentId = $null; Depth = 0 })
    while ($queue.Count -gt 0) {
        $frame = $queue.Dequeue()
        $id = "uia-$nextId"
        $nextId += 1
        $results.Add((Get-ElementRecord -Element $frame.Element -Id $id -ParentId $frame.ParentId -Depth $frame.Depth -IncludeBoundingRectangles $IncludeBoundingRectangles))
        if ($frame.Depth -ge $MaxDepth) { continue }
        try {
            $children = $frame.Element.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
            for ($i = 0; $i -lt $children.Count; $i += 1) {
                $queue.Enqueue([pscustomobject]@{ Element = $children.Item($i); ParentId = $id; Depth = $frame.Depth + 1 })
            }
        } catch { continue }
    }
    return $results.ToArray()
}

function Get-DesktopChildrenInventory {
    param(
        [int]$MaxDepth,
        [bool]$IncludeBoundingRectangles
    )
    $desktopRoot = [Windows.Automation.AutomationElement]::RootElement
    $children = $desktopRoot.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
    $results = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $children.Count; $i += 1) {
        $element = $children.Item($i)
        $id = "desktop-$i"
        $results.Add((Get-ElementRecord -Element $element -Id $id -ParentId $null -Depth 0 -IncludeBoundingRectangles $IncludeBoundingRectangles))
        if ($MaxDepth -le 0) { continue }
        try {
            $nested = Build-Inventory -Root $element -MaxDepth ($MaxDepth - 1) -IncludeBoundingRectangles $IncludeBoundingRectangles
            foreach ($item in $nested) {
                if ($item.id -ne 'uia-1') { $results.Add($item) }
            }
        } catch { }
    }
    return $results.ToArray()
}

function Find-ElementByRuntimeId {
    param(
        [Windows.Automation.AutomationElement]$Root,
        [int[]]$TargetRuntimeId
    )
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        $element = $queue.Dequeue()
        try {
            $runtimeId = @($element.GetRuntimeId())
            if ($runtimeId.Count -eq $TargetRuntimeId.Count) {
                $matched = $true
                for ($i = 0; $i -lt $runtimeId.Count; $i += 1) {
                    if ([int]$runtimeId[$i] -ne [int]$TargetRuntimeId[$i]) { $matched = $false; break }
                }
                if ($matched) { return $element }
            }
        } catch { }
        try {
            $children = $element.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
            for ($i = 0; $i -lt $children.Count; $i += 1) { $queue.Enqueue($children.Item($i)) }
        } catch { continue }
    }
    return $null
}

function Invoke-Element {
    param([Windows.Automation.AutomationElement]$Element)
    try {
        $invokePattern = [Windows.Automation.InvokePattern]$Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
        if ($null -ne $invokePattern) { $invokePattern.Invoke(); return 'Invoke' }
    } catch { }
    try {
        $selectionItemPattern = [Windows.Automation.SelectionItemPattern]$Element.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
        if ($null -ne $selectionItemPattern) { $selectionItemPattern.Select(); return 'SelectionItem' }
    } catch { }
    if ($null -ne $legacyPatternType) {
        try {
            $legacyPattern = $Element.GetCurrentPattern($legacyPatternType::Pattern)
            if ($null -ne $legacyPattern) { $legacyPattern.DoDefaultAction(); return 'LegacyIAccessible' }
        } catch { }
    }
    throw 'No supported automation pattern available to invoke the target element.'
}

function Set-ElementValue {
    param(
        [Windows.Automation.AutomationElement]$Element,
        [string]$Value
    )
    try {
        $valuePattern = [Windows.Automation.ValuePattern]$Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) { $valuePattern.SetValue($Value); return 'Value' }
    } catch { }
    try {
        $rangePattern = [Windows.Automation.RangeValuePattern]$Element.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern)
        if ($null -ne $rangePattern) {
            $doubleValue = [double]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture)
            $rangePattern.SetValue($doubleValue); return 'RangeValue'
        }
    } catch { }
    try {
        $descendants = $Element.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        for ($i = 0; $i -lt $descendants.Count; $i += 1) {
            try {
                $child = $descendants.Item($i)
                $childPattern = [Windows.Automation.ValuePattern]$child.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
                if ($null -ne $childPattern) { $childPattern.SetValue($Value); return 'ValueDescendant' }
            } catch { }
        }
    } catch { }
    throw 'No set-value automation pattern available for the target element.'
}

function Process-Command {
    param([pscustomobject]$Command)
    try {
        $payload = $Command.payload
        $root = Get-PaintRootElement $payload
        if ($null -eq $root) { throw 'UI Automation could not create a root element from the supplied HWND.' }

        switch ($Command.action) {
            'inventory' {
                $maxDepth = if ($null -ne $payload.maxDepth) { [int]$payload.maxDepth } else { 6 }
                $includeBounds = if ($null -ne $payload.includeBoundingRectangles) { [bool]$payload.includeBoundingRectangles } else { $false }
                $scope = if ($null -ne $payload.scope) { [string]$payload.scope } else { 'window' }
                if ($scope -eq 'desktop-children') {
                    $elements = Get-DesktopChildrenInventory -MaxDepth $maxDepth -IncludeBoundingRectangles $includeBounds
                } else {
                    $elements = Build-Inventory -Root $root -MaxDepth $maxDepth -IncludeBoundingRectangles $includeBounds
                }
                return [pscustomobject]@{
                    success = $true
                    id = $Command.id
                    root = (Get-ElementRecord -Element $root -Id 'uia-0' -ParentId $null -Depth 0 -IncludeBoundingRectangles $includeBounds)
                    elements = $elements
                }
            }
            'invoke' {
                $target = Find-ElementByRuntimeId -Root $root -TargetRuntimeId @($payload.runtimeId)
                if ($null -eq $target) { throw 'Target automation element was not found in the current Paint UI tree.' }
                $pattern = Invoke-Element -Element $target
                return [pscustomobject]@{
                    success = $true
                    id = $Command.id
                    pattern = $pattern
                }
            }
            'set-value' {
                $target = Find-ElementByRuntimeId -Root $root -TargetRuntimeId @($payload.runtimeId)
                if ($null -eq $target) { throw 'Target automation element was not found in the current Paint UI tree.' }
                $pattern = Set-ElementValue -Element $target -Value ([string]$payload.value)
                return [pscustomobject]@{
                    success = $true
                    id = $Command.id
                    pattern = $pattern
                }
            }
            default { throw "Unsupported action '$($Command.action)'." }
        }
    } catch {
        return [pscustomobject]@{
            success = $false
            id = $Command.id
            error = if ($_.Exception -ne $null) { $_.Exception.Message } else { $_.ToString() }
            errorType = if ($_.Exception -ne $null) { $_.Exception.GetType().FullName } else { $null }
            scriptStackTrace = $_.ScriptStackTrace
            positionMessage = $_.InvocationInfo.PositionMessage
        }
    }
}

if ($Server) {
    # Persistent server mode: read JSONL from stdin, write JSONL to stdout
    $stdin = [Console]::In
    $stdout = [Console]::Out
    while ($true) {
        $line = $stdin.ReadLine()
        if ($null -eq $line) { break }  # EOF
        $line = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $cmd = $line | ConvertFrom-Json
            $result = Process-Command -Command $cmd
            $stdout.WriteLine(($result | ConvertTo-Json -Depth 100 -Compress))
        } catch {
            $err = [pscustomobject]@{
                success = $false
                id = $null
                error = $_.Exception.Message
            }
            $stdout.WriteLine(($err | ConvertTo-Json -Compress))
        }
    }
    exit 0
}

# One-shot mode (legacy compatibility)
try {
    $payload = ConvertFrom-Base64Json $PayloadBase64
    $command = [pscustomobject]@{
        id = 'oneshot'
        action = $Action
        payload = $payload
    }
    $result = Process-Command -Command $command
    $result | ConvertTo-Json -Depth 100 -Compress
    exit 0
} catch {
    $errorResponse = [pscustomobject]@{
        success = $false
        error = if ($_.Exception -ne $null) { $_.Exception.Message } else { $_.ToString() }
        errorType = if ($_.Exception -ne $null) { $_.Exception.GetType().FullName } else { $null }
        scriptStackTrace = $_.ScriptStackTrace
        positionMessage = $_.InvocationInfo.PositionMessage
    }
    $errorResponse | ConvertTo-Json -Depth 20 -Compress
    exit 1
}