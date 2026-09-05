import logger from '../config/logger.js';
import { extractVoiceCallFromTranscript, isAIServiceAvailable } from './aiService.js';
import { fetchVoiceArtifactText, fetchVoiceWorkflowRun } from './voiceApiClient.js';
import { pickBestVoicePayload } from './voiceResultMerge.js';
import type { VoiceCallContext, VoiceCallMasters } from './voiceWebhookIngestion.js';

const MAX_TRANSCRIPT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8_000;

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

export interface TranscriptEnrichOptions {
  fetchText?: (url: string) => Promise<string>;
  fetchRun?: (
    workflowId: string | number,
    runId: string | number
  ) => Promise<Record<string, unknown> | null>;
  extractFromTranscript?: (
    text: string,
    masters: VoiceCallMasters,
    callContext?: VoiceCallContext
  ) => Promise<Record<string, unknown>>;
  callContext?: VoiceCallContext;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUnresolvedTemplate(value: unknown): boolean {
  return typeof value === 'string' && /^\{\{[^}]+\}\}$/.test(value.trim());
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function isEmptyField(value: unknown): boolean {
  if (value == null) return true;
  if (isUnresolvedTemplate(value)) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function capTranscript(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_TRANSCRIPT_CHARS) return trimmed;
  return trimmed.slice(trimmed.length - MAX_TRANSCRIPT_CHARS);
}

function lineFromTurn(turn: unknown): string {
  if (typeof turn === 'string') return turn.trim();
  if (!isPlainObject(turn)) return '';
  const role = String(turn.role ?? turn.speaker ?? turn.name ?? turn.actor ?? '').trim();
  const content = turn.content;
  const text = String(
    (typeof content === 'string' ? content : null) ??
      turn.text ??
      turn.message ??
      turn.utterance ??
      turn.transcript ??
      ''
  ).trim();
  if (!text) return '';
  return role ? `${role}: ${text}` : text;
}

export function flattenTranscriptArtifact(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return flattenTranscriptArtifact(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(raw)) {
    return raw.map(lineFromTurn).filter(Boolean).join('\n');
  }
  if (!isPlainObject(raw)) return String(raw);

  if (raw.transcript != null) return flattenTranscriptArtifact(raw.transcript);
  if (Array.isArray(raw.messages)) return flattenTranscriptArtifact(raw.messages);
  if (Array.isArray(raw.turns)) return flattenTranscriptArtifact(raw.turns);
  if (Array.isArray(raw.conversation)) return flattenTranscriptArtifact(raw.conversation);
  if (Array.isArray(raw.utterances)) return flattenTranscriptArtifact(raw.utterances);
  if (typeof raw.text === 'string') return raw.text.trim();
  return JSON.stringify(raw);
}

function pickFirst(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] === undefined) continue;
    if (isUnresolvedTemplate(payload[key])) continue;
    return payload[key];
  }
  return undefined;
}

function pickHttpUrl(payload: Record<string, unknown>, keys: string[]): string {
  const value = pickFirst(payload, keys);
  return isHttpUrl(value) ? value.trim() : '';
}

function extractInlineTranscript(payload: Record<string, unknown>): string {
  const candidates = [payload.transcript, payload.conversation, payload.messages, payload.turns];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    if (isHttpUrl(candidate) || isUnresolvedTemplate(candidate)) continue;
    if (Array.isArray(candidate)) {
      const flat = flattenTranscriptArtifact(candidate);
      if (flat) return capTranscript(flat);
      continue;
    }
    if (typeof candidate === 'string') {
      const looksLikeDialogue = /assistant:|user:|farmer:|riya:/i.test(candidate);
      if (candidate.trim().length < 40 && !looksLikeDialogue) continue;
      return capTranscript(flattenTranscriptArtifact(candidate));
    }
    if (isPlainObject(candidate)) {
      const flat = flattenTranscriptArtifact(candidate);
      if (flat) return capTranscript(flat);
    }
  }
  return '';
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
  if (value == null || value === '' || isUnresolvedTemplate(value)) return [];
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

function mergeComments(left: unknown, right: unknown): string {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!b) return a;
  if (!a) return b;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n${b}`;
}

function mergePurchasedRaw(left: unknown, right: unknown): unknown[] {
  const rows: unknown[] = [];
  for (const value of [left, right]) {
    if (Array.isArray(value)) rows.push(...value);
    else if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) rows.push(...parsed);
      } catch {
        /* ignore */
      }
    }
  }
  const byProduct = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const product = String(row.product ?? row.name ?? '').trim();
    if (!product) continue;
    const key = product.toLowerCase();
    const existing = byProduct.get(key);
    if (!existing) {
      byProduct.set(key, { ...row, product });
      continue;
    }
    const existingQty = String(existing.quantity ?? existing.qty ?? '').trim();
    const nextQty = String(row.quantity ?? row.qty ?? '').trim();
    if (!existingQty && nextQty) byProduct.set(key, { ...existing, ...row, product });
  }
  return [...byProduct.values()];
}

/**
 * Combine webhook JSON with transcript extraction.
 * Webhook wins for filled scalars / telephony; arrays and comments are unioned.
 */
export function mergeExtractedSurvey(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of SURVEY_KEYS) {
    if (source[key] === undefined || isEmptyField(source[key])) continue;

    if (key === 'crops_discussed' || key === 'products_discussed') {
      target[key] = uniqueStrings([...parseStringList(target[key]), ...parseStringList(source[key])]);
      continue;
    }
    if (key === 'purchased_products') {
      target[key] = mergePurchasedRaw(target[key], source[key]);
      continue;
    }
    if (key === 'farmer_comments') {
      target[key] = mergeComments(target[key], source[key]);
      continue;
    }
    if (key === 'sentiment') {
      const current = String(target[key] ?? '').trim();
      if (isEmptyField(target[key]) || current.toUpperCase() === 'N/A') {
        target[key] = source[key];
      }
      continue;
    }
    if (key === 'call_status') {
      if (isEmptyField(target[key])) target[key] = source[key];
      continue;
    }
    if (isEmptyField(target[key])) target[key] = source[key];
  }
}

function normalizeGatheredContext(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const snake = key.includes('_')
      ? key
      : key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
    out[snake] = value;
  }
  return out;
}

async function lookupRunArtifacts(
  payload: Record<string, unknown>,
  options?: TranscriptEnrichOptions
): Promise<Record<string, unknown>> {
  const runId = pickFirst(payload, ['workflow_run_id', 'workflowRunId']);
  const workflowId =
    pickFirst(payload, ['workflow_id', 'workflowId']) ?? process.env.VOICE_WORKFLOW_ID?.trim();
  if (runId == null || runId === '' || workflowId == null || workflowId === '') {
    return {};
  }

  try {
    const fetchRun = options?.fetchRun ?? fetchVoiceWorkflowRun;
    const run = await fetchRun(String(workflowId), String(runId));
    if (!run) return {};

    const extras: Record<string, unknown> = {
      ...normalizeGatheredContext(run.gathered_context),
    };
    const transcriptUrl = pickHttpUrl(run, ['transcript_url', 'transcriptUrl', 'transcript_public_url']);
    const recordingUrl = pickHttpUrl(run, [
      'recording_url',
      'recordingUrl',
      'recording_public_url',
      'voice_recording_url',
    ]);
    if (transcriptUrl) extras.transcript_url = transcriptUrl;
    if (recordingUrl) extras.voice_recording_url = recordingUrl;

    const duration = isPlainObject(run.cost_info) ? run.cost_info.call_duration_seconds : undefined;
    if (duration != null && duration !== '') extras.call_duration_seconds = duration;
    return extras;
  } catch (error) {
    logger.warn('Voice run lookup skipped', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {};
  }
}

async function resolveTranscriptText(
  payload: Record<string, unknown>,
  options?: TranscriptEnrichOptions
): Promise<{ text: string; url: string }> {
  const inline = extractInlineTranscript(payload);
  const url = pickHttpUrl(payload, ['transcript_url', 'transcriptUrl', 'transcript_public_url']);
  if (inline) return { text: inline, url };
  if (!url) return { text: '', url: '' };

  const fetchText = options?.fetchText
    ? options.fetchText
    : (url: string) => fetchVoiceArtifactText(url, FETCH_TIMEOUT_MS);
  const raw = await fetchText(url);
  return { text: capTranscript(flattenTranscriptArtifact(raw)), url };
}

function fillUrlIfEmpty(payload: Record<string, unknown>, key: string, url: unknown): void {
  if (typeof url === 'string' && isHttpUrl(url) && isEmptyField(payload[key])) {
    payload[key] = url.trim();
  }
}

/**
 * Read the webhook JSON, then extract from the transcript and combine.
 * Webhook values stay when already filled; transcript adds missing fields and extra names.
 */
export async function enrichWebhookFromTranscript(
  body: Record<string, unknown>,
  masters: VoiceCallMasters,
  options?: TranscriptEnrichOptions
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...body };
  const nested = body.call_result;
  if (isPlainObject(nested)) Object.assign(payload, nested);

  const runExtras = await lookupRunArtifacts(payload, options);
  mergeExtractedSurvey(payload, runExtras);
  fillUrlIfEmpty(payload, 'transcript_url', runExtras.transcript_url);
  fillUrlIfEmpty(payload, 'voice_recording_url', runExtras.voice_recording_url);
  fillUrlIfEmpty(payload, 'recording_url', runExtras.recording_url);
  if (isEmptyField(payload.call_duration_seconds) && runExtras.call_duration_seconds != null) {
    payload.call_duration_seconds = runExtras.call_duration_seconds;
  }

  const validStatuses = ['Connected', 'Disconnected', 'Incoming N/A', 'No Answer', 'Invalid'];
  const status = payload.call_status ?? payload.callStatus;
  if (typeof status === 'string' && validStatuses.includes(status) && status !== 'Connected') {
    return payload;
  }

  let transcriptText = '';
  let transcriptUrl = pickHttpUrl(payload, ['transcript_url', 'transcriptUrl', 'transcript_public_url']);
  try {
    const resolved = await resolveTranscriptText(payload, options);
    transcriptText = resolved.text;
    if (resolved.url) transcriptUrl = resolved.url;
  } catch (error) {
    logger.warn('Voice transcript fetch failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  fillUrlIfEmpty(payload, 'transcript_url', transcriptUrl);

  if (!transcriptText) return payload;

  const callContext = options?.callContext;
  const extract =
    options?.extractFromTranscript ??
    (async (text: string, m: VoiceCallMasters, ctx?: VoiceCallContext) => {
      if (!isAIServiceAvailable()) {
        throw new Error('GEMINI_API_KEY is not configured');
      }
      return extractVoiceCallFromTranscript(text, {
        farmerName: ctx?.farmerName,
        activityType: ctx?.activityType,
        territory: ctx?.villageName,
        crops: m.crops,
        products: m.products,
        activityCrops: ctx?.activityCrops,
        activityProducts: ctx?.activityProducts,
      });
    });

  try {
    const extracted = await extract(transcriptText, masters, callContext);
    const combined = pickBestVoicePayload(payload, extracted, masters, callContext || {});
    logger.info('Voice result picked from transcript + webhook against call context', {
      keys: SURVEY_KEYS.filter((key) => !isEmptyField(combined[key])),
    });
    return combined;
  } catch (error) {
    logger.warn('Voice transcript extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return payload;
}
