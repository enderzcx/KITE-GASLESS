param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$AdminApiKey = "",
  [string]$AgentApiKey = "",
  [string]$ViewerApiKey = "",
  [string]$Capability = "risk-score-feed",
  [string]$GroupLabel = "workers-group",
  [int]$WaitMs = 12000,
  [switch]$BindRealX402
)

$ErrorActionPreference = "Stop"

function New-Headers([string]$apiKey) {
  $headers = @{
    "Content-Type" = "application/json"
  }
  if ($apiKey) {
    $headers["x-api-key"] = $apiKey
  }
  return $headers
}

function Call-Api([string]$Method, [string]$Path, [hashtable]$Headers, $Body = $null) {
  $uri = "$BaseUrl$Path"
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 10
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers
}

$viewerKey = if ($ViewerApiKey) { $ViewerApiKey } else { $AgentApiKey }

Write-Host "[1/4] starting XMTP runtimes..."
$start = Call-Api -Method "POST" -Path "/api/xmtp/start" -Headers (New-Headers $AdminApiKey) -Body @{}

Write-Host "[2/4] ensuring workers group..."
$ensureBody = @{
  autoStart = $true
  label = $GroupLabel
}
$group = Call-Api -Method "POST" -Path "/api/xmtp/groups/ensure" -Headers (New-Headers $AdminApiKey) -Body $ensureBody

Write-Host "[3/4] running router -> risk group flow..."
$runBody = @{
  autoStart = $true
  capability = $Capability
  groupLabel = $GroupLabel
  waitMs = $WaitMs
  bindRealX402 = [bool]$BindRealX402
}
$run = Call-Api -Method "POST" -Path "/api/network/demo/router-risk-group/run" -Headers (New-Headers $AgentApiKey) -Body $runBody

$taskId = [string]$run.task.taskId
$traceId = [string]$run.task.traceId
$requestId = [string]$run.task.requestId

Write-Host "[4/4] querying phase + result evidence..."
$events = Call-Api -Method "GET" -Path "/api/xmtp/events?taskId=$taskId&limit=40" -Headers (New-Headers $viewerKey)

$summary = [ordered]@{
  ok = $true
  runtimeStarted = $start.xmtp
  group = $group.group
  task = $run.task
  resultReceived = [bool]$run.resultReceived
  taskResult = $run.taskResult
  payment = $run.payment
  receiptRef = $run.receiptRef
  paymentBinding = $run.paymentBinding
  warnings = $run.warnings
  phaseMessages = $run.xmtp.phaseMessages
  traceId = $traceId
  requestId = $requestId
  taskId = $taskId
  eventCount = $events.total
}

Write-Host ""
Write-Host "=== Router -> Risk Group Demo Summary ==="
$summary | ConvertTo-Json -Depth 10
Write-Host ""
Write-Host "=== Latest Events ==="
$events.items | Select-Object -First 12 | ConvertTo-Json -Depth 10
