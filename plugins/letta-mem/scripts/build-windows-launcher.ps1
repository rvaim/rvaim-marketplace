[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$compilerCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1

if (-not $compiler) {
  throw 'Windows .NET Framework C# compiler was not found.'
}

function Build-GuiLauncher {
  param(
    [Parameter(Mandatory = $true)]
    [string] $SourceName,
    [Parameter(Mandatory = $true)]
    [string] $OutputName
  )

  $sourcePath = Join-Path $PSScriptRoot $SourceName
  $outputPath = Join-Path $pluginRoot "bin\$OutputName.exe"
  $sourceHashPath = Join-Path $pluginRoot "bin\$OutputName.source.sha256"

  & $compiler `
    /nologo `
    /target:winexe `
    /platform:anycpu `
    /optimize+ `
    /warnaserror+ `
    "/out:$outputPath" `
    $sourcePath
  if ($LASTEXITCODE -ne 0) {
    throw "Windows launcher build failed with exit code $LASTEXITCODE."
  }

  $bytes = [System.IO.File]::ReadAllBytes($outputPath)
  if ($bytes.Length -lt 256 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
    throw 'Windows launcher is not a valid PE file.'
  }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  $optionalHeaderOffset = $peOffset + 24
  $subsystem = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset + 68)
  if ($subsystem -ne 2) {
    throw "Windows launcher is not a GUI subsystem executable: subsystem=$subsystem"
  }

  $sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sourceHash = [BitConverter]::ToString($sha256.ComputeHash($sourceBytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  [System.IO.File]::WriteAllText(
    $sourceHashPath,
    "$sourceHash`n",
    [System.Text.Encoding]::ASCII
  )

  Write-Output "Windows launcher generated: $outputPath"
}

Build-GuiLauncher `
  -SourceName 'windows-launcher.cs' `
  -OutputName 'letta-mem-launcher'
Build-GuiLauncher `
  -SourceName 'windows-hook-launcher.cs' `
  -OutputName 'letta-mem-hook-launcher'
