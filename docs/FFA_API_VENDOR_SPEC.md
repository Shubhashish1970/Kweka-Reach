# FFA API Vendor Specification (for Kweka Reach / EMS)

This document defines the **FFA API** contract that the EMS backend (Kweka Reach) will call to ingest Activities & Farmers.

The vendor will **host this API**. EMS will be configured to call it via `FFA_API_URL`.

## Overview

- **Integration type**: EMS **pulls** activities from the FFA API.
- **Primary endpoint**: `GET {FFA_API_URL}/activities`
- **Incremental sync**: EMS will call with `dateFrom` to fetch activities after the last sync point.
- **Data model**: Each Activity contains an embedded array of Farmers.

## Base URL

- EMS config: `FFA_API_URL`
- EMS will remove any trailing `/` before calling.

Example:
- `FFA_API_URL=https://vendor-ffa.example.com/api`
- EMS calls `https://vendor-ffa.example.com/api/activities?...`

## Authentication (choose one)

EMS supports either of these:

### Option 1: Bearer token

- Vendor issues `FFA_API_TOKEN`
- EMS sends header:

```http
Authorization: Bearer <FFA_API_TOKEN>
```

### Option 2: API key

- Vendor issues `FFA_API_KEY`
- EMS sends header:

```http
X-API-Key: <FFA_API_KEY>
```

Notes:
- EMS will send **either** Bearer token **or** X-API-Key, not both.
- EMS always sends `Content-Type: application/json`.

## Endpoint: List Activities

### `GET /activities`

EMS calls:
- Full sync: `GET /activities?limit=0&dateFrom=DD/MM/YYYY` (limit `0` = all eligible from dateFrom)
- Incremental sync: `GET /activities?limit=0&dateFrom=DD/MM/YYYY` (dateFrom = last sync; limit `0` = all undelivered since then)

#### Query parameters

- **limit** *(required by EMS)*: integer  
  - `0` = return all eligible activities for the given `dateFrom` (no cap).
  - Any positive integer caps the response to that many activities.
  - EMS defaults: full and incremental sync use `limit=0` unless overridden by env.
- **dateFrom** *(optional)*: string in **DD/MM/YYYY**  
  - When provided, return activities whose **activity date is >= dateFrom** OR whose **updatedAt/syncedAt >= dateFrom** (vendor choice).  
  - EMS expects that subsequent incremental syncs return *newly added or newly updated* activities since the last cutoff.

#### Response (success)

Status: `200 OK`

```json
{
  "success": true,
  "data": {
    "activities": [
      {
        "activityId": "A-1001",
        "type": "Field Day",
        "date": "01/04/2026",
        "officerId": "FDA-501162",
        "officerName": "Bharathapu Sekhar",
        "location": "A-4 Loc",
        "territory": "Karimnagar1",
        "territoryName": "Karimnagar1",
        "zoneName": "Telangana",
        "buName": "SOUTH BU",
        "tmEmpCode": "22920",
        "tmName": "TM Name",
        "state": "Telangana",
        "crops": ["Paddy"],
        "products": ["Product A"],
        "farmers": [
          {
            "farmerId": "F-1",
            "name": "Bal ka Harish",
            "mobileNumber": "8340809331",
            "location": "A-1 Loc",
            "crops": ["Paddy"],
            "photoUrl": "https://example.com/photo.jpg"
          }
        ]
      }
    ]
  }
}
```

#### Response (error)

For any application error, return:
- status: `4xx` (recommended)  
- body:

```json
{
  "success": false,
  "message": "Human readable error"
}
```

EMS does not require a specific error schema beyond the above.

## Field requirements and validation

### Activity fields

| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `activityId` | string | Yes | Must be **stable and unique** across all time. EMS upserts by this key. |
| `type` | string | Yes | Must be one of: `Field Day`, `Group Meeting`, `Demo Visit`, `OFM`, `Other` |
| `date` | string | Yes | Preferred format: **DD/MM/YYYY**. EMS can also parse `YYYY-MM-DD` and ISO, but vendor should send DD/MM/YYYY. |
| `officerId` | string | Yes | FDA employee code (string). |
| `officerName` | string | Yes | FDA name. |
| `location` | string | Yes | Free text. |
| `territory` | string | Yes | Legacy / fallback territory. |
| `state` | string | Recommended | EMS uses state to derive language. If missing, EMS will derive from territory for backward compatibility but vendor should provide it. |
| `territoryName` | string | Optional | Preferred territory label. If absent, EMS falls back to `territory`. |
| `zoneName` | string | Optional | Zone. |
| `buName` | string | Optional | Business Unit. |
| `tmEmpCode` | string | Optional | TM employee code. |
| `tmName` | string | Optional | TM name. |
| `crops` | string[] | Optional | Array of crop names. |
| `products` | string[] | Optional | Array of product names. |
| `farmers` | Farmer[] | Yes | Can be empty array but should be present. |

### Farmer fields (within `activity.farmers[]`)

| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `farmerId` | string | Optional | EMS currently does **not** rely on it; mobile is the unique key. |
| `name` | string | Yes | |
| `mobileNumber` | string | Yes | Must be stable for the farmer. EMS upserts farmers by `mobileNumber`. |
| `location` | string | Yes | |
| `photoUrl` | string | Optional | URL. |
| `crops` | string[] | Optional | |

## EMS ingestion behavior (important for vendor)

EMS will:
- Upsert **Activity** by `activityId`
- Upsert **Farmer** by `mobileNumber`
- Replace the Activity’s `farmerIds` link list with the Farmers provided on the activity payload
- Derive Farmer `preferredLanguage` from Activity `state` (vendor does not need to send language)

Implications:
- If vendor sends the same activity multiple times, it will overwrite crops/products/farmers links for that activity (expected).
- If vendor changes a farmer’s name/location for the same `mobileNumber`, EMS will update it (expected).

## Performance and limits

- EMS may call with `limit=0` (full eligible set) or a positive cap. Large responses should complete within a practical latency target (EMS uses up to 120s timeout when `limit=0`).

## Testing checklist (vendor)

- Full sync returns valid JSON with required fields.
- Incremental sync with `dateFrom` returns only new/updated activities (or at minimum does not miss them).
- Dates validate: DD/MM/YYYY.
- Every activity has unique `activityId`.
- Farmers have numeric-string `mobileNumber` (no formatting characters preferred).
- Auth works with either Bearer or X-API-Key.

