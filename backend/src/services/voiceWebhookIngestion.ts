import { MasterCrop, MasterProduct, NonPurchaseReason, Sentiment } from '../models/MasterData.js';
import { ICallLog } from '../models/CallTask.js';
import { Farmer } from '../models/Farmer.js';
import { Activity } from '../models/Activity.js';
import logger from '../config/logger.js';
import { SubmitCallInteractionInput } from './taskSubmitService.js';
import {
  enrichWebhookFromTranscript,
  type TranscriptEnrichOptions,
} from './voiceTranscriptFallback.js';
import { CROP_NAME_ALIASES, canonicalName, matchAgainstOurData } from './voiceNameMatch.js';

/**
 * Common JSON Dograh should always POST. Fill what the call produced;
 * use null / [] / "" for the rest. Reach applies human-form rules and masters.
 *
 * {
 *   task_id, attempt_id, workflow_run_id,
 *   call_status, call_duration_seconds,
 *   did_attend, did_recall,
 *   crops_discussed, products_discussed, activity_quality,
 *   has_purchased, purchased_products,
 *   willing_to_purchase, likely_purchase_date, non_purchase_reason,
 *   farmer_comments, sentiment,
 *   voice_recording_url, transcript_url
 * }
 */
export const VOICE_CALL_STATUSES: ICallLog['callStatus'][] = [
  'Connected',
  'Disconnected',
  'Incoming N/A',
  'No Answer',
  'Invalid',
];

const DID_ATTEND_VALUES: NonNullable<ICallLog['didAttend']>[] = [
  'Yes, I attended',
  'No, I missed',
  "Don't recall",
  'Identity Wrong',
  'Not a Farmer',
];

const UNITS = ['kg', 'gms', 'lt'] as const;
const RECALL_ATTEND = new Set(['Yes, I attended', "Don't recall"]);

export interface VoiceCallMasters {
  crops: string[];
  products: string[];
  nonPurchaseReasons: string[];
  sentiments: string[];
}

export interface VoiceCallContext {
  farmerName?: string;
  villageName?: string;
  activityType?: string;
  activityCrops?: string[];
  activityProducts?: string[];
  mdoName?: string;
}

export async function loadVoiceCallMasters(): Promise<VoiceCallMasters> {
  const [crops, products, reasons, sentiments] = await Promise.all([
    MasterCrop.find({ isActive: true }).select('name').lean(),
    MasterProduct.find({ isActive: true }).select('name').lean(),
    NonPurchaseReason.find({ isActive: true }).select('name').lean(),
    Sentiment.find({ isActive: true }).select('name').lean(),
  ]);
  return {
    crops: crops.map((r) => r.name).filter(Boolean),
    products: products.map((r) => r.name).filter(Boolean),
    nonPurchaseReasons: reasons.map((r) => r.name).filter(Boolean),
    sentiments: sentiments.map((r) => r.name).filter(Boolean),
  };
}

export async function loadVoiceCallContext(task: {
  farmerId?: unknown;
  activityId?: unknown;
}): Promise<VoiceCallContext> {
  const [farmer, activity] = await Promise.all([
    task.farmerId ? Farmer.findById(task.farmerId).select('name location').lean() : null,
    task.activityId
      ? Activity.findById(task.activityId).select('type crops products officerName location').lean()
      : null,
  ]);
  return {
    farmerName: farmer?.name || '',
    villageName: farmer?.location || activity?.location || '',
    activityType: activity?.type || '',
    activityCrops: (activity?.crops || []).filter(Boolean),
    activityProducts: (activity?.products || []).filter(Boolean),
    mdoName: activity?.officerName || '',
  };
}

function preferMasterSpelling(
  values: string[] | undefined,
  names: string[],
  options?: Parameters<typeof canonicalName>[2]
): string[] {
  return (values || [])
    .map((value) => canonicalName(value, names, options) || value.trim())
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function flattenWebhookBody(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.call_result;
  if (isPlainObject(nested)) {
    return { ...nested, ...body };
  }
  return body;
}

function isUnresolvedTemplate(value: unknown): boolean {
  return typeof value === 'string' && /^\{\{[^}]+\}\}$/.test(value.trim());
}

function pick(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] === undefined) continue;
    const value = payload[key];
    if (isUnresolvedTemplate(value)) return '';
    return value;
  }
  return undefined;
}

function pickHttpUrl(payload: Record<string, unknown>, ...keys: string[]): string {
  const value = pick(payload, ...keys);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

/**
 * True when the webhook already has survey answers in our format,
 * so we should not fetch/extract the transcript.
 */
export function hasStructuredCallResult(body: Record<string, unknown>): boolean {
  const payload = flattenWebhookBody(body);
  if (mapDidAttend(pick(payload, 'did_attend', 'didAttend'))) return true;
  if (parseBoolean(pick(payload, 'did_recall', 'didRecall')) != null) return true;
  if (parseStringArray(pick(payload, 'crops_discussed', 'cropsDiscussed')).length) return true;
  if (parseStringArray(pick(payload, 'products_discussed', 'productsDiscussed')).length) return true;
  if (parseInteger(pick(payload, 'activity_quality', 'activityQuality')) != null) return true;
  if (parseBoolean(pick(payload, 'has_purchased', 'hasPurchased')) != null) return true;
  if (parseBoolean(pick(payload, 'willing_to_purchase', 'willingToPurchase')) != null) return true;
  const comments = String(pick(payload, 'farmer_comments', 'farmerComments') ?? '').trim();
  return Boolean(comments);
}

function parseStringArray(value: unknown): string[] {
  if (isUnresolvedTemplate(value) || value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v && !isUnresolvedTemplate(v));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
      } catch {
        /* fall through */
      }
    }
    return trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '' || isUnresolvedTemplate(value)) return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  if (['true', 'yes', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  return null;
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || isUnresolvedTemplate(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapVoiceCallStatus(payload: Record<string, unknown>): ICallLog['callStatus'] {
  const raw = String(
    pick(
      payload,
      'call_status',
      'callStatus',
      'telephony_status',
      'end_reason',
      'call_disposition',
      'callDisposition',
      'disposition'
    ) ?? ''
  ).trim();
  const s = raw.toLowerCase().replace(/_/g, ' ');
  if (!raw) return 'No Answer';
  if (VOICE_CALL_STATUSES.includes(raw as ICallLog['callStatus'])) {
    return raw as ICallLog['callStatus'];
  }
  if (s.includes('invalid')) return 'Invalid';
  if (s.includes('no answer') || s === 'no-answer' || s.includes('not reachable')) return 'No Answer';
  if (s.includes('busy') || s.includes('disconnected')) return 'Disconnected';
  if (s.includes('incoming') && s.includes('n/a')) return 'Incoming N/A';
  if (s.includes('voicemail')) return 'No Answer';
  if (s.includes('connect') || s.includes('completed') || s.includes('end call') || s.includes('bot hangup')) {
    return 'Connected';
  }
  if (s.includes('failed') || s.includes('error') || s.includes('canceled') || s.includes('cancelled')) {
    return 'No Answer';
  }
  return 'Connected';
}

function mapDidAttend(value: unknown): ICallLog['didAttend'] {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (DID_ATTEND_VALUES.includes(s as NonNullable<ICallLog['didAttend']>)) {
    return s as ICallLog['didAttend'];
  }
  const lower = s.toLowerCase();
  if (lower.includes('identity') || lower.includes('wrong')) return 'Identity Wrong';
  if (lower.includes('not a farmer')) return 'Not a Farmer';
  if (lower.includes("don't") || lower.includes('dont') || lower.includes('recall')) return "Don't recall";
  if (lower.includes('missed')) return 'No, I missed';
  if (lower.includes('yes') || lower.includes('attended')) return 'Yes, I attended';
  if (lower === 'no') return 'No, I missed';
  return null;
}

function referenceDateFromPayload(payload: Record<string, unknown>): Date {
  const raw = pick(payload, 'call_ended_at', 'ended_at', 'call_end_time', 'timestamp');
  const parsed = raw ? new Date(String(raw)) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatYmdIST(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addIstDays(date: Date, days: number): string {
  const shifted = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return formatYmdIST(shifted);
}

function mapSentiment(value: unknown, sentiments: string[]): ICallLog['sentiment'] {
  const allowed = sentiments.length ? sentiments : ['Positive', 'Negative', 'Neutral', 'N/A'];
  const matched = canonicalName(String(value || 'N/A'), allowed);
  if (matched && ['Positive', 'Negative', 'Neutral', 'N/A'].includes(matched)) {
    return matched as ICallLog['sentiment'];
  }
  const lower = String(value || '').toLowerCase();
  if (lower.includes('pos')) return 'Positive';
  if (lower.includes('neg')) return 'Negative';
  if (lower.includes('neut')) return 'Neutral';
  return 'N/A';
}

function parseUnit(value: unknown): (typeof UNITS)[number] {
  const s = String(value || 'kg').trim().toLowerCase();
  if (s === 'kg' || s === 'kgs') return 'kg';
  if (s === 'gms' || s === 'g' || s === 'gm' || s === 'gram' || s === 'grams') return 'gms';
  if (s === 'lt' || s === 'l' || s === 'ltr' || s === 'litre' || s === 'liter') return 'lt';
  return 'kg';
}

function parsePurchasedProducts(
  value: unknown,
  productNames: string[],
  preferred: string[] = []
): { items: ICallLog['purchasedProducts']; unmatched: string[] } {
  let rows = value;
  if (typeof rows === 'string') {
    const trimmed = rows.trim();
    if (!trimmed || isUnresolvedTemplate(trimmed)) return { items: [], unmatched: [] };
    if (trimmed.startsWith('[')) {
      try {
        rows = JSON.parse(trimmed);
      } catch {
        return { items: [], unmatched: [] };
      }
    } else {
      return { items: [], unmatched: [] };
    }
  }
  if (!Array.isArray(rows)) return { items: [], unmatched: [] };
  const items: ICallLog['purchasedProducts'] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const rawName = String(row.product ?? row.name ?? '').trim();
    if (!rawName) continue;
    const product = productNames.length || preferred.length
      ? matchAgainstOurData([rawName], productNames, preferred).matched[0] || null
      : rawName;
    if (!product) {
      unmatched.push(rawName);
      continue;
    }
    if (seen.has(product)) continue;
    seen.add(product);
    items.push({
      product,
      quantity: String(row.quantity ?? row.qty ?? '').trim(),
      unit: parseUnit(row.unit),
    });
  }
  return { items, unmatched };
}

function parseLikelyDate(value: unknown, reference = new Date()): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const lower = s.toLowerCase();
  if (lower === 'today' || s === 'आज') return formatYmdIST(reference);
  if (lower === 'tomorrow' || s === 'कल') return addIstDays(reference, 1);
  if (lower === 'day after tomorrow' || s === 'परसों') return addIstDays(reference, 2);
  return '';
}

function emptySurvey(partial: Partial<SubmitCallInteractionInput> = {}): SubmitCallInteractionInput {
  return {
    callStatus: 'No Answer',
    callDurationSeconds: 0,
    didAttend: null,
    didRecall: null,
    cropsDiscussed: [],
    productsDiscussed: [],
    hasPurchased: null,
    willingToPurchase: null,
    likelyPurchaseDate: '',
    nonPurchaseReason: '',
    purchasedProducts: [],
    farmerComments: '',
    sentiment: 'N/A',
    activityQuality: null,
    ...partial,
  };
}

/**
 * Apply the same dependent-field rules as the human Call Interaction form,
 * and coerce names onto active masters when those lists are provided.
 */
export function mapVoiceWebhookToSubmitInput(
  body: Record<string, unknown>,
  masters: VoiceCallMasters = { crops: [], products: [], nonPurchaseReasons: [], sentiments: [] },
  callContext: VoiceCallContext = {}
): SubmitCallInteractionInput {
  const payload = flattenWebhookBody(body);
  const callStatus = mapVoiceCallStatus(payload);
  const duration = Math.max(
    0,
    parseInteger(pick(payload, 'call_duration_seconds', 'callDurationSeconds', 'duration', 'call_duration')) || 0
  );
  const recordingUrl = pickHttpUrl(
    payload,
    'voice_recording_url',
    'recording_url',
    'recordingUrl',
    'recording'
  );
  const transcriptUrl = pickHttpUrl(
    payload,
    'transcript_url',
    'transcriptUrl',
    'transcript_public_url'
  );

  const media = {
    ...(recordingUrl && { recordingUrl }),
    ...(transcriptUrl && { transcriptUrl }),
  };

  if (callStatus !== 'Connected') {
    return emptySurvey({ callStatus, callDurationSeconds: duration, ...media });
  }

  const preferredCrops = preferMasterSpelling(callContext.activityCrops, masters.crops, {
    aliases: CROP_NAME_ALIASES,
  });
  const preferredProducts = preferMasterSpelling(callContext.activityProducts, masters.products);

  const didAttend = mapDidAttend(pick(payload, 'did_attend', 'didAttend'));
  let didRecall = parseBoolean(pick(payload, 'did_recall', 'didRecall'));
  if (!didAttend || !RECALL_ATTEND.has(didAttend)) {
    didRecall = null;
  }

  const cropMatch = matchAgainstOurData(
    parseStringArray(pick(payload, 'crops_discussed', 'cropsDiscussed')),
    masters.crops,
    callContext.activityCrops || [],
    { aliases: CROP_NAME_ALIASES, preferred: preferredCrops }
  );
  const productMatch = matchAgainstOurData(
    parseStringArray(pick(payload, 'products_discussed', 'productsDiscussed')),
    masters.products,
    callContext.activityProducts || [],
    { preferred: preferredProducts }
  );
  let cropsDiscussed = cropMatch.matched;
  let productsDiscussed = productMatch.matched;
  let activityQuality = parseInteger(pick(payload, 'activity_quality', 'activityQuality'));
  if (activityQuality != null && (activityQuality < 1 || activityQuality > 5)) activityQuality = null;

  let hasPurchased = parseBoolean(pick(payload, 'has_purchased', 'hasPurchased'));
  let willingToPurchase = parseBoolean(pick(payload, 'willing_to_purchase', 'willingToPurchase'));
  let likelyPurchaseDate = parseLikelyDate(
    pick(payload, 'likely_purchase_date', 'likelyPurchaseDate'),
    referenceDateFromPayload(payload)
  );
  let nonPurchaseReason = String(pick(payload, 'non_purchase_reason', 'nonPurchaseReason') ?? '').trim();
  const purchased = parsePurchasedProducts(
    pick(payload, 'purchased_products', 'purchasedProducts'),
    masters.products,
    preferredProducts
  );
  let purchasedProducts = purchased.items;
  let farmerComments = String(pick(payload, 'farmer_comments', 'farmerComments') ?? '').trim();
  let sentiment = mapSentiment(pick(payload, 'sentiment'), masters.sentiments);

  const unmatchedNotes = [...cropMatch.extra, ...productMatch.extra, ...purchased.unmatched];
  if (unmatchedNotes.length) {
    const note = `Also mentioned: ${unmatchedNotes.join(', ')}`;
    farmerComments = farmerComments ? `${farmerComments}\n${note}` : note;
  }

  const surveySignal =
    cropsDiscussed.length > 0 ||
    productsDiscussed.length > 0 ||
    unmatchedNotes.length > 0 ||
    activityQuality != null ||
    hasPurchased != null ||
    willingToPurchase != null ||
    Boolean(likelyPurchaseDate) ||
    Boolean(nonPurchaseReason) ||
    Boolean(farmerComments);
  if (didRecall == null && didAttend && RECALL_ATTEND.has(didAttend) && surveySignal) {
    didRecall = true;
  }

  if (didRecall !== true) {
    cropsDiscussed = [];
    productsDiscussed = [];
    activityQuality = null;
    hasPurchased = null;
    willingToPurchase = null;
    likelyPurchaseDate = '';
    nonPurchaseReason = '';
    purchasedProducts = [];
    farmerComments = '';
    sentiment = 'N/A';
  } else {
    if (hasPurchased == null && (willingToPurchase != null || likelyPurchaseDate || nonPurchaseReason)) {
      hasPurchased = false;
    }
    if (hasPurchased === true) {
      willingToPurchase = null;
      likelyPurchaseDate = '';
      nonPurchaseReason = '';
    } else if (hasPurchased === false) {
      purchasedProducts = [];
      if (willingToPurchase !== true) likelyPurchaseDate = '';
      if (willingToPurchase === true) nonPurchaseReason = '';
    } else {
      willingToPurchase = null;
      likelyPurchaseDate = '';
      nonPurchaseReason = '';
      purchasedProducts = [];
    }
  }

  if (nonPurchaseReason) {
    const matchedReason = masters.nonPurchaseReasons.length
      ? canonicalName(nonPurchaseReason, masters.nonPurchaseReasons)
      : nonPurchaseReason;
    nonPurchaseReason = matchedReason || '';
  }

  return {
    callStatus,
    callDurationSeconds: duration,
    didAttend,
    didRecall,
    cropsDiscussed,
    productsDiscussed,
    hasPurchased,
    willingToPurchase,
    likelyPurchaseDate,
    nonPurchaseReason,
    purchasedProducts,
    farmerComments,
    sentiment,
    activityQuality,
    ...media,
  };
}

export interface VoiceIngestOptions extends TranscriptEnrichOptions {
  masters?: VoiceCallMasters;
  callContext?: VoiceCallContext;
}

export async function ingestVoiceWebhookCallResult(
  body: Record<string, unknown>,
  options?: VoiceIngestOptions
): Promise<SubmitCallInteractionInput> {
  const masters = options?.masters ?? (await loadVoiceCallMasters());
  const callContext: VoiceCallContext = {
    ...options?.callContext,
    activityCrops: preferMasterSpelling(options?.callContext?.activityCrops, masters.crops, {
      aliases: CROP_NAME_ALIASES,
    }),
    activityProducts: preferMasterSpelling(options?.callContext?.activityProducts, masters.products),
  };

  let payload = body;
  try {
    payload = await enrichWebhookFromTranscript(body, masters, { ...options, callContext });
  } catch (error) {
    logger.warn('Voice transcript enrich skipped', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  return mapVoiceWebhookToSubmitInput(payload, masters, callContext);
}
