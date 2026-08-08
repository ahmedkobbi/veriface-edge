#!/bin/bash
# VeriFace Edge — Health Check Script
#
# Performs comprehensive health checks on a running VeriFace Edge deployment.
# Exits 0 if healthy, 1 if degraded, 2 if down.
#
# Usage:
#   ./scripts/health-check.sh
#   ./scripts/health-check.sh --url https://veriface.io
#   ./scripts/health-check.sh --docker  # Check Docker containers

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TARGET_URL="${TARGET_URL:-http://localhost:3000}"
CHECK_DOCKER=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --url)
      TARGET_URL="$2"
      shift 2
      ;;
    --docker)
      CHECK_DOCKER=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

PASS=0
FAIL=0
WARN=0

check() {
  local name="$1"
  local condition="$2"
  local detail="$3"

  if [ "$condition" = "true" ]; then
    echo -e "  ${GREEN}✓${NC} $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $name"
    [ -n "$detail" ] && echo -e "      $detail"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local name="$1"
  local detail="$2"
  echo -e "  ${YELLOW}⚠${NC} $name"
  [ -n "$detail" ] && echo -e "      $detail"
  WARN=$((WARN + 1))
}

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  VeriFace Edge — Health Check                             ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Target: $TARGET_URL${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. HTTP Health Endpoint
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[1/5] HTTP Health Endpoint${NC}"

HTTP_STATUS=$(curl -sk -o /tmp/health-response.json -w "%{http_code}" "$TARGET_URL/api/health" 2>/dev/null || echo "000")
RESPONSE_TIME=$(curl -sk -o /dev/null -w "%{time_total}" "$TARGET_URL/api/health" 2>/dev/null || echo "0")

check "Health endpoint reachable" "$([ "$HTTP_STATUS" != "000" ] && echo true || echo false)" "Cannot connect to $TARGET_URL/api/health"
check "Health endpoint returns 200 or 503" "$([ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ] && echo true || echo false)" "Got HTTP $HTTP_STATUS"

if [ "$HTTP_STATUS" = "200" ]; then
  check "Health status is 'healthy'" "true" ""
elif [ "$HTTP_STATUS" = "503" ]; then
  warn "Health status is 'degraded'" "Some components may be down (expected if WebSocket mini-service is not running)"
fi

# Check response time
RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc 2>/dev/null || echo "0")
check "Response time < 500ms" "$([ $(echo "$RESPONSE_TIME < 0.5" | bc) = "1" ] && echo true || echo false)" "Response took ${RESPONSE_TIME_MS}ms"

echo ""

# ---------------------------------------------------------------------------
# 2. Public Status Endpoint
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[2/5] Public Status Endpoint${NC}"

STATUS_HTTP=$(curl -sk -o /dev/null -w "%{http_code}" "$TARGET_URL/api/status" 2>/dev/null || echo "000")
check "Status endpoint reachable" "$([ "$STATUS_HTTP" != "000" ] && echo true || echo false)" ""
check "Status endpoint returns 200" "$([ "$STATUS_HTTP" = "200" ] && echo true || echo false)" "Got HTTP $STATUS_HTTP"

echo ""

# ---------------------------------------------------------------------------
# 3. Security Headers
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[3/5] Security Headers${NC}"

HEADERS=$(curl -skI "$TARGET_URL/api/health" 2>/dev/null || echo "")

check "Strict-Transport-Security present" "$(echo "$HEADERS" | grep -qi 'strict-transport-security' && echo true || echo false)" ""
check "X-Content-Type-Options: nosniff" "$(echo "$HEADERS" | grep -qi 'x-content-type-options.*nosniff' && echo true || echo false)" ""
check "X-Frame-Options: DENY" "$(echo "$HEADERS" | grep -qi 'x-frame-options.*deny' && echo true || echo false)" ""
check "Content-Security-Policy present" "$(echo "$HEADERS" | grep -qi 'content-security-policy' && echo true || echo false)" ""
check "Referrer-Policy present" "$(echo "$HEADERS" | grep -qi 'referrer-policy' && echo true || echo false)" ""
check "Permissions-Policy present" "$(echo "$HEADERS" | grep -qi 'permissions-policy' && echo true || echo false)" ""

# Check CSP doesn't have unsafe-inline (M-7 fix)
CSP=$(echo "$HEADERS" | grep -i 'content-security-policy' | head -1 || echo "")
if echo "$CSP" | grep -qi "unsafe-inline"; then
  check "CSP has no unsafe-inline" "false" "CSP contains unsafe-inline (XSS risk)"
else
  check "CSP has no unsafe-inline" "true" ""
fi

echo ""

# ---------------------------------------------------------------------------
# 4. Docker Containers (if --docker flag)
# ---------------------------------------------------------------------------

if [ "$CHECK_DOCKER" = true ]; then
  echo -e "${YELLOW}[4/5] Docker Containers${NC}"

  if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    check "Docker is installed" "true" ""

    # Check running containers
    RUNNING=$(docker compose ps --format json 2>/dev/null | python3 -c "
import sys, json
services = [json.loads(line) for line in sys.stdin if line.strip()]
print(len(services))
" 2>/dev/null || echo "0")

    check "At least 4 services running (app, db, redis, nginx)" "$([ "$RUNNING" -ge 4 ] && echo true || echo false)" "Found $RUNNING running services"

    # Check each container's health
    for service in app postgres redis nginx cron; do
      STATE=$(docker compose ps "$service" --format json 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.readline())
    print(data.get('Health', data.get('State', 'unknown')))
except:
    print('not-found')
" 2>/dev/null || echo "not-found")

      if [ "$STATE" = "healthy" ] || [ "$STATE" = "running" ]; then
        check "Container '$service' is healthy" "true" ""
      elif [ "$STATE" = "not-found" ]; then
        warn "Container '$service' not found" "May be intentionally disabled"
      else
        check "Container '$service' is healthy" "false" "State: $STATE"
      fi
    done
  else
    warn "Docker not available" "Cannot check container health"
  fi
else
  echo -e "${YELLOW}[4/5] Docker check skipped (use --docker to enable)${NC}"
fi

echo ""

# ---------------------------------------------------------------------------
# 5. TLS Certificate (if HTTPS)
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[5/5] TLS Certificate${NC}"

if echo "$TARGET_URL" | grep -q "https"; then
  CERT_INFO=$(echo | timeout 5 openssl s_client -connect "$(echo "$TARGET_URL" | sed 's|https://||;s|/.*||')":443 -servername "$(echo "$TARGET_URL" | sed 's|https://||;s|/.*||')" 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null || echo "")

  if [ -n "$CERT_INFO" ]; then
    check "TLS certificate present" "true" ""

    # Check expiry
    EXPIRY=$(echo "$CERT_INFO" | grep "notAfter" | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    if [ $DAYS_LEFT -gt 30 ]; then
      check "Certificate expires in > 30 days" "true" "Expires in $DAYS_LEFT days ($EXPIRY)"
    elif [ $DAYS_LEFT -gt 0 ]; then
      warn "Certificate expires soon" "Expires in $DAYS_LEFT days ($EXPIRY)"
    else
      check "Certificate not expired" "false" "Expired $((-DAYS_LEFT)) days ago"
    fi
  else
    check "TLS certificate present" "false" "Could not retrieve certificate"
  fi
else
  warn "Not using HTTPS" "Target is HTTP — TLS not checked"
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Health Check Summary                                     ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  ${GREEN}Passed: $PASS${NC}"
echo -e "${GREEN}║  ${YELLOW}Warnings: $WARN${NC}"
echo -e "${GREEN}║  ${RED}Failed: $FAIL${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"

if [ $FAIL -gt 0 ]; then
  exit 2  # Down
elif [ $WARN -gt 0 ]; then
  exit 1  # Degraded
else
  exit 0  # Healthy
fi
