param(
  [string]$BaseUrl = "http://localhost:3001",
  [string]$Payer = "",
  [switch]$UseRuntime = $true,
  [string]$SourceAgentId = "1",
  [string]$TargetAgentId = "2",
  [Parameter(Mandatory=$true)][string]$Symbol,
  [Parameter(Mandatory=$true)][double]$TakeProfit,
  [Parameter(Mandatory=$true)][double]$StopLoss,
  [Parameter(Mandatory=$true)][string]$RequestId,
  [Parameter(Mandatory=$true)][string]$TxHash,
  [Parameter(Mandatory=$true)][string]$TokenAddress,
  [Parameter(Mandatory=$true)][string]$Recipient,
  [Parameter(Mandatory=$true)][string]$Amount
)

function Resolve-Payer {
  param(
    [string]$BaseUrl,
    [string]$Payer,
    [bool]$UseRuntime
  )
  if ($Payer) { return $Payer }
  if (-not $UseRuntime) {
    throw "Missing payer. Provide -Payer or enable -UseRuntime."
  }

  $runtime = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/session/runtime/secret"
  if (-not $runtime.ok -or -not $runtime.runtime -or -not $runtime.runtime.aaWallet) {
    throw "Runtime session not ready. Generate session and sync runtime first."
  }
  return [string]$runtime.runtime.aaWallet
}

$resolvedPayer = Resolve-Payer -BaseUrl $BaseUrl -Payer $Payer -UseRuntime $UseRuntime

$payload = @{
  payer = $resolvedPayer
  sourceAgentId = $SourceAgentId
  targetAgentId = $TargetAgentId
  task = @{
    symbol = $Symbol
    takeProfit = $TakeProfit
    stopLoss = $StopLoss
  }
  requestId = $RequestId
  paymentProof = @{
    requestId = $RequestId
    txHash = $TxHash
    payer = $resolvedPayer
    tokenAddress = $TokenAddress
    recipient = $Recipient
    amount = $Amount
  }
}

try {
  $res = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/skill/openclaw/invoke" -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8) -ErrorAction Stop
  [pscustomobject]@{
    statusCode = [int]$res.StatusCode
    body = ($res.Content | ConvertFrom-Json)
  }
} catch {
  $status = 0
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $status = [int]$_.Exception.Response.StatusCode.value__
  }
  $raw = $_.ErrorDetails.Message
  if (-not $raw -and $_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $raw = $reader.ReadToEnd()
    $reader.Close()
  }
  $body = $null
  if ($raw) {
    try { $body = $raw | ConvertFrom-Json } catch { $body = $raw }
  }

  [pscustomobject]@{
    statusCode = $status
    body = $body
  }
}
