param(
  [string]$BaseUrl = "http://localhost:3001",
  [string]$Payer = "",
  [switch]$UseRuntime = $true,
  [string]$SourceAgentId = "1",
  [string]$TargetAgentId = "2",
  [Parameter(Mandatory=$true)][string]$Symbol,
  [Parameter(Mandatory=$true)][double]$TakeProfit,
  [Parameter(Mandatory=$true)][double]$StopLoss,
  [string]$TxHash = ""
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$challenge = & "$scriptDir/request-challenge.ps1" `
  -BaseUrl $BaseUrl `
  -Payer $Payer `
  -UseRuntime:$UseRuntime `
  -SourceAgentId $SourceAgentId `
  -TargetAgentId $TargetAgentId `
  -Symbol $Symbol `
  -TakeProfit $TakeProfit `
  -StopLoss $StopLoss

if (-not $challenge) {
  throw "Failed to get challenge result."
}

if ([int]$challenge.statusCode -ne 402) {
  return [pscustomobject]@{
    step = "challenge"
    status = "unexpected"
    statusCode = $challenge.statusCode
    body = $challenge.body
  }
}

$requestId = [string]$challenge.body.x402.requestId
$accept = $challenge.body.x402.accepts[0]

$result = [ordered]@{
  challenge = [ordered]@{
    statusCode = $challenge.statusCode
    requestId = $requestId
    tokenAddress = [string]$accept.tokenAddress
    recipient = [string]$accept.recipient
    amount = [string]$accept.amount
    network = [string]$accept.network
  }
  payment = [ordered]@{
    txHash = $TxHash
    submitted = $false
    mode = ""
  }
}

if (-not $TxHash) {
  $payBody = @{
    tokenAddress = [string]$accept.tokenAddress
    recipient = [string]$accept.recipient
    amount = [string]$accept.amount
    requestId = $requestId
    action = "reactive-stop-orders"
    query = "symbol=$Symbol,tp=$TakeProfit,sl=$StopLoss"
  }
  if ($Payer) {
    $payBody.payer = $Payer
  }

  try {
    $payRes = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/session/pay" -ContentType "application/json" -Body ($payBody | ConvertTo-Json -Depth 8)
    if (-not $payRes.ok -or -not $payRes.payment -or -not $payRes.payment.txHash) {
      return [pscustomobject]@{
        step = "payment"
        status = "failed"
        detail = $payRes
      }
    }
    $TxHash = [string]$payRes.payment.txHash
    $result.payment.txHash = $TxHash
    $result.payment.mode = "api/session/pay"
  } catch {
    return [pscustomobject]@{
      step = "payment"
      status = "failed"
      detail = $_.Exception.Message
    }
  }
} else {
  $result.payment.mode = "manual"
}

$proof = & "$scriptDir/submit-proof.ps1" `
  -BaseUrl $BaseUrl `
  -Payer $Payer `
  -UseRuntime:$UseRuntime `
  -SourceAgentId $SourceAgentId `
  -TargetAgentId $TargetAgentId `
  -Symbol $Symbol `
  -TakeProfit $TakeProfit `
  -StopLoss $StopLoss `
  -RequestId $requestId `
  -TxHash $TxHash `
  -TokenAddress ([string]$accept.tokenAddress) `
  -Recipient ([string]$accept.recipient) `
  -Amount ([string]$accept.amount)

$result.payment.submitted = $true
$result.proof = [ordered]@{
  statusCode = $proof.statusCode
  body = $proof.body
}

return [pscustomobject]$result
