#!/bin/bash

# Comprehensive test script for FFA API configuration
# Usage: ./scripts/test-ffa-config.sh

set -e

echo "🔍 FFA API Configuration Test"
echo "=============================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI is not installed${NC}"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Warning: gcloud not authenticated${NC}"
    echo "Run: gcloud auth login"
    exit 1
fi

PROJECT_ID=${GCP_PROJECT_ID:-cc-ems-dev}
REGION=${GCP_REGION:-us-central1}

echo "📋 Configuration:"
echo "  - Project: $PROJECT_ID"
echo "  - Region: $REGION"
echo ""

# Step 1: Check Mock FFA API service (prefer kweka-reach-mock-ffa-api, then legacy)
echo "1️⃣  Checking Mock FFA API service..."
MOCK_FFA_URL=""
for MOCK_SVC in kweka-reach-mock-ffa-api mock-ffa-api; do
  CANDIDATE=$(gcloud run services describe "$MOCK_SVC" \
      --region $REGION \
      --project $PROJECT_ID \
      --format 'value(status.url)' 2>/dev/null || true)
  if [ -n "$CANDIDATE" ] && [ "$CANDIDATE" != "null" ]; then
    MOCK_FFA_URL="$CANDIDATE"
    echo "   Using service: $MOCK_SVC"
    break
  fi
done

if [ -z "$MOCK_FFA_URL" ] || [ "$MOCK_FFA_URL" = "null" ]; then
    echo -e "${RED}❌ Mock FFA API service not found (tried kweka-reach-mock-ffa-api, mock-ffa-api)${NC}"
    echo "   Solution: Deploy Mock FFA API via GitHub Actions"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ Mock FFA API URL: $MOCK_FFA_URL${NC}"
    EXPECTED_FFA_API_URL="${MOCK_FFA_URL}/api"
    echo "   Expected FFA_API_URL: $EXPECTED_FFA_API_URL"
    echo ""
fi

# Step 2: Check Backend FFA_API_URL (prefer kweka-reach-backend, then legacy)
echo "2️⃣  Checking Backend FFA_API_URL..."
BACKEND_JSON=""
for BACKEND_SVC in kweka-reach-backend cc-ems-backend; do
  if BACKEND_JSON=$(gcloud run services describe "$BACKEND_SVC" \
      --region $REGION \
      --project $PROJECT_ID \
      --format 'json' 2>/dev/null); then
    if [ -n "$BACKEND_JSON" ]; then
      echo "   Using backend service: $BACKEND_SVC"
      break
    fi
  fi
done
BACKEND_FFA_URL=$(echo "$BACKEND_JSON" | python3 -c "
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
if [ -z "$BACKEND_JSON" ]; then
  BACKEND_FFA_URL="ERROR"
fi

if [ "$BACKEND_FFA_URL" = "NOT_SET" ] || [ "$BACKEND_FFA_URL" = "ERROR" ] || [ -z "$BACKEND_FFA_URL" ]; then
    echo -e "${RED}❌ FFA_API_URL not set in backend${NC}"
    echo "   Solution: Redeploy backend or set FFA_API_URL GitHub secret"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ Backend FFA_API_URL: $BACKEND_FFA_URL${NC}"
    echo ""
    
    # Compare with expected
    if [ "$BACKEND_FFA_URL" = "$EXPECTED_FFA_API_URL" ]; then
        echo -e "${GREEN}✅ FFA_API_URL matches expected value${NC}"
    else
        echo -e "${YELLOW}⚠️  FFA_API_URL doesn't match expected value${NC}"
        echo "   Expected: $EXPECTED_FFA_API_URL"
        echo "   Actual:   $BACKEND_FFA_URL"
    fi
    echo ""
fi

# Step 3: Test Mock FFA API connectivity
echo "3️⃣  Testing Mock FFA API connectivity..."

# Test health endpoint
HEALTH_URL="${MOCK_FFA_URL}/api/health"
echo "   Testing: $HEALTH_URL"
HEALTH_RESPONSE=$(curl -s --max-time 10 "$HEALTH_URL" 2>&1) || HEALTH_RESPONSE="ERROR"
if echo "$HEALTH_RESPONSE" | grep -q '"success"'; then
    echo -e "${GREEN}✅ Health endpoint responding${NC}"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null | head -5 || echo "$HEALTH_RESPONSE" | head -3
else
    echo -e "${RED}❌ Health endpoint failed${NC}"
    echo "   Response: $HEALTH_RESPONSE"
    exit 1
fi
echo ""

# Test activities endpoint
ACTIVITIES_URL="${MOCK_FFA_URL}/api/activities?limit=2"
echo "   Testing: $ACTIVITIES_URL"
ACTIVITIES_RESPONSE=$(curl -s --max-time 10 "$ACTIVITIES_URL" 2>&1) || ACTIVITIES_RESPONSE="ERROR"
if echo "$ACTIVITIES_RESPONSE" | grep -q '"success"'; then
    echo -e "${GREEN}✅ Activities endpoint responding${NC}"
    ACTIVITIES_COUNT=$(echo "$ACTIVITIES_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('data', {}).get('activities', [])))" 2>/dev/null || echo "0")
    echo "   Found $ACTIVITIES_COUNT activities"
else
    echo -e "${RED}❌ Activities endpoint failed${NC}"
    echo "   Response: $ACTIVITIES_RESPONSE" | head -5
    exit 1
fi
echo ""

# Step 4: Test backend's FFA_API_URL
echo "4️⃣  Testing Backend's FFA_API_URL..."
BACKEND_TEST_URL="${BACKEND_FFA_URL}/activities?limit=2"
echo "   Testing: $BACKEND_TEST_URL"
BACKEND_TEST_RESPONSE=$(curl -s --max-time 10 "$BACKEND_TEST_URL" 2>&1) || BACKEND_TEST_RESPONSE="ERROR"
HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BACKEND_TEST_URL" 2>&1) || HTTP_STATUS="ERROR"

if echo "$BACKEND_TEST_RESPONSE" | grep -q '"success"'; then
    echo -e "${GREEN}✅ Backend's FFA_API_URL is working (HTTP $HTTP_STATUS)${NC}"
    ACTIVITIES_COUNT=$(echo "$BACKEND_TEST_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('data', {}).get('activities', [])))" 2>/dev/null || echo "0")
    echo "   Found $ACTIVITIES_COUNT activities"
elif [ "$HTTP_STATUS" = "404" ]; then
    echo -e "${RED}❌ 404 Not Found - Endpoint doesn't exist${NC}"
    echo "   This explains the FFA sync 404 error!"
    echo "   Check if URL is correct or Mock FFA API endpoint exists"
    exit 1
else
    echo -e "${RED}❌ Request failed (HTTP $HTTP_STATUS)${NC}"
    echo "   Response: $BACKEND_TEST_RESPONSE" | head -5
    exit 1
fi
echo ""

# Step 5: Summary
echo "📊 Summary"
echo "=========="
echo -e "${GREEN}✅ Mock FFA API is deployed and accessible${NC}"
echo -e "${GREEN}✅ Backend FFA_API_URL is set${NC}"
echo -e "${GREEN}✅ All endpoints are responding correctly${NC}"
echo ""
echo "💡 If FFA sync still fails, check:"
echo "   1. Backend logs for actual error messages"
echo "   2. Ensure Mock FFA API service is healthy"
echo "   3. Check network connectivity between services"
