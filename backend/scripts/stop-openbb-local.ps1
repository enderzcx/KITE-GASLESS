param(
  [string]$ContainerName = 'kite-openbb-local'
)

$ErrorActionPreference = 'Stop'

$exists = docker ps -a --filter "name=^/${ContainerName}$" --format "{{.Names}}"
if ($exists) {
  docker rm -f $ContainerName | Out-Null
  Write-Host "OpenBB container stopped: $ContainerName"
} else {
  Write-Host "OpenBB container not found: $ContainerName"
}
