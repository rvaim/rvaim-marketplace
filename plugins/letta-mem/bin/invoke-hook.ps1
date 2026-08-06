param(
  [switch] $NoHostStdin,
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $LauncherArguments
)

$ErrorActionPreference = "Stop"
$exitCode = 1
$process = $null
$inputBuffer = $null
$stdoutTask = $null
$stderrTask = $null

function Get-SyntheticSessionInput {
  param(
    [string[]] $Arguments
  )

  if ($Arguments -notcontains "prepare-session-worker") {
    return [System.Text.Encoding]::UTF8.GetBytes("{}")
  }

  $sessionId = $env:CODEX_THREAD_ID
  if ([string]::IsNullOrWhiteSpace($sessionId)) {
    return $null
  }

  $payload = [ordered]@{
    session_id = $sessionId
    cwd = (Get-Location).Path
    hook_event_name = "SessionStart"
    source = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOOK_SOURCE)) {
      "startup"
    } else {
      $env:CODEX_HOOK_SOURCE
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_TRANSCRIPT_PATH)) {
    $payload.transcript_path = $env:CODEX_TRANSCRIPT_PATH
  }

  $json = $payload | ConvertTo-Json -Compress
  return [System.Text.Encoding]::UTF8.GetBytes($json)
}

try {
  $launcher = Join-Path $PSScriptRoot "letta-mem-hook-launcher.exe"
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Windows Hook launcher is missing: $launcher"
  }

  $inputBuffer = [System.IO.MemoryStream]::new()
  if ($NoHostStdin) {
    $syntheticInput = Get-SyntheticSessionInput -Arguments $LauncherArguments
    if ($null -eq $syntheticInput) {
      [Console]::OpenStandardInput().CopyTo($inputBuffer)
    } else {
      $inputBuffer.Write($syntheticInput, 0, $syntheticInput.Length)
    }
  } else {
    [Console]::OpenStandardInput().CopyTo($inputBuffer)
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $launcher
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in $LauncherArguments) {
    [void] $startInfo.ArgumentList.Add($argument)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Windows Hook launcher could not be started"
  }

  $input = $inputBuffer.ToArray()
  if ($input.Length -gt 0) {
    $process.StandardInput.BaseStream.Write($input, 0, $input.Length)
  }
  $process.StandardInput.Close()

  $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync(
    [Console]::OpenStandardOutput()
  )
  $stderrTask = $process.StandardError.BaseStream.CopyToAsync(
    [Console]::OpenStandardError()
  )
  $process.WaitForExit()
  [void] $stdoutTask.GetAwaiter().GetResult()
  [void] $stderrTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
} catch {
  [Console]::Error.WriteLine("Letta memory Hook runner failed: {0}" -f $_.Exception.Message)
} finally {
  if ($null -ne $process) {
    $process.Dispose()
  }
  if ($null -ne $inputBuffer) {
    $inputBuffer.Dispose()
  }
}

exit $exitCode
