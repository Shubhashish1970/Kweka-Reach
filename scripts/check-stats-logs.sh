#!/bin/bash

# Script to check Cloud Run logs for stats endpoint issues

PROJECT_ID="cc-ems-dev"
SERVICE_NAME="${SERVICE_NAME:-kweka-reach-backend}"
REGION="us-central1"

echo "🔍 Checking Cloud Run logs for stats endpoint issues..."
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo ""

echo "=== Recent Stats Aggregation Logs (Last 50 entries) ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME AND (textPayload=~'Stats aggregation' OR jsonPayload.message=~'Stats aggregation')" \
  --limit 50 \
  --format="table(timestamp,severity,textPayload,jsonPayload.message,jsonPayload.map,jsonPayload.calculatedCounts)" \
  --project $PROJECT_ID \
  --freshness=1h \
  2>&1

echo ""
echo "=== Recent API Requests to /tasks/own/history/stats (Last 30 entries) ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME AND (textPayload=~'/tasks/own/history/stats' OR jsonPayload.message=~'/tasks/own/history/stats' OR httpRequest.requestUrl=~'/tasks/own/history/stats')" \
  --limit 30 \
  --format="table(timestamp,severity,httpRequest.requestUrl,httpRequest.status,textPayload,jsonPayload.message)" \
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
echo "✅ Log check complete!"
echo ""
echo "💡 To view logs in browser:"
echo "https://console.cloud.google.com/logs/query?project=$PROJECT_ID"
