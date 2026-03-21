# Cloud Run service rename: `kweka-reach-*`

Legacy names **`cc-ems-backend`** and **`mock-ffa-api`** are replaced by:

| Role | New service name |
|------|------------------|
| EMS API | `kweka-reach-backend` |
| Mock FFA API | `kweka-reach-mock-ffa-api` |

## What was updated in the repo

- **`.github/workflows/deploy-backend.yml`** — deploys `kweka-reach-backend`. When resolving the mock URL for `FFA_API_URL`, it tries **`kweka-reach-mock-ffa-api`** first, then **`mock-ffa-api`** (cutover only).
- **`.github/workflows/deploy-mock-ffa-api.yml`** — deploys `kweka-reach-mock-ffa-api`. Resolves `EMS_API_URL` from **`kweka-reach-backend`** first, then **`cc-ems-backend`** (cutover only).
- **`.github/workflows/firebase-deploy-dev.yml`** — detects API URL from **`kweka-reach-backend`**.
- **`scripts/*.sh`** — defaults updated to `kweka-reach-backend` (override with `SERVICE_NAME` / `BACKEND_SERVICE` where documented).

## Your cutover steps

1. **Deploy mock first** (optional if `FFA_API_URL` secret already points at a working mock):
   - Actions → **Deploy Mock FFA API to Cloud Run** → Run workflow.
2. **Deploy backend**:
   - Push `backend/**` or Actions → **Deploy Backend to Cloud Run** → Run workflow.
3. **Verify**
   - Open `https://<kweka-reach-backend-url>/api/health` and `/api/health/database`.
   - If using mock: `https://<mock-url>/api/health`.
4. **Frontend**
   - Run **Deploy to Firebase (Dev/Test)** or ensure secret **`VITE_API_URL_DEV`** matches the **new** backend URL (`…/api`).
5. **Delete legacy services** (only after everything works):
   ```bash
   chmod +x scripts/delete-legacy-cloud-run-services.sh
   ./scripts/delete-legacy-cloud-run-services.sh
   ```
   Or in Cloud Run console, delete **`cc-ems-backend`** and **`mock-ffa-api`**.

## Notes

- Docker images in Artifact Registry still use repository **`cc-ems-repo`**; only the **image name** (service name) in the path changes to match the new service names.
- Firebase project ID in workflows is unchanged unless you migrate hosting separately.
