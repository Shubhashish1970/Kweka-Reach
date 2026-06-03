# FFA API Setup: Mock (Option A) and Real API Switch

This guide walks you through setting up the **Mock FFA API** (which fetches crop/product masters from EMS) and how to **switch to the real FFA API** using GitHub secrets.

---

## Overview

| Component | Role |
|-----------|------|
| **EMS Backend** | Calls FFA API (mock or real) using `FFA_API_URL`. Optionally sends auth via `FFA_API_TOKEN` or `FFA_API_KEY`. Exposes `GET /api/ffa/master-data` protected by `FFA_MASTER_KEY`. |
| **Mock FFA API** | At startup, calls EMS `GET /api/ffa/master-data` with `X-FFA-Master-Key` to load crops/products. Needs `EMS_API_URL` (set by deploy workflow from backend URL) and `FFA_MASTER_KEY` (from GitHub secret). |

**Switch to NACL EMS API (UAT):** Set `FFA_API_URL` to `https://emsapiuat.naclind.com/api`, plus `FFA_EMS_CTID`, `FFA_EMS_SECTKEY`, and optionally `FFA_EMS_TOKEN` / `FFA_EMS_DEFAULT_DATE_FROM`. Backend authenticates via `POST /EMS/authenticate` and fetches `GET /EMS/activities` with Bearer token. Redeploy backend.

**Switch to generic vendor API (Bearer/API key):** Set `FFA_API_URL` to the vendor base URL (e.g. `https://real-ffa.example.com/api`) and set `FFA_API_TOKEN` or `FFA_API_KEY` (do not set `FFA_EMS_CTID`). Redeploy backend.

---

## Step 1: Create the shared auth key for Mock ↔ EMS

The mock calls EMS to fetch masters. EMS protects that endpoint with a shared secret.

1. **Generate a secret value** (e.g. a long random string):
   ```bash
   openssl rand -base64 32
   ```
   Copy the output (e.g. `K7x...`).

2. **Add it as a GitHub secret:**
   - Repo → **Settings** → **Secrets and variables** → **Actions**
   - **New repository secret**
   - **Name:** `FFA_MASTER_KEY`
   - **Value:** paste the value from step 1
   - **Add secret**

This same value will be used by:
- **EMS backend** to validate `X-FFA-Master-Key` on `GET /api/ffa/master-data`
- **Mock FFA API** (injected by the deploy workflow) to send that header when calling EMS

---

## Step 2: Deploy order (Mock using EMS masters)

For the mock to load masters from EMS, EMS must be deployed first so the workflow can pass its URL to the mock.

1. **Deploy EMS Backend first**
   - Push to the branch that triggers backend deploy, or run the **Deploy Backend** workflow manually.
   - Ensure `FFA_MASTER_KEY` is set (Step 1). The workflow will pass it to the backend so `/api/ffa/master-data` is protected.

2. **Deploy Mock FFA API**
   - Push changes under `mock-ffa-api/` or run the **Deploy Mock FFA API** workflow manually.
   - The workflow will:
     - Resolve the EMS backend URL (`cc-ems-backend`) and set `EMS_API_URL` on the mock
     - Set `FFA_MASTER_KEY` from the GitHub secret
   - If `FFA_MASTER_KEY` is not set, the workflow will warn; the mock will still run but use fallback crops/products.

3. **Backend’s FFA target (no extra secret for mock)**
   - If you **do not** set `FFA_API_URL` in GitHub, the **backend** workflow will auto-detect the deployed Mock FFA API URL and use `{MOCK_URL}/api` as `FFA_API_URL`.
   - So for mock-only you don’t have to add `FFA_API_URL`; deploy backend after mock and it will point to the mock.

---

## Step 3: (Optional) Set FFA_API_URL to use Mock explicitly

If you want the backend to always use the mock (e.g. to override auto-detection):

1. After the Mock FFA API is deployed, copy its **service URL** from the workflow log (e.g. `https://mock-ffa-api-xxxxx.run.app`).
2. **Add or edit GitHub secret:**
   - **Name:** `FFA_API_URL`
   - **Value:** `https://mock-ffa-api-xxxxx.run.app/api` (include `/api` at the end)
3. Redeploy the backend. It will use this URL for all FFA calls.

---

## Step 4: Set auth for the Real FFA API (when you switch)

When you switch to the **real** FFA API, you set the URL and (if required) auth.

1. **Set the real FFA API URL**
   - **Name:** `FFA_API_URL`
   - **Value:** Base URL of the real FFA API including `/api`, e.g. `https://real-ffa.example.com/api`
   - No trailing slash (the code normalizes it).

2. **Set auth (if the real API requires it)**
   - **Option A – Bearer token**
     - **Name:** `FFA_API_TOKEN`
     - **Value:** token string
   - **Option B – API key header**
     - **Name:** `FFA_API_KEY`
     - **Value:** API key string  
   The backend sends `Authorization: Bearer <FFA_API_TOKEN>` if `FFA_API_TOKEN` is set, otherwise `X-API-Key: <FFA_API_KEY>` if `FFA_API_KEY` is set.

3. **Redeploy the backend** so it uses the new `FFA_API_URL` and auth. The mock is not used when `FFA_API_URL` points to the real API.

---

## Summary: GitHub secrets

| Secret | Used by | When to set | Purpose |
|--------|---------|-------------|---------|
| `FFA_MASTER_KEY` | Backend + Mock FFA API | Always for Option A mock | Shared key: FFA (mock or real) calls EMS `/api/ffa/master-data` with `X-FFA-Master-Key`; backend validates it. |
| `FFA_API_URL` | Backend only | Optional for mock; **required** for real API | Base `.../api` for EMS, or mock/vendor URL. If unset, backend deploy uses deployed mock URL. |
| `FFA_EMS_CTID` | Backend only | NACL EMS API | With `FFA_EMS_SECTKEY`, enables EMS authenticate + activities flow. |
| `FFA_EMS_SECTKEY` | Backend only | NACL EMS API | Secret key for authenticate body. |
| `FFA_EMS_TOKEN` | Backend only | Optional | Optional `token` field in authenticate POST body. |
| `FFA_EMS_DEFAULT_DATE_FROM` | Backend only | Optional | Full sync cutoff `DD/MM/YYYY` (default `01/01/2020`). EMS requires `dateFrom`. |
| `FFA_EMS_ACTIVITIES_LIMIT_FULL` | Backend only | Optional | NACL activities `limit` for **Sync FFA (Full)**. Default `0` = all eligible from `FFA_EMS_DEFAULT_DATE_FROM`. |
| `FFA_EMS_ACTIVITIES_LIMIT_INCREMENTAL` | Backend only | Optional | NACL activities `limit` for **Sync FFA (Incremental)**. Default `0` = all undelivered since last sync `dateFrom`. |
| `FFA_EMS_ACTIVITIES_TIMEOUT_MS` | Backend only | Optional | HTTP timeout for activities GET (default 120s when `limit=0`, else 30s). |
| `FFA_API_TOKEN` | Backend only | Vendor Bearer (non-EMS) | Sent as `Authorization: Bearer <token>`. |
| `FFA_API_KEY` | Backend only | Vendor API key (non-EMS) | Sent as `X-API-Key: <key>`. |

---

## Quick checklist

**Mock FFA with masters from EMS (Option A):**
1. Add `FFA_MASTER_KEY` in GitHub (Step 1).
2. Deploy backend, then deploy Mock FFA API (Step 2).
3. Optionally set `FFA_API_URL` to the mock URL (Step 3).

**Switch to real FFA API:**
1. Set `FFA_API_URL` to real API base URL (e.g. `https://real-ffa.example.com/api`).
2. Set `FFA_API_TOKEN` or `FFA_API_KEY` if the real API requires auth (Step 4).
3. Redeploy backend.

No code change is needed to switch; only GitHub secrets and a backend redeploy.
