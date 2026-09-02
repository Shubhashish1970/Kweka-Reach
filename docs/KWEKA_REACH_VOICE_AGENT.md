# Kweka Reach — Voice Agent Integration

**Status:** In dev — Reach integration largely complete (orchestrator, webhook, Voice Agents admin, team-lead controls, test trigger). **Open:** V16 per-agent safe dial (UI + wiring), ops E2E (§12.0 R8–R9, §13 C3–C11). **Tracker:** §12.0 (Reach), §13 C1–C14 (Calling agent), §14.7 V1–V16 (admin).
**Audience:** Product, engineering, voice platform partners  
**Related:**
- **`docs/kweka_reach_api_integration.md`** — **Voice tool outbound contract (authoritative)** — endpoint shape, headers, and `initial_context` fields Reach must send
- `docs/kweka_reach_integration_guide.pdf` (webhook patterns + broader integration notes)
- Voice platform codebase: [kw-ai-calling-agent](https://github.com/Kweka-AI-Solutions-Private-Limited/kw-ai-calling-agent) (Dograh — implementation reference)

---

## 1. Executive summary

Kweka Reach will support **virtual call-centre agents** that behave like human agents on the same task queue, but place calls through the **Kweka voice platform** (Dograh) instead of the manual dialer UI.

- Admins create virtual agents with the **same language skills** as human `cc_agent` users.
- Reach decides **who to call, when, and in which language**; the voice platform runs the **conversation workflow**, captures answers, and returns **structured JSON** via webhook.
- Reach **validates and persists** results using the **same task lifecycle and `callLog` model** as human agents (`POST /api/tasks/:id/submit` semantics).
- **Callbacks and retries** are governed entirely by **Reach business rules**; Reach initiates every outbound attempt. The voice platform does **not** own the callback calendar (do not use Dograh **Campaigns** for Reach scheduling).

This keeps EMS reporting, agent history, team allocation, and sampling unchanged. Voice is a **transport and conversation layer**, not a parallel CRM.

---

## 2. Voice platform overview (kw-ai-calling-agent)

The voice product is built on **Dograh** and branded for Kweka.

| Component | Path | Role |
|-----------|------|------|
| **Backend** | `dograh-backend/api` | FastAPI — workflows, runs, public trigger API, webhooks, telephony, campaigns |
| **Frontend** | `dograh-frontend` | Next.js visual **workflow builder** (nodes, pathways, publish/draft) |
| **Pipecat** | `dograh-backend/pipecat` | Real-time voice pipeline (STT / LLM / TTS, voicemail detection, end-call reasons) |

A **voice agent** = a **workflow** (directed graph of conversation nodes), versioned (draft vs published), scoped per organisation, with a stable **Agent UUID** (`workflow_uuid`).

### 2.1 Workflow building blocks (voice-owned)

| Node / feature | Purpose |
|----------------|---------|
| **Start Call** | Greeting; one per workflow |
| **Agent** | Prompt-driven conversation stage; pathways between nodes |
| **Global** | Shared instructions appended across nodes |
| **End Call** | Final message + optional variable extraction |
| **API Trigger** | Alternative trigger UUID (see §5.1) |
| **Webhook** | POST results to Reach after run completes |
| **Pre-Call Data Fetch** | Optional HTTP **POST** to Reach when call connects (Dograh → Reach) |
| **Tools / Knowledge Base** | APIs, transfer, MCP, RAG documents |

Reach does **not** author or version these graphs in admin UI.

---

## 3. Goals

| Goal | Description |
|------|-------------|
| **Parity with humans** | Virtual agents use the same queue, languages, team structure, and submission outcomes as human agents. |
| **Separation of concerns** | Reach owns data and workflow state; voice platform owns telephony, speech, and question scripts. |
| **No duplicate data model** | Call outcomes land in existing `CallTask` + `callLog` records — not a separate farmer-sync silo. |
| **Controlled callbacks** | All redials and scheduled callbacks follow Reach rules (dates, max attempts, business hours). |
| **Single integration pattern** | Per-task API trigger from Reach orchestrator — not bulk Campaign retry on the voice side. |

---

## 4. Responsibility split

| Responsibility | Owner | Notes |
|----------------|--------|-------|
| Farmer & activity data | **Kweka Reach** | From FFA sync, sampling, allocation |
| Task queue & assignment | **Kweka Reach** | `sampled_in_queue` → agent by language + team |
| Language matching | **Kweka Reach** | Agent `languageCapabilities` ↔ farmer `preferredLanguage` |
| When to dial (including callbacks) | **Kweka Reach** | Orchestrator + existing callback rules + per-agent calling window (§14) |
| Question script / conversation flow | **Voice platform** | Workflow per **virtual agent** (Calling agent UI); Reach stores **trigger UUID** only |
| Outbound call, STT/TTS, branching | **Voice platform** | Telephony: Exotel, Twilio, Plivo, Vonage, Telnyx, etc. |
| Map voice answers → JSON | **Voice platform** | `gathered_context` extraction + webhook template |
| Persist outcome, update task status | **Kweka Reach** | Same path as `POST /api/tasks/:id/submit` |
| EMS / reports / agent history | **Kweka Reach** | Unchanged — reads existing task data |

**Reach is not the source of truth for what questions to ask.**  
**Reach is the source of truth for who to call and what happened after each attempt.**

---

## 5. Virtual agent concept (Reach)

### 5.1 Same role, different execution mode

| Attribute | Human agent | Virtual (voice) agent |
|-----------|-------------|------------------------|
| Role | `cc_agent` | `cc_agent` |
| Kind | `agentKind: human` | `agentKind: virtual` |
| Language skills | Multi-select from Languages master | **Same** multi-select |
| Team lead | Required | **Same** |
| Queue eligibility | Tasks where farmer language ∈ agent languages | **Same** |
| How a call is placed | Agent uses dialer UI in Agent Workspace | Reach orchestrator calls voice API |
| How answers are captured | Agent fills `CallInteractionForm` | Voice webhook → mapped to `callLog` |

### 5.2 Language skills (aligned with human agents)

When defining an agent in User Management:

- Admin selects **language capabilities** exactly as for a human agent (e.g. Hindi, Telugu, Tamil).
- Allocation logic remains: a task is eligible only if `farmer.preferredLanguage` is in the agent’s `languageCapabilities`.
- No separate language UX outside the agent record.

### 5.3 Calling agent binding (per virtual agent — not Languages master)

A **Reach virtual agent** (e.g. Riya, `VA00001`) is a normal `cc_agent` user with its **own assigned task queue**. The **Calling agent** (Dograh) workflow/script is authored in the Calling agent UI; Reach only stores the **integration pointer** on that virtual agent.

| Layer | What it is | Where configured |
|-------|------------|------------------|
| **Reach CC agent** | User with `agentKind: virtual`, languages, team lead, assigned tasks | User Management |
| **Calling agent workflow** | Conversation graph, prompts, extraction | Calling agent (Dograh) UI |
| **API Trigger UUID** (or workflow UUID path) | Which Dograh endpoint Reach POSTs to for **this** virtual agent | **Voice Agents admin** (§14) — per agent |
| **Languages master** | Reach operational language (skills, farmer matching) | Master Management — **not** the primary place for voice trigger UUID |

**Agreed model (product):**

- Each virtual agent has its own **`voiceTriggerUuid`** (API Trigger UUID in dev; workflow UUID path optional in prod).
- `initial_context.agent_name` uses the virtual agent’s display name (e.g. `riya`) — agent-centric, as in §8.5.
- Orchestrator dequeues from **`getNextTaskForAgent(thatAgentId)`** — Riya’s queue only — then triggers **that agent’s** UUID.
- Language matching already happened at **allocation**; the trigger is **not** resolved from Languages master in the target design.

**Current implementation note:** Trigger UUID is stored **per virtual agent** on Voice Agents admin. Languages master field is deprecated (schema retained for legacy data only).

### 5.4 Two meanings of “agent”

| Term | System | Example |
|------|--------|---------|
| **Virtual CC agent** | Kweka Reach `User` | Riya — queue, workspace, EMS history |
| **Voice workflow / API trigger** | kw-ai-calling-agent (Dograh) | Published graph + trigger UUID linked from Reach |

Do not conflate Reach **language capabilities** with Calling agent **integration config**.

## 6. Dograh data model (context variables)

Dograh passes data through three layers relevant to Reach integration:

```
initial_context  ──►  Agent prompts ({{farmer_name}}, etc.)
        │
   [optional Pre-Call Data Fetch from Reach]
        │
   Conversation + extraction
        │
gathered_context  ──►  Webhook payload to Reach
```

| Object | Set by | Used for |
|--------|--------|----------|
| **`initial_context`** | Reach on trigger (or Pre-Call Data Fetch response) | Template variables in agent prompts: `{{farmer_name}}` (not `{{initial_context.farmer_name}}` in prompts) |
| **`gathered_context`** | Extraction on Agent / End Call nodes during call | Structured survey answers → webhook → Reach `callLog` |
| **`workflow_run_id`** | Dograh on call start | Idempotency, recordings, transcripts, run lookup |

### 6.1 Webhook payload variables (Dograh → Reach)

Configured in the workflow **Webhook node** template:

| Variable | Description |
|----------|-------------|
| `{{workflow_run_id}}` | Unique run ID (use as `call_attempt_id`) |
| `{{workflow_id}}` / `{{workflow_name}}` | Agent metadata |
| `{{call_time}}` | ISO-8601 UTC call start |
| `{{initial_context.*}}` | Everything Reach sent at trigger |
| `{{gathered_context.*}}` | Extracted answers (must mirror `callLog` fields) |
| `{{cost_info.call_duration_seconds}}` | Duration |
| `{{recording_url}}` / `{{transcript_url}}` | Optional artifacts |

Webhook auth on Dograh side: API key header, Bearer, Basic, or custom header — must match Reach inbound endpoint.

---

## 7. End-to-end flow

```mermaid
sequenceDiagram
  participant Admin as Reach Admin
  participant Reach as Kweka Reach
  participant Orch as Reach Orchestrator
  participant Voice as kw-ai-calling-agent
  participant Farmer as Farmer

  Admin->>Reach: Create virtual cc_agent (User Mgmt) + Voice Agents config
  Admin->>Voice: Publish workflow + API trigger for Riya (Dograh UI)
  Admin->>Reach: Set Riya voiceTriggerUuid + start/stop on Voice Agents admin
  Reach->>Reach: Sampling & TL allocation → tasks assigned to Riya
  Orch->>Reach: getNextTaskForAgent(Riya) when running & in calling window
  Reach->>Reach: Mark task in_progress
  Orch->>Voice: POST /public/agent/test/{riya_trigger_uuid} (dev) or prod path
  Note over Orch,Voice: initial_context: task_id, attempt_id, farmer, activity
  opt Pre-Call Data Fetch
    Voice->>Reach: GET task/farmer context
    Reach-->>Voice: Enriched JSON
  end
  Voice->>Farmer: Outbound call + workflow script
  Farmer->>Voice: Spoken answers
  Voice->>Voice: gathered_context extraction
  Voice->>Reach: Webhook POST (callLog-shaped JSON)
  Reach->>Reach: Validate → submit logic → DB
  alt Terminal outcome
    Reach->>Reach: completed / not_reachable / invalid_number
  else Callback later
    Reach->>Reach: Apply Reach rules; wait until due
  end
  Orch->>Reach: Next task when ready
```

---

## 8. API contract

### 8.0 Voice tool specification (authoritative — follow this)

**Source:** `docs/kweka_reach_api_integration.md` (provided by the Voice / Calling agent team).

Reach **must** implement outbound triggers per this document:

| Item | Voice tool spec |
|------|-----------------|
| **Method** | `POST` |
| **Dev base URL** | `https://35.234.218.115.sslip.io` |
| **Path pattern** | `/api/v1/public/agent/test/{trigger_uuid}` |
| **Headers** | `Content-Type: application/json` |
| **Body** | `{ "phone_number": "+91…", "initial_context": { … } }` |
| **Success** | HTTP 200/202 — voice platform queues outbound call immediately |

**`initial_context` fields (Voice tool — all required for script personalization):**

| Key | Example |
|-----|---------|
| `farmer_name` | `Deepak` |
| `agent_name` | `riya` |
| `village_name` | `Banswada` |
| `mdo_name` | `raviteja` |
| `event_date` | `04-08-2026 19:34 PM` |
| `product_name` | `Atonik-growth regulator` |

The Voice tool doc uses a **fixed dev trigger UUID** (`e5a72e34-d77d-46f3-8645-5bdff1e560dc`) as an example. In Reach production, replace this with **each virtual agent’s UUID** from Voice Agents admin (§14). The URL pattern stays the same.

**Reach compliance:** `buildVoiceInitialContext()` and the orchestrator send exactly these six keys (plus Reach extensions below). Admin **Test trigger** uses the same payload shape as the Voice tool manual examples.

### 8.1 Outbound — Reach → Voice platform

**Primary route (matches Voice tool + Reach implementation):** API Trigger UUID on the **test** path (dev/draft) or **production** path when published.

| Environment | Endpoint |
|-------------|----------|
| Test (draft) | `POST {VOICE_API_BASE}/api/v1/public/agent/test/{trigger_uuid}` |
| Production | `POST {VOICE_API_BASE}/api/v1/public/agent/{trigger_uuid}` |

**Alternative route** (Dograh workflow UUID — only if Voice team configures `triggerRouteType: workflow`):

| Test | `POST {VOICE_API_BASE}/api/v1/public/agent/test/workflow/{workflow_uuid}` |
| Production | `POST {VOICE_API_BASE}/api/v1/public/agent/workflow/{workflow_uuid}` |

Do **not** mix UUID types — API Trigger UUID ≠ workflow UUID.

#### Reach extensions (on top of Voice tool spec)

These fields are **not** in `kweka_reach_api_integration.md` but are **required for Reach production** (webhook loop-back):

| Key | Status | Purpose |
|-----|--------|---------|
| `task_id` | **Required — keep** | `CallTask` ObjectId — webhook maps result to correct task; ensures accurate data exchange |
| `attempt_id` | **Sent today; full enforcement deferred** | New UUID per dial — see §8.1.1 |

Optional Reach field (harmless extra context for prompts):

| Key | Purpose |
|-----|---------|
| `preferred_language` | Farmer `preferredLanguage` |

#### 8.1.1 `attempt_id` — deferred for concurrent scenarios

Reach **sends** `attempt_id` on every orchestrated call for traceability. Webhook idempotency today relies on **`workflow_run_id`** only.

With a **single virtual agent and no concurrent calls**, this is sufficient for now. When multiple agents or overlapping calls are introduced, Reach must:

- [x] Enforce idempotency on `(task_id, attempt_id)` in addition to `workflow_run_id`
- [x] Reject or ignore duplicate webhooks for stale `attempt_id`
- [~] Surface `attempt_id` in admin audit / stuck-task tooling (receipts store attemptId; audit on test trigger)

#### Safe dial override (per virtual agent — do not call farmers on dev)

**Agreed approach:** per agent on **Voice Agents admin** (not GitHub / global env).

| Field | Type | Behaviour |
|-------|------|-----------|
| `voiceDialOverrideEnabled` | Yes / No | When **Yes**, orchestrator dials `voiceDialOverrideNumber` instead of farmer mobile |
| `voiceDialOverrideNumber` | Single E.164 or 10-digit | Team safe number for dev/UAT |

- Farmer data in `initial_context` stays real (names, village, etc.) — only the **dialed number** changes.
- **Unset / No** in production when ready to call real farmers.
- Admin **Test trigger** continues to use the number entered in the UI.
- ~~`VOICE_OVERRIDE_DIAL_TO` env var~~ — **not used** (superseded by per-agent setting).

**Implementation status:** schema + dial resolver partial — **UI, API save, orchestrator wiring pending** (see V16 §14.7).

#### Platform auth (coordinate with Voice team)

The Voice tool integration guide lists only `Content-Type`. The Dograh platform (`public_agent.py`) also requires **`X-API-Key`** for org authentication. Reach sends this via `VOICE_API_KEY`. Confirm the key with the Voice team for each environment.

#### Dograh optional request fields (not in Voice tool doc)

| Field | Notes |
|-------|-------|
| `telephony_configuration_id` | Override org default outbound line |
| `voice` / `language` | Optional TTS overrides |

**Dograh error responses:**

| HTTP | Cause |
|------|--------|
| `400` | Telephony not configured, or call failed to initiate |
| `401` | Missing or invalid `X-API-Key` |
| `403` | API key org does not own this trigger |
| `404` | Trigger not found, inactive, or not published |

**Test vs production (Dograh):**

| URL | Runs |
|-----|------|
| `/public/agent/test/{uuid}` | Latest **draft**; falls back to published if no draft |
| `/public/agent/{uuid}` | **Published** definition only |

<Warning>
Voice tool dev URL uses the **test** path. After workflow edits, the test path sees drafts; the production path needs an explicit **publish** in the Calling agent UI.
</Warning>

#### Field mapping (Voice tool keys → Reach data)

| Voice tool `initial_context` key | Reach source |
|----------------------------------|--------------|
| `farmer_name` | `Farmer.name` |
| `agent_name` | Virtual `cc_agent` display name (lowercase in examples, e.g. `riya`) |
| `village_name` | Farmer location / activity village |
| `mdo_name` | Activity `officerName` |
| `event_date` | Activity date (display format `DD-MM-YYYY HH:MM AM/PM`) |
| `product_name` | First product on activity |

**Request body — Voice tool shape (manual / admin test trigger):**

```json
{
  "phone_number": "+919396792409",
  "initial_context": {
    "farmer_name": "Deepak",
    "agent_name": "riya",
    "village_name": "Banswada",
    "mdo_name": "raviteja",
    "event_date": "04-08-2026 19:34 PM",
    "product_name": "Atonik-growth regulator"
  }
}
```

**Request body — Reach orchestrator (Voice tool fields + extensions):**

```json
{
  "phone_number": "+919396792409",
  "initial_context": {
    "task_id": "<Reach CallTask ObjectId>",
    "attempt_id": "<uuid per dial attempt>",
    "farmer_name": "Deepak",
    "agent_name": "riya",
    "village_name": "Banswada",
    "mdo_name": "raviteja",
    "event_date": "04-08-2026 19:34 PM",
    "product_name": "Atonik-growth regulator"
  },
  "telephony_configuration_id": null
}
```

> **JSON note:** All keys must be double-quoted strings.

**Success response:**

```json
{
  "status": "initiated",
  "workflow_run_id": 12345,
  "workflow_run_name": "WR-API-7823"
}
```

Store `workflow_run_id` on the task for correlation and idempotency.

### 8.2 Optional — Pre-Call Data Fetch (Dograh → Reach)

Instead of a large `initial_context`, Dograh can call Reach **when the call connects** to load farmer/task fields before the agent speaks. Configured on the workflow **Start Call** node (Advanced → Pre-Call Data Fetch).

| Item | Detail |
|------|--------|
| **Method** | `POST` (not GET) |
| **Dograh request** | `{ "event": "call_inbound", "call_inbound": { "agent_id", "from_number", "to_number" } }` |
| **Reach response** | JSON with `initial_context` object (or nested under `call_inbound.initial_context`) |
| **Reach endpoint** | **Not built yet** — planned read-only authenticated API |

Useful if context changes between queue time and dial time. For Reach v1, `initial_context` at trigger time is sufficient.

### 8.3 Inbound — Dograh → Reach

After the run completes, Dograh executes the workflow **Webhook node** asynchronously.

**Reach implementation:** authenticated `POST` endpoint that maps payload → existing submit logic (not a separate `/farmers/sync` silo — that URL in the PDF is an example only).

| Voice / webhook field | Reach |
|-----------------------|--------|
| `initial_context.task_id` | Target `CallTask` |
| `workflow_run_id` + `attempt_id` | Idempotency (reject duplicates) |
| Telephony / end reason | `callLog.callStatus`, task `status` |
| `cost_info.call_duration_seconds` | `callLog.callDurationSeconds` |
| `gathered_context.*` | `callLog` survey fields |
| `recording_url` / `transcript_url` | Optional extension fields |

**Dograh webhook delivery notes (from `developer/webhooks.mdx`):**

- Webhook nodes run **asynchronously** after run completes.
- Reach should respond **2xx within ~30 seconds**.
- **Duplicate deliveries** are possible — Reach dedupes on `workflow_run_id`.
- Default: non-2xx responses are **logged, not retried** (unless Dograh `retry_config` set on node).
- Multiple webhook nodes per workflow are allowed.
- `campaign_id` is **null** for ad-hoc API-trigger runs (Reach path).
- `annotations` available if workflow has a **QA node**.

### 8.4 Dispositions (mapping reference)

Dograh reports telephony and end-of-call reasons separately. Reach maps these to task outcomes and callback rules.

**Telephony (`TelephonyCallStatus`):** `busy`, `no-answer`, `failed`, `canceled`, `completed`, etc.

**End-task reasons (pipecat):** `end_call_tool`, `user_hangup`, `voicemail_detected`, `pipeline_error`, `call_duration_exceeded`, `system_connect_error`, etc.

**Extracted fields (`gathered_context`):** e.g. `callback_requested`, `callback_time`, survey answers — defined per workflow extraction schema. Reach team agrees the extraction variable names once; Calling agent workflow authors configure matching prompts.

### 8.5 Dev test environment (Voice tool example)

Matches `docs/kweka_reach_api_integration.md`:

| Item | Value |
|------|--------|
| **Base URL** | `https://35.234.218.115.sslip.io` |
| **Test endpoint** | `POST https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc` |
| **Example trigger UUID** | `e5a72e34-d77d-46f3-8645-5bdff1e560dc` (Riya dev — set per agent in Voice Agents admin) |
| **Headers (Voice tool)** | `Content-Type: application/json` |
| **Headers (Reach also sends)** | `X-API-Key: <org_api_key>` via `VOICE_API_KEY` |

**Example `curl` (manual test):**

```bash
curl -X POST \
  'https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "phone_number": "+919396792409",
    "initial_context": {
      "farmer_name": "Deepak",
      "agent_name": "riya",
      "village_name": "Banswada",
      "mdo_name": "raviteja",
      "event_date": "04-08-2026 19:34 PM",
      "product_name": "Atonik-growth regulator"
    }
  }'
```

**Reach env vars (dev):**

| Variable | Example value |
|----------|----------------|
| `VOICE_API_BASE_URL` | `https://35.234.218.115.sslip.io` |
| `VOICE_API_KEY` | Org API key (secret) |
| `VOICE_TRIGGER_UUID` | Dev-only **global fallback** when per-agent UUID unset (interim) |
| `VOICE_WEBHOOK_API_KEY` | Shared secret Calling agent sends on webhook (`X-API-Key` or `X-Voice-Webhook-Key`) |
| `VOICE_ORCHESTRATOR_ENABLED` | `true` to poll virtual agent queues |
| `VOICE_ORCHESTRATOR_INTERVAL_SEC` | Poll interval (default `30`) |
| `VOICE_USE_TEST_ENDPOINT` | `true` (default) → `/public/agent/test/{uuid}` |
| `VOICE_STUCK_TASK_MINUTES` | Release stuck `in_progress` voice tasks (default `15`) |
| `REACH_PUBLIC_API_URL` | Public Reach API base (for webhook URL display; set on deploy) |
| `USER_VIRTUAL_AGENT_DEFAULT_PASSWORD` | Default login password for virtual CC agents (min 8 chars; dev fallback `Nacl@1234` if unset) |
| `USER_DEFAULT_RESET_PASSWORD` | Fallback for human admin reset and virtual agents if virtual-specific var unset |

Reach webhook URL for Calling agent to configure: `POST {REACH_API}/api/voice/webhook`

Production: each virtual agent’s trigger UUID is stored on the **Voice Agents admin** record (§14). Do **not** use Languages master as the long-term store for trigger UUIDs.

---

## 9. Callbacks and retries — Reach initiates

| | Kweka Reach | Voice platform (Dograh) |
|---|-------------|-------------------------|
| Callback business rules | Yes | No |
| Next dial time | Reach queue + `scheduledDate` | Executes only when Reach triggers API |
| Max callbacks (2 per farmer+activity) | Reach `callbackNumber` model | N/A |

**Do not use Dograh Campaigns** for Reach task callbacks. Campaigns include built-in `retry_config` (max attempts, intervals) and bulk scheduling — that duplicates and conflicts with Reach-owned callback logic. Use **per-task API triggers** from the Reach orchestrator only.

Voice may handle **in-call technical events** (voicemail detection, user hangup) on a single attempt; **business callbacks** are always Reach-driven.

---

## 10. Task lifecycle in Reach (unchanged)

| Stage | Task status | Human | Virtual |
|-------|-------------|-------|---------|
| Queued | `sampled_in_queue` | Agent sees in dialer | Orchestrator polls |
| Active | `in_progress` | Load in workspace | Before voice API call |
| Done | `completed`, `not_reachable`, `invalid_number`, … | Form submit | Webhook → submit |
| Follow-up | `isCallback`, `callbackNumber` 1–2 | Manual / rules | Same rules after webhook |

### 10.1 `callLog` fields (voice must populate via `gathered_context`)

- Call status, duration, attendance, recall
- Crops / products discussed, purchase intent, dates
- Farmer comments, sentiment, activity quality (where applicable)

---

## 11. What exists today

### 11.1 Kweka Reach — core platform (unchanged)

- `cc_agent` users with `languageCapabilities` and team lead
- Task queue, sampling, allocation, language filtering
- Agent Workspace + `CallInteractionForm` (human dialer)
- `POST /api/tasks/:id/submit` + full `callLog` schema
- Callback model (`isCallback`, `callbackNumber`, max 2)
- EMS / agent history from task data

### 11.2 Kweka Reach — voice integration (built)

| Area | Status | Notes |
|------|--------|-------|
| `agentKind: human \| virtual` on `User` | Done | Default `human` |
| Users API + User Management UI | Done | Human / Virtual selector, Virtual badge |
| Virtual agent default password | Done | `USER_VIRTUAL_AGENT_DEFAULT_PASSWORD`; create without password |
| Auth profile `agentKind` | Done | Login + `GET /api/auth/me` |
| Virtual agent workspace theme | Done | Violet UI for `agentKind: virtual` |
| Agent Queues — voice agent cards | Done | Violet cards + `agentKind` in admin API |
| Voice API client | Done | `voiceApiClient.ts` — test trigger path |
| Orchestrator worker | Done | Cron; reads `VoicePlatformSettings` + per-agent config |
| Webhook `POST /api/voice/webhook` | Done | Maps to shared submit handler |
| Idempotency | Done | `VoiceWebhookReceipt` on `workflow_run_id` |
| Task fields | Done | `voiceWorkflowRunId`, `voiceAttemptId` on `CallTask` |
| Stuck-call release | Done | Configurable via platform settings / env |
| Concurrency | Done | 1 active voice call per virtual agent |
| `GET /api/voice/status` | Done | Non-secret config probe |
| `GET /api/voice/agent-status` | Done | Read-only banner for virtual agent workspace |
| Deploy workflow secrets | Done | GitHub Actions → Cloud Run for voice env vars |
| `REACH_PUBLIC_API_URL` on deploy | Done | Set post-deploy on Cloud Run |
| Voice verify script / CI | Done | `scripts/verify-voice-config.sh` + GitHub workflow |
| Unit tests (helpers) | Partial | `voiceWebhook.test.ts` — mapping + E.164 only |
| Languages master `voiceTriggerUuid` | **Deprecated** | Removed from UI/API; use Voice Agents admin per agent |
| Voice Agents admin page | **Done** | Admin → Voice Agents tab (§14) |
| Per-agent start/stop & calling hours | **Done** | Orchestrator + admin UI |
| Test trigger API + UI | **Done** | Admin + team lead |
| Team lead voice controls | **Done** | `/api/team/voice/*` + Team Lead tab |
| Per-agent UUID orchestration | **Done** | No longer uses Languages master |
| Per-agent safe dial override | **Done** | Voice Agents admin UI + orchestrator |
| `attempt_id` concurrent idempotency | **Done** | Stale attempt rejection + receipt index |
| `triggerRouteType: workflow` path | **Done** | Per-agent setting + `voiceApiClient` |
| Platform `useTestEndpoint` in orchestrator | **Done** | DB setting drives trigger URL |
| Cloud Run voice secrets set | **Pending ops** | API/orchestrator inactive until configured |
| E2E with Calling agent webhook | **Pending ops** | Needs secrets + Dograh webhook node aimed at Reach |

### 11.3 Calling agent (kw-ai-calling-agent — ready)

- Workflow builder UI, publish/draft, Agent UUID per workflow
- Public outbound API (`/public/agent/workflow/{workflow_uuid}`)
- Webhook node with configurable payload templates
- Pre-Call Data Fetch node
- Telephony integrations (Exotel, Twilio, Plivo, Vonage, Telnyx, …)
- Run records, recordings, transcripts
- Org API keys (`X-API-Key`)

### 11.4 Calling agent (to build / configure for Reach)

See **§13 Task list — Calling agent**.

---

## 12. Task list — Kweka Reach (integration)

**Work in parallel with §13.** Marked `[x]` = done · `[~]` = partial · `[ ]` = not done / deferred.

### 12.0 Tracker summary (finalized from product discussion)

| # | Area | Status | Notes |
|---|------|--------|-------|
| **R1** | Virtual agent identity & violet UI | **Done** | `agentKind`, workspace, queues, passwords |
| **R2** | Voice Agents admin (Option B) | **Done** | Global settings + per-agent config (§14 V1–V14) |
| **R3** | Outbound per Voice tool spec | **Done** | Follow `kweka_reach_api_integration.md` six fields + test URL |
| **R4** | Reach extensions (`task_id`, `attempt_id`) | **Done** / **Deferred** | `task_id` required; `attempt_id` sent but V15 enforcement later |
| **R5** | Orchestrator (queue, hours, start/stop) | **Done** | Per-agent UUID, not Languages master |
| **R6** | Inbound webhook → submit | **Done** | Idempotent on `workflow_run_id` |
| **R7** | Team lead voice controls | **Done** | Start/stop/test for own agents |
| **R8** | Per-agent safe dial override | **Done** | V16 — Yes + single number on Voice Agents admin |
| **R9** | Cloud Run voice secrets + E2E | **[ ] Ops** | Secrets, Dograh webhook, verify script |
| **R10** | `workflow` UUID route + DB test flag | **Done** | `triggerRouteType` + `useTestEndpoint` wired in client |
| **R11** | Ops polish | **[~] Partial** | Metrics API + webhook rate limit + recording URLs; runbook in doc |

**Calling agent (§13):** webhook template, telephony, workflows per virtual agent, E2E — **mostly open** (Voice team).

### 12.1 Identity & admin UI

- [x] Add `agentKind: 'human' | 'virtual'` to `User` model (default `'human'`)
- [x] API: create/update/list users with `agentKind`; virtual agents require `teamLeadId` + `languageCapabilities`
- [x] User Management UI: CC Agent type selector (Human / Virtual)
- [x] User list: badge for Virtual agents
- [x] Virtual agent default password (`USER_VIRTUAL_AGENT_DEFAULT_PASSWORD` + admin reset)
- [x] Auth: return `agentKind` on login and `/api/auth/me`
- [x] Agent Workspace: violet theme for virtual agents
- [x] Agent Queues: violet voice-agent cards + `agentKind` in queue APIs
- [x] **Voice Agents admin page (Option B)** — see **§14**

### 12.2 Calling agent integration config

- [x] Outbound contract follows **`docs/kweka_reach_api_integration.md`** (Voice tool — six `initial_context` keys, test URL pattern)
- [x] Store Calling agent trigger UUID — **per virtual agent** on Voice Agents admin (§14)
- [x] Env vars / secrets support: `VOICE_API_BASE_URL`, `VOICE_API_KEY`, `VOICE_TRIGGER_UUID` (env fallback only), `VOICE_WEBHOOK_API_KEY`, orchestrator flags
- [x] GitHub Actions: pass voice + virtual-agent password secrets to Cloud Run deploy
- [x] Post-deploy: set `REACH_PUBLIC_API_URL`; verify `/api/voice/status`
- [x] Migrate orchestrator: per-agent UUID (Languages master removed from UI/API)
- [x] Per-agent **safe dial override** (`voiceDialOverrideEnabled` + `voiceDialOverrideNumber`) — see V16
- [x] Wire `triggerRouteType: workflow` → `/public/agent/workflow/{uuid}` in `voiceApiClient`
- [x] Wire platform `useTestEndpoint` from DB into orchestrator client (not env-only)

### 12.3 Outbound orchestrator

- [x] `initial_context` script fields: `farmer_name`, `agent_name`, `village_name`, `mdo_name`, `event_date`, `product_name` + `task_id`, `attempt_id` (§8.1)
- [x] Orchestrator: map task/farmer/activity → `initial_context`
- [x] Orchestrator: list active virtual `cc_agent` users
- [x] Orchestrator: `getNextTaskForAgent(agentId)` — assigned agent queue
- [x] Mark task `in_progress` before outbound call
- [x] Call Calling agent test API: `POST .../public/agent/test/{trigger_uuid}` (`VOICE_USE_TEST_ENDPOINT`)
- [x] Persist `workflow_run_id` on `CallTask` (`voiceWorkflowRunId`, `voiceAttemptId`)
- [x] Handle trigger failures (release task back to queue)
- [x] Stuck-task sweeper: `in_progress` > N minutes without webhook → release
- [x] Concurrency: 1 active call per virtual agent
- [x] Orchestrator: respect per-agent **running/paused** and **calling window** (§14)
- [x] Feature flag: `VOICE_ORCHESTRATOR_ENABLED` + platform DB toggle
- [x] Orchestrator: pass per-agent dial override to `resolveVoiceDialNumber` (V16)
- [x] Logging / metrics: `GET /api/admin/voice/metrics` summary
- [x] Do not delegate scheduling to Calling agent Campaigns (policy — documented in orchestrator)

### 12.4 Inbound webhook

- [x] Agree inbound webhook JSON schema aligned to `callLog` + task status (implemented in `mapVoiceWebhookToSubmitInput`)
- [~] Agree disposition → `callStatus` / task `status` mapping — **code exists; product sign-off pending**
- [x] Agree idempotency key: `workflow_run_id` (with `task_id`)
- [x] Optional: Pre-Call Data Fetch read API (`GET /api/voice/tasks/:id/context`)
- [x] Authenticated voice webhook endpoint (`requireVoiceWebhookKey`)
- [x] Map webhook body → internal submit handler (`submitCallInteractionForTask`)
- [x] Idempotency: dedupe on `workflow_run_id` (`VoiceWebhookReceipt`)
- [x] **`attempt_id` idempotency** for concurrent / multi-agent calls (§8.1.1)
- [~] Unit tests: mapping helpers only — **missing:** no answer E2E, partial survey, invalid number, duplicate webhook integration tests
- [x] On webhook: apply existing callback rules via shared submit service
- [x] Rate limiting on webhook endpoint
- [~] Runbook: stuck tasks, duplicate webhooks, Calling agent outage (ops notes in §12.5 + verify script)

### 12.5 EMS / reporting & go-live

- [x] Agent history / EMS: optional `recording_url` / `transcript_url` on `callLog`
- [ ] E2E dev test: orchestrator → call → webhook → task completed in Reach DB
- [x] Configure per-agent safe dial (V16) on dev agents before enabling orchestrator (UI + API ready)
- [ ] Cloud Run: set `VOICE_API_*` + `VOICE_WEBHOOK_API_KEY`; run `verify-voice-config` workflow

---

## 13. Task list — Calling agent (kw-ai-calling-agent)

**Work in parallel with §12.** Outbound trigger shape is defined in **`docs/kweka_reach_api_integration.md`** (Reach follows this). Webhook template below must echo `task_id` from `initial_context`.

| # | Task | Status |
|---|------|--------|
| C1 | Dev instance live | [x] |
| C2 | Dev API trigger UUID shared (`e5a72e34-…`) | [x] |
| C3 | Org API key (`X-API-Key`) shared securely with Reach | [ ] |
| C4 | Telephony configured for outbound on dev | [ ] |
| C5 | `initial_context` keys in workflow prompts (`{{farmer_name}}`, etc.) | [ ] |
| C6 | Outbound workflow **per virtual agent** (not per language) | [ ] |
| C7 | Workflow nodes: Start Call, Agent, Global, End Call, extraction | [ ] |
| C8 | `gathered_context` matches Reach `callLog` field names | [ ] |
| C9 | Webhook node → Reach `POST /api/voice/webhook` with template below | [ ] |
| C10 | Webhook auth matches Reach `VOICE_WEBHOOK_API_KEY` | [ ] |
| C11 | E2E: trigger → call → webhook on Reach dev | [ ] |
| C12 | Edge cases: voicemail, no-answer, busy, partial survey | [ ] |
| C13 | Confirm no Campaign retry for Reach (API trigger only) | [ ] |
| C14 | Runbook: draft vs publish URLs; publish without breaking runs | [ ] |

**Legacy checklist (detail):**
- [x] Dev instance: `https://35.234.218.115.sslip.io`
- [x] Dev test trigger: `POST /api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc`
- [ ] Org API key (`X-API-Key`, format e.g. `dg_…`) shared securely with Reach team
- [ ] Telephony configured for outbound on dev (e.g. Exotel); document `telephony_configuration_id` if needed
- [x] `initial_context` keys for EMS script: `farmer_name`, `agent_name`, `village_name`, `mdo_name`, `event_date`, `product_name`
- [ ] Workflow prompts use `{{farmer_name}}`, `{{agent_name}}`, `{{village_name}}`, `{{mdo_name}}`, `{{event_date}}`, `{{product_name}}`
- [ ] Create outbound workflow per **virtual agent** (Hindi, Telugu, Tamil, … — one workflow per agent, not Languages master)
- [ ] Each workflow: **Start Call**, **Agent** nodes (prompts), **Global**, **End Call**
- [ ] Prompts reference all agreed `initial_context` variables (see §8.1)
- [ ] Language-appropriate voice / TTS per workflow
- [ ] Optional: **Pre-Call Data Fetch** node → Reach read API
- [ ] Extraction on Agent / End Call: `gathered_context` fields matching Reach `callLog` (`did_attend`, `did_recall`, crops, products, purchase fields, sentiment, `callback_requested`, `callback_time`, etc.)
- [ ] Map pipecat end reasons + telephony status into `gathered_context` for Reach
- [ ] **Webhook node** → Reach dev/staging URL with payload template (see §8.3 / example below)
- [ ] Webhook credential matches Reach inbound auth (API key header or Bearer)
- [ ] Publish workflows per **virtual agent** (not per language); share trigger UUID with Reach Voice Agents admin
- [ ] Test: dev URL §8.5; then production `POST .../public/agent/{uuid}` or `.../workflow/{uuid}`
- [ ] End-to-end test: API trigger → call → webhook received on Reach dev
- [ ] Test edge cases: voicemail, no-answer, busy, invalid number, partial survey (user hangup)
- [ ] Confirm **no Campaign retry** for Reach integration — API trigger only
- [ ] Optional **QA node** for post-call quality checks
- [ ] Monitor `workflow_run_id`, webhook delivery failures, recording storage
- [ ] Runbook: publish workflow without breaking in-flight runs; draft vs production URLs

**Webhook payload template (agree with Reach, adjust field names as needed):**

```json
{
  "task_id": "{{initial_context.task_id}}",
  "attempt_id": "{{initial_context.attempt_id}}",
  "workflow_run_id": "{{workflow_run_id}}",
  "call_time": "{{call_time}}",
  "call_duration_seconds": "{{cost_info.call_duration_seconds}}",
  "recording_url": "{{recording_url}}",
  "transcript_url": "{{transcript_url}}",
  "telephony_status": "{{gathered_context.telephony_status}}",
  "end_reason": "{{gathered_context.end_reason}}",
  "call_status": "{{gathered_context.call_status}}",
  "did_attend": "{{gathered_context.did_attend}}",
  "did_recall": "{{gathered_context.did_recall}}",
  "crops_discussed": "{{gathered_context.crops_discussed}}",
  "products_discussed": "{{gathered_context.products_discussed}}",
  "has_purchased": "{{gathered_context.has_purchased}}",
  "willing_to_purchase": "{{gathered_context.willing_to_purchase}}",
  "likely_purchase_date": "{{gathered_context.likely_purchase_date}}",
  "non_purchase_reason": "{{gathered_context.non_purchase_reason}}",
  "farmer_comments": "{{gathered_context.farmer_comments}}",
  "sentiment": "{{gathered_context.sentiment}}",
  "activity_quality": "{{gathered_context.activity_quality}}"
}
```

---

---

## 14. Voice Agents admin page (Option B — agreed design)

Dedicated admin area: **Voice Agents** (separate from User Management and Languages master).

### 14.1 Purpose

- Configure **platform-wide** voice integration defaults (Global).
- Configure **per virtual CC agent** operational settings (Local) — start/stop, calling hours, trigger UUID, caps.
- Show **runtime status** per agent (idle, calling, paused, outside hours).

**Not on this page:** workflow authoring (Calling agent UI), human agent settings, Languages master editing.

### 14.2 Reach vs Calling agent (reminder)

| Reach virtual agent (e.g. Riya) | Calling agent (Dograh) |
|--------------------------------|------------------------|
| `cc_agent` + `agentKind: virtual` | Workflow graph, prompts, TTS |
| Assigned task queue | Telephony execution |
| Start/stop, calling window | `gathered_context` extraction |
| Stores **API Trigger UUID** for this agent | Publishes trigger; sends webhook to Reach |

Languages master = **Reach language skills only**. Trigger UUID belongs on the **virtual agent record**.

### 14.3 Page layout

```
Voice Agents (admin nav)
├── Global settings          ← platform integration + defaults
├── Agent list               ← all users where agentKind = virtual
└── Agent detail [Riya]      ← local config + runtime stats
```

### 14.4 Global settings catalog

| ID | Setting | Recommended |
|----|---------|-------------|
| G1 | Orchestrator master on/off | **Yes** |
| G2 | Poll interval (seconds) | **Yes** |
| G3 | Default timezone | **Yes** (`Asia/Kolkata`) |
| G4 | Default calling window (days + start/end) | **Yes** |
| G5 | Default min gap between calls | **Yes** |
| G6 | Default max calls per agent per day | **Yes** |
| G7 | Default max concurrent calls per agent | **Yes** (default 1) |
| G8 | Stuck-call timeout (minutes) | **Yes** |
| G9 | Auto-pause agent after N API failures | **Yes** |
| G10 | Voice API base URL | **Yes** |
| G11 | Voice API key | **Yes** (secret) |
| G12 | Webhook inbound API key | **Yes** (secret) |
| G13 | Webhook URL (read-only, copy) | **Yes** |
| G14 | Use test vs production trigger path | **Yes** |
| G15 | Default telephony configuration ID | Optional |
| G16 | Global no-call calendar | Optional |
| G17 | Alert on integration failure | Optional |

*Today these live in Cloud Run env vars; Voice Agents admin should surface editable globals (secrets masked) where appropriate.*

### 14.5 Per virtual agent settings catalog

**Identity (from User Management — link or read-only):** name, email, employee ID, languages, team lead, `isActive`.

| ID | Setting | Recommended |
|----|---------|-------------|
| A4 | **API Trigger UUID** (Calling agent binding for this agent) | **Yes — must have** |
| A5 | Trigger route type (API trigger vs workflow UUID path) | **Yes** |
| A6 | Telephony configuration ID override | Optional |
| A7 | `agent_name` for `initial_context` | **Yes** (default: display name) |
| A8 | Integration health (last trigger OK / error) | **Yes** (read-only) |
| A9 | Voice status: `running` / `paused` / `stopped` | **Yes** (default **paused** on create) |
| A10 | Inherit global calling window | **Yes** |
| A11 | Custom calling window | **Yes** (if not inheriting) |
| A12 | Inherit global throughput limits | **Yes** |
| A13 | Custom max calls/day, min gap, concurrency | **Yes** |
| A14 | Pause reason + paused by + timestamp | **Yes** |
| A15 | Dequeue only from this agent’s assigned queue | **Yes** (orchestrator rule) |
| A16 | Callback rules | **Yes** — use existing Reach logic; no new config |
| A17 | Territory / BU filter on dequeue | Optional |
| A18 | Callbacks-only mode | Optional |
| A19 | Who can start/stop (MIS Admin / Team Lead) | **Yes** |
| A20 | Read-only status in agent workspace | **Yes** |
| A21 | Allow agent self pause from workspace | Optional (suggest no) |
| A22 | **Safe dial override** (`voiceDialOverrideEnabled` + single `voiceDialOverrideNumber`) | **Yes** (dev/UAT) |

**Runtime (read-only):** idle / calling / paused / outside hours / cap reached; queue counts; calls today; last trigger / last webhook; current task; consecutive failures; config audit log; dial override active indicator.

### 14.6 Orchestrator rules (target behaviour)

For each virtual agent where `voiceStatus = running` and current time ∈ calling window:

1. Skip if agent already has an active voice call.
2. `getNextTaskForAgent(thatAgentId)` — **that agent’s queue only**.
3. Use **`thatAgent.voiceTriggerUuid`** (not Languages master).
4. Build `initial_context` from task + farmer + activity; `agent_name` from agent config.
5. POST Calling agent → persist `workflow_run_id` → await webhook.

### 14.7 Task list — Voice Agents admin (Kweka Reach)

| # | Task | Status |
|---|------|--------|
| V1 | Add `VoiceAgentConfig` model (or extend `User`) — per-agent UUID, status, windows, limits | [x] |
| V2 | Add `VoicePlatformSettings` model (or config collection) for global defaults | [x] |
| V3 | API: `GET/PUT /api/admin/voice/settings` (global) | [x] |
| V4 | API: `GET /api/admin/voice/agents` — list virtual agents + runtime summary | [x] |
| V5 | API: `GET/PUT /api/admin/voice/agents/:id` — local config + start/stop | [x] |
| V6 | API: `POST /api/admin/voice/agents/:id/test-trigger` — optional test call | [x] |
| V7 | Admin UI: **Voice Agents** nav + Global settings panel | [x] |
| V8 | Admin UI: Agent list (status, languages, queue stats, quick pause/resume) | [x] |
| V9 | Admin UI: Agent detail — trigger UUID, hours, limits, audit | [x] |
| V10 | Orchestrator: read per-agent config (status, window, limits, UUID) | [x] |
| V11 | Migrate off Languages master `voiceTriggerUuid` (deprecate field + UI) | [x] |
| V12 | Agent workspace: show voice status banner (read-only) | [x] |
| V13 | Permissions: MIS Admin edit; Team Lead start/stop own agents (if A19) | [x] |
| V14 | Audit log for config changes | [x] |
| V15 | `attempt_id` concurrent idempotency (multi-agent / overlapping calls) | [x] |
| V16 | Per-agent safe dial override (Yes + single number on Voice Agents admin) | [x] |

---

## 15. Security & operations

| Topic | Reach | Voice platform |
|-------|-------|----------------|
| Outbound auth | Stores `VOICE_API_KEY`; calls Dograh | Validates `X-API-Key` |
| Inbound auth | Validates webhook secret on Reach endpoint | Sends credential from Webhook node |
| PII | Minimize logs; task-scoped access | Recordings/transcripts per org retention |
| Idempotency | Dedupe on `workflow_run_id` | Retries may duplicate webhook — Reach must handle |
| Stuck calls | Release `in_progress` after timeout | Run status: `pending`, `in_progress`, `completed`, `failed` |
| Safe dial override | Per-agent `voiceDialOverrideEnabled` + number (Voice Agents admin) | Reach config |

---

## 16. Open decisions

1. ~~**Workflow UUID storage:** Languages master vs per virtual agent?~~ **Resolved:** per virtual agent on Voice Agents admin (§14).
2. **Orchestrator hosting:** Implemented as backend cron worker (`setupVoiceOrchestrator`); Cloud Run min-instances keeps it alive.
3. **Pre-Call Data Fetch:** optional; Dograh uses **POST** with `event: call_inbound` — Reach read API not built.
4. **Partial surveys:** disposition and callback rule when farmer hangs up early?
5. **Recording URLs:** new optional fields on `callLog` or separate collection?
6. **Prod Calling agent URL:** dev uses `35.234.218.115.sslip.io`; hosted Dograh reference is `api.dograh.com` — prod host TBD for Kweka
7. ~~**Voice Agents admin scope:**~~ **Mostly implemented** (§14.7 V1–V14 done); remaining: wire `workflow` route type + DB `useTestEndpoint` to client
8. **Voice tool vs Reach extensions:** `kweka_reach_api_integration.md` authoritative for six keys; Reach adds `task_id` (required) + `attempt_id` (traceability; V15 enforcement deferred)
9. **Safe dial on dev:** per-agent **Yes + number** on Voice Agents admin (V16) — not global env
10. **E2E go-live:** Cloud Run secrets + Dograh webhook (R9 / C9–C11)

---

## 17. Glossary

| Term | Meaning |
|------|---------|
| **cc_agent** | Call-centre agent role in Reach |
| **Virtual agent** | `cc_agent` with `agentKind: virtual` |
| **Orchestrator** | Reach worker that dequeues tasks and calls Dograh API |
| **API Trigger UUID** | Dograh public trigger id; Reach POSTs to `/public/agent/test/{uuid}` (dev) or prod equivalent — **stored per virtual agent** |
| **Voice Agents admin** | Reach admin page for global + per-agent voice operations (§14) |
| **Workflow** | Dograh conversation graph (authored in Calling agent UI); linked from Reach via API Trigger UUID |
| **initial_context** | Data Reach sends at call start; used in agent prompts |
| **gathered_context** | Data Dograh extracts during call; sent in webhook |
| **workflow_run_id** | Dograh run identifier; correlate recording and idempotency |
| **callLog** | Reach interaction record on `CallTask` after submit |
| **Campaign** | Dograh bulk dialer — **not** used for Reach task callbacks |

---

## 18. References

| Resource | Location |
|----------|----------|
| **Voice tool outbound spec (authoritative)** | `docs/kweka_reach_api_integration.md` |
| Reach integration PDF | `docs/kweka_reach_integration_guide.pdf` |
| FFA ingest spec | `docs/FFA_API_VENDOR_SPEC.md` |
| Voice platform repo | [kw-ai-calling-agent](https://github.com/Kweka-AI-Solutions-Private-Limited/kw-ai-calling-agent) |
| Dograh public trigger routes | `dograh-backend/api/routes/public_agent.py` |
| Dograh API Trigger docs | `dograh-backend/docs/voice-agent/api-trigger.mdx` |
| Dograh webhook payload reference | `dograh-backend/docs/developer/webhooks.mdx` |
| Dograh Pre-Call Data Fetch | `dograh-backend/docs/voice-agent/pre-call-data-fetch.mdx` |
| Voice verify script | `scripts/verify-voice-config.sh` |
| Dev test trigger | §8.5 — `e5a72e34-d77d-46f3-8645-5bdff1e560dc` on `35.234.218.115.sslip.io` |
| Reach task submit | `POST /api/tasks/:id/submit` |

---

## 19. Summary for stakeholders

- Virtual voice agents are **first-class cc_agents** with the **same language skills and queue rules** as humans; each has its **own assigned queue** (e.g. Riya).
- The **Calling agent (Dograh)** owns workflows, scripts, telephony, and `gathered_context` extraction; **Reach** owns queue, callbacks, start/stop, calling hours, and database writes.
- Integration is **API trigger out, webhook in** — aligned to existing `callLog` / submit semantics.
- Outbound trigger follows **`docs/kweka_reach_api_integration.md`** (Voice tool spec).
- Reach adds `task_id` (required) and `attempt_id` (sent; full idempotency deferred — V15).
- Per-agent safe dial: **Yes + team number** on Voice Agents admin (V16 — finish implementation).
- **§12.0 tracker** is the single summary; detail in §12.1–12.5, §13 C1–C14, §14.7 V1–V16.

*Last updated: September 2026 — task lists finalized after Voice tool spec + per-agent dial override discussion.*
