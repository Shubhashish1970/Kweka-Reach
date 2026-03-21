#!/bin/bash

# Script to check Mock FFA API deployment status and URL
# Usage: ./scripts/check-ffa-api-status.sh

set -e

echo "🔍 Checking Mock FFA API deployment status..."
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get project ID from git config or environment
PROJECT_ID=${GCP_PROJECT_ID:-cc-ems-dev}
REGION=${GCP_REGION:-us-central1}

echo "📋 Configuration:"
echo "  - Project: $PROJECT_ID"
echo "  - Region: $REGION"
echo "  - Services tried: kweka-reach-mock-ffa-api, mock-ffa-api"
echo ""

# Check if service exists (prefer new name, then legacy)
echo "🔍 Checking if Mock FFA API service exists..."
SERVICE_NAME=""
SERVICE_URL=""
for CANDIDATE in kweka-reach-mock-ffa-api mock-ffa-api; do
  if gcloud run services describe "$CANDIDATE" \
      --region $REGION \
      --project $PROJECT_ID \
      --quiet 2>/dev/null; then
    SERVICE_NAME="$CANDIDATE"
    SERVICE_URL=$(gcloud run services describe "$CANDIDATE" \
        --region $REGION \
        --project $PROJECT_ID \
        --format 'value(status.url)' 2>/dev/null || echo "")
    break
  fi
done

if [ -n "$SERVICE_NAME" ]; then
    
    echo "✅ Mock FFA API service exists ($SERVICE_NAME)"
    echo ""
    
    if [ -n "$SERVICE_URL" ] && [ "$SERVICE_URL" != "null" ]; then
        echo "✅ Service URL: $SERVICE_URL"
        echo "✅ FFA_API_URL should be: ${SERVICE_URL}/api"
        echo ""
        
        # Test if service is accessible
        echo "🔍 Testing service health endpoint..."
        HEALTH_URL="${SERVICE_URL}/api/health"
        if curl -s --max-time 10 "$HEALTH_URL" > /dev/null 2>&1; then
            echo "✅ Service is accessible and responding"
            HEALTH_RESPONSE=$(curl -s --max-time 10 "$HEALTH_URL")
            echo "   Response: $HEALTH_RESPONSE"
        else
            echo "⚠️ Service URL exists but may not be accessible"
            echo "   Health check URL: $HEALTH_URL"
        fi
    else
        echo "⚠️ Service exists but URL is empty or null"
    fi
    
    echo ""
    echo "📝 To set this as FFA_API_URL in backend deployment:"
    echo "   1. Go to: https://github.com/Shubhashish1970/Kweka-Reach/settings/secrets/actions"
    echo "   2. Add/edit secret: FFA_API_URL"
    echo "   3. Value: ${SERVICE_URL}/api"
    echo ""
    echo "   OR the backend deployment will auto-detect it on next deploy"
    
else
    echo "❌ Mock FFA API service does not exist"
    echo ""
    echo "📝 To deploy Mock FFA API:"
    echo "   1. Go to GitHub Actions: https://github.com/Shubhashish1970/Kweka-Reach/actions/workflows/deploy-mock-ffa-api.yml"
    echo "   2. Click 'Run workflow' button"
    echo "   3. Select branch: main"
    echo "   4. Click 'Run workflow'"
    echo ""
    echo "   OR push changes to mock-ffa-api/ directory to trigger deployment"
fi
