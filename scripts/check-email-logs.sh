#!/bin/bash

# Script to check Cloud Run logs for email/Resend issues

PROJECT_ID="cc-ems-dev"
SERVICE_NAME="${SERVICE_NAME:-kweka-reach-backend}"

echo "🔍 Checking Cloud Run logs for email issues..."
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo ""

echo "=== Recent Email-Related Logs (Last 30 entries) ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME AND (textPayload=~'email' OR textPayload=~'Resend' OR textPayload=~'📧' OR jsonPayload.message=~'email')" \
  --limit 30 \
  --format="table(timestamp,severity,textPayload,jsonPayload.message)" \
  --project $PROJECT_ID \
  --freshness=1h \
  2>&1

echo ""
echo "=== Recent Errors (Last 20 entries) ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME AND severity>=ERROR" \
  --limit 20 \
  --format="table(timestamp,severity,textPayload,jsonPayload.message,jsonPayload.error)" \
  --project $PROJECT_ID \
  --freshness=1h \
  2>&1

echo ""
echo "=== Checking for Resend API Issues ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME AND (textPayload=~'Resend' OR jsonPayload.message=~'Resend')" \
  --limit 20 \
  --format="table(timestamp,severity,textPayload,jsonPayload.message,jsonPayload.error)" \
  --project $PROJECT_ID \
  --freshness=1h \
  2>&1

echo ""
echo "✅ Log check complete!"
echo ""
echo "💡 To view logs in browser:"
echo "https://console.cloud.google.com/logs/query?project=$PROJECT_ID"
