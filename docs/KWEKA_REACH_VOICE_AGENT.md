# Kweka Reach — Voice Agent Integration

**Status:** Design / in dev testing (Calling agent test API available — see §8.5)  
**Audience:** Product, engineering, voice platform partners  
**Related:**
- `docs/kweka_reach_integration_guide.pdf` (outbound trigger + example webhook patterns)
- Voice platform codebase: [kw-ai-calling-agent](https://github.com/Kweka-AI-Solutions-Private-Limited/kw-ai-calling-agent) (Dograh — `dograh-backend` + `dograh-frontend` + `pipecat`)

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
| **Pre-Call Data Fetch** | Optional HTTP call to Reach when call connects |
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
| When to dial (including callbacks) | **Kweka Reach** | Orchestrator + existing callback rules |
| Question script / conversation flow | **Voice platform** | One **published workflow per language** |
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
| Kind (proposed) | `agentKind: human` | `agentKind: virtual` |
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

### 5.3 Voice workflow pointer (language → `workflow_uuid`)

- Each language maps to a **published workflow** on Dograh with its own **Agent UUID** (`workflow_uuid`).
- Reach stores the pointer either:
  - **Option A:** Per virtual agent per language (`voiceWorkflows: { "Hindi": "uuid-..." }`), or
  - **Option B:** On Languages master (one `workflowUuid` per language, shared across virtual agents).

**Recommended for Reach:** Option B — one Hindi workflow serves all Hindi virtual agents.

---

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

  Admin->>Reach: Create virtual cc_agent + language skills
  Admin->>Voice: Publish workflow per language (Dograh UI)
  Reach->>Reach: Sampling & TL allocation → tasks in queue
  Orch->>Reach: Dequeue next task (language match)
  Reach->>Reach: Mark task in_progress
  Orch->>Voice: POST /public/agent/workflow/{workflow_uuid}
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

### 8.1 Outbound — Reach → Dograh

**Recommended route for Reach:** trigger by stable **Agent UUID** (one per language workflow).

| Environment | Endpoint |
|-------------|----------|
| Production | `POST {VOICE_API_BASE}/api/v1/public/agent/workflow/{workflow_uuid}` |
| Test (draft) | `POST {VOICE_API_BASE}/api/v1/public/agent/test/workflow/{workflow_uuid}` |

**Auth:** `X-API-Key: <org_api_key>`

**Alternative route** (if using API Trigger node UUID instead of Agent UUID):

| Production | `POST /api/v1/public/agent/{trigger_uuid}` |
| Test | `POST /api/v1/public/agent/test/{trigger_uuid}` |

Do **not** mix UUID types — trigger UUID ≠ workflow UUID.

#### `initial_context` fields (agreed for EMS script)

Reach maps task / farmer / activity data into these keys for the Calling agent prompts (`{{farmer_name}}`, `{{mdo_name}}`, etc.):

| `initial_context` key | Reach source (orchestrator) | Example |
|----------------------|-----------------------------|---------|
| `farmer_name` | `Farmer.name` | `Deepak` |
| `agent_name` | Virtual `cc_agent` display name | `riya` |
| `village_name` | Farmer location / village | `Banswada` |
| `mdo_name` | Activity officer (MDO) name | `raviteja` |
| `event_date` | Activity date/time (display format) | `04-08-2026 19:34 PM` |
| `product_name` | Product discussed on activity | `Atonik-growth regulator` |
| `task_id` | `CallTask` id | Required for webhook → submit |
| `attempt_id` | New UUID per dial attempt | Required for idempotency |

**Request body (full — production orchestrator):**

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

**Manual test payload** (script fields only — omit `task_id` / `attempt_id` until Reach webhook is wired):

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

> **JSON note:** All `initial_context` keys must be double-quoted strings. Invalid example: `village_name: "Banswada"` (missing quotes on key).

**Success response:**

```json
{
  "status": "initiated",
  "workflow_run_id": 12345,
  "workflow_run_name": "WR-API-7823"
}
```

Store `workflow_run_id` on the task or attempt record for correlation and idempotency.

### 8.2 Optional — Pre-Call Data Fetch (Dograh → Reach)

Instead of a large `initial_context`, Dograh can call Reach **when the call connects** to load farmer/task fields before the agent speaks. Useful if context changes between queue time and dial time.

Reach would expose a read-only authenticated endpoint; Dograh configures it on the workflow **Pre-Call Data Fetch** node.

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

### 8.4 Dispositions (mapping reference)

Dograh reports telephony and end-of-call reasons separately. Reach maps these to task outcomes and callback rules.

**Telephony (`TelephonyCallStatus`):** `busy`, `no-answer`, `failed`, `canceled`, `completed`, etc.

**End-task reasons (pipecat):** `end_call_tool`, `user_hangup`, `voicemail_detected`, `pipeline_error`, `call_duration_exceeded`, `system_connect_error`, etc.

**Extracted fields (`gathered_context`):** e.g. `callback_requested`, `callback_time`, survey answers — defined per workflow extraction schema. Reach team agrees the extraction variable names once; Calling agent workflow authors configure matching prompts.

### 8.5 Dev test environment (current)

| Item | Value |
|------|--------|
| **Base URL** | `https://35.234.218.115.sslip.io` |
| **Route type** | API Trigger UUID (not Agent/workflow UUID) |
| **Test endpoint** | `POST https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc` |
| **Trigger UUID** | `e5a72e34-d77d-46f3-8645-5bdff1e560dc` |
| **Auth** | Header `X-API-Key: <org_api_key>` (from Calling agent team — not stored in this doc) |
| **Content-Type** | `application/json` |

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
| `VOICE_TRIGGER_UUID` | `e5a72e34-d77d-46f3-8645-5bdff1e560dc` (dev test trigger; per-language triggers or workflow UUIDs in prod) |
| `VOICE_WEBHOOK_API_KEY` | Shared secret Calling agent sends on webhook (`X-API-Key` or `X-Voice-Webhook-Key`) |
| `VOICE_ORCHESTRATOR_ENABLED` | `true` to poll virtual agent queues |
| `VOICE_ORCHESTRATOR_INTERVAL_SEC` | Poll interval (default `30`) |
| `VOICE_USE_TEST_ENDPOINT` | `true` (default) → `/public/agent/test/{uuid}` |
| `VOICE_STUCK_TASK_MINUTES` | Release stuck `in_progress` voice tasks (default `15`) |
| `USER_VIRTUAL_AGENT_DEFAULT_PASSWORD` | Default login password for virtual CC agents (min 8 chars; dev fallback `Nacl@1234` if unset) |
| `USER_DEFAULT_RESET_PASSWORD` | Fallback for human admin reset and virtual agents if virtual-specific var unset |

Reach webhook URL for Calling agent to configure: `POST {REACH_API}/api/voice/webhook`

When workflows are published per language, production may use either `POST .../public/agent/workflow/{workflow_uuid}` or a dedicated trigger UUID per language — store the chosen UUID on Languages master either way.

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

### 11.1 Kweka Reach (ready)

- `cc_agent` users with `languageCapabilities` and team lead
- Task queue, sampling, allocation, language filtering
- Agent Workspace + `CallInteractionForm`
- `POST /api/tasks/:id/submit` + full `callLog` schema
- Callback model (`isCallback`, `callbackNumber`, max 2)
- EMS / agent history from task data

### 11.2 Kweka Reach (to build)

See **§12 Task list — Kweka Reach**.

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

## 12. Task list — Kweka Reach

**Work in parallel with §13.** Both teams share the integration contract (`initial_context`, webhook schema, disposition mapping) and validate together on dev.

- [ ] Add `agentKind: 'human' | 'virtual'` to `User` model (default `'human'`)
- [ ] API: create/update/list users with `agentKind`; virtual agents require `teamLeadId` + `languageCapabilities`
- [ ] User Management UI: CC Agent type selector (Human / Virtual)
- [ ] User list: badge or filter for Virtual agents
- [ ] Store Calling agent UUID per language on Languages master (`triggerUuid` or `workflowUuid`)
- [ ] Env vars / secrets: `VOICE_API_BASE_URL`, `VOICE_API_KEY`, `VOICE_TRIGGER_UUID` (dev), inbound webhook secret
- [x] `initial_context` script fields agreed: `farmer_name`, `agent_name`, `village_name`, `mdo_name`, `event_date`, `product_name` (see §8.1)
- [ ] Orchestrator: map Reach task/farmer/activity → `initial_context` keys above + `task_id`, `attempt_id`
- [ ] Agree inbound webhook JSON schema aligned to `callLog` + task status
- [ ] Agree disposition → `callStatus` / task `status` mapping (product sign-off)
- [ ] Agree idempotency key: `(task_id, workflow_run_id)` or `(task_id, attempt_id)`
- [ ] Optional: Pre-Call Data Fetch read API (`GET /api/voice/tasks/:id/context` or similar)
- [ ] Authenticated voice webhook endpoint (service API key / Bearer)
- [ ] Map webhook body → internal submit handler (reuse `POST /tasks/:id/submit` validation)
- [ ] Idempotency: dedupe on `workflow_run_id`
- [ ] Unit tests: no answer, partial survey, invalid number, duplicate webhook
- [ ] Orchestrator: list active virtual `cc_agent` users
- [ ] Orchestrator: dequeue next task (`sampled_in_queue`, language match, `scheduledDate <= now`)
- [ ] Mark task `in_progress` before outbound call
- [ ] Call Calling agent test API: `POST {VOICE_API_BASE_URL}/api/v1/public/agent/test/{VOICE_TRIGGER_UUID}` (dev) or `/workflow/{uuid}` when per-language workflows are published
- [ ] Persist `workflow_run_id` on task or `VoiceCallAttempt` record
- [ ] Handle trigger failures (release task, retry later, alert)
- [ ] Stuck-task sweeper: `in_progress` > N minutes without webhook → release or mark unsuccessful
- [ ] Concurrency: 1 active call per virtual agent at launch
- [ ] On webhook: apply existing callback rules (`callbackNumber`, `parentTaskId`, max 2)
- [ ] Do not delegate scheduling to Calling agent Campaigns
- [ ] Logging / metrics: calls initiated, webhooks received, failures, latency
- [ ] Feature flag for orchestrator; dev then prod rollout
- [ ] Agent history / EMS: optional recording URL field if needed
- [ ] Rate limiting on webhook endpoint
- [ ] Runbook: stuck tasks, duplicate webhooks, Calling agent outage

---

## 13. Task list — Calling agent (kw-ai-calling-agent)

**Work in parallel with §12.** Repo: [kw-ai-calling-agent](https://github.com/Kweka-AI-Solutions-Private-Limited/kw-ai-calling-agent) (Dograh).

- [x] Dev instance: `https://35.234.218.115.sslip.io`
- [x] Dev test trigger: `POST /api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc`
- [ ] Org API key (`X-API-Key`) shared securely with Reach team
- [ ] Telephony configured for outbound on dev (e.g. Exotel); document `telephony_configuration_id` if needed
- [x] `initial_context` keys for EMS script: `farmer_name`, `agent_name`, `village_name`, `mdo_name`, `event_date`, `product_name`
- [ ] Workflow prompts use `{{farmer_name}}`, `{{agent_name}}`, `{{village_name}}`, `{{mdo_name}}`, `{{event_date}}`, `{{product_name}}`
- [ ] Create outbound workflow per Reach language (Hindi, Telugu, Tamil, …)
- [ ] Each workflow: **Start Call**, **Agent** nodes (prompts), **Global**, **End Call**
- [ ] Prompts reference all agreed `initial_context` variables (see §8.1)
- [ ] Language-appropriate voice / TTS per workflow
- [ ] Optional: **Pre-Call Data Fetch** node → Reach read API
- [ ] Extraction on Agent / End Call: `gathered_context` fields matching Reach `callLog` (`did_attend`, `did_recall`, crops, products, purchase fields, sentiment, `callback_requested`, `callback_time`, etc.)
- [ ] Map pipecat end reasons + telephony status into `gathered_context` for Reach
- [ ] **Webhook node** → Reach dev/staging URL with payload template (see §8.3 / example below)
- [ ] Webhook credential matches Reach inbound auth (API key header or Bearer)
- [ ] Publish workflows per language; share UUID per language with Reach (trigger or `workflow_uuid`)
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

## 14. Security & operations

| Topic | Reach | Voice platform |
|-------|-------|----------------|
| Outbound auth | Stores `VOICE_API_KEY`; calls Dograh | Validates `X-API-Key` |
| Inbound auth | Validates webhook secret on Reach endpoint | Sends credential from Webhook node |
| PII | Minimize logs; task-scoped access | Recordings/transcripts per org retention |
| Idempotency | Dedupe on `workflow_run_id` | Retries may duplicate webhook — Reach must handle |
| Stuck calls | Release `in_progress` after timeout | Run status: `pending`, `in_progress`, `completed`, `failed` |

---

## 15. Open decisions

1. **Workflow UUID storage:** Languages master (recommended) vs per virtual agent?
2. **Orchestrator hosting:** Cloud Run job, Scheduler, or backend worker?
3. **Pre-Call Data Fetch:** required, or is `initial_context` at trigger enough?
4. **Partial surveys:** disposition and callback rule when farmer hangs up early?
5. **Recording URLs:** new optional fields on `callLog` or separate collection?
6. **Prod Calling agent URL:** dev uses `35.234.218.115.sslip.io`; prod host TBD

---

## 16. Glossary

| Term | Meaning |
|------|---------|
| **cc_agent** | Call-centre agent role in Reach |
| **Virtual agent** | `cc_agent` with `agentKind: virtual` |
| **Orchestrator** | Reach worker that dequeues tasks and calls Dograh API |
| **Workflow / Agent** | Dograh conversation graph; identified by `workflow_uuid` |
| **initial_context** | Data Reach sends at call start; used in agent prompts |
| **gathered_context** | Data Dograh extracts during call; sent in webhook |
| **workflow_run_id** | Dograh run identifier; correlate recording and idempotency |
| **callLog** | Reach interaction record on `CallTask` after submit |
| **Campaign** | Dograh bulk dialer — **not** used for Reach task callbacks |

---

## 17. References

| Resource | Location |
|----------|----------|
| Reach integration PDF | `docs/kweka_reach_integration_guide.pdf` |
| FFA ingest spec | `docs/FFA_API_VENDOR_SPEC.md` |
| Voice platform repo | [kw-ai-calling-agent](https://github.com/Kweka-AI-Solutions-Private-Limited/kw-ai-calling-agent) |
| Dograh public trigger (by Agent UUID) | `dograh-backend/api/routes/public_agent.py` |
| Dograh docs (in repo) | `dograh-backend/docs/voice-agent/`, `dograh-backend/docs/developer/webhooks.mdx` |
| Dev test trigger | §8.5 — `e5a72e34-d77d-46f3-8645-5bdff1e560dc` on `35.234.218.115.sslip.io` |
| Reach task submit | `POST /api/tasks/:id/submit` |

---

## 18. Summary for stakeholders

- Virtual voice agents are **first-class cc_agents** with the **same language skills and queue rules** as humans.
- The **Calling agent (Dograh)** owns workflows, scripts, telephony, and `gathered_context` extraction; **Reach** owns queue, callbacks, and database writes.
- Integration is **API trigger out, webhook in** — aligned to existing `callLog` / submit semantics.
- **Dev test API** is live (§8.5): trigger UUID `e5a72e34-...` on `https://35.234.218.115.sslip.io` with `initial_context` fields for farmer, agent, village, MDO, event date, and product.
- **Callbacks are Reach-initiated**; do not use Calling agent Campaign retry for Reach tasks.
- **§12** (Kweka Reach) and **§13** (Calling agent) are the two parallel task lists — both teams complete together.

*Last updated: September 2026 — dev test API and `initial_context` schema documented.*
