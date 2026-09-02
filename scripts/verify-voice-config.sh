#!/bin/bash
# Verify Cloud Run voice integration configuration and Reach ↔ Dograh connectivity checks.
# Usage: ./scripts/verify-voice-config.sh
# Env: GCP_PROJECT_ID, GCP_REGION, BACKEND_SERVICE, VOICE_WEBHOOK_API_KEY (optional, for auth probe)

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ID=${GCP_PROJECT_ID:-cc-ems-dev}
REGION=${GCP_REGION:-us-central1}
BACKEND_SERVICE="${BACKEND_SERVICE:-kweka-reach-backend}"

echo -e "${BLUE}🔍 Voice integration verification (Reach + Dograh readiness)${NC}"
echo "=============================================================="
echo ""

if ! command -v gcloud &> /dev/null; then
  echo -e "${RED}❌ gcloud CLI is not installed${NC}"
  exit 1
fi

BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format 'value(status.url)' 2>/dev/null || echo "")

if [ -z "$BACKEND_URL" ] || [ "$BACKEND_URL" = "null" ]; then
  echo -e "${RED}❌ Could not resolve Cloud Run URL for $BACKEND_SERVICE${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Backend URL: $BACKEND_URL${NC}"
echo ""

echo -e "${BLUE}1️⃣  Cloud Run voice environment variables${NC}"
ENV_JSON=$(gcloud run services describe "$BACKEND_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format 'json' 2>/dev/null)

check_env() {
  local name="$1"
  local required="${2:-yes}"
  local val
  val=$(echo "$ENV_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
env = data.get('spec', {}).get('template', {}).get('spec', {}).get('containers', [{}])[0].get('env', [])
print(next((e.get('value', '') for e in env if e.get('name') == '$name'), ''))
" 2>/dev/null || echo "")
  if [ -n "$val" ]; then
    echo -e "  ${GREEN}✅${NC} $name is set"
    return 0
  fi
  if [ "$required" = "yes" ]; then
    echo -e "  ${RED}❌${NC} $name is NOT set (required)"
    return 1
  fi
  echo -e "  ${YELLOW}⚠️${NC}  $name is not set (optional)"
  return 0
}

FAIL=0
check_env VOICE_API_BASE_URL yes || FAIL=1
check_env VOICE_API_KEY yes || FAIL=1
check_env VOICE_WEBHOOK_API_KEY yes || FAIL=1
check_env VOICE_ORCHESTRATOR_ENABLED no
check_env REACH_PUBLIC_API_URL no
check_env USER_VIRTUAL_AGENT_DEFAULT_PASSWORD no
echo ""

echo -e "${BLUE}2️⃣  Reach voice status API${NC}"
STATUS_JSON=$(curl -sf --max-time 15 "$BACKEND_URL/api/voice/status" || echo "")
if [ -z "$STATUS_JSON" ]; then
  echo -e "${RED}❌ GET /api/voice/status failed${NC}"
  FAIL=1
else
  echo "$STATUS_JSON" | python3 -m json.tool 2>/dev/null | head -20 || echo "$STATUS_JSON"
  API_OK=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('apiConfigured') else 'no')" 2>/dev/null || echo "no")
  WH_OK=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('webhookConfigured') else 'no')" 2>/dev/null || echo "no")
  if [ "$API_OK" = "yes" ]; then
    echo -e "${GREEN}✅ Voice API credentials reported as configured${NC}"
  else
    echo -e "${RED}❌ Voice API not fully configured (apiConfigured=false)${NC}"
    FAIL=1
  fi
  if [ "$WH_OK" = "yes" ]; then
    echo -e "${GREEN}✅ Voice webhook key reported as configured${NC}"
  else
    echo -e "${RED}❌ Voice webhook key not configured${NC}"
    FAIL=1
  fi
fi
echo ""

echo -e "${BLUE}2b. Per-agent safe dial (Voice Agents admin)${NC}"
DIAL_OVERRIDE=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('dialOverrideActive') else 'no')" 2>/dev/null || echo "unknown")
if [ "$DIAL_OVERRIDE" = "yes" ]; then
  AGENT_COUNT=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('agentsWithDialOverride',0))" 2>/dev/null || echo "?")
  echo -e "  ${GREEN}✅${NC} Per-agent safe dial active on $AGENT_COUNT virtual agent(s)"
elif [ "$DIAL_OVERRIDE" = "no" ]; then
  echo -e "  ${YELLOW}⚠️${NC}  No per-agent safe dial — orchestrator may dial real farmer numbers on dev"
else
  echo -e "  ${YELLOW}⚠️${NC}  Could not read dialOverrideActive from status API"
fi
echo ""

echo -e "${BLUE}3️⃣  Webhook auth probe (no key → expect 401)${NC}"
WH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$BACKEND_URL/api/voice/webhook" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"000000000000000000000000"}' || echo "000")
if [ "$WH_STATUS" = "401" ] || [ "$WH_STATUS" = "403" ]; then
  echo -e "${GREEN}✅ Webhook rejects unauthenticated requests (HTTP $WH_STATUS)${NC}"
else
  echo -e "${RED}❌ Expected 401/403 without webhook key, got HTTP $WH_STATUS${NC}"
  FAIL=1
fi
echo ""

if [ -n "${VOICE_WEBHOOK_API_KEY:-}" ]; then
  echo -e "${BLUE}4️⃣  Webhook auth probe (valid key, invalid task → expect 400/404)${NC}"
  AUTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$BACKEND_URL/api/voice/webhook" \
    -H 'Content-Type: application/json' \
    -H "X-API-Key: $VOICE_WEBHOOK_API_KEY" \
    -d '{"task_id":"000000000000000000000000","call_status":"Connected"}' || echo "000")
  if [ "$AUTH_STATUS" = "400" ] || [ "$AUTH_STATUS" = "404" ]; then
    echo -e "${GREEN}✅ Webhook accepts API key (HTTP $AUTH_STATUS — auth passed, payload rejected as expected)${NC}"
  else
    echo -e "${YELLOW}⚠️  Webhook with key returned HTTP $AUTH_STATUS (expected 400/404 for dummy task)${NC}"
  fi
  echo ""
else
  echo -e "${YELLOW}4️⃣  Skipping authenticated webhook probe (set VOICE_WEBHOOK_API_KEY env to enable)${NC}"
  echo ""
fi

echo -e "${BLUE}5️⃣  Dograh E2E (manual via Reach admin)${NC}"
echo "  • Admin → Voice Agents → set per-agent API Trigger UUID"
echo "  • Enable per-agent safe dial + team number on dev agents before orchestrator"
echo "  • Enable orchestrator in global settings (or VOICE_ORCHESTRATOR_ENABLED=true)"
echo "  • Use 'Test trigger call' with your mobile — confirms Reach → Dograh outbound"
echo "  • Complete a real queue call — confirm Dograh webhook hits:"
echo "    ${BACKEND_URL}/api/voice/webhook"
echo ""

if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}❌ Voice configuration verification failed${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Voice configuration verification passed${NC}"
exit 0
