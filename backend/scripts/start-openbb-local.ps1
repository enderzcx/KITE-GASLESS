param(
  [int]$Port = 6900,
  [string]$ContainerName = 'kite-openbb-local',
  [string]$ImageName = 'kite-openbb:latest',
  [string]$ProxyUrl = '',
  [string]$NoProxy = '',
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

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

function Convert-ProxyForContainer {
  param([string]$Url)
  $raw = [string]$Url
  if (-not $raw) { return '' }
  if ($raw -match '://127\.0\.0\.1(?::|/|$)') {
    return $raw -replace '://127\.0\.0\.1', '://host.docker.internal'
  }
  if ($raw -match '://localhost(?::|/|$)') {
    return $raw -replace '://localhost', '://host.docker.internal'
  }
  return $raw
}

$scriptDir = Split-Path -Parent $PSCommandPath
$backendDir = Split-Path -Parent $scriptDir
$dockerfile = Join-Path $backendDir 'docker\openbb\Dockerfile'
$dockerContext = Split-Path -Parent $dockerfile
$stateDir = Join-Path $backendDir 'data\openbb-platform'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

$envMap = Load-EnvMap (Join-Path $backendDir '.env')
if (-not $ProxyUrl -and $envMap.ContainsKey('OPENALICE_PROXY_URL')) {
  $ProxyUrl = [string]$envMap['OPENALICE_PROXY_URL']
}
if (-not $NoProxy -and $envMap.ContainsKey('OPENALICE_NO_PROXY')) {
  $NoProxy = [string]$envMap['OPENALICE_NO_PROXY']
}
if (-not $NoProxy) {
  $NoProxy = '127.0.0.1,localhost,host.docker.internal'
}

$containerProxy = Convert-ProxyForContainer $ProxyUrl
if ($containerProxy) {
  Write-Host "OpenBB proxy: $containerProxy"
} else {
  Write-Host 'OpenBB proxy: none'
}

$dockerOk = $false
try {
  docker info --format "{{.ServerVersion}}" | Out-Null
  if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch {}
if (-not $dockerOk) {
  throw 'Docker daemon is not running. Please start Docker Desktop first.'
}

$needsBuild = $false
if ($Rebuild) {
  $needsBuild = $true
} else {
  $imageExists = $false
  $imageList = docker images --format "{{.Repository}}:{{.Tag}}"
  foreach ($item in $imageList) {
    if ([string]$item -eq $ImageName) {
      $imageExists = $true
      break
    }
  }
  if (-not $imageExists) { $needsBuild = $true }
}

if ($needsBuild) {
  if (-not (Test-Path $dockerfile)) {
    throw "OpenBB Dockerfile not found: $dockerfile"
  }
  $buildArgs = @('build', '-f', $dockerfile, '-t', $ImageName)
  if ($containerProxy) {
    $buildArgs += @('--build-arg', "HTTP_PROXY=$containerProxy")
    $buildArgs += @('--build-arg', "HTTPS_PROXY=$containerProxy")
    $buildArgs += @('--build-arg', "ALL_PROXY=$containerProxy")
  }
  if ($NoProxy) {
    $buildArgs += @('--build-arg', "NO_PROXY=$NoProxy")
  }
  $buildArgs += $dockerContext
  Write-Host "Building image $ImageName ..."
  & docker @buildArgs
  if ($LASTEXITCODE -ne 0) { throw "Failed to build image $ImageName" }
}

$exists = (docker ps -a --filter "name=^/${ContainerName}$" --format "{{.Names}}")
if ($exists) {
  docker rm -f $ContainerName | Out-Null
}

$runArgs = @(
  'run', '-d',
  '--name', $ContainerName,
  '--restart', 'unless-stopped',
  '-p', "${Port}:6900",
  '-v', "${stateDir}:/root/.openbb_platform"
)
if ($containerProxy) {
  $runArgs += @('-e', "HTTP_PROXY=$containerProxy")
  $runArgs += @('-e', "HTTPS_PROXY=$containerProxy")
  $runArgs += @('-e', "ALL_PROXY=$containerProxy")
}
if ($NoProxy) {
  $runArgs += @('-e', "NO_PROXY=$NoProxy")
}
$runArgs += $ImageName

Write-Host "Starting OpenBB container: $ContainerName ..."
& docker @runArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to start container $ContainerName" }

$ready = $false
for ($i = 0; $i -lt 120; $i += 1) {
  try {
    $null = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/openapi.json" -TimeoutSec 3
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) {
  Write-Host "OpenBB start timeout. Check logs with: docker logs $ContainerName"
  exit 1
}

Write-Host "OpenBB is up on http://127.0.0.1:$Port"
