param(
  [string]$XmtpdRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $XmtpdRoot) {
  $XmtpdRoot = Join-Path $repoRoot "xmtpd-1.1.1"
}

if (-not (Test-Path $XmtpdRoot)) {
  throw "xmtpd directory not found: $XmtpdRoot"
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
  throw "bash not found. Please install Git Bash or WSL bash."
}

$pidFile = Join-Path $repoRoot "backend\data\xmtp_local_node.pid"
if (Test-Path $pidFile) {
  $pidText = (Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $nodePid = 0
  if ([int]::TryParse(($pidText ?? "").Trim(), [ref]$nodePid) -and $nodePid -gt 0) {
    $proc = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $nodePid -Force
      Write-Output "stopped xmtpd node process pid=$nodePid"
    }
  }
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

Push-Location $XmtpdRoot
try {
  & bash ./dev/down
  if ($LASTEXITCODE -ne 0) {
    throw "dev/down failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output "xmtpd local dependencies stopped."
