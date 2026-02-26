param(
  [string]$MessageDir = 'G:\KKK\services\openalice-message',
  [string]$TechnicalDir = 'G:\KKK\services\openalice-technical',
  [int]$MessagePort = 3212,
  [int]$TechnicalPort = 3312
)

$ErrorActionPreference = 'Stop'

function Start-AgentProcess {
  param(
    [string]$Name,
    [string]$Dir,
    [int]$Port,
    [string]$LogDir,
    [string]$StateDir
  )

  if (-not (Test-Path $Dir)) {
    throw "$Name directory not found: $Dir"
  }

  $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) {
    Write-Host "[$Name] already listening on $Port (PID=$($existing.OwningProcess))."
    Set-Content -Path (Join-Path $StateDir "$Name.pid") -Value "$($existing.OwningProcess)" -Encoding UTF8
    return
  }

  $stdout = Join-Path $LogDir "$Name.out.log"
  $stderr = Join-Path $LogDir "$Name.err.log"
  $cmd = "cd '$Dir'; pnpm dev"
  $proc = Start-Process -FilePath powershell -ArgumentList '-NoProfile', '-Command', $cmd -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Set-Content -Path (Join-Path $StateDir "$Name.pid") -Value "$($proc.Id)" -Encoding UTF8
  Write-Host "[$Name] started PID=$($proc.Id), waiting for port $Port ..."
}

$scriptDir = Split-Path -Parent $PSCommandPath
$backendDir = Split-Path -Parent $scriptDir
$logDir = Join-Path $backendDir 'logs\openalice'
$stateDir = Join-Path $backendDir 'data\openalice-runtime'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

Start-AgentProcess -Name 'message' -Dir $MessageDir -Port $MessagePort -LogDir $logDir -StateDir $stateDir
Start-AgentProcess -Name 'technical' -Dir $TechnicalDir -Port $TechnicalPort -LogDir $logDir -StateDir $stateDir

for ($i = 0; $i -lt 30; $i += 1) {
  $m = Get-NetTCPConnection -LocalPort $MessagePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $t = Get-NetTCPConnection -LocalPort $TechnicalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m -and $t) {
    Write-Host "OpenAlice dual runtimes are up: message=$MessagePort, technical=$TechnicalPort"
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Host "OpenAlice start timeout. Check logs:"
Write-Host "  $logDir\\message.out.log"
Write-Host "  $logDir\\message.err.log"
Write-Host "  $logDir\\technical.out.log"
Write-Host "  $logDir\\technical.err.log"
exit 1

