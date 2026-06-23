import axios, { AxiosError } from 'axios';
import logger from '../config/logger.js';

/** EMS authenticate + activities API (NACL UAT/prod). */

export interface EmsFfaActivity {
  activityId: string;
  type: string;
  date: string;
  officerId: string;
  officerName: string;
  location: string;
  territory: string;
  territoryName?: string;
  zoneName?: string;
  buName?: string;
  tmEmpCode?: string;
  tmName?: string;
  state?: string;
  crops?: string[];
  products?: string[];
  farmers: EmsFfaFarmer[];
}

export interface EmsFfaFarmer {
  farmerId: string;
  name: string;
  mobileNumber: string;
  location: string;
  crops?: string[];
  photoUrl?: string;
}

type EmsAuthResponse = {
  styp?: string;
  senm?: string;
  odat?: Array<{ token?: string }> | { token?: string };
};

const REQUEST_TIMEOUT_MS = 30_000;

export const isEmsFfaApiEnabled = (): boolean => {
  const ctid = process.env.FFA_EMS_CTID?.trim();
  const sectkey = process.env.FFA_EMS_SECTKEY?.trim();
  return Boolean(ctid && sectkey);
};

/** Base URL ending in `/api` (e.g. https://emsapiuat.naclind.com/api). */
export const resolveEmsApiBase = (ffaApiUrl: string): string => {
  let base = (ffaApiUrl || '').trim().replace(/\/$/, '');
  if (base.endsWith('/EMS/authenticate')) {
    base = base.slice(0, -'/EMS/authenticate'.length);
  }
  if (!base.endsWith('/api')) {
    base = `${base}/api`;
  }
  return base;
};

/** Full sync / legacy: DD/MM/YYYY */
export const formatDateFromParam = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
};

/**
 * NACL EMS dateFrom query param: DD-MM-YYYY HH:mm:ss (matches activity `Date` in prod).
 * Prod rejects DD/MM/YYYY HH:mm:ss ("Error converting data type varchar to date").
 * DD/MM/YYYY date-only also works; this formatter is used for a consistent datetime cutoff.
 */
export const formatEmsDateTimeFromParam = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;
};

/**
 * NACL EMS `dateFrom` query param for GET /EMS/activities.
 * Prod accepts DD/MM/YYYY date-only (Postman / live API). DD-MM-YYYY HH:mm:ss and
 * DD/MM/YYYY HH:mm:ss cause SQL errors or timeouts on emsffaapi.naclind.com.
 */
export const formatEmsActivitiesQueryDateFrom = (date: Date): string => formatDateFromParam(date);

/** @deprecated Prefer formatEmsActivitiesQueryDateFrom for EMS API query strings. */
export const formatEmsActivitiesDateFromParam = (date: Date): string =>
  formatEmsDateTimeFromParam(date);

const validateLocalDateTime = (
  d: Date,
  yyyy: number,
  mm: number,
  dd: number,
  h = 0,
  min = 0,
  sec = 0
): void => {
  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd ||
    d.getHours() !== h ||
    d.getMinutes() !== min ||
    d.getSeconds() !== sec
  ) {
    throw new Error('Invalid activity date/time');
  }
};

/**
 * Parse NACL activity `Date` and related strings into local Date.
 * Supports DD-MM-YYYY HH:mm:ss (prod), slash variants, and legacy formats.
 */
export const parseEmsActivityDate = (value: string): Date => {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid activity date (missing)');
  }

  const raw = value.trim();

  const dashDateTime = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (dashDateTime) {
    const dd = Number(dashDateTime[1]);
    const mm = Number(dashDateTime[2]);
    const yyyy = Number(dashDateTime[3]);
    const h = Number(dashDateTime[4]);
    const min = Number(dashDateTime[5]);
    const sec = Number(dashDateTime[6]);
    const d = new Date(yyyy, mm - 1, dd, h, min, sec);
    validateLocalDateTime(d, yyyy, mm, dd, h, min, sec);
    return d;
  }

  const dashDateOnly = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashDateOnly) {
    const dd = Number(dashDateOnly[1]);
    const mm = Number(dashDateOnly[2]);
    const yyyy = Number(dashDateOnly[3]);
    const d = new Date(yyyy, mm - 1, dd);
    validateLocalDateTime(d, yyyy, mm, dd);
    return d;
  }

  const slashDateTime = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/);
  if (slashDateTime) {
    return parseEmsActivityDate(`${slashDateTime[1]}/${slashDateTime[2]}/${slashDateTime[3]}`);
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const parts = raw.split('/').map((p) => Number(p));
    const [a, b, yyyy] = parts;
    let dd: number;
    let mm: number;
    if (b > 12) {
      mm = a;
      dd = b;
    } else if (a > 12) {
      dd = a;
      mm = b;
    } else {
      dd = a;
      mm = b;
    }
    const d = new Date(yyyy, mm - 1, dd);
    validateLocalDateTime(d, yyyy, mm, dd);
    return d;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid activity date (YYYY-MM-DD): ${raw}`);
    }
    return d;
  }

  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid activity date: ${raw}`);
  }
  return d;
};

/** Parse DD/MM/YYYY from FFA_EMS_DEFAULT_DATE_FROM (or fallback for full FFA sync). */
export const parseFfaEmsDefaultDateFrom = (rawInput?: string): Date => {
  const raw = (rawInput ?? process.env.FFA_EMS_DEFAULT_DATE_FROM ?? '01/01/2020').trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return new Date(2020, 0, 1);
  }
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
};

/** Normalized DD/MM/YYYY from env; null if not set or invalid. */
export const getFfaEmsDefaultDateFromDisplay = (): string | null => {
  const raw = process.env.FFA_EMS_DEFAULT_DATE_FROM?.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = String(Number(m[1])).padStart(2, '0');
  const mm = String(Number(m[2])).padStart(2, '0');
  return `${dd}/${mm}/${m[3]}`;
};

/** ISO date (YYYY-MM-DD) for HTML date inputs; null if env not set. */
export const getFfaEmsDefaultDateFromIso = (): string | null => {
  const display = getFfaEmsDefaultDateFromDisplay();
  if (!display) return null;
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

export const resolveActivitiesDateFrom = (dateFrom?: Date): Date => {
  if (dateFrom) return dateFrom;
  return parseFfaEmsDefaultDateFrom();
};

export type EmsActivitiesFetchMode = 'full' | 'incremental';

/** NACL EMS requires limit > 0; 100 is the documented example. */
const DEFAULT_EMS_LIMIT_INCREMENTAL = 100;
const DEFAULT_EMS_LIMIT_FULL = 100;
const DEFAULT_EMS_LIMIT_FALLBACK = 10_000;

/** Parse non-negative integer limit; undefined if unset/invalid. */
export const parseEmsActivitiesLimit = (raw: string | undefined | null): number | undefined => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
};

/**
 * NACL EMS `limit` query param resolution (config/env). 0 means "use server default cap" in admin UI.
 * Resolution order: per-request override → mode env → global `FFA_EMS_ACTIVITIES_LIMIT` → 0.
 */
export const resolveEmsActivitiesLimit = (
  mode: EmsActivitiesFetchMode,
  requestOverride?: number | null
): number => {
  if (requestOverride !== undefined && requestOverride !== null) {
    const parsed = parseEmsActivitiesLimit(String(requestOverride));
    if (parsed !== undefined) return parsed;
  }
  const modeEnv =
    mode === 'full'
      ? process.env.FFA_EMS_ACTIVITIES_LIMIT_FULL
      : process.env.FFA_EMS_ACTIVITIES_LIMIT_INCREMENTAL;
  const modeLimit = parseEmsActivitiesLimit(modeEnv);
  if (modeLimit !== undefined) return modeLimit;
  const globalLimit = parseEmsActivitiesLimit(process.env.FFA_EMS_ACTIVITIES_LIMIT);
  if (globalLimit !== undefined) return globalLimit;
  return 0;
};

/** When limit=0 returns empty on prod, retry with this cap (env override). */
export const resolveEmsActivitiesLimitFallback = (): number => {
  return parseEmsActivitiesLimit(process.env.FFA_EMS_ACTIVITIES_LIMIT_FALLBACK) ?? DEFAULT_EMS_LIMIT_FALLBACK;
};

/**
 * EMS API rejects limit=0 (doc: limit must be > 0). Map 0 / unset to a positive request limit.
 */
export const coerceEmsActivitiesRequestLimit = (
  resolved: number,
  mode: EmsActivitiesFetchMode
): number => {
  if (resolved > 0) return resolved;
  const fromEnv = parseEmsActivitiesLimit(process.env.FFA_EMS_ACTIVITIES_LIMIT_FALLBACK);
  if (fromEnv !== undefined && fromEnv > 0) return fromEnv;
  return mode === 'full' ? DEFAULT_EMS_LIMIT_FULL : DEFAULT_EMS_LIMIT_INCREMENTAL;
};

export const getEmsPullLimitConfig = (): {
  enabled: boolean;
  globalLimit: number;
  fullLimit: number;
  incrementalLimit: number;
  fallbackLimit: number;
  hint: string;
} => ({
  enabled: isEmsFfaApiEnabled(),
  globalLimit: parseEmsActivitiesLimit(process.env.FFA_EMS_ACTIVITIES_LIMIT) ?? 0,
  fullLimit: resolveEmsActivitiesLimit('full'),
  incrementalLimit: resolveEmsActivitiesLimit('incremental'),
  fallbackLimit: resolveEmsActivitiesLimitFallback(),
  hint: 'EMS requires limit > 0. Admin 0 = server default (100 incremental / 10000 fallback).',
});

const resolveActivitiesRequestTimeoutMs = (limit: number): number => {
  const envRaw = process.env.FFA_EMS_ACTIVITIES_TIMEOUT_MS?.trim();
  if (envRaw) {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Large pulls (limit=0) may return many activities + farmers
  return limit === 0 ? 120_000 : REQUEST_TIMEOUT_MS;
};

const normalizeFarmer = (raw: Record<string, unknown>): EmsFfaFarmer => ({
  farmerId: String(raw.farmerId ?? raw.FarmerId ?? ''),
  name: String(raw.name ?? raw.Name ?? ''),
  mobileNumber: String(raw.mobileNumber ?? raw.MobileNumber ?? raw.mobile ?? ''),
  location: String(raw.location ?? raw.Location ?? ''),
  crops: Array.isArray(raw.crops) ? (raw.crops as string[]) : undefined,
  photoUrl: raw.photoUrl != null ? String(raw.photoUrl) : undefined,
});

const normalizeActivity = (raw: Record<string, unknown>): EmsFfaActivity => ({
  activityId: String(raw.activityId ?? raw.ActivityId ?? ''),
  type: String(raw.type ?? raw.Type ?? ''),
  date: String(raw.date ?? raw.Date ?? ''),
  officerId: String(raw.officerId ?? raw.OfficerId ?? ''),
  officerName: String(raw.officerName ?? raw.OfficerName ?? ''),
  location: String(raw.location ?? raw.Location ?? ''),
  territory: String(
    raw.territory ?? raw.Territory ?? raw.territoryName ?? raw.TerritoryName ?? ''
  ),
  territoryName:
    raw.territoryName != null
      ? String(raw.territoryName)
      : raw.TerritoryName != null
        ? String(raw.TerritoryName)
        : undefined,
  zoneName:
    raw.zoneName != null
      ? String(raw.zoneName)
      : raw.ZoneName != null
        ? String(raw.ZoneName)
        : undefined,
  buName:
    raw.buName != null
      ? String(raw.buName)
      : raw.BuName != null
        ? String(raw.BuName)
        : undefined,
  tmEmpCode:
    raw.tmEmpCode != null
      ? String(raw.tmEmpCode)
      : raw.TmEmpCode != null
        ? String(raw.TmEmpCode)
        : undefined,
  tmName:
    raw.tmName != null
      ? String(raw.tmName)
      : raw.TmName != null
        ? String(raw.TmName)
        : undefined,
  state:
    raw.state != null
      ? String(raw.state)
      : raw.State != null
        ? String(raw.State)
        : undefined,
  crops: Array.isArray(raw.crops)
    ? (raw.crops as string[])
    : Array.isArray(raw.Crops)
      ? (raw.Crops as string[])
      : undefined,
  products: Array.isArray(raw.products)
    ? (raw.products as string[])
    : Array.isArray(raw.Products)
      ? (raw.Products as string[])
      : undefined,
  farmers: Array.isArray(raw.farmers)
    ? (raw.farmers as Record<string, unknown>[]).map(normalizeFarmer)
    : Array.isArray(raw.Farmers)
      ? (raw.Farmers as Record<string, unknown>[]).map(normalizeFarmer)
      : [],
});

const mapRawActivityList = (rawList: unknown[]): EmsFfaActivity[] =>
  rawList
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeActivity(item as Record<string, unknown>));

/** Truncate EMS body for logs when parsing fails (avoid huge payloads). */
const summarizeEmsResponseForLog = (payload: unknown): string => {
  try {
    if (payload === null || payload === undefined) return String(payload);
    if (Array.isArray(payload)) {
      return `array[len=${payload.length}] sample=${JSON.stringify(payload[0] ?? null).slice(0, 400)}`;
    }
    if (typeof payload === 'object') {
      const keys = Object.keys(payload as object);
      return `object keys=[${keys.join(', ')}] sample=${JSON.stringify(payload).slice(0, 500)}`;
    }
    return String(payload).slice(0, 500);
  } catch {
    return '[unserializable EMS response]';
  }
};

const resolveRawActivityListFromObject = (data: Record<string, unknown>): unknown[] | undefined => {
  const nested = data.data ?? data.Data;
  if (Array.isArray(nested)) {
    return nested;
  }
  if (nested && typeof nested === 'object') {
    const nestedObj = nested as Record<string, unknown>;
    if (Array.isArray(nestedObj.activities)) return nestedObj.activities;
    if (Array.isArray(nestedObj.Activities)) return nestedObj.Activities;
  }
  if (Array.isArray(data.activities)) return data.activities;
  if (Array.isArray(data.Activities)) return data.Activities;
  if (Array.isArray(data.odat)) return data.odat;
  return undefined;
};

const extractActivitiesFromPayload = (payload: unknown): EmsFfaActivity[] => {
  if (Array.isArray(payload)) {
    return mapRawActivityList(payload);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('EMS activities returned invalid response format');
  }

  const data = payload as Record<string, unknown>;
  const success =
    data.success === true ||
    data.Success === true ||
    (data.styp === 'S' || data.styp === 's');

  const noDataMsg = String(data.message ?? data.Message ?? data.senm ?? '').toLowerCase();
  if (
    data.Success === false ||
    (data.success === false && noDataMsg.includes('no data'))
  ) {
    logger.info('[FFA SYNC][EMS] No activities returned from EMS', {
      message: data.message ?? data.Message ?? data.senm,
    });
    return [];
  }

  const rawList = resolveRawActivityListFromObject(data);

  if (!rawList) {
    if (!success && (data.styp === 'E' || data.styp === 'e')) {
      throw new Error(`EMS activities error: ${String(data.senm ?? data.message ?? 'unknown')}`);
    }
    const msg = String(data.message ?? data.Message ?? data.senm ?? '').trim();
    logger.warn('[FFA SYNC][EMS] Activities response had no activities array', {
      responseSummary: summarizeEmsResponseForLog(payload),
      message: msg || undefined,
      success,
    });
    return [];
  }

  return mapRawActivityList(rawList);
};

/**
 * POST /api/EMS/authenticate → Bearer session token (odat[0].token).
 */
export const authenticateEms = async (ffaApiUrl: string): Promise<string> => {
  const base = resolveEmsApiBase(ffaApiUrl);
  const url = `${base}/EMS/authenticate`;
  const ctid = process.env.FFA_EMS_CTID!.trim();
  const sectkey = process.env.FFA_EMS_SECTKEY!.trim();
  const token = (process.env.FFA_EMS_TOKEN || '').trim();

  logger.info('[FFA SYNC][EMS] Authenticating', { url, ctidPresent: !!ctid });

  try {
    const response = await axios.post<EmsAuthResponse>(
      url,
      { ctid, token, sectkey },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status) => status < 500,
      }
    );

    if (response.status >= 400) {
      throw new Error(`EMS authenticate HTTP ${response.status}`);
    }

    const body = response.data;
    if (body?.styp === 'E' || body?.styp === 'e') {
      throw new Error(`EMS authenticate failed: ${body.senm ?? 'unknown'}`);
    }

    let sessionToken = '';
    if (Array.isArray(body?.odat) && body.odat.length > 0) {
      sessionToken = body.odat[0]?.token?.trim() ?? '';
    } else if (body?.odat && typeof body.odat === 'object' && 'token' in body.odat) {
      sessionToken = String((body.odat as { token?: string }).token ?? '').trim();
    }

    if (!sessionToken) {
      throw new Error('EMS authenticate succeeded but no session token in odat[0].token');
    }

    logger.info('[FFA SYNC][EMS] Authenticate OK', { tokenLength: sessionToken.length });
    return sessionToken;
  } catch (error) {
    const msg = axios.isAxiosError(error)
      ? formatAxiosError(error, 'EMS authenticate')
      : error instanceof Error
        ? error.message
        : 'EMS authenticate failed';
    logger.error('[FFA SYNC][EMS] Authenticate error', { url, message: msg });
    throw new Error(msg);
  }
};

/**
 * GET /api/EMS/activities?limit=N&dateFrom=... (dateFrom required by EMS).
 * dateFrom query uses DD/MM/YYYY (NACL prod / Postman). Activity `Date` fields in the
 * response remain DD-MM-YYYY HH:mm:ss and are parsed by parseEmsActivityDate.
 */
export const fetchEmsActivities = async (
  ffaApiUrl: string,
  dateFrom: Date,
  limit: number,
  mode: EmsActivitiesFetchMode = 'incremental'
): Promise<EmsFfaActivity[]> => {
  const base = resolveEmsApiBase(ffaApiUrl);
  const dateFromParam = formatEmsActivitiesQueryDateFrom(dateFrom);
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 0;
  const requestLimit = coerceEmsActivitiesRequestLimit(safeLimit, mode);
  const sessionToken = await authenticateEms(ffaApiUrl);

  const fetchWithLimit = async (reqLimit: number): Promise<EmsFfaActivity[]> => {
    const url = `${base}/EMS/activities?limit=${reqLimit}&dateFrom=${encodeURIComponent(dateFromParam)}`;
    const timeoutMs = resolveActivitiesRequestTimeoutMs(reqLimit);

    logger.info('[FFA SYNC][EMS] Fetching activities', {
      url,
      dateFrom: dateFromParam,
      limit: reqLimit,
      configuredLimit: safeLimit,
      timeoutMs,
    });

    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      const detail =
        typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data);
      throw new Error(`EMS activities HTTP ${response.status}: ${detail}`);
    }

    return extractActivitiesFromPayload(response.data);
  };

  try {
    const activities = await fetchWithLimit(requestLimit);
    logger.info(`[FFA SYNC][EMS] Fetched ${activities.length} activities`);
    return activities;
  } catch (error) {
    const msg = axios.isAxiosError(error)
      ? formatAxiosError(error, 'EMS activities')
      : error instanceof Error
        ? error.message
        : 'EMS activities request failed';
    logger.error('[FFA SYNC][EMS] Activities fetch error', { dateFrom: dateFromParam, limit: safeLimit, message: msg });
    throw new Error(msg);
  }
};

const formatAxiosError = (error: AxiosError, context: string): string => {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return `Cannot connect for ${context}: ${error.message}`;
  }
  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    const timeoutSec = (error.config?.timeout ?? REQUEST_TIMEOUT_MS) / 1000;
    return `${context} timed out after ${timeoutSec}s`;
  }
  if (error.response) {
    const detail = error.response.data ? ` - ${JSON.stringify(error.response.data)}` : '';
    return `${context} HTTP ${error.response.status}${detail}`;
  }
  return `${context}: ${error.message}`;
};
