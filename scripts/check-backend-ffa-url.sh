#!/bin/bash

# Script to check backend FFA_API_URL configuration
# Usage: ./scripts/check-backend-ffa-url.sh

set -e

echo "🔍 Checking Backend FFA_API_URL configuration..."
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
SERVICE_NAME="${SERVICE_NAME:-kweka-reach-backend}"

echo "📋 Configuration:"
echo "  - Project: $PROJECT_ID"
echo "  - Region: $REGION"
echo "  - Service: $SERVICE_NAME"
echo ""

# Get environment variables
echo "🔍 Checking backend environment variables..."
ENV_VARS=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --project $PROJECT_ID \
    --format 'value(spec.template.spec.containers[0].env)' 2>/dev/null || echo "")

if [ -z "$ENV_VARS" ]; then
    echo "❌ Error: Could not retrieve environment variables"
    echo "   Service might not exist or you might not have permission"
    exit 1
fi

# Extract FFA_API_URL
FFA_API_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --project $PROJECT_ID \
    --format 'value(spec.template.spec.containers[0].env[?name==`FFA_API_URL`].value)' 2>/dev/null || echo "")

if [ -z "$FFA_API_URL" ]; then
    echo "⚠️ FFA_API_URL environment variable is not set"
    echo ""
    echo "📝 This means the backend will use default: http://localhost:4000/api"
    echo "   This won't work in Cloud Run production environment"
    echo ""
    echo "💡 Solutions:"
    echo "   1. Deploy Mock FFA API first"
    echo "   2. Then redeploy backend (it will auto-detect Mock FFA API URL)"
    echo "   3. OR set FFA_API_URL as GitHub secret"
else
    echo "✅ FFA_API_URL is set: $FFA_API_URL"
    echo ""
    
    # Check if it's localhost (won't work in Cloud Run)
    if echo "$FFA_API_URL" | grep -q "localhost"; then
        echo "❌ WARNING: FFA_API_URL contains 'localhost'"
        echo "   This won't work in Cloud Run production environment"
        echo "   The backend cannot connect to localhost from Cloud Run"
        echo ""
        echo "💡 Solutions:"
        echo "   1. Deploy Mock FFA API to Cloud Run"
        echo "   2. Set FFA_API_URL to Mock FFA API Cloud Run URL"
        echo "   3. Redeploy backend"
    else
        echo "✅ FFA_API_URL looks valid (not localhost)"
        echo ""
        
        # Test if URL is accessible
        echo "🔍 Testing FFA API connectivity..."
        HEALTH_URL="${FFA_API_URL%/api}/api/health"
        if curl -s --max-time 10 "$HEALTH_URL" > /dev/null 2>&1; then
            echo "✅ FFA API is accessible and responding"
            HEALTH_RESPONSE=$(curl -s --max-time 10 "$HEALTH_URL")
            echo "   Response: $HEALTH_RESPONSE"
        else
            echo "⚠️ FFA API URL is set but not accessible"
            echo "   Health check URL: $HEALTH_URL"
            echo "   This might cause timeout errors"
        fi
    fi
fi

echo ""
echo "📝 To update FFA_API_URL:"
echo "   1. Get Mock FFA API URL (run: ./scripts/check-ffa-api-status.sh)"
echo "   2. Set as GitHub secret: https://github.com/Shubhashish1970/CC-EMS/settings/secrets/actions"
echo "   3. OR trigger backend redeployment (it will auto-detect Mock FFA API URL)"
