#!/bin/bash
# Script to check Cloud Run logs for stats endpoint

PROJECT_ID="cc-ems-dev"
SERVICE_NAME="${SERVICE_NAME:-kweka-reach-backend}"

echo "🔍 Checking Cloud Run logs for stats calculation..."
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo ""

echo "=== Recent Stats Calculation Logs ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE_NAME\" AND jsonPayload.message=~\"Stats calculation\"" \
  --limit 10 \
  --project $PROJECT_ID \
  --freshness=1h \
  --format="table(timestamp,severity,jsonPayload.message,jsonPayload.totalTasksFound,jsonPayload.calculatedCounts,jsonPayload.outcomeBreakdown,jsonPayload.statusBreakdown)" \
  2>&1

echo ""
echo "=== Recent Errors ==="
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE_NAME\" AND severity=\"ERROR\"" \
  --limit 10 \
  --project $PROJECT_ID \
  --freshness=1h \
  --format="table(timestamp,severity,jsonPayload.message,textPayload)" \
  2>&1

echo ""
echo "✅ Done!"
