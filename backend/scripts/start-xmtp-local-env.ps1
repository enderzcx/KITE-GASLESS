param(
  [string]$XmtpdRoot = "",
  [string]$Profile = "single",
  [switch]$StartNode
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

$profileNormalized = ($Profile ?? "").Trim().ToLowerInvariant()
if ($profileNormalized -ne "single" -and $profileNormalized -ne "dual") {
  throw "Profile must be single or dual."
}

Push-Location $XmtpdRoot
try {
  & bash ./dev/up $profileNormalized
  if ($LASTEXITCODE -ne 0) {
    throw "dev/up failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if ($StartNode) {
  $nodeProc = Start-Process -FilePath $bash.Source -ArgumentList "./dev/run" -WorkingDirectory $XmtpdRoot -PassThru
  $pidFile = Join-Path $repoRoot "backend\data\xmtp_local_node.pid"
  Set-Content -Path $pidFile -Value $nodeProc.Id -Encoding UTF8
  Write-Output "xmtpd node started, pid=$($nodeProc.Id), pidFile=$pidFile"
} else {
  Write-Output "local dependencies started. Run 'bash ./dev/run' in $XmtpdRoot to start the node."
}
