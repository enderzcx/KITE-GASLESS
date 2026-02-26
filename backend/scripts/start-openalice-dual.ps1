param(
  [string]$MessageDir = 'G:\KKK\services\openalice-message',
  [string]$TechnicalDir = 'G:\KKK\services\openalice-technical',
  [int]$MessagePort = 3212,
  [int]$TechnicalPort = 3312,
  [string]$ProxyUrl = '',
  [string]$NoProxy = ''
)

$ErrorActionPreference = 'Stop'

function Load-EnvMap {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content -Path $Path) {
    $raw = [string]$line
    if (-not $raw) { continue }
    if ($raw.TrimStart().StartsWith('#')) { continue }
    if ($raw -notmatch '=') { continue }
    $idx = $raw.IndexOf('=')
    if ($idx -lt 1) { continue }
    $k = $raw.Substring(0, $idx).Trim()
    $v = $raw.Substring($idx + 1).Trim()
    if (-not $k) { continue }
    $map[$k] = $v
  }
  return $map
}

function Escape-PsSingleQuoted {
  param([string]$Value)
  return ([string]$Value).Replace("'", "''")
}

function Start-AgentProcess {
  param(
    [string]$Name,
    [string]$Dir,
    [int]$Port,
    [string]$LogDir,
    [string]$StateDir,
    [string]$Proxy,
    [string]$NoProxyValue
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
  $escapedDir = Escape-PsSingleQuoted $Dir
  $cmdParts = @()
  $cmdParts += "cd '$escapedDir'"
  if ($Proxy) {
    $escapedProxy = Escape-PsSingleQuoted $Proxy
    $cmdParts += "`$env:HTTP_PROXY='$escapedProxy'"
    $cmdParts += "`$env:HTTPS_PROXY='$escapedProxy'"
    $cmdParts += "`$env:ALL_PROXY='$escapedProxy'"
    if ($NoProxyValue) {
      $escapedNoProxy = Escape-PsSingleQuoted $NoProxyValue
      $cmdParts += "`$env:NO_PROXY='$escapedNoProxy'"
    }
  }
  $cmdParts += "pnpm dev"
  $cmd = ($cmdParts -join '; ')
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

$envFile = Join-Path $backendDir '.env'
$envMap = Load-EnvMap $envFile
if (-not $ProxyUrl -and $envMap.ContainsKey('OPENALICE_PROXY_URL')) {
  $ProxyUrl = [string]$envMap['OPENALICE_PROXY_URL']
}
if (-not $NoProxy -and $envMap.ContainsKey('OPENALICE_NO_PROXY')) {
  $NoProxy = [string]$envMap['OPENALICE_NO_PROXY']
}
if (-not $NoProxy) {
  $NoProxy = '127.0.0.1,localhost'
}
if ($ProxyUrl) {
  Write-Host "Using proxy for OpenAlice runtimes: $ProxyUrl"
} else {
  Write-Host 'No proxy configured. If external model APIs timeout, set OPENALICE_PROXY_URL in backend/.env.'
}

Start-AgentProcess -Name 'message' -Dir $MessageDir -Port $MessagePort -LogDir $logDir -StateDir $stateDir -Proxy $ProxyUrl -NoProxyValue $NoProxy
Start-AgentProcess -Name 'technical' -Dir $TechnicalDir -Port $TechnicalPort -LogDir $logDir -StateDir $stateDir -Proxy $ProxyUrl -NoProxyValue $NoProxy

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
