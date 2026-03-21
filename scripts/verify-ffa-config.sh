#!/bin/bash

# Automated FFA API Configuration Verification Script
# This script checks backend FFA_API_URL and tests connectivity
# Usage: ./scripts/verify-ffa-config.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ID=${GCP_PROJECT_ID:-cc-ems-dev}
REGION=${GCP_REGION:-us-central1}
BACKEND_SERVICE="${BACKEND_SERVICE:-kweka-reach-backend}"

echo -e "${BLUE}🔍 Automated FFA API Configuration Verification${NC}"
echo "=================================================="
echo ""

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI is not installed${NC}"
    exit 1
fi

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud not authenticated${NC}"
    echo "Run: gcloud auth login"
    exit 1
fi

# Step 1: Get Backend FFA_API_URL
echo -e "${BLUE}1️⃣  Checking Backend Configuration...${NC}"
BACKEND_FFA_URL=$(gcloud run services describe $BACKEND_SERVICE \
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
" 2>&1) || BACKEND_FFA_URL="ERROR"

if [ "$BACKEND_FFA_URL" = "NOT_SET" ] || [ "$BACKEND_FFA_URL" = "ERROR" ] || [ -z "$BACKEND_FFA_URL" ]; then
    echo -e "${RED}❌ FFA_API_URL not set in backend${NC}"
    echo "   Solution: Set FFA_API_URL GitHub secret and redeploy"
    exit 1
fi

echo -e "${GREEN}✅ Backend FFA_API_URL: $BACKEND_FFA_URL${NC}"
echo ""

# Step 2: Test Health Endpoint
echo -e "${BLUE}2️⃣  Testing Health Endpoint...${NC}"
HEALTH_URL="${BACKEND_FFA_URL}/health"
HEALTH_RESPONSE=$(curl -s --max-time 10 "$HEALTH_URL" 2>&1) || HEALTH_RESPONSE="ERROR"
HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>&1) || HEALTH_STATUS="ERROR"

if [ "$HEALTH_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ Health endpoint working (HTTP 200)${NC}"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null | head -8 || echo "$HEALTH_RESPONSE" | head -3
else
    echo -e "${RED}❌ Health endpoint failed (HTTP $HEALTH_STATUS)${NC}"
    echo "   URL: $HEALTH_URL"
    echo "   Response: $HEALTH_RESPONSE" | head -3
    exit 1
fi
echo ""

# Step 3: Test Activities Endpoint
echo -e "${BLUE}3️⃣  Testing Activities Endpoint...${NC}"
ACTIVITIES_URL="${BACKEND_FFA_URL}/activities?limit=2"
ACTIVITIES_RESPONSE=$(curl -s --max-time 10 "$ACTIVITIES_URL" 2>&1) || ACTIVITIES_RESPONSE="ERROR"
ACTIVITIES_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$ACTIVITIES_URL" 2>&1) || ACTIVITIES_STATUS="ERROR"

if [ "$ACTIVITIES_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ Activities endpoint working (HTTP 200)${NC}"
    if echo "$ACTIVITIES_RESPONSE" | grep -q '"success"'; then
        ACTIVITIES_COUNT=$(echo "$ACTIVITIES_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('data', {}).get('activities', [])))" 2>/dev/null || echo "0")
        echo "   Found $ACTIVITIES_COUNT activities"
        echo "$ACTIVITIES_RESPONSE" | python3 -m json.tool 2>/dev/null | head -15 || echo "$ACTIVITIES_RESPONSE" | head -5
    else
        echo "   Response: $ACTIVITIES_RESPONSE" | head -5
    fi
elif [ "$ACTIVITIES_STATUS" = "404" ]; then
    echo -e "${RED}❌ 404 Not Found - This is the error causing FFA sync to fail!${NC}"
    echo "   URL: $ACTIVITIES_URL"
    exit 1
else
    echo -e "${RED}❌ Activities endpoint failed (HTTP $ACTIVITIES_STATUS)${NC}"
    echo "   URL: $ACTIVITIES_URL"
    echo "   Response: $ACTIVITIES_RESPONSE" | head -5
    exit 1
fi
echo ""

# Step 4: Summary
echo -e "${BLUE}📊 Verification Summary${NC}"
echo "====================="
echo -e "${GREEN}✅ Backend FFA_API_URL is set correctly${NC}"
echo -e "${GREEN}✅ Mock FFA API is accessible and working${NC}"
echo -e "${GREEN}✅ All endpoints are responding correctly${NC}"
echo ""
echo -e "${BLUE}💡 Next Steps:${NC}"
echo "   If FFA sync still fails, check:"
echo "   1. Backend logs for actual error messages"
echo "   2. Network connectivity between services"
echo "   3. Mock FFA API service health in Cloud Run console"
