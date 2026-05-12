# trade-scout-viewer Deployment Guide

Deploy **my-scoutify** (trade-scout-viewer) to an Azure VM using Docker.

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

## Endpoints

| Service | URL |
|---------|-----|
| Dashboard | `http://aura-rca.northcentralus.cloudapp.azure.com:3001` |
| API - Trades | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/trades` |
| API - Signals | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/signals` |
| API - Stats | `http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/stats` |

## Ingesting Data

Push trade logs from the earnings-trade bot:

```python
import requests, json

API = "http://aura-rca.northcentralus.cloudapp.azure.com:3001/api/trades"

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
