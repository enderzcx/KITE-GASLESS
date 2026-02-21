param(
  [string]$BaseUrl = "http://localhost:3001"
)

Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/session/runtime/secret"
