# Kweka Reach — Test Plan

## Reasoning

The system has **three layers of risk** that tests need to cover:

1. **Data integrity** — Incorrect sampling, duplicate tasks, bad imports corrupt downstream call operations that are hard to reverse
2. **Business rule enforcement** — Task state machine, callback limits, role permissions are never enforced at the code level (only at the UI level), so they can be bypassed via API
3. **Concurrency & state** — Sync locks are in-memory, no DB transactions, partial failures leave the DB in inconsistent states

13 distinct bugs were identified during code review. The test cases below are organized to catch all of them, plus validate happy paths.

---

## Plan: Test Architecture

```
backend/
├── tests/
│   ├── unit/
│   │   ├── samplingService.test.ts     ← Algorithm correctness
│   │   ├── taskService.test.ts         ← State machine, callbacks
│   │   └── excelImport.test.ts         ← Parsing & validation
│   ├── integration/
│   │   ├── auth.test.ts                ← Login, token, RBAC
│   │   ├── tasks.test.ts               ← Task lifecycle via API
│   │   ├── users.test.ts               ← User CRUD & permissions
│   │   ├── sampling.test.ts            ← Sampling run flows
│   │   ├── masterData.test.ts          ← Crops/products/languages
│   │   └── ffa.test.ts                 ← Sync & import
│   └── helpers/
│       ├── db.ts                       ← In-memory MongoDB setup
│       └── factories.ts                ← Test data builders
```

**Stack recommendation:** Jest + Supertest + `mongodb-memory-server` (avoids needing a real DB, no test pollution).

---

## Test Cases

### AUTH — `auth.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| A1 | Login with valid credentials returns JWT + user object | Happy path |
| A2 | Login with unknown email returns 401 (not 404, no user enumeration) | Security |
| A3 | Login with correct email but wrong password returns 401 | Security |
| A4 | Login with `isActive: false` user returns 401 | Business rule |
| A5 | Login with email `USER@EXAMPLE.COM` matches lowercase record | Email normalization |
| A6 | Password reset token is invalidated after use | Token lifecycle |
| A7 | Password reset token expires after 1 hour | Token lifecycle |
| A8 | New reset request invalidates previous token | Token replacement |
| A9 | `GET /api/users/me` with no `Authorization` header returns 401 | Auth middleware |
| A10 | `GET /api/users/me` with `Bearer invalid.token.here` returns 401 | JWT validation |
| A11 | `GET /api/users/me` with token for a deactivated user returns 401 | Active check |
| A12 | `POST /auth/forgot-password` with non-existent email returns 200 (no enumeration) | Security |
| A13 | Password reset with new password not meeting complexity returns 400 | Validation |

---

### USER MANAGEMENT — `users.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| U1 | Create user with duplicate email returns 409 | Uniqueness |
| U2 | Create user with duplicate `employeeId` returns 409 | Uniqueness |
| U3 | Admin cannot deactivate their own account | Self-deactivation rule |
| U4 | Assigning `teamLeadId` that is a `cc_agent` (not team lead) returns 400 | Role validation |
| U5 | Creating `cc_agent` without a `teamLeadId` returns 400 | Required field |
| U6 | `cc_agent` cannot access `GET /api/users` (admin only) | RBAC |
| U7 | Multi-role user switching via `X-Active-Role` header accesses correct endpoints | Role switching |
| U8 | User cannot switch to a role they don't have via `X-Active-Role` | Role security |
| U9 | Updating user email to an already-used email returns 409 | Update uniqueness |
| U10 | `GET /api/users/:id/team` returns only agents under that team lead | Team scoping |
| U11 | `GET /api/users/:id/team` for a non-team-lead returns 400 or empty | Role check |
| U12 | Deactivating user clears them from future task assignment | Cascade check |

---

### TASK STATE MACHINE — `tasks.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| T1 | Newly sampled task has status `unassigned` | Initial state |
| T2 | Assigning task to agent changes status to `sampled_in_queue` | Transition |
| T3 | `interactionHistory` is appended on every status change | Audit trail |
| T4 | `completed` task cannot be moved back to `in_progress` | Missing state machine |
| T5 | `invalid_number` task cannot be assigned to an agent | Missing guard |
| T6 | Task with `callLog` present cannot have callLog overwritten | Immutability |
| T7 | Agent can only see their own assigned tasks, not others' | Data isolation |
| T8 | Team lead can see all tasks in their territory | Scope rule |
| T9 | Call log submission with `callStartedAt` in the future returns 400 | Missing validation |
| T10 | Call log with `activityQuality` outside 1-5 returns 400 | Bounds check |
| T11 | Call log with invalid `sentiment` enum returns 400 | Enum validation |
| T12 | Call log with `didAttend: 'Not a Farmer'` does not require purchase fields | Conditional logic |

---

### CALLBACK LOGIC — `tasks.test.ts` (continued)

| # | Test | What it catches |
|---|------|----------------|
| CB1 | Creating callback from `callbackNumber: 0` task creates task with `callbackNumber: 1` | Happy path |
| CB2 | Creating callback from `callbackNumber: 1` task creates task with `callbackNumber: 2` | Second callback |
| CB3 | Cannot create a callback from a task with `callbackNumber: 2` (already at max) | Max limit |
| CB4 | Cannot create two callbacks from the same parent task | Duplicate prevention |
| CB5 | `retryCount` on callback task equals parent `retryCount + 1` | Counter logic |
| CB6 | Callback assigned agent has language capability for farmer's language | Bug #5 |
| CB7 | Callback inherits correct `activityId` and `farmerId` from parent | Data integrity |
| CB8 | Legacy task with no `callbackNumber` field is eligible for one callback | Bug #4 |

---

### SAMPLING SERVICE — `samplingService.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| S1 | 10% of 100 farmers = 10 tasks created | Basic math |
| S2 | `minFarmersToSample: 5` on activity with 3 farmers creates 3 tasks (not 5) | Min cap |
| S3 | `maxFarmersToSample: 3` on activity with 20 farmers creates exactly 3 tasks | Max cap |
| S4 | When `minFarmersToSample > maxFarmersToSample`, max wins | Bug #1 |
| S5 | Farmer in cooling period is excluded from sampling | Cooling rule |
| S6 | Activity with all farmers in cooling becomes `inactive` | Lifecycle transition |
| S7 | Ad-hoc run skips farmers already sampled in that activity | Ad-hoc rule |
| S8 | First-sample run sets `activity.firstSampleRun = true` | Flag |
| S9 | Activities with `lifecycleStatus: 'inactive'` are excluded from first-sample | Eligibility |
| S10 | Activities with ineligible activity type are excluded even with `forceRun: true` | Type gate |
| S11 | Sampling run with 0 matched activities sets run status to `completed` (not hanging) | Edge case |
| S12 | Sampling creates audit records for each sampled farmer | Audit trail |
| S13 | Concurrent sampling runs: second run is rejected while first is in progress | Concurrency |
| S14 | `reservoirSampling()` never returns duplicates | Bug #3 |
| S15 | Run capped at 5000 activities even if more exist | Safety cap |

---

### EXCEL IMPORT — `excelImport.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| EX1 | Valid Excel with Activities + Farmers sheet imports successfully | Happy path |
| EX2 | Excel missing "Farmers" sheet returns clear error | Validation |
| EX3 | Farmer with 9-digit mobile number is rejected with error row reference | Bug #10 |
| EX4 | Farmer with 11-digit mobile number is rejected | Bug #10 |
| EX5 | Duplicate `activityId` rows in Excel: last row does not silently overwrite first | Bug #12 |
| EX6 | Same farmer mobile in two different activities creates one Farmer doc | Deduplication |
| EX7 | Invalid state name falls back to English but logs a warning (not silently) | Bug #11 |
| EX8 | Date in `DD/MM/YYYY` format parsed correctly | Date parsing |
| EX9 | Date in Excel serial number format parsed correctly | Date parsing |
| EX10 | Activity with all invalid farmers creates activity with empty `farmerIds` | Edge case |
| EX11 | Progress state is reset properly after import completes or fails | State cleanup |
| EX12 | Import file > 25MB is rejected at upload | Size limit |
| EX13 | Excel with 10,000 rows completes without timeout | Performance |

---

### MASTER DATA — `masterData.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| MD1 | Creating crop `"Rice"` then `"rice"` returns 409 (case-insensitive dup) | Case-insensitive rule |
| MD2 | Creating crop with name containing regex chars (`"Corn (Yellow)"`) succeeds | Regex escaping |
| MD3 | Deactivating a crop removes it from dropdown but keeps it in DB | Soft delete |
| MD4 | Bulk deactivate with empty array returns 200 with 0 affected | Edge case |
| MD5 | Reactivating a deactivated crop allows creation of new with same name | Business rule clarification |
| MD6 | `GET /api/master-data/crops` (public dropdown) returns only active records | Filter |
| MD7 | `GET /api/admin/master-data/crops` (admin) returns all including inactive | Admin visibility |

---

### FFA SYNC — `ffa.test.ts`

| # | Test | What it catches |
|---|------|----------------|
| F1 | Sync with no prior activities fetches from FFA and creates records | Full sync |
| F2 | Incremental sync only fetches activities after last sync minus 1 hour | Incremental logic |
| F3 | Second sync call within 10 minutes is rejected | Rate limiting |
| F4 | Activity with empty `state` field uses territory to derive state | State fallback |
| F5 | Activity with empty `state` AND empty `territory` is handled gracefully (not stored with empty state) | Bug #9 |
| F6 | Same `activityId` in two syncs upserts (not duplicates) | Idempotency |
| F7 | Sync sets `syncedAt` timestamp on each activity | Tracking |
| F8 | FFA API returns 500 — sync fails gracefully, does not corrupt existing data | Error resilience |
| F9 | Batch deletion of import that has tasks with calls is blocked | Safety rule |
| F10 | Batch deletion of import with only unworked tasks succeeds | Happy path |

---

### RBAC / PERMISSIONS — across test files

| # | Test | What it catches |
|---|------|----------------|
| P1 | `cc_agent` cannot access `POST /api/sampling/run` | Sampling restricted |
| P2 | `team_lead` cannot access `POST /api/users` (create user) | User mgmt restricted |
| P3 | `mis_admin` can access all admin endpoints | Admin access |
| P4 | `core_sales_head` and `marketing_head` are read-only | Analytics-only roles |
| P5 | Unauthenticated request to any protected route returns 401 | Auth middleware |
| P6 | Any role can call `GET /api/health` | Public endpoint |

---

## Bugs Identified in Code Review

| # | Bug | Location | Severity |
|---|-----|----------|----------|
| 1 | `minFarmersToSample > maxFarmersToSample` not enforced — min wins over max | `samplingService.ts:234` | High |
| 2 | Inefficient duplicate task check loads all tasks into memory | `samplingService.ts:219-220` | Medium |
| 3 | `reservoirSampling()` not guaranteed to be deduplicated | `samplingService.ts:241` | Medium |
| 4 | Legacy tasks with no `callbackNumber` field handled inconsistently | `routes/tasks.ts:3569-3575` | High |
| 5 | Callback agent not validated for farmer's language capability | `routes/tasks.ts:3817-3850` | Medium |
| 6 | No upper bound on `retryCount` — can be manually inflated | `routes/tasks.ts:3832` | Low |
| 7 | Sync lock is in-memory — multiple server instances can sync simultaneously | `ffaSync.ts:311-312` | High |
| 8 | `lastSyncTime` is lost on server restart, allowing immediate re-sync | `ffaSync.ts:312, 574` | Medium |
| 9 | Activity with empty state AND empty territory stored with `state: ''` silently | `ffaSync.ts:230-232` | High |
| 10 | Farmer mobile number not validated before upsert — silent DB rejection | `excelImport.ts:289, 293` | High |
| 11 | Invalid state name silently defaults to English with no user-visible error | `excelImport.ts:243-250` | High |
| 12 | Duplicate `activityId` rows in Excel silently overwrite each other | `excelImport.ts:213` | High |
| 13 | Farmer deduplication is per-activity only — cross-activity data may be stale | `excelImport.ts:301` | Medium |

---

## Priority Order for Implementation

### Phase 1 — Critical (fix bugs + guard core workflows)
S4, S14, CB3, CB4, EX3, EX5, T4, T5, F5

### Phase 2 — High (data integrity)
A2, A11, U3, U8, T9, EX7, EX11, CB8, F8

### Phase 3 — Coverage (happy paths + regression)
All remaining tests
