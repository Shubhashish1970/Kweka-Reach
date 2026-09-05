import { CROP_NAME_ALIASES, matchAgainstOurData, namesLikelySame } from './voiceNameMatch.js';
import type { VoiceCallContext, VoiceCallMasters } from './voiceWebhookIngestion.js';

const SURVEY_KEYS = [
  'call_status',
  'call_duration_seconds',
  'did_attend',
  'did_recall',
  'crops_discussed',
  'products_discussed',
  'activity_quality',
  'has_purchased',
  'purchased_products',
  'willing_to_purchase',
  'likely_purchase_date',
  'non_purchase_reason',
  'farmer_comments',
  'sentiment',
] as const;

const VALID_STATUSES = ['Connected', 'Disconnected', 'Incoming N/A', 'No Answer', 'Invalid'];
const DID_ATTEND = [
  'Yes, I attended',
  'No, I missed',
  "Don't recall",
  'Identity Wrong',
  'Not a Farmer',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUnresolvedTemplate(value: unknown): boolean {
  return typeof value === 'string' && /^\{\{[^}]+\}\}$/.test(value.trim());
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (isUnresolvedTemplate(value)) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function parseStringList(value: unknown): string[] {
  if (isEmpty(value)) return [];
  if (Array.isArray(value)) return uniqueStrings(value.map((v) => String(v)));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return uniqueStrings(parsed.map((v) => String(v)));
      } catch {
        /* fall through */
      }
    }
    return uniqueStrings(trimmed.split(/[,;|]/));
  }
  return [];
}

function parsePurchasedRows(value: unknown): Record<string, unknown>[] {
  const rows: unknown[] = [];
  if (Array.isArray(value)) rows.push(...value);
  else if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) rows.push(...parsed);
    } catch {
      return [];
    }
  }
  return rows.filter(isPlainObject);
}

function knownContextNames(callContext: VoiceCallContext): string[] {
  return [
    callContext.farmerName,
    callContext.villageName,
    callContext.mdoName,
    ...(callContext.activityCrops || []),
    ...(callContext.activityProducts || []),
  ].filter((name): name is string => Boolean(name && name.trim()));
}

function isKnownContextMention(spoken: string, callContext: VoiceCallContext): boolean {
  return knownContextNames(callContext).some((name) => namesLikelySame(spoken, name));
}

function pickFilled(transcript: unknown, agent: unknown): unknown {
  if (!isEmpty(transcript)) return transcript;
  if (!isEmpty(agent)) return agent;
  return transcript;
}

function pickStatus(transcript: unknown, agent: unknown): unknown {
  const agentStatus = typeof agent === 'string' ? agent.trim() : '';
  const transcriptStatus = typeof transcript === 'string' ? transcript.trim() : '';
  if (VALID_STATUSES.includes(agentStatus) && agentStatus !== 'Connected') return agentStatus;
  if (VALID_STATUSES.includes(agentStatus)) return agentStatus;
  if (VALID_STATUSES.includes(transcriptStatus)) return transcriptStatus;
  return pickFilled(transcript, agent);
}

function pickAttend(transcript: unknown, agent: unknown): unknown {
  const t = typeof transcript === 'string' ? transcript.trim() : '';
  const a = typeof agent === 'string' ? agent.trim() : '';
  const tOk = DID_ATTEND.includes(t);
  const aOk = DID_ATTEND.includes(a);
  if (tOk && aOk) return t;
  if (tOk) return t;
  if (aOk) return a;
  return pickFilled(transcript, agent);
}

function pickQuality(transcript: unknown, agent: unknown): unknown {
  const t = Number(transcript);
  const a = Number(agent);
  const tOk = Number.isFinite(t) && t >= 1 && t <= 5;
  const aOk = Number.isFinite(a) && a >= 1 && a <= 5;
  if (tOk && aOk) return t;
  if (tOk) return t;
  if (aOk) return a;
  return null;
}

function pickSentiment(transcript: unknown, agent: unknown): unknown {
  const t = String(transcript ?? '').trim();
  const a = String(agent ?? '').trim();
  const real = (s: string) => s && s.toUpperCase() !== 'N/A';
  if (real(t)) return t;
  if (real(a)) return a;
  return pickFilled(transcript, agent);
}

function pickBoolean(transcript: unknown, agent: unknown): unknown {
  if (typeof transcript === 'boolean') return transcript;
  if (typeof agent === 'boolean') return agent;
  return pickFilled(transcript, agent);
}

function mergeComments(transcript: unknown, agent: unknown, extras: string[]): string {
  const parts = [transcript, agent]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((text) => !text.startsWith('Mentioned, not in master:'));
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((existing) => existing.includes(part) || part.includes(existing))) continue;
    unique.push(part);
  }
  if (extras.length) unique.push(`Also mentioned: ${extras.join(', ')}`);
  return unique.join('\n');
}

/**
 * Transcript JSON is the base. Voice-agent JSON is compared against it.
 * Keep the value that matches our call context / masters; union names from both.
 */
export function pickBestVoicePayload(
  agentPayload: Record<string, unknown>,
  transcriptPayload: Record<string, unknown>,
  masters: VoiceCallMasters,
  callContext: VoiceCallContext = {}
): Record<string, unknown> {
  const cropMatch = matchAgainstOurData(
    uniqueStrings([
      ...parseStringList(transcriptPayload.crops_discussed),
      ...parseStringList(agentPayload.crops_discussed),
    ]),
    masters.crops,
    callContext.activityCrops || [],
    { aliases: CROP_NAME_ALIASES, preferred: callContext.activityCrops }
  );
  const productMatch = matchAgainstOurData(
    uniqueStrings([
      ...parseStringList(transcriptPayload.products_discussed),
      ...parseStringList(agentPayload.products_discussed),
    ]),
    masters.products,
    callContext.activityProducts || [],
    { preferred: callContext.activityProducts }
  );

  const purchasedRows = [
    ...parsePurchasedRows(transcriptPayload.purchased_products),
    ...parsePurchasedRows(agentPayload.purchased_products),
  ];
  const purchasedMatched: Record<string, unknown>[] = [];
  const purchasedExtra: string[] = [];
  const seenProduct = new Set<string>();
  for (const row of purchasedRows) {
    const rawName = String(row.product ?? row.name ?? '').trim();
    if (!rawName) continue;
    const product = matchAgainstOurData(
      [rawName],
      masters.products,
      callContext.activityProducts || [],
      { preferred: callContext.activityProducts }
    );
    if (!product.matched.length) {
      purchasedExtra.push(rawName);
      continue;
    }
    const name = product.matched[0];
    if (seenProduct.has(name)) continue;
    seenProduct.add(name);
    purchasedMatched.push({ ...row, product: name });
  }

  const extras = [...cropMatch.extra, ...productMatch.extra, ...purchasedExtra].filter(
    (name) => name && !isKnownContextMention(name, callContext)
  );

  const combined: Record<string, unknown> = { ...agentPayload };
  for (const key of SURVEY_KEYS) {
    if (key === 'crops_discussed') {
      combined[key] = cropMatch.matched;
      continue;
    }
    if (key === 'products_discussed') {
      combined[key] = productMatch.matched;
      continue;
    }
    if (key === 'purchased_products') {
      combined[key] = purchasedMatched;
      continue;
    }
    if (key === 'call_status') {
      combined[key] = pickStatus(transcriptPayload[key], agentPayload[key]);
      continue;
    }
    if (key === 'did_attend') {
      combined[key] = pickAttend(transcriptPayload[key], agentPayload[key]);
      continue;
    }
    if (key === 'activity_quality') {
      combined[key] = pickQuality(transcriptPayload[key], agentPayload[key]);
      continue;
    }
    if (key === 'sentiment') {
      combined[key] = pickSentiment(transcriptPayload[key], agentPayload[key]);
      continue;
    }
    if (key === 'did_recall' || key === 'has_purchased' || key === 'willing_to_purchase') {
      combined[key] = pickBoolean(transcriptPayload[key], agentPayload[key]);
      continue;
    }
    if (key === 'farmer_comments') {
      combined[key] = mergeComments(
        transcriptPayload[key],
        agentPayload[key],
        uniqueStrings(extras)
      );
      continue;
    }
    combined[key] = pickFilled(transcriptPayload[key], agentPayload[key]);
  }
  return combined;
}
