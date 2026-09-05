import logger from '../config/logger.js';
import type { VoiceTriggerRouteType } from '../models/User.js';

export interface VoiceTriggerResponse {
  status: string;
  workflow_run_id: number;
  workflow_run_name: string;
  workflow_id?: number;
}

export interface VoiceTriggerPayload {
  phone_number: string;
  initial_context: Record<string, string>;
  telephony_configuration_id?: number | null;
}

export interface VoiceTriggerOptions {
  triggerRouteType?: VoiceTriggerRouteType;
  useTestEndpoint?: boolean;
}

function getVoiceApiBaseUrl(): string {
  const base = process.env.VOICE_API_BASE_URL?.trim().replace(/\/$/, '');
  if (!base) {
    throw new Error('VOICE_API_BASE_URL is not configured');
  }
  return base;
}

function getVoiceApiKey(): string {
  const key = process.env.VOICE_API_KEY?.trim();
  if (!key) {
    throw new Error('VOICE_API_KEY is not configured');
  }
  return key;
}

/** Build outbound trigger URL for API Trigger UUID or workflow UUID path. */
export function buildVoiceTriggerUrl(triggerUuid: string, options?: VoiceTriggerOptions): string {
  const base = getVoiceApiBaseUrl();
  const routeType = options?.triggerRouteType ?? 'api_trigger';
  const useTest =
    options?.useTestEndpoint !== undefined
      ? options.useTestEndpoint
      : process.env.VOICE_USE_TEST_ENDPOINT !== 'false';

  if (routeType === 'workflow') {
    return `${base}/api/v1/public/agent/workflow/${triggerUuid}`;
  }

  const path = useTest
    ? `/api/v1/public/agent/test/${triggerUuid}`
    : `/api/v1/public/agent/${triggerUuid}`;
  return `${base}${path}`;
}

export async function triggerVoiceOutboundCall(
  triggerUuid: string,
  payload: VoiceTriggerPayload,
  options?: VoiceTriggerOptions
): Promise<VoiceTriggerResponse> {
  const url = buildVoiceTriggerUrl(triggerUuid, options);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': getVoiceApiKey(),
    },
    body: JSON.stringify({
      phone_number: payload.phone_number,
      initial_context: payload.initial_context,
      telephony_configuration_id: payload.telephony_configuration_id ?? null,
    }),
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    logger.error(`Voice API error ${response.status}: ${text}`);
    const err = new Error(data?.detail || data?.message || `Voice API returned ${response.status}`);
    (err as any).statusCode = response.status;
    throw err;
  }

  if (!data?.workflow_run_id) {
    throw new Error('Voice API response missing workflow_run_id');
  }

  return data as VoiceTriggerResponse;
}

export interface VoiceWorkflowRun {
  id?: number;
  workflow_id?: number;
  is_completed?: boolean;
  status?: string;
  current_status?: string;
  transcript_url?: string | null;
  transcript_public_url?: string | null;
  recording_url?: string | null;
  recording_public_url?: string | null;
  cost_info?: { call_duration_seconds?: number | string };
  gathered_context?: Record<string, unknown>;
  [key: string]: unknown;
}

export function isVoiceWorkflowRunCompleted(run: VoiceWorkflowRun | null | undefined): boolean {
  if (!run) return false;
  if (run.is_completed === true) return true;
  const status = String(run.status ?? run.current_status ?? '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .trim();
  return ['completed', 'failed', 'ended', 'done', 'complete'].includes(status);
}

export function resolveVoiceWorkflowId(taskWorkflowId?: number | null): string | number | null {
  if (taskWorkflowId != null && Number.isFinite(taskWorkflowId)) return taskWorkflowId;
  const fromEnv = process.env.VOICE_WORKFLOW_ID?.trim();
  return fromEnv || null;
}

function withTimeout(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function voiceAuthHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'X-API-Key': getVoiceApiKey(),
  };
}

/** Look up a Dograh run for artifact URLs, duration, and gathered_context. */
export async function fetchVoiceWorkflowRun(
  workflowId: string | number,
  runId: string | number,
  timeoutMs = 8000
): Promise<VoiceWorkflowRun | null> {
  const url = `${getVoiceApiBaseUrl()}/api/v1/workflow/${workflowId}/runs/${runId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: voiceAuthHeaders(),
    signal: withTimeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    logger.warn('Voice workflow run lookup failed', {
      status: response.status,
      workflowId,
      runId,
      body: text.slice(0, 300),
    });
    return null;
  }
  try {
    return text ? (JSON.parse(text) as VoiceWorkflowRun) : null;
  } catch {
    logger.warn('Voice workflow run response was not JSON', { workflowId, runId });
    return null;
  }
}

/** Download a transcript/recording URL. Sends the org API key when configured. */
export async function fetchVoiceArtifactText(url: string, timeoutMs = 8000): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };
  try {
    headers['X-API-Key'] = getVoiceApiKey();
  } catch {
    /* public artifact URLs do not need the org key */
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal: withTimeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Transcript fetch returned ${response.status}`);
  }
  return text;
}

export function toIndianE164(mobileNumber: string): string {
  const digits = String(mobileNumber || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (String(mobileNumber).startsWith('+')) return String(mobileNumber);
  return `+${digits}`;
}
