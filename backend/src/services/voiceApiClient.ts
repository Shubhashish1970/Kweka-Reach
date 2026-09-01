import logger from '../config/logger.js';

export interface VoiceTriggerResponse {
  status: string;
  workflow_run_id: number;
  workflow_run_name: string;
}

export interface VoiceTriggerPayload {
  phone_number: string;
  initial_context: Record<string, string>;
  telephony_configuration_id?: number | null;
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

/** Build outbound trigger URL for API Trigger UUID (not workflow UUID path). */
export function buildVoiceTriggerUrl(triggerUuid: string): string {
  const base = getVoiceApiBaseUrl();
  const useTest = process.env.VOICE_USE_TEST_ENDPOINT !== 'false';
  const path = useTest
    ? `/api/v1/public/agent/test/${triggerUuid}`
    : `/api/v1/public/agent/${triggerUuid}`;
  return `${base}${path}`;
}

export async function triggerVoiceOutboundCall(
  triggerUuid: string,
  payload: VoiceTriggerPayload
): Promise<VoiceTriggerResponse> {
  const url = buildVoiceTriggerUrl(triggerUuid);
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

export function toIndianE164(mobileNumber: string): string {
  const digits = String(mobileNumber || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (String(mobileNumber).startsWith('+')) return String(mobileNumber);
  return `+${digits}`;
}
