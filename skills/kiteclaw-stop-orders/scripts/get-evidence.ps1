param(
  [string]$BaseUrl = "http://localhost:3001",
  [Parameter(Mandatory=$true)][string]$RequestId
)

Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/skill/openclaw/evidence/$RequestId"
