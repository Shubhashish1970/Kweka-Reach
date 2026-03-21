#!/usr/bin/env bash
#
# Deletes legacy Cloud Run services after kweka-reach-* services are verified.
# Run only after:
#   - kweka-reach-backend is deployed and /api/health + /api/health/database pass
#   - kweka-reach-mock-ffa-api is deployed (if you use mock FFA)
#   - GitHub secret VITE_API_URL_DEV (if used) points at the new backend URL
#
# Usage:
#   export GCP_PROJECT_ID=your-project-id   # optional if gcloud default project is set
#   ./scripts/delete-legacy-cloud-run-services.sh
#
set -euo pipefail

REGION="${GCP_REGION:-us-central1}"
PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"

if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ Set GCP project: gcloud config set project YOUR_PROJECT_ID or export GCP_PROJECT_ID"
  exit 1
fi

LEGACY_BACKEND="cc-ems-backend"
LEGACY_MOCK="mock-ffa-api"

echo "Project: $PROJECT  Region: $REGION"
echo "This will DELETE Cloud Run services:"
echo "  - $LEGACY_BACKEND"
echo "  - $LEGACY_MOCK"
echo ""
read -r -p "Type YES to confirm: " ans
if [ "$ans" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

for svc in "$LEGACY_BACKEND" "$LEGACY_MOCK"; do
  if gcloud run services describe "$svc" --region "$REGION" --project "$PROJECT" &>/dev/null; then
    echo "Deleting $svc ..."
    gcloud run services delete "$svc" --region "$REGION" --project "$PROJECT" --quiet
    echo "✅ Deleted $svc"
  else
    echo "ℹ️  $svc not found (skipped)"
  fi
done

echo "Done."
