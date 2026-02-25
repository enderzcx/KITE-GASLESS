param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$AdminApiKey = "",
  [string]$AgentApiKey = "",
  [string]$ViewerApiKey = ""
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
    $json = $Body | ConvertTo-Json -Depth 12
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers
}

function New-TaskId([string]$prefix) {
  return "{0}_{1}" -f $prefix, ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
}

$viewerKey = if ($ViewerApiKey) { $ViewerApiKey } else { $AgentApiKey }

Write-Host "[1/4] starting XMTP runtimes..."
$start = Call-Api -Method "POST" -Path "/api/xmtp/start" -Headers (New-Headers $AdminApiKey) -Body @{}

$tasks = @(
  @{
    name = "price-agent"
    body = @{
      autoStart = $true
      toAgentId = "price-agent"
      capability = "btc-price-feed"
      taskId = (New-TaskId "price")
      input = @{
        pair = "BTCUSDT"
        source = "hyperliquid"
      }
    }
  },
  @{
    name = "reader-agent"
    body = @{
      autoStart = $true
      toAgentId = "reader-agent"
      capability = "x-reader-feed"
      taskId = (New-TaskId "reader")
      input = @{
        url = "https://x.com/Kite_AI"
        mode = "auto"
        maxChars = 800
      }
    }
  },
  @{
    name = "executor-agent"
    body = @{
      autoStart = $true
      toAgentId = "executor-agent"
      capability = "execute-plan"
      taskId = (New-TaskId "executor")
      input = @{
        symbol = "BTCUSDT"
        source = "hyperliquid"
        horizonMin = 60
        includeQuote = $true
        includeRisk = $true
        includeReader = $true
        url = "https://x.com/Kite_AI"
      }
    }
  }
)

Write-Host "[2/4] dispatching tasks to worker runtimes..."
$dispatch = @()
foreach ($t in $tasks) {
  $resp = Call-Api -Method "POST" -Path "/api/network/tasks/run" -Headers (New-Headers $AgentApiKey) -Body $t.body
  $dispatch += @{
    name = $t.name
    task = $resp.task
    xmtp = $resp.xmtp
  }
}

Write-Host "[3/4] waiting for task-result events..."
Start-Sleep -Seconds 6

Write-Host "[4/4] collecting task-result evidence..."
$results = @()
foreach ($row in $dispatch) {
  $taskId = [string]$row.task.taskId
  $events = Call-Api -Method "GET" -Path "/api/xmtp/events?kind=task-result&taskId=$taskId&limit=5" -Headers (New-Headers $viewerKey)
  $latest = $null
  if ($events.total -gt 0) {
    $latest = $events.items | Select-Object -First 1
  }
  $results += @{
    name = $row.name
    taskId = $taskId
    traceId = [string]$row.task.traceId
    requestId = [string]$row.task.requestId
    resultCount = $events.total
    latest = $latest
  }
}

$summary = [ordered]@{
  ok = $true
  runtimeStarted = $start.xmtp
  dispatched = $dispatch
  results = $results
}

Write-Host ""
Write-Host "=== XMTP Workers Capability Demo ==="
$summary | ConvertTo-Json -Depth 12
