param(
  [int]$Port = 6900
)

$ErrorActionPreference = 'Stop'

$tcp = Test-NetConnection 127.0.0.1 -Port $Port

$openApiOk = $false
$historyOk = $false
$historyCount = 0
$historyProvider = ''
$historyError = ''

try {
  $null = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/openapi.json" -TimeoutSec 8
  $openApiOk = $true
} catch {
  $openApiOk = $false
}

try {
  $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/v1/crypto/price/historical?symbol=BTCUSD&provider=yfinance&interval=1h" -TimeoutSec 20
  $historyCount = @($resp.results).Count
  $historyProvider = [string]$resp.provider
  $historyOk = $historyCount -gt 0
} catch {
  $historyError = $_.Exception.Message
  $historyOk = $false
}

[PSCustomObject]@{
  tcp = [PSCustomObject]@{
    port = $Port
    listening = [bool]$tcp.TcpTestSucceeded
  }
  openapi = [PSCustomObject]@{
    ok = $openApiOk
  }
  btcHistory = [PSCustomObject]@{
    ok = $historyOk
    provider = $historyProvider
    rows = $historyCount
    error = $historyError
  }
} | ConvertTo-Json -Depth 8
