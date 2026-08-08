<#
.SYNOPSIS
    Captura una región de la pantalla y reporta si contiene tinta (píxeles no blancos).
.DESCRIPTION
    Sonda de un solo uso invocada por el servidor MCP tras un paint_draw para
    verificar, a nivel de píxel, que algo cambió realmente en pantalla. No es
    un servidor persistente (a diferencia de paint-uia-bridge.ps1): se lanza,
    imprime un único JSON por stdout y termina.
.PARAMETER X
    Coordenada X (pantalla, física) de la esquina superior izquierda de la región.
.PARAMETER Y
    Coordenada Y (pantalla, física) de la esquina superior izquierda de la región.
.PARAMETER Width
    Ancho de la región a capturar.
.PARAMETER Height
    Alto de la región a capturar.
.PARAMETER OutPath
    Ruta donde guardar el PNG capturado (opcional; si se omite no se persiste).
.EXAMPLE
    powershell -File paint-screenshot.ps1 -X 140 -Y 40 -Width 928 -Height 920
#>

param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function Write-JsonResult {
    param($Object)
    $Object | ConvertTo-Json -Compress | Write-Output
}

try {
    if ($Width -le 0 -or $Height -le 0) {
        throw "Width y Height deben ser positivos."
    }

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($Width, $Height)))
    $graphics.Dispose()

    # Muestrea una rejilla (no cada píxel, para mantenerlo rápido) buscando
    # cualquier píxel que se aparte notablemente de blanco puro, lo que
    # indicaría que algo se dibujó sobre el lienzo en blanco de Paint.
    $stepX = [Math]::Max(1, [Math]::Floor($Width / 200))
    $stepY = [Math]::Max(1, [Math]::Floor($Height / 200))
    $sampled = 0
    $nonWhite = 0
    $whiteThreshold = 245

    for ($py = 0; $py -lt $Height; $py += $stepY) {
        for ($px = 0; $px -lt $Width; $px += $stepX) {
            $pixel = $bitmap.GetPixel($px, $py)
            $sampled += 1
            if ($pixel.R -lt $whiteThreshold -or $pixel.G -lt $whiteThreshold -or $pixel.B -lt $whiteThreshold) {
                $nonWhite += 1
            }
        }
    }

    if ($OutPath) {
        $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bitmap.Dispose()

    $ratio = if ($sampled -gt 0) { $nonWhite / $sampled } else { 0 }

    Write-JsonResult @{
        ok           = $true
        hasInk       = ($nonWhite -gt 0)
        sampledCount = $sampled
        nonWhiteCount = $nonWhite
        nonWhiteRatio = [Math]::Round($ratio, 4)
        outPath      = $OutPath
    }
} catch {
    Write-JsonResult @{
        ok    = $false
        error = $_.Exception.Message
    }
    exit 1
}
