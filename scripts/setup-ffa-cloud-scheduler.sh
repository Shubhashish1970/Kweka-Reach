#!/usr/bin/env bash
# Create or update Google Cloud Scheduler job for FFA incremental sync.
# Requires: gcloud CLI, FFA_CRON_SECRET set on Cloud Run backend, scheduler API enabled.
#
# Usage:
#   export GCP_PROJECT_ID=your-project
#   export BACKEND_URL=https://your-cloud-run-url   # no trailing slash
#   export FFA_CRON_SECRET=your-long-random-secret
#   ./scripts/setup-ffa-cloud-scheduler.sh
#
# Optional:
#   export SCHEDULER_REGION=asia-south1   # default: asia-south1 (near Asia/Kolkata)
#   export JOB_NAME=kweka-reach-ffa-sync  # default

set -euo pipefail

GCP_PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
BACKEND_URL="${BACKEND_URL:?Set BACKEND_URL (Cloud Run service URL, no trailing slash)}"
FFA_CRON_SECRET="${FFA_CRON_SECRET:?Set FFA_CRON_SECRET (must match Cloud Run env)}"
SCHEDULER_REGION="${SCHEDULER_REGION:-asia-south1}"
JOB_NAME="${JOB_NAME:-kweka-reach-ffa-sync}"
SCHEDULE="${SCHEDULE:-* * * * *}"
TIMEZONE="${TIMEZONE:-Asia/Kolkata}"

echo "Project:          $GCP_PROJECT_ID"
echo "Backend URL:      $BACKEND_URL"
echo "Scheduler region: $SCHEDULER_REGION"
echo "Job name:         $JOB_NAME"
echo "Schedule:         $SCHEDULE ($TIMEZONE)"

gcloud services enable cloudscheduler.googleapis.com --project="$GCP_PROJECT_ID"

TARGET_URI="${BACKEND_URL}/api/ffa/run-scheduled-sync"

if gcloud scheduler jobs describe "$JOB_NAME" --location="$SCHEDULER_REGION" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  echo "Updating existing scheduler job..."
  gcloud scheduler jobs update http "$JOB_NAME" \
    --location="$SCHEDULER_REGION" \
    --project="$GCP_PROJECT_ID" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIMEZONE" \
    --uri="$TARGET_URI" \
    --http-method=POST \
    --headers="X-FFA-Cron-Secret=${FFA_CRON_SECRET}" \
    --attempt-deadline=540s
else
  echo "Creating scheduler job..."
  gcloud scheduler jobs create http "$JOB_NAME" \
    --location="$SCHEDULER_REGION" \
    --project="$GCP_PROJECT_ID" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIMEZONE" \
    --uri="$TARGET_URI" \
    --http-method=POST \
    --headers="X-FFA-Cron-Secret=${FFA_CRON_SECRET}" \
    --attempt-deadline=540s
fi

echo ""
echo "Done. Cloud Scheduler will POST to $TARGET_URI every minute."
echo "Actual sync runs only when due per Admin → Data Management schedule (e.g. every 3 minutes)."
echo ""
echo "Test manually:"
echo "  curl -X POST -H \"X-FFA-Cron-Secret: \$FFA_CRON_SECRET\" \"$TARGET_URI\""
