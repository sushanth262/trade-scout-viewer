#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  trade-scout-viewer VM deployment script
#  Usage:  ./deploy.sh [--build] [--skip-docker-install]
#
#  Required environment variables:
#    COSMOS_ENDPOINT   - Azure Cosmos DB endpoint
#    COSMOS_KEY        - Azure Cosmos DB primary key
#    GITHUB_TOKEN      - GHCR auth token (for pulling images)
#
#  Optional:
#    VM_USER           - SSH user (default: azureuser)
#    VM_HOST           - VM hostname/IP (default: localhost for local deploy)
#    IMAGE_TAG         - Docker image tag (default: latest)
# ============================================================

IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="ghcr.io/sushanth262/trade-scout-viewer:${IMAGE_TAG}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="${1:-}"
SKIP_DOCKER="${2:-}"

echo "=== trade-scout-viewer deployment ==="
echo "  Image: ${IMAGE}"

# --- Step 1: Verify env vars ---
for var in COSMOS_ENDPOINT COSMOS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: ${var} is not set." >&2
    exit 1
  fi
done

# --- Step 2: Build and push (optional) ---
if [ "${BUILD}" = "--build" ]; then
  echo "--- Building Docker image ---"
  docker build \
    --build-arg COSMOS_ENDPOINT="${COSMOS_ENDPOINT}" \
    --build-arg COSMOS_KEY="${COSMOS_KEY}" \
    -t "${IMAGE}" \
    "${SCRIPT_DIR}"

  echo "--- Pushing to GHCR ---"
  echo "${GITHUB_TOKEN}" | docker login ghcr.io -u sushanth262 --password-stdin
  docker push "${IMAGE}"
  echo "--- Image pushed: ${IMAGE} ---"
fi

# --- Step 3: Install Docker if needed ---
if [ "${SKIP_DOCKER}" != "--skip-docker-install" ]; then
  if ! command -v docker &>/dev/null; then
    echo "--- Installing Docker ---"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$(whoami)" || true
  fi
fi

# --- Step 4: Login to GHCR and pull ---
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "--- Logging into GHCR ---"
  echo "${GITHUB_TOKEN}" | docker login ghcr.io -u sushanth262 --password-stdin
fi

echo "--- Pulling image ---"
docker pull "${IMAGE}"

# --- Step 5: Stop existing container and start new one ---
echo "--- Deploying container ---"
docker stop trade-scout-viewer 2>/dev/null || true
docker rm trade-scout-viewer 2>/dev/null || true

docker run -d \
  --name trade-scout-viewer \
  --restart unless-stopped \
  -p 3001:3000 \
  -e COSMOS_ENDPOINT="${COSMOS_ENDPOINT}" \
  -e COSMOS_KEY="${COSMOS_KEY}" \
  "${IMAGE}"

echo ""
echo "=== Deployment complete ==="
echo "  Container: trade-scout-viewer"
echo "  Port:      3001"
echo "  Health:    http://localhost:3001"
echo ""

# Wait for health
for i in $(seq 1 15); do
  if curl -sf http://localhost:3001 >/dev/null 2>&1; then
    echo "  Status: HEALTHY"
    exit 0
  fi
  sleep 2
done

echo "  Status: Container started but health check pending (may need a few more seconds)"
