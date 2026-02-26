param(
  [int]$MessagePort = 3212,
  [int]$TechnicalPort = 3312
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$backendDir = Split-Path -Parent $scriptDir
$stateDir = Join-Path $backendDir 'data\openalice-runtime'

function Stop-ByPidFile {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path $Path)) { return }
  $pidText = Get-Content -Path $Path -ErrorAction SilentlyContinue | Select-Object -First 1
  $pidValue = 0
  if (-not [int]::TryParse([string]$pidText, [ref]$pidValue)) {
    Remove-Item -Path $Path -Force -ErrorAction SilentlyContinue
    return
  }
  try {
    Stop-Process -Id $pidValue -Force -ErrorAction Stop
    Write-Host "[$Name] stopped PID=$pidValue (pid file)."
  } catch {
    Write-Host "[$Name] pid file PID=$pidValue not running or no permission."
  }
  Remove-Item -Path $Path -Force -ErrorAction SilentlyContinue
}

Stop-ByPidFile -Path (Join-Path $stateDir 'message.pid') -Name 'message'
Stop-ByPidFile -Path (Join-Path $stateDir 'technical.pid') -Name 'technical'

foreach ($pair in @(@('message', $MessagePort), @('technical', $TechnicalPort))) {
  $name = $pair[0]
  $port = [int]$pair[1]
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    try {
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
      Write-Host "[$name] stopped PID=$($conn.OwningProcess) (port $port)."
    } catch {
      Write-Host "[$name] failed to stop PID=$($conn.OwningProcess) on port $port."
    }
  } else {
    Write-Host "[$name] no listener on port $port."
  }
}

