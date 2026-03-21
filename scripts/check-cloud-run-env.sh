#!/bin/bash
# Script to check Cloud Run environment variables

echo "🔍 Checking Cloud Run Service Environment Variables..."
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Service details
SERVICE_NAME="${SERVICE_NAME:-kweka-reach-backend}"
REGION="us-central1"

echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo ""

# Get environment variables
echo "📋 Current Environment Variables:"
gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format="table(spec.template.spec.containers[0].env.name,spec.template.spec.containers[0].env.value)" \
  2>/dev/null || {
    echo "❌ Error: Could not retrieve service information"
    echo "Make sure you're authenticated: gcloud auth login"
    echo "Make sure the service exists: gcloud run services list --region $REGION"
    exit 1
}

echo ""
echo "🔍 Checking MONGODB_URI database name..."
MONGODB_URI=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format="value(spec.template.spec.containers[0].env[?(@.name=='MONGODB_URI')].value)" \
  2>/dev/null)

if [ -z "$MONGODB_URI" ]; then
    echo "❌ MONGODB_URI not found in environment variables"
else
    # Extract database name from URI
    DB_NAME=$(echo "$MONGODB_URI" | sed -n 's/.*\/\([^?]*\).*/\1/p')
    echo "Current database: $DB_NAME"
    
    if [ "$DB_NAME" = "Kweka_Call_Centre" ]; then
        echo "✅ Database is correctly set to Kweka_Call_Centre"
    else
        echo "⚠️  Database is set to: $DB_NAME"
        echo "   Expected: Kweka_Call_Centre"
        echo ""
        echo "📝 To update, you need to:"
        echo "   1. Update the MONGODB_URI secret in GitHub:"
        echo "      https://github.com/YOUR_REPO/settings/secrets/actions"
        echo "   2. Or update directly in Cloud Run:"
        echo "      gcloud run services update $SERVICE_NAME \\"
        echo "        --region $REGION \\"
        echo "        --update-env-vars MONGODB_URI='mongodb+srv://.../Kweka_Call_Centre?...'"
    fi
fi
