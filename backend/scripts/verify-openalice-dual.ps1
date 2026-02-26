param(
  [string]$BackendUrl = 'http://localhost:3001',
  [int]$MessagePort = 3212,
  [int]$TechnicalPort = 3312
)

$ErrorActionPreference = 'Stop'

function Check-Url {
  param([string]$Url)
  try {
    $resp = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 8
    return @{ ok = $true; data = $resp }
  } catch {
    return @{ ok = $false; reason = $_.Exception.Message }
  }
}

$scriptDir = Split-Path -Parent $PSCommandPath
$backendDir = Split-Path -Parent $scriptDir
$envPath = Join-Path $backendDir '.env'

$viewerKey = ''
if (Test-Path $envPath) {
  $line = Get-Content -Path $envPath | Where-Object { $_ -match '^KITECLAW_API_KEY_VIEWER=' } | Select-Object -First 1
  if ($line -match '^KITECLAW_API_KEY_VIEWER=(.*)$') {
    $viewerKey = $Matches[1].Trim()
  }
}

$messageCheck = Check-Url -Url ("http://127.0.0.1:{0}/api/chat/history?limit=1" -f $MessagePort)
$technicalCheck = Check-Url -Url ("http://127.0.0.1:{0}/api/chat/history?limit=1" -f $TechnicalPort)

$backendResult = $null
if ($viewerKey) {
  try {
    $headers = @{ 'x-api-key' = $viewerKey }
    $backendResult = Invoke-RestMethod -Uri "$BackendUrl/api/openalice/health" -Method Get -Headers $headers
  } catch {
    $backendResult = @{ ok = $false; reason = $_.Exception.Message }
  }
} else {
  $backendResult = @{ ok = $false; reason = 'KITECLAW_API_KEY_VIEWER missing in backend/.env' }
}

[PSCustomObject]@{
  message = $messageCheck
  technical = $technicalCheck
  backend = $backendResult
} | ConvertTo-Json -Depth 12
