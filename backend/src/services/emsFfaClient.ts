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

export const formatDateFromParam = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
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
  territory: String(raw.territory ?? raw.Territory ?? raw.territoryName ?? ''),
  territoryName: raw.territoryName != null ? String(raw.territoryName) : undefined,
  zoneName: raw.zoneName != null ? String(raw.zoneName) : undefined,
  buName: raw.buName != null ? String(raw.buName) : undefined,
  tmEmpCode: raw.tmEmpCode != null ? String(raw.tmEmpCode) : undefined,
  tmName: raw.tmName != null ? String(raw.tmName) : undefined,
  state: raw.state != null ? String(raw.state) : undefined,
  crops: Array.isArray(raw.crops) ? (raw.crops as string[]) : undefined,
  products: Array.isArray(raw.products) ? (raw.products as string[]) : undefined,
  farmers: Array.isArray(raw.farmers)
    ? (raw.farmers as Record<string, unknown>[]).map(normalizeFarmer)
    : [],
});

const extractActivitiesFromPayload = (data: Record<string, unknown>): EmsFfaActivity[] => {
  const success =
    data.success === true ||
    data.Success === true ||
    (data.styp === 'S' || data.styp === 's');

  const noDataMsg = String(data.message ?? data.senm ?? '').toLowerCase();
  if (
    data.Success === false ||
    (data.success === false && noDataMsg.includes('no data'))
  ) {
    logger.info('[FFA SYNC][EMS] No activities returned from EMS', { message: data.message ?? data.senm });
    return [];
  }

  let rawList: unknown[] | undefined;
  const nested = data.data as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.activities)) {
    rawList = nested.activities;
  } else if (Array.isArray(data.activities)) {
    rawList = data.activities;
  } else if (Array.isArray(data.odat)) {
    rawList = data.odat;
  }

  if (!rawList) {
    if (!success && (data.styp === 'E' || data.styp === 'e')) {
      throw new Error(`EMS activities error: ${String(data.senm ?? data.message ?? 'unknown')}`);
    }
    if (!success && data.Success === false) {
      return [];
    }
    throw new Error('EMS activities response does not contain an activities array');
  }

  return rawList
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeActivity(item as Record<string, unknown>));
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
 * GET /api/EMS/activities?limit=100&dateFrom=DD/MM/YYYY (dateFrom required by EMS).
 */
export const fetchEmsActivities = async (
  ffaApiUrl: string,
  dateFrom: Date
): Promise<EmsFfaActivity[]> => {
  const base = resolveEmsApiBase(ffaApiUrl);
  const dateFromParam = formatDateFromParam(dateFrom);
  const url = `${base}/EMS/activities?limit=100&dateFrom=${encodeURIComponent(dateFromParam)}`;

  const sessionToken = await authenticateEms(ffaApiUrl);

  logger.info('[FFA SYNC][EMS] Fetching activities', { url, dateFrom: dateFromParam });

  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
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

    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('EMS activities returned invalid response format');
    }

    const activities = extractActivitiesFromPayload(data as Record<string, unknown>);
    logger.info(`[FFA SYNC][EMS] Fetched ${activities.length} activities`);
    return activities;
  } catch (error) {
    const msg = axios.isAxiosError(error)
      ? formatAxiosError(error, 'EMS activities')
      : error instanceof Error
        ? error.message
        : 'EMS activities request failed';
    logger.error('[FFA SYNC][EMS] Activities fetch error', { url, message: msg });
    throw new Error(msg);
  }
};

const formatAxiosError = (error: AxiosError, context: string): string => {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return `Cannot connect for ${context}: ${error.message}`;
  }
  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    return `${context} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
  }
  if (error.response) {
    const detail = error.response.data ? ` - ${JSON.stringify(error.response.data)}` : '';
    return `${context} HTTP ${error.response.status}${detail}`;
  }
  return `${context}: ${error.message}`;
};
