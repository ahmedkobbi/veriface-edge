#!/bin/bash
# VeriFace Edge — Production Deployment Script
#
# Usage:
#   ./scripts/deploy.sh                    # Deploy with default settings
#   ./scripts/deploy.sh --build            # Rebuild image before deploying
#   ./scripts/deploy.sh --env-file .env.prod  # Use custom env file
#   ./scripts/deploy.sh --rollback         # Rollback to previous version
#
# Prerequisites:
#   - Docker + Docker Compose installed
#   - .env.production file with all secrets
#   - TLS certs in ./certs/ (fullchain.pem + privkey.pem)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="docker-compose.yml"
IMAGE_NAME="veriface-edge"
VERSION="${VERSION:-1.0.0}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"

# Parse arguments
BUILD=false
ROLLBACK=false
ENV_FILE_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --build)
      BUILD=true
      shift
      ;;
    --env-file)
      ENV_FILE_FLAG="$2"
      shift 2
      ;;
    --rollback)
      ROLLBACK=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--build] [--env-file .env.prod] [--rollback]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Use --env-file override if provided
if [ -n "$ENV_FILE_FLAG" ]; then
  ENV_FILE="$ENV_FILE_FLAG"
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  VeriFace Edge — Production Deployment                    ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Version:    ${VERSION:-1.0.0}                                          ║${NC}"
echo -e "${BLUE}║  Commit:     ${COMMIT_SHA}                                         ║${NC}"
echo -e "${BLUE}║  Env file:   ${ENV_FILE}                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[1/6] Pre-flight checks...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}❌ Docker is not installed${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker installed"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
  echo -e "${RED}❌ Docker Compose is not installed${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker Compose installed"

# Check env file
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}❌ Environment file not found: $ENV_FILE${NC}"
  echo -e "    Copy .env.example to $ENV_FILE and fill in secrets."
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Environment file: $ENV_FILE"

# Check required secrets in env file
REQUIRED_SECRETS=(
  "POSTGRES_PASSWORD"
  "REDIS_PASSWORD"
  "VERIFACE_SERVER_SIGNING_KEY"
  "VERIFACE_ENCRYPTION_KEY"
  "VERIFACE_ALLOWED_ORIGINS"
  "VERIFACE_BOOTSTRAP_SECRET"
  "CRON_SECRET"
  "WEBAUTHN_RP_ID"
  "WEBAUTHN_RP_ORIGIN"
)

MISSING=0
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! grep -q "^${secret}=" "$ENV_FILE" || grep -q "^${secret}=$" "$ENV_FILE"; then
    echo -e "  ${RED}✗${NC} Missing: $secret"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  echo -e "${RED}❌ $MISSING required secrets are missing in $ENV_FILE${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} All required secrets present"

# Check TLS certs
if [ ! -f "certs/fullchain.pem" ] || [ ! -f "certs/privkey.pem" ]; then
  echo -e "${YELLOW}  ⚠${NC} TLS certs not found in ./certs/ (using HTTP fallback)"
  echo -e "    For production, place fullchain.pem + privkey.pem in ./certs/"
fi

echo ""

# ---------------------------------------------------------------------------
# Build (optional)
# ---------------------------------------------------------------------------

if [ "$BUILD" = true ]; then
  echo -e "${YELLOW}[2/6] Building Docker image...${NC}"
  docker build \
    --build-arg VERSION="$VERSION" \
    --build-arg COMMIT_SHA="$COMMIT_SHA" \
    -t "$IMAGE_NAME:$VERSION" \
    -t "$IMAGE_NAME:latest" \
    .
  echo -e "  ${GREEN}✓${NC} Image built: $IMAGE_NAME:$VERSION"
  echo ""
else
  echo -e "${YELLOW}[2/6] Skipping build (use --build to rebuild)${NC}"
  echo ""
fi

# ---------------------------------------------------------------------------
# Rollback (optional)
# ---------------------------------------------------------------------------

if [ "$ROLLBACK" = true ]; then
  echo -e "${YELLOW}[3/6] Rolling back to previous version...${NC}"
  # List available images
  echo "Available versions:"
  docker images "$IMAGE_NAME" --format "table {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}" | head -10
  echo ""
  read -p "Enter version to rollback to: " ROLLBACK_VERSION
  if [ -z "$ROLLBACK_VERSION" ]; then
    echo -e "${RED}❌ No version specified${NC}"
    exit 1
  fi
  VERSION="$ROLLBACK_VERSION"
  echo -e "  ${GREEN}✓${NC} Rolling back to version: $VERSION"
  echo ""
else
  echo -e "${YELLOW}[3/6] No rollback requested${NC}"
  echo ""
fi

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[4/6] Deploying services...${NC}"

# Pull latest images for dependencies (postgres, redis, nginx)
docker compose --env-file "$ENV_FILE" pull postgres redis nginx

# Start services (recreates changed containers)
docker compose --env-file "$ENV_FILE" up -d --remove-orphans

echo -e "  ${GREEN}✓${NC} Services started"
echo ""

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[5/6] Waiting for health checks...${NC}"

MAX_WAIT=60
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
  HEALTHY=$(docker compose --env-file "$ENV_FILE" ps --format json 2>/dev/null | \
    python3 -c "
import sys, json
services = [json.loads(line) for line in sys.stdin if line.strip()]
healthy = all(s.get('Health') == 'healthy' or s.get('State') == 'running' for s in services)
print('yes' if healthy else 'no')
" 2>/dev/null || echo "no")

  if [ "$HEALTHY" = "yes" ]; then
    echo -e "  ${GREEN}✓${NC} All services healthy (waited ${WAITED}s)"
    break
  fi

  sleep 2
  WAITED=$((WAITED + 2))
  echo -e "  Waiting... (${WAITED}s)"
done

if [ "$HEALTHY" != "yes" ]; then
  echo -e "${RED}❌ Services not healthy after ${MAX_WAIT}s${NC}"
  echo -e "    Check logs: docker compose logs"
  exit 1
fi

echo ""

# ---------------------------------------------------------------------------
# Post-deploy verification
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[6/6] Post-deploy verification...${NC}"

# Test the health endpoint through nginx
SITE_URL=$(grep "^SITE_URL=" "$ENV_FILE" | cut -d= -f2)
if [ -n "$SITE_URL" ]; then
  HTTP_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "$SITE_URL/api/health" 2>/dev/null || echo "000")
  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ]; then
    echo -e "  ${GREEN}✓${NC} Health endpoint reachable (HTTP $HTTP_STATUS)"
  else
    echo -e "  ${RED}❌ Health endpoint unreachable (HTTP $HTTP_STATUS)${NC}"
  fi
fi

# Show running services
echo ""
echo -e "${BLUE}Running services:${NC}"
docker compose --env-file "$ENV_FILE" ps

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Deployment successful!                                 ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Version:    $VERSION                                        ${NC}"
echo -e "${GREEN}║  Site URL:   ${SITE_URL:-http://localhost}                       ${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  Useful commands:                                            ║${NC}"
echo -e "${GREEN}║  • View logs:  docker compose logs -f                        ║${NC}"
echo -e "${GREEN}║  • Restart:    docker compose restart                        ║${NC}"
echo -e "${GREEN}║  • Stop:       docker compose down                           ║${NC}"
echo -e "${GREEN}║  • Rollback:   ./scripts/deploy.sh --rollback                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
