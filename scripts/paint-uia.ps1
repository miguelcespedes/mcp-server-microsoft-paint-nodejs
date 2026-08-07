param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inventory', 'invoke')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$PayloadBase64
)

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

  if ($null -eq $ControlType) {
    return $null
  }

  $programmaticName = $ControlType.ProgrammaticName
  if ([string]::IsNullOrWhiteSpace($programmaticName)) {
    return $null
  }

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
      $candidates += $element
      continue
    }

    if (-not [string]::IsNullOrWhiteSpace($className) -and $current.ClassName -eq $className) {
      $candidates += $element
      continue
    }

    if (-not [string]::IsNullOrWhiteSpace($windowTitle) -and $current.Name -eq $windowTitle) {
      $candidates += $element
      continue
    }
  }

  if ($candidates.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($className)) {
    for ($i = 0; $i -lt $children.Count; $i += 1) {
      $element = $children.Item($i)
      if ($element.Current.ClassName -eq $className) {
        $candidates += $element
      }
    }
  }

  if ($candidates.Count -eq 0) {
    throw 'UI Automation could not locate the Paint root element among desktop children.'
  }

  if ($candidates.Count -eq 1) {
    return $candidates[0]
  }

  foreach ($candidate in $candidates) {
    if (-not [bool]$candidate.Current.IsOffscreen) {
      return $candidate
    }
  }

  return $candidates[0]
}

function Get-SupportedPatterns {
  param($Element)

  $supported = New-Object System.Collections.Generic.List[string]
  $patterns = @()

  try {
    $patterns = @($Element.GetSupportedPatterns())
  } catch {
    return @($supported)
  }

  foreach ($pattern in $patterns) {
    if ($null -eq $pattern) {
      continue
    }

    $programmaticName = $pattern.ProgrammaticName
    if ([string]::IsNullOrWhiteSpace($programmaticName)) {
      continue
    }

    $normalized = $programmaticName.Replace('Identifiers.Pattern: ', '')
    if (-not [string]::IsNullOrWhiteSpace($normalized)) {
      $supported.Add($normalized)
    }
  }

  return @($supported)
}

function ConvertTo-RectangleObject {
  param($Rect, [bool]$Include)

  if (-not $Include) {
    return $null
  }

  $values = @($Rect.Left, $Rect.Top, $Rect.Width, $Rect.Height)
  foreach ($value in $values) {
    if ([double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) {
      return $null
    }
    if ($value -lt -2147483648 -or $value -gt 2147483647) {
      return $null
    }
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

  try {
    $runtimeId = @($Element.GetRuntimeId())
  } catch {
    $runtimeId = @()
  }

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

    if ($frame.Depth -ge $MaxDepth) {
      continue
    }

    try {
      $children = $frame.Element.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
      for ($i = 0; $i -lt $children.Count; $i += 1) {
        $queue.Enqueue([pscustomobject]@{ Element = $children.Item($i); ParentId = $id; Depth = $frame.Depth + 1 })
      }
    } catch {
      continue
    }
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

    if ($MaxDepth -le 0) {
      continue
    }

    try {
      $nested = Build-Inventory -Root $element -MaxDepth ($MaxDepth - 1) -IncludeBoundingRectangles $IncludeBoundingRectangles
      foreach ($item in $nested) {
        if ($item.id -ne 'uia-1') {
          $results.Add($item)
        }
      }
    } catch {
    }
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
          if ([int]$runtimeId[$i] -ne [int]$TargetRuntimeId[$i]) {
            $matched = $false
            break
          }
        }

        if ($matched) {
          return $element
        }
      }
    } catch {
    }

    try {
      $children = $element.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
      for ($i = 0; $i -lt $children.Count; $i += 1) {
        $queue.Enqueue($children.Item($i))
      }
    } catch {
      continue
    }
  }

  return $null
}

function Invoke-Element {
  param([Windows.Automation.AutomationElement]$Element)

  try {
    $invokePattern = [Windows.Automation.InvokePattern]$Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $invokePattern) {
      $invokePattern.Invoke()
      return 'Invoke'
    }
  } catch {
  }

  try {
    $selectionItemPattern = [Windows.Automation.SelectionItemPattern]$Element.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
    if ($null -ne $selectionItemPattern) {
      $selectionItemPattern.Select()
      return 'SelectionItem'
    }
  } catch {
  }

  if ($null -ne $legacyPatternType) {
    try {
      $legacyPattern = $Element.GetCurrentPattern($legacyPatternType::Pattern)
      if ($null -ne $legacyPattern) {
        $legacyPattern.DoDefaultAction()
        return 'LegacyIAccessible'
      }
    } catch {
    }
  }

  throw 'No supported automation pattern available to invoke the target element.'
}

try {
  $payload = ConvertFrom-Base64Json $PayloadBase64
  $root = Get-PaintRootElement $payload

  if ($null -eq $root) {
    throw 'UI Automation could not create a root element from the supplied HWND.'
  }

  if ($Action -eq 'inventory') {
    $maxDepth = if ($null -ne $payload.maxDepth) { [int]$payload.maxDepth } else { 6 }
    $includeBounds = if ($null -ne $payload.includeBoundingRectangles) { [bool]$payload.includeBoundingRectangles } else { $false }
    $scope = if ($null -ne $payload.scope) { [string]$payload.scope } else { 'window' }
    if ($scope -eq 'desktop-children') {
      $elements = Get-DesktopChildrenInventory -MaxDepth $maxDepth -IncludeBoundingRectangles $includeBounds
    } else {
      $elements = Build-Inventory -Root $root -MaxDepth $maxDepth -IncludeBoundingRectangles $includeBounds
    }

    $response = [pscustomobject]@{
      success = $true
      root = (Get-ElementRecord -Element $root -Id 'uia-0' -ParentId $null -Depth 0 -IncludeBoundingRectangles $includeBounds)
      elements = $elements
    }

    $response | ConvertTo-Json -Depth 100 -Compress
    exit 0
  }

  if ($Action -eq 'invoke') {
    $target = Find-ElementByRuntimeId -Root $root -TargetRuntimeId @($payload.runtimeId)
    if ($null -eq $target) {
      throw 'Target automation element was not found in the current Paint UI tree.'
    }

    $pattern = Invoke-Element -Element $target
    $response = [pscustomobject]@{
      success = $true
      pattern = $pattern
    }

    $response | ConvertTo-Json -Depth 50 -Compress
    exit 0
  }

  throw "Unsupported action '$Action'."
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
