#Requires -Version 5.1
<#
.SYNOPSIS
  Build trade-scout-viewer, push to GHCR, restart container on Azure VM (auravm / aura).

.DESCRIPTION
  Reads .env.local from the repo root (Docker --env-file format for the container).
  Uses $env:GITHUB_TOKEN for GHCR login (not written into the container env file).
  Overrides ALERT_BASE_URL for production approve links unless -SkipAlertBaseUrlOverride.

  Requires Docker Desktop (or another engine) running locally for build/push (unless -SkipBuildPush).

.PARAMETER AlertBaseUrl
  Public base URL for email approval links (default matches DEPLOY.md).

.PARAMETER SkipBuildPush
  Only pull/restart the container on the VM (image must already be on GHCR).
#>
param(
  [string]$ResourceGroup = "auravm",
  [string]$VmName = "aura",
  [string]$AlertBaseUrl = "http://aura-rca.northcentralus.cloudapp.azure.com:3001",
  [switch]$SkipAlertBaseUrlOverride,
  [switch]$SkipBuildPush
)

$ErrorActionPreference = "Stop"
if (-not $SkipBuildPush) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "docker CLI not found. Install Docker Desktop and ensure it is on PATH."
  }
  docker info 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker engine is not reachable. Start Docker Desktop (Linux engine) and retry."
  }
}
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

$envLocal = Join-Path $Root ".env.local"
if (-not (Test-Path $envLocal)) {
  Write-Error ".env.local not found at $envLocal"
}

if (-not $env:GITHUB_TOKEN) {
  Write-Error "Set environment variable GITHUB_TOKEN (write:packages) before running this script."
}

$lines = Get-Content $envLocal -Encoding UTF8
$envPairs = [ordered]@{}
foreach ($raw in $lines) {
  $line = $raw.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { continue }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { continue }
  $k = $line.Substring(0, $idx).Trim()
  $v = $line.Substring($idx + 1).Trim()
  if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  $envPairs[$k] = $v
}

if ($envPairs.Contains("QUIVER_TOKEN") -and -not $envPairs.Contains("QUIVER_API_KEY")) {
  $envPairs["QUIVER_API_KEY"] = $envPairs["QUIVER_TOKEN"]
}

if (-not $SkipAlertBaseUrlOverride) {
  $envPairs["ALERT_BASE_URL"] = $AlertBaseUrl.TrimEnd("/")
}

$sb = New-Object System.Text.StringBuilder
foreach ($key in $envPairs.Keys) {
  if ($key -eq "GITHUB_TOKEN") { continue }
  $val = $envPairs[$key] -replace "`r`n", " " -replace "`n", " "
  [void]$sb.Append("${key}=${val}`n")
}
$envFileText = $sb.ToString()
$envFileB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($envFileText))

$ghB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($env:GITHUB_TOKEN))

$remote = @"
set -euo pipefail
echo '$ghB64' | base64 -d | docker login ghcr.io -u sushanth262 --password-stdin
echo '$envFileB64' | base64 -d > /tmp/trade-scout-viewer.env
chmod 600 /tmp/trade-scout-viewer.env
docker pull ghcr.io/sushanth262/trade-scout-viewer:latest
docker stop trade-scout-viewer 2>/dev/null || true
docker rm trade-scout-viewer 2>/dev/null || true
docker run -d --name trade-scout-viewer --restart unless-stopped \
  -p 3001:3000 \
  --env-file /tmp/trade-scout-viewer.env \
  ghcr.io/sushanth262/trade-scout-viewer:latest
shred -u /tmp/trade-scout-viewer.env 2>/dev/null || rm -f /tmp/trade-scout-viewer.env
docker ps --filter name=trade-scout-viewer
echo DONE
"@
$remote = $remote -replace "`r`n", "`n" -replace "`r", "`n"

$b64script = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remote))

if (-not $SkipBuildPush) {
  Write-Host "=== docker build ===" -ForegroundColor Cyan
  docker build `
    --build-arg COSMOS_ENDPOINT="$($envPairs['COSMOS_ENDPOINT'])" `
    --build-arg COSMOS_KEY="$($envPairs['COSMOS_KEY'])" `
    -t ghcr.io/sushanth262/trade-scout-viewer:latest `
    $Root
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "=== docker login & push ===" -ForegroundColor Cyan
  $env:GITHUB_TOKEN | docker login ghcr.io -u sushanth262 --password-stdin
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  docker push ghcr.io/sushanth262/trade-scout-viewer:latest
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "=== skipping docker build/push (-SkipBuildPush) ===" -ForegroundColor Yellow
}

Write-Host "=== az vm run-command (resource-group=$ResourceGroup name=$VmName) ===" -ForegroundColor Cyan
az vm run-command invoke `
  --resource-group $ResourceGroup `
  --name $VmName `
  --command-id RunShellScript `
  --scripts "echo $b64script | base64 -d | bash" `
  --only-show-errors -o json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== finished ===" -ForegroundColor Green
