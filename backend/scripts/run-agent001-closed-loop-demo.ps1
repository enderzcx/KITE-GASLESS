param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$AdminApiKey = "",
  [string]$AgentApiKey = "",
  [string]$ViewerApiKey = "",
  [string]$Message = "基于消息面和技术面给我 BTCUSDT 60m 挂单计划并自动执行"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonPost {
  param(
    [string]$Url,
    [hashtable]$Headers,
    [hashtable]$Body
  )
  return Invoke-RestMethod -Method Post -Uri $Url -Headers $Headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 20)
}

Write-Host "==> Start XMTP runtimes"
if ($AdminApiKey) {
  $start = Invoke-JsonPost -Url "$BaseUrl/api/xmtp/start" -Headers @{ "x-api-key" = $AdminApiKey } -Body @{}
  $start | ConvertTo-Json -Depth 8
}
else {
  Write-Host "Skip /api/xmtp/start (missing AdminApiKey)"
}

Write-Host "==> DM AGENT001"
$chatHeaders = @{}
if ($AgentApiKey) { $chatHeaders["x-api-key"] = $AgentApiKey }
$chat = Invoke-JsonPost -Url "$BaseUrl/api/agent001/chat/run" -Headers $chatHeaders -Body @{
  text = $Message
  autoStart = $true
}
$chat | ConvertTo-Json -Depth 20

Write-Host "==> Check x402 requests"
$viewerHeaders = @{}
if ($ViewerApiKey) { $viewerHeaders["x-api-key"] = $ViewerApiKey }
$requests = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/x402/requests?limit=20" -Headers $viewerHeaders
$requests | ConvertTo-Json -Depth 12

Write-Host "==> Check Hyperliquid open orders"
$orders = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/hyperliquid/testnet/open-orders?symbol=BTCUSDT" -Headers $viewerHeaders
$orders | ConvertTo-Json -Depth 12
