#!/bin/bash

# Post-deployment verification script
# Runs after backend deployment to verify configuration
# Usage: ./scripts/verify-deployment.sh [SERVICE_NAME]

set -e

SERVICE_NAME=${1:-kweka-reach-backend}
PROJECT_ID=${GCP_PROJECT_ID:-cc-ems-dev}
REGION=${GCP_REGION:-us-central1}

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Post-Deployment Verification${NC}"
echo "=============================="
echo "Service: $SERVICE_NAME"
echo ""

# Get FFA_API_URL from deployed service
FFA_API_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --project $PROJECT_ID \
    --format 'json' 2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    env_vars = data.get('spec', {}).get('template', {}).get('spec', {}).get('containers', [{}])[0].get('env', [])
    ffa_url = next((e.get('value') for e in env_vars if e.get('name') == 'FFA_API_URL'), None)
    print(ffa_url if ffa_url else 'NOT_SET')
except Exception as e:
    print('ERROR')
    sys.exit(1)
" 2>&1) || FFA_API_URL="ERROR"

if [ "$FFA_API_URL" = "NOT_SET" ] || [ "$FFA_API_URL" = "ERROR" ] || [ -z "$FFA_API_URL" ]; then
    echo -e "${RED}❌ FFA_API_URL not found in deployed service${NC}"
    exit 1
fi

echo -e "${GREEN}✅ FFA_API_URL configured: $FFA_API_URL${NC}"

# Test connectivity
echo ""
echo -e "${BLUE}Testing FFA API connectivity...${NC}"
HEALTH_URL="${FFA_API_URL}/health"
HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>&1) || HTTP_STATUS="ERROR"

if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ FFA API is accessible (HTTP 200)${NC}"
else
    echo -e "${YELLOW}⚠️  FFA API health check failed (HTTP $HTTP_STATUS)${NC}"
    echo "   This might be expected if Mock FFA API is not deployed yet"
fi

echo ""
echo -e "${GREEN}✅ Deployment verification complete${NC}"
