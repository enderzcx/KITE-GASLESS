param(
  [string]$Port = "",
  [string]$TokenFile = "",
  [switch]$NoRun
)

$ErrorActionPreference = "Stop"

$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $backendDir "..")

function Resolve-TokenFile {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $false)][string]$ExplicitFile
  )

  $candidates = @()
  if ($ExplicitFile) {
    $explicitPath = $ExplicitFile
    if (-not [System.IO.Path]::IsPathRooted($explicitPath)) {
      $explicitPath = Join-Path $RepoRoot $explicitPath
    }
    if (-not (Test-Path -Path $explicitPath -PathType Leaf)) {
      throw "Token file not found: $explicitPath"
    }
    return (Resolve-Path $explicitPath)
  }

  $preferFiles = @("重要信息.md", "IMPORTANT.md", "IMPORTANT_INFO.md")
  foreach ($name in $preferFiles) {
    $filePath = Join-Path $RepoRoot $name
    if (Test-Path -Path $filePath -PathType Leaf) {
      $candidates += (Resolve-Path $filePath)
    }
  }

  $mdCandidates = Get-ChildItem -Path $RepoRoot -Filter "*.md" -File -ErrorAction Stop
  foreach ($md in $mdCandidates) {
    $resolved = Resolve-Path $md.FullName
    if ($candidates -contains $resolved) { continue }
    $candidates += $resolved
  }

  foreach ($file in $candidates) {
    try {
      $matched = Select-String -Path $file -Pattern "^\s*OPENNEWS_TOKEN/TWITTER_TOKEN\s*=" -Quiet -ErrorAction Stop
      if ($matched) {
        return $file
      }
    }
    catch {
      continue
    }
  }
  return $null
}

function Read-SharedToken {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )
  $match = Select-String -Path $FilePath -Pattern "^\s*OPENNEWS_TOKEN/TWITTER_TOKEN\s*=\s*(.+)\s*$" | Select-Object -Last 1
  if (-not $match) {
    throw "OPENNEWS_TOKEN/TWITTER_TOKEN not found in $FilePath"
  }
  $token = $match.Matches[0].Groups[1].Value.Trim()
  if (-not $token) {
    throw "OPENNEWS_TOKEN/TWITTER_TOKEN is empty in $FilePath"
  }
  return $token
}

$infoFile = Resolve-TokenFile -RepoRoot $repoRoot -ExplicitFile $TokenFile
$token = ""
if ($infoFile) {
  $token = Read-SharedToken -FilePath $infoFile
}

if (-not $token) {
  $token = String($env:OPENNEWS_TOKEN).Trim()
}
if (-not $token) {
  $token = String($env:TWITTER_TOKEN).Trim()
}
if (-not $token) {
  throw "No token available. Please set OPENNEWS_TOKEN/TWITTER_TOKEN in env or add OPENNEWS_TOKEN/TWITTER_TOKEN=... to a markdown file in $repoRoot"
}

if ($Port) {
  $env:PORT = String($Port).Trim()
}
elseif (-not $env:PORT) {
  $env:PORT = "3399"
}

if (-not $env:KITECLAW_AUTH_DISABLED) {
  $env:KITECLAW_AUTH_DISABLED = "1"
}

$env:OPENNEWS_TOKEN = $token
$env:TWITTER_TOKEN = $token
if (-not $env:OPENNEWS_API_BASE) { $env:OPENNEWS_API_BASE = "https://ai.6551.io" }
if (-not $env:TWITTER_API_BASE) { $env:TWITTER_API_BASE = "https://ai.6551.io" }

Set-Location $backendDir

Write-Host "[start-backend-one] backend=$backendDir port=$($env:PORT) authDisabled=$($env:KITECLAW_AUTH_DISABLED)"
if ($infoFile) {
  Write-Host "[start-backend-one] OPENNEWS_TOKEN/TWITTER_TOKEN loaded from $([System.IO.Path]::GetFileName($infoFile))"
}
else {
  Write-Host "[start-backend-one] OPENNEWS_TOKEN/TWITTER_TOKEN loaded from environment variables"
}
Write-Host "[start-backend-one] OPENNEWS_API_BASE=$($env:OPENNEWS_API_BASE) TWITTER_API_BASE=$($env:TWITTER_API_BASE)"

if ($NoRun) {
  Write-Host "[start-backend-one] dry run only, skip npm start"
  exit 0
}

npm.cmd start
