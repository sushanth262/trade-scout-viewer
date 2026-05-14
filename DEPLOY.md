# trade-scout-viewer Deployment Guide

Deploy **my-scoutify** (trade-scout-viewer) to an Azure VM using Docker.

## Before you deploy (required)

**Do not build or run the production container until every environment variable below is set to real values** (no placeholders). Ask the repo owner to confirm each secret before you push a new image or restart Docker on the VM.

| Variable | Where | Purpose |
|----------|--------|---------|
| `COSMOS_ENDPOINT` | `.env.local` / Docker `-e` | Azure Cosmos account URI |
| `COSMOS_KEY` | `.env.local` / Docker `-e` | Cosmos read/write key |
| `ALPACA_API_KEY` | same | Alpaca paper/live trading key |
| `ALPACA_API_SECRET` | same | Alpaca secret |
| `ALPACA_BASE_URL` | same | Default `https://paper-api.alpaca.markets` |
| `ALPACA_DATA_URL` | same | Default `https://data.alpaca.markets` |
| `QUIVER_API_KEY` | same | Optional Quiver Quant live API |
| `ALERT_HMAC_SECRET` | same | Long random string; **must match** `indicator-alert-bot` `.env` |
| `SENDGRID_API_KEY` | same | Optional; for future server-side mail |
| `ALERT_EMAIL_TO` | same | Alert recipient |
| `ALERT_BASE_URL` | same | Public site URL for email approval links (e.g. `http://your-vm:3001`) |

After filling secrets, run `npm run build` locally, then proceed with Docker build / deploy steps below. When you start the container on the VM, pass the same keys as `-e` flags (or an env file) so runtime matches `.env.local`.

---

## Architecture

```
Browser → :3001 → Next.js (standalone) → Cosmos DB (free tier, centralus)
```

The app runs as a single Docker container exposing port 3001.
On the Aura VM, it sits alongside the existing Aura services on a different port.

## Prerequisites

- **Azure VM** with Docker installed (reuses the Aura VM at `52.162.205.226`)
- **Azure Cosmos DB** (free tier) — already provisioned as `tradescoutviewer` in `auravm` resource group
- **GHCR access** — `GITHUB_TOKEN` with `read:packages` scope
- **Cosmos DB credentials** — endpoint and primary key

## Local Development

```bash
cd C:\Users\dsush\source\repos\trade-scout-viewer

# 1. Install dependencies
npm install

# 2. Create .env.local with your Cosmos credentials
#    COSMOS_ENDPOINT=https://tradescoutviewer.documents.azure.com:443/
#    COSMOS_KEY=<your-cosmos-key>

# 3. Run the dev server
npm run dev
```

Open http://localhost:3000.

## Build Image and Push to GHCR (PowerShell)

```powershell
cd C:\Users\dsush\source\repos\trade-scout-viewer

# 1. Build the Docker image
docker build `
  --build-arg COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/" `
  --build-arg COSMOS_KEY="$env:COSMOS_KEY" `
  -t ghcr.io/sushanth262/trade-scout-viewer:latest .

# 2. Login to GHCR and push
echo $env:GITHUB_TOKEN | docker login ghcr.io -u sushanth262 --password-stdin
docker push ghcr.io/sushanth262/trade-scout-viewer:latest
```

Requires `$env:GITHUB_TOKEN` (with `write:packages` scope) and `$env:COSMOS_KEY` set in your terminal.

## Quick Start (on VM)

```bash
# 1. Set required env vars
export COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/"
export COSMOS_KEY="<your-cosmos-key>"
export GITHUB_TOKEN="<your-github-token>"

# 2. Run the deploy script
chmod +x deploy.sh
./deploy.sh
```

## Build and Push Image

From your local machine:

```bash
export COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/"
export COSMOS_KEY="<your-cosmos-key>"
export GITHUB_TOKEN="<your-github-token>"

./deploy.sh --build
```

This builds the Docker image locally, pushes to GHCR, then deploys.

## Deploy via `az vm run-command`

If you don't have SSH access, use Azure CLI:

```powershell
$script = @'
export COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/"
export COSMOS_KEY="<key>"
export GITHUB_TOKEN="<token>"

echo "$GITHUB_TOKEN" | docker login ghcr.io -u sushanth262 --password-stdin
docker pull ghcr.io/sushanth262/trade-scout-viewer:latest
docker stop trade-scout-viewer 2>/dev/null || true
docker rm trade-scout-viewer 2>/dev/null || true
docker run -d --name trade-scout-viewer --restart unless-stopped \
  -p 3001:3000 \
  -e COSMOS_ENDPOINT="$COSMOS_ENDPOINT" \
  -e COSMOS_KEY="$COSMOS_KEY" \
  ghcr.io/sushanth262/trade-scout-viewer:latest
echo DONE
'@
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($script))
az vm run-command invoke --resource-group auravm --name aura `
  --command-id RunShellScript `
  --scripts "echo $b64 | base64 -d | bash" `
  --only-show-errors -o json
```

## NSG Rule (if not already open)

```bash
az network nsg rule create --resource-group auravm --nsg-name aura-nsg \
  --name AllowScoutify --priority 1003 --access Allow --direction Inbound \
  --protocol Tcp --destination-port-ranges 3001
```

## Full Deploy from PowerShell (Build + Push + VM)

End-to-end: build the image locally, push to GHCR, open the NSG port, and deploy the container on the VM.

```powershell
# --- Prerequisites: set these env vars ---
# $env:COSMOS_KEY = "<your-cosmos-key>"
# $env:GITHUB_TOKEN = "<your-github-token>"

# 1. Build and push image
cd C:\Users\dsush\source\repos\trade-scout-viewer
docker build `
  --build-arg COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/" `
  --build-arg COSMOS_KEY="$env:COSMOS_KEY" `
  -t ghcr.io/sushanth262/trade-scout-viewer:latest .

echo $env:GITHUB_TOKEN | docker login ghcr.io -u sushanth262 --password-stdin
docker push ghcr.io/sushanth262/trade-scout-viewer:latest

# 2. Open port 3001 (one-time, skip if already done)
az network nsg rule create --resource-group auravm --nsg-name aura-nsg `
  --name AllowScoutify --priority 1003 --access Allow --direction Inbound `
  --protocol Tcp --destination-port-ranges 3001 --only-show-errors -o json

# 3. Deploy container on VM
$cosmosKey = $env:COSMOS_KEY
$ghToken = $env:GITHUB_TOKEN
$script = @"
echo "$ghToken" | docker login ghcr.io -u sushanth262 --password-stdin
docker pull ghcr.io/sushanth262/trade-scout-viewer:latest
docker stop trade-scout-viewer 2>/dev/null || true
docker rm trade-scout-viewer 2>/dev/null || true
docker run -d --name trade-scout-viewer --restart unless-stopped \
  -p 3001:3000 \
  -e COSMOS_ENDPOINT="https://tradescoutviewer.documents.azure.com:443/" \
  -e COSMOS_KEY="$cosmosKey" \
  ghcr.io/sushanth262/trade-scout-viewer:latest
docker ps --filter name=trade-scout-viewer
echo DONE
"@
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($script))
az vm run-command invoke --resource-group auravm --name aura `
  --command-id RunShellScript `
  --scripts "echo $b64 | base64 -d | bash" `
  --only-show-errors -o json
```

## Endpoints

| Service | URL |
|---------|-----|
| Dashboard | `http://aura-rca.northcentralus.cloudapp.azure.com:3001` |
| API - Trades | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/trades` |
| API - Signals | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/signals` |
| API - Stats | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/stats` |

## Ingesting Data

POST endpoints are restricted to localhost/VM-internal requests only (403 for external IPs).
The earnings-trade bot must run on the same VM and POST to `http://localhost:3001`.

```python
import requests, json

API = "http://localhost:3001/api/trades"  # must be localhost

with open("trades_log.jsonl") as f:
    trades = [json.loads(line) for line in f]

resp = requests.post(API, json=trades)
print(resp.json())
```

## Updating

```bash
# Pull latest image and restart
docker pull ghcr.io/sushanth262/trade-scout-viewer:latest
docker stop trade-scout-viewer && docker rm trade-scout-viewer
docker run -d --name trade-scout-viewer --restart unless-stopped \
  -p 3001:3000 \
  -e COSMOS_ENDPOINT="$COSMOS_ENDPOINT" \
  -e COSMOS_KEY="$COSMOS_KEY" \
  ghcr.io/sushanth262/trade-scout-viewer:latest
```

## Troubleshooting

```bash
docker logs trade-scout-viewer --tail 50     # App logs
docker inspect trade-scout-viewer            # Container config
curl http://localhost:3001/api/stats          # Health check
```
