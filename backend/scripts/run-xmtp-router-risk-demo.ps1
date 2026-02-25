param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$AdminApiKey = "",
  [string]$AgentApiKey = "",
  [string]$ViewerApiKey = "",
  [string]$Capability = "risk-score-feed",
  [int]$WaitMs = 10000
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

Write-Host "[1/3] starting XMTP runtimes..."
$start = Call-Api -Method "POST" -Path "/api/xmtp/start" -Headers (New-Headers $AdminApiKey) -Body @{}

Write-Host "[2/3] sending router -> risk demo task..."
$runBody = @{
  autoStart = $true
  capability = $Capability
  waitMs = $WaitMs
}
$run = Call-Api -Method "POST" -Path "/api/network/demo/router-risk/run" -Headers (New-Headers $AgentApiKey) -Body $runBody

$taskId = [string]$run.task.taskId
$traceId = [string]$run.task.traceId
$requestId = [string]$run.task.requestId

Write-Host "[3/3] querying XMTP evidence..."
$events = Call-Api -Method "GET" -Path "/api/xmtp/events?taskId=$taskId&limit=30" -Headers (New-Headers $viewerKey)

$summary = [ordered]@{
  ok = $true
  runtimeStarted = $start.xmtp
  task = $run.task
  resultReceived = [bool]$run.resultReceived
  resultStatus = [string]$run.taskResult.status
  taskResult = $run.taskResult
  payment = $run.payment
  receiptRef = $run.receiptRef
  ackReceived = [bool]$run.ackReceived
  traceId = $traceId
  requestId = $requestId
  taskId = $taskId
  eventCount = $events.total
}

Write-Host ""
Write-Host "=== Router -> Risk Demo Summary ==="
$summary | ConvertTo-Json -Depth 8
Write-Host ""
Write-Host "=== Latest Events ==="
$events.items | Select-Object -First 8 | ConvertTo-Json -Depth 8
