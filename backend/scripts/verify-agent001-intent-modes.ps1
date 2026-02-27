param(
  [string]$BaseUrl = "http://127.0.0.1:3399",
  [int]$StartupTimeoutSec = 120,
  [switch]$SkipStart,
  [switch]$KeepServer
)

$ErrorActionPreference = "Stop"

$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $backendDir

$job = $null
try {
  if (-not $SkipStart) {
    $job = Start-Job -ScriptBlock {
      param($dir)
      Set-Location $dir
      npm run start:one
    } -ArgumentList $backendDir

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 1000
      try {
        $auth = Invoke-RestMethod "$BaseUrl/api/auth/info" -TimeoutSec 3
        if ($auth.ok) {
          $ready = $true
          break
        }
      }
      catch {
        # keep waiting
      }
    }
    if (-not $ready) {
      throw "backend_start_timeout: $BaseUrl/api/auth/info not ready in ${StartupTimeoutSec}s"
    }
  }

  node .\scripts\verify-agent001-intent-modes.mjs --base-url "$BaseUrl"
  if ($LASTEXITCODE -ne 0) {
    throw "verify-agent001-intent-modes failed with code $LASTEXITCODE"
  }
}
finally {
  if ($job -and -not $KeepServer) {
    try {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
      Receive-Job -Job $job -ErrorAction SilentlyContinue | Select-Object -Last 40
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    catch {
      # ignore cleanup errors
    }
  }
}
