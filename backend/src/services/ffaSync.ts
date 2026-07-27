import { Activity, IActivity } from '../models/Activity.js';
import { Farmer, IFarmer } from '../models/Farmer.js';
import logger from '../config/logger.js';
import { FfaSyncConfig } from '../models/FfaSyncConfig.js';
import mongoose from 'mongoose';
import axios, { AxiosError } from 'axios';
import { getLanguageForState } from '../utils/stateLanguageMapper.js';
import {
  fetchEmsActivities,
  formatDateFromParam,
  formatEmsActivitiesQueryDateFrom,
  formatEmsActivitiesDateFromParam,
  parseEmsActivityDate,
  getEmsPullLimitConfig,
  parseEmsActivitiesLimit,
  coerceEmsActivitiesRequestLimit,
  resolveEmsActivitiesLimit,
  isEmsFfaApiEnabled,
  resolveActivitiesDateFrom,
} from './emsFfaClient.js';
import { resolveEmsActivitiesDateFrom, recordLastSyncRunResult } from './ffaSyncConfigService.js';

interface FFAActivity {
  activityId: string;
  type: string;
  date: string;
  officerId: string; // MDO empCode
  officerName: string; // MDO name
  location: string;
  territory: string; // legacy / fallback
  territoryName?: string; // Activity API v2 preferred
  zoneName?: string;
  buName?: string;
  tmEmpCode?: string;
  tmName?: string;
  state?: string; // NEW: State field from FFA API (optional during transition)
  crops?: string[];
  products?: string[];
  farmers: FFAFarmer[];
}

interface FFAFarmer {
  farmerId: string;
  name: string;
  mobileNumber: string;
  location: string;
  // preferredLanguage: string; // REMOVED - will be derived from state
  crops?: string[];
  photoUrl?: string;
}

const FFA_API_URL = process.env.FFA_API_URL || 'http://localhost:4000/api';

/** Shown when FFA/EMS API responds OK but returns zero activities (not a failure). */
export const FFA_SYNC_NO_ACTIVITIES_MESSAGE =
  'Sync completed successfully, but there are no new activities to update from FFA.';

/**
 * Fetch activities from FFA API with timeout and better error handling
 * @param dateFrom - Optional date to fetch activities after (for incremental sync)
 * @param fullSync - When true, uses full-sync limit (default 0 = all eligible from default dateFrom)
 * @param activitiesLimit - Optional per-request EMS `limit` override (0 = all eligible)
 */
const fetchFFAActivities = async (
  dateFrom?: Date,
  fullSync = false,
  activitiesLimit?: number | null
): Promise<FFAActivity[]> => {
  // Validate FFA_API_URL is set
  if (!process.env.FFA_API_URL) {
    logger.warn('FFA_API_URL environment variable is not set, using default: http://localhost:4000/api');
  }

  if (isEmsFfaApiEnabled()) {
    const emsDateFrom = resolveActivitiesDateFrom(dateFrom);
    const emsMode = fullSync ? 'full' : 'incremental';
    const emsLimit = resolveEmsActivitiesLimit(emsMode, activitiesLimit);
    const emsRequestLimit = coerceEmsActivitiesRequestLimit(emsLimit, emsMode);
    const dateFromParam = formatEmsActivitiesQueryDateFrom(emsDateFrom);
    logger.info('[FFA SYNC] Using NACL EMS API (authenticate + /EMS/activities)', {
      syncMode: emsMode,
      configuredLimit: emsLimit,
      requestLimit: emsRequestLimit,
      dateFrom: emsDateFrom.toISOString(),
      dateFromParam,
      dateFromMeaning: 'FFA activity date cutoff (DD/MM/YYYY for EMS query)',
    });
    const raw = await fetchEmsActivities(FFA_API_URL, emsDateFrom, emsLimit, emsMode);
    const cutoffStart = new Date(emsDateFrom);
    cutoffStart.setHours(0, 0, 0, 0);
    const filtered = raw.filter((a) => {
      try {
        return parseEmsActivityDate(a.date) >= cutoffStart;
      } catch {
        logger.warn('[FFA SYNC] Dropping EMS activity with unparseable date', {
          activityId: a.activityId,
          date: a.date,
        });
        return false;
      }
    });
    if (filtered.length < raw.length) {
      logger.info(
        `[FFA SYNC] Kept ${filtered.length}/${raw.length} EMS activities on or after ${dateFromParam}`
      );
    }
    return filtered;
  }

  // Build URL with optional dateFrom parameter for incremental sync (mock / vendor spec)
  // Handle trailing slash in FFA_API_URL to avoid double slashes
  const baseUrl = FFA_API_URL.endsWith('/') ? FFA_API_URL.slice(0, -1) : FFA_API_URL;
  let url = `${baseUrl}/activities?limit=100`;
  if (dateFrom) {
    // New contract: DD/MM/YYYY (keep server-side compatibility for legacy too)
    const dd = String(dateFrom.getDate()).padStart(2, '0');
    const mm = String(dateFrom.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dateFrom.getFullYear());
    const dateFromDDMMYYYY = `${dd}/${mm}/${yyyy}`;
    url += `&dateFrom=${encodeURIComponent(dateFromDDMMYYYY)}`;
    logger.info(`[FFA SYNC] Incremental sync: fetching activities after ${dateFromDDMMYYYY}`);
  } else {
    logger.info(`[FFA SYNC] Full sync: fetching all activities`);
  }

  logger.info(`[FFA SYNC] Fetching activities from FFA API: ${url}`, {
    ffaApiUrl: FFA_API_URL,
    fullUrl: url,
    hasEnvVar: !!process.env.FFA_API_URL,
    incremental: !!dateFrom,
    dateFrom: dateFrom?.toISOString(),
  });

  // Optional auth for real FFA API (use FFA_API_TOKEN for Bearer, or FFA_API_KEY for X-API-Key)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const ffaToken = process.env.FFA_API_TOKEN;
  const ffaKey = process.env.FFA_API_KEY;
  if (ffaToken && ffaToken.trim()) {
    headers['Authorization'] = `Bearer ${ffaToken.trim()}`;
  } else if (ffaKey && ffaKey.trim()) {
    headers['X-API-Key'] = ffaKey.trim();
  }

  try {
    // Use axios with timeout and proper error handling
    const response = await axios.get(url, {
      timeout: 30000, // 30 second timeout
      headers,
      validateStatus: (status) => status < 500, // Don't throw for 4xx errors, we'll handle them
    });
    
    // Check if response is successful (2xx)
    if (response.status >= 400) {
      logger.error(`FFA API returned error status ${response.status}:`, response.data);
      throw new Error(`FFA API error (${response.status}): ${response.statusText || 'Unknown error'}`);
    }

    const data = response.data;
    
    if (!data || typeof data !== 'object') {
      throw new Error('FFA API returned invalid response format');
    }

    if (!data.success) {
      logger.error('FFA API returned success: false', data);
      throw new Error(data.message || 'FFA API returned an error response');
    }

    if (!data.data || !Array.isArray(data.data.activities)) {
      logger.error('FFA API response missing activities array', data);
      throw new Error('FFA API response does not contain activities array');
    }

    logger.info(`[FFA SYNC] Successfully fetched ${data.data.activities.length} activities from FFA API`);
    return data.data.activities;
  } catch (error) {
    let errorMessage = 'Unknown error';
    let errorDetails: any = {};
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      errorDetails = {
        code: axiosError.code,
        message: axiosError.message,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        responseData: axiosError.response?.data,
        config: {
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          timeout: axiosError.config?.timeout,
        },
      };
      
      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        errorMessage = `Cannot connect to FFA API at ${FFA_API_URL}. Please check if the FFA API is running and FFA_API_URL is configured correctly.`;
      } else if (axiosError.code === 'ETIMEDOUT' || axiosError.message.includes('timeout')) {
        errorMessage = 'FFA API request timed out after 30 seconds';
      } else if (axiosError.response) {
        errorMessage = `FFA API error (${axiosError.response.status}): ${axiosError.response.statusText || 'Unknown error'}`;
        if (axiosError.response.data) {
          errorMessage += ` - ${JSON.stringify(axiosError.response.data)}`;
        }
      } else {
        errorMessage = `Network error connecting to FFA API: ${axiosError.message}`;
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = {
        name: error.name,
        stack: error.stack,
      };
    } else {
      errorDetails = { rawError: error };
    }
    
    logger.error('[FFA SYNC] Error fetching activities from FFA API:', {
      error: errorMessage,
      url,
      ffaApiUrl: FFA_API_URL,
      envVarSet: !!process.env.FFA_API_URL,
      errorDetails,
    });
    
    throw new Error(errorMessage);
  }
};

const MISSING_ACTIVITY_LOCATION = 'Missing Location ';

/**
 * @param dataBatchId - Same id for all activities in one sync run (for per-batch delete before sampling)
 */
const syncActivity = async (ffaActivity: FFAActivity, dataBatchId: string): Promise<IActivity> => {
  try {
    // Determine state (prefer FFA `state`, fallback to territory parsing for backward compatibility)
    // NOTE: In steady state, Activity API v2 must always provide `state`.
    const resolvedState = (ffaActivity.state && ffaActivity.state.trim())
      ? ffaActivity.state.trim()
      : (ffaActivity.territory ? ffaActivity.territory.replace(/\s+Zone$/i, '').trim() : '');

    if (!resolvedState) {
      throw new Error(`Activity ${ffaActivity.activityId} is missing both state and territory (cannot resolve state)`);
    }

    if (!ffaActivity.state || !ffaActivity.state.trim()) {
      logger.warn(`[FFA SYNC] Activity ${ffaActivity.activityId} missing state in payload; derived state from territory as "${resolvedState}"`);
    }

    const resolvedLocation = (ffaActivity.location || '').trim() || MISSING_ACTIVITY_LOCATION;
    if (!((ffaActivity.location || '').trim())) {
      logger.warn(`[FFA SYNC] Activity ${ffaActivity.activityId} missing location; using "${MISSING_ACTIVITY_LOCATION}"`);
    }

    // Upsert activity
    const activity = await Activity.findOneAndUpdate(
      { activityId: ffaActivity.activityId },
      {
        $set: {
        activityId: ffaActivity.activityId,
        type: ffaActivity.type,
          date: parseEmsActivityDate(ffaActivity.date),
        officerId: ffaActivity.officerId,
        officerName: ffaActivity.officerName,
        location: resolvedLocation,
        territory: ffaActivity.territory,
          territoryName: (ffaActivity.territoryName || ffaActivity.territory || '').trim(),
          zoneName: (ffaActivity.zoneName || '').trim(),
          buName: (ffaActivity.buName || '').trim(),
          state: resolvedState, // Store resolved state
          tmEmpCode: (ffaActivity.tmEmpCode || '').trim(),
          tmName: (ffaActivity.tmName || '').trim(),
        crops: ffaActivity.crops || [],
        products: ffaActivity.products || [],
        syncedAt: new Date(),
        dataBatchId,
      },
        $setOnInsert: {
          lifecycleStatus: 'active',
          lifecycleUpdatedAt: new Date(),
          firstSampleRun: false, // New synced activities are eligible for first-sample run
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Sync farmers for this activity
    const farmerIds: mongoose.Types.ObjectId[] = [];
    
    // Get language for state (once per activity)
    const preferredLanguage = await getLanguageForState(resolvedState);
    logger.debug(`[FFA SYNC] Activity ${ffaActivity.activityId} in state "${resolvedState}" mapped to language "${preferredLanguage}"`);
    
    for (const ffaFarmer of ffaActivity.farmers) {
      // Farmer-level territory is not expected from FFA anymore. Always derive from Activity.
      const resolvedFarmerTerritory = ((ffaActivity.territoryName || ffaActivity.territory || '') as string).trim();
      // Upsert farmer - preferredLanguage now derived from state
      const farmer = await Farmer.findOneAndUpdate(
        { mobileNumber: ffaFarmer.mobileNumber },
        {
          name: ffaFarmer.name,
          mobileNumber: ffaFarmer.mobileNumber,
          location: ffaFarmer.location,
          preferredLanguage: preferredLanguage, // Derived from state, not from FFA API
          territory: resolvedFarmerTerritory || 'Unknown',
          photoUrl: ffaFarmer.photoUrl,
        },
        { upsert: true, new: true }
      );

      farmerIds.push(farmer._id);
    }

    // Update activity with farmer IDs
    activity.farmerIds = farmerIds;
    await activity.save();

    logger.info(`[FFA SYNC] Synced activity: ${ffaActivity.activityId} (${resolvedState}) with ${farmerIds.length} farmers (language: ${preferredLanguage})`);

    return activity;
  } catch (error) {
    logger.error(`[FFA SYNC] Error syncing activity ${ffaActivity.activityId}:`, error);
    throw error;
  }
};

/**
 * Sync all activities from FFA API
 * @param fullSync - If true, syncs all activities. If false, only syncs activities after the last sync date (incremental)
 */
// Sync lock to prevent concurrent syncs
let isSyncing = false;
let lastSyncTime: number | null = null;

// Progress for UI (activities synced so far / total)
export type SyncProgressState = {
  running: boolean;
  activitiesSynced: number;
  totalActivities: number;
  farmersSynced: number;
  errorCount: number;
  syncType: 'full' | 'incremental' | null;
  message: string;
  /** Current ingest batch id (sync-{timestamp}) while a run is active or just finished */
  dataBatchId?: string | null;
  lastResult?: {
    activitiesSynced: number;
    activitiesFetched?: number;
    emsPullLimit?: number;
    farmersSynced: number;
    errors: string[];
    syncType: 'full' | 'incremental';
    skipped?: boolean;
    skipReason?: string;
    infoMessage?: string;
  };
};

let syncProgress: SyncProgressState = {
  running: false,
  activitiesSynced: 0,
  totalActivities: 0,
  farmersSynced: 0,
  errorCount: 0,
  syncType: null,
  message: '',
  dataBatchId: null,
};

const snapshotSyncProgress = (): SyncProgressState => ({ ...syncProgress });

const persistSyncProgress = async (): Promise<void> => {
  try {
    await FfaSyncConfig.updateOne(
      { key: 'default' },
      {
        $set: {
          liveSyncProgress: {
            ...snapshotSyncProgress(),
            updatedAt: new Date().toISOString(),
          },
        },
      }
    );
  } catch (error) {
    logger.warn('[FFA SYNC] Failed to persist live sync progress', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const readStoredSyncProgress = (raw: Record<string, unknown> | null | undefined): SyncProgressState | null => {
  if (!raw || typeof raw !== 'object') return null;
  return {
    running: Boolean(raw.running),
    activitiesSynced: Number(raw.activitiesSynced) || 0,
    totalActivities: Number(raw.totalActivities) || 0,
    farmersSynced: Number(raw.farmersSynced) || 0,
    errorCount: Number(raw.errorCount) || 0,
    syncType:
      raw.syncType === 'full' || raw.syncType === 'incremental' ? raw.syncType : null,
    message: String(raw.message ?? ''),
    dataBatchId: typeof raw.dataBatchId === 'string' ? raw.dataBatchId : null,
    lastResult: raw.lastResult as SyncProgressState['lastResult'],
  };
};

export async function getSyncProgress(): Promise<SyncProgressState> {
  if (syncProgress.running) {
    return snapshotSyncProgress();
  }
  try {
    const config = await FfaSyncConfig.findOne({ key: 'default' }).select('liveSyncProgress').lean();
    const stored = readStoredSyncProgress(
      config?.liveSyncProgress as Record<string, unknown> | null | undefined
    );
    if (stored?.running) return stored;
    if (stored) return stored;
  } catch (error) {
    logger.warn('[FFA SYNC] Failed to read live sync progress', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return snapshotSyncProgress();
}

/** Reset progress when a new sync is queued (avoids stale lastResult on first poll). */
export const beginSyncProgress = (syncType: 'full' | 'incremental'): void => {
  syncProgress = {
    running: true,
    activitiesSynced: 0,
    totalActivities: 0,
    farmersSynced: 0,
    errorCount: 0,
    syncType,
    message: syncType === 'full' ? 'Full sync in progress…' : 'Incremental sync in progress…',
    dataBatchId: null,
    lastResult: undefined,
  };
  void persistSyncProgress();
};

let lastLiveProgressPersistAt = 0;
const persistLiveSyncProgress = (force = false): void => {
  const now = Date.now();
  if (!force && now - lastLiveProgressPersistAt < 2000) return;
  lastLiveProgressPersistAt = now;
  void persistSyncProgress();
};

// Minimum time between manual incremental syncs (ms) — default 3 minutes
const MIN_SYNC_INTERVAL = parseInt(process.env.MIN_SYNC_INTERVAL || '180000', 10);

export type FfaSyncOptions = {
  /** NACL EMS activities `limit` for this run only (0 = all eligible). */
  activitiesLimit?: number | null;
  /** When true, skip the manual debounce guard (used by scheduled/cron sync). */
  skipMinInterval?: boolean;
  /** When set, persist last-sync summary for admin UI (manual vs scheduled). */
  syncSource?: 'manual' | 'scheduled';
};

const maybeRecordLastSyncRun = async (
  result: {
    activitiesSynced: number;
    farmersSynced: number;
    skipped?: boolean;
    skipReason?: string;
    infoMessage?: string;
  },
  syncSource?: 'manual' | 'scheduled'
) => {
  if (!syncSource) return;
  await recordLastSyncRunResult(result, syncSource);
};

export const syncFFAData = async (
  fullSync: boolean = false,
  options?: FfaSyncOptions
): Promise<{
  activitiesSynced: number;
  farmersSynced: number;
  errors: string[];
  syncType: 'full' | 'incremental';
  lastSyncDate?: Date;
  skipped?: boolean;
  skipReason?: string;
  infoMessage?: string;
  activitiesFetched?: number;
  emsPullLimit?: number;
}> => {
  const startTime = Date.now();
  const errors: string[] = [];
  let activitiesSynced = 0;
  let farmersSynced = 0;
  let lastSyncDate: Date | undefined;

  try {
    // Check if sync is already in progress
    if (isSyncing) {
      const skipReason = 'Another sync is already in progress';
      logger.warn(`[FFA SYNC] ${skipReason}`);
      syncProgress.running = false;
      syncProgress.lastResult = { activitiesSynced: 0, farmersSynced: 0, errors: [skipReason], syncType: 'incremental', skipped: true, skipReason };
      persistLiveSyncProgress(true);
      return {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: [skipReason],
        syncType: 'incremental',
        skipped: true,
        skipReason,
      };
    }

    // Check if sync was run recently (manual incremental only — scheduled sync passes skipMinInterval)
    if (
      !fullSync &&
      !options?.skipMinInterval &&
      lastSyncTime &&
      Date.now() - lastSyncTime < MIN_SYNC_INTERVAL
    ) {
      const waitMinutes = Math.max(1, Math.round(MIN_SYNC_INTERVAL / 1000 / 60));
      const timeSinceLastSync = Math.round((Date.now() - lastSyncTime) / 1000 / 60);
      const skipReason = `Sync was completed ${timeSinceLastSync} minute(s) ago. Please wait at least ${waitMinutes} minute(s) between syncs.`;
      logger.info(`[FFA SYNC] ${skipReason}`);
      syncProgress.running = false;
      syncProgress.lastResult = { activitiesSynced: 0, farmersSynced: 0, errors: [], syncType: 'incremental', skipped: true, skipReason };
      persistLiveSyncProgress(true);
      return {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: [],
        syncType: 'incremental',
        skipped: true,
        skipReason,
      };
    }

    // Set sync lock and mark progress running (may already be set by POST /sync handler)
    isSyncing = true;
    beginSyncProgress(fullSync ? 'full' : 'incremental');

    const activityDateFrom = await resolveEmsActivitiesDateFrom();
    lastSyncDate = activityDateFrom;
    logger.info(
      `[FFA SYNC] EMS activity dateFrom=${formatEmsActivitiesQueryDateFrom(activityDateFrom)} (DD/MM/YYYY query param; cutoff from admin config or FFA_EMS_DEFAULT_DATE_FROM)`
    );

    logger.info(`[FFA SYNC] Starting FFA data sync (${fullSync ? 'full' : 'incremental'})...`, {
      ffaApiUrl: FFA_API_URL,
      hasEnvVar: !!process.env.FFA_API_URL,
      fullSync,
      activityDateFrom: activityDateFrom.toISOString(),
      emsDateFromParam: formatDateFromParam(activityDateFrom),
    });

    const emsMode = fullSync ? 'full' : 'incremental';
    const emsPullLimitResolved = isEmsFfaApiEnabled()
      ? coerceEmsActivitiesRequestLimit(
          resolveEmsActivitiesLimit(emsMode, options?.activitiesLimit),
          emsMode
        )
      : undefined;

    let ffaActivities: FFAActivity[];
    try {
      ffaActivities = await fetchFFAActivities(
        activityDateFrom,
        fullSync,
        options?.activitiesLimit
      );
      logger.info(
        `[FFA SYNC] Fetched ${ffaActivities.length} activities from FFA API` +
          (emsPullLimitResolved != null ? ` (EMS request limit=${emsPullLimitResolved})` : '')
      );
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : 'Failed to fetch activities from FFA API';
      logger.error('[FFA SYNC] Failed to fetch activities from FFA API:', errorMsg);
      throw new Error(`Failed to fetch activities from FFA API: ${errorMsg}`);
    }

    if (!ffaActivities || ffaActivities.length === 0) {
      logger.info(`[FFA SYNC] ${FFA_SYNC_NO_ACTIVITIES_MESSAGE}`);
      isSyncing = false;
      syncProgress.running = false;
      syncProgress.lastResult = {
        activitiesSynced: 0,
        activitiesFetched: 0,
        emsPullLimit: emsPullLimitResolved,
        farmersSynced: 0,
        errors: [],
        syncType: fullSync ? 'full' : 'incremental',
        infoMessage: FFA_SYNC_NO_ACTIVITIES_MESSAGE,
      };
      persistLiveSyncProgress(true);
      lastSyncTime = Date.now();
      await maybeRecordLastSyncRun(
        {
          activitiesSynced: 0,
          farmersSynced: 0,
          infoMessage: FFA_SYNC_NO_ACTIVITIES_MESSAGE,
        },
        options?.syncSource
      );
      return {
        activitiesSynced: 0,
        activitiesFetched: 0,
        emsPullLimit: emsPullLimitResolved,
        farmersSynced: 0,
        errors: [],
        syncType: fullSync ? 'full' : 'incremental',
        lastSyncDate,
        infoMessage: FFA_SYNC_NO_ACTIVITIES_MESSAGE,
      };
    }

    // Check which activities are actually new (not already synced recently)
    // This prevents redundant processing when sync is run consecutively
    let newActivities: FFAActivity[] = [];
    if (!fullSync && ffaActivities.length > 0) {
      const existingActivityIds = await Activity.find({
        activityId: { $in: ffaActivities.map((a) => a.activityId).filter(Boolean) },
      })
        .select('activityId')
        .lean();

      const existingIds = new Set(existingActivityIds.map((a) => a.activityId));
      newActivities = ffaActivities.filter((a) => !existingIds.has(a.activityId));

      const skippedCount = ffaActivities.length - newActivities.length;
      if (skippedCount > 0) {
        logger.info(`[FFA SYNC] Skipping ${skippedCount} activities already in database`);
      }

      if (newActivities.length === 0) {
        const skipReason =
          `EMS returned ${ffaActivities.length} activities but all are already in the database` +
          (emsPullLimitResolved != null
            ? ` (pull limit ${emsPullLimitResolved} — increase in Data Management if more are expected)`
            : '');
        logger.info(`[FFA SYNC] ${skipReason}`);
        isSyncing = false;
        syncProgress.running = false;
        syncProgress.lastResult = {
          activitiesSynced: 0,
          activitiesFetched: ffaActivities.length,
          emsPullLimit: emsPullLimitResolved,
          farmersSynced: 0,
          errors: [],
          syncType: 'incremental',
          skipped: true,
          skipReason,
        };
        persistLiveSyncProgress(true);
        lastSyncTime = Date.now();
        await maybeRecordLastSyncRun(
          {
            activitiesSynced: 0,
            farmersSynced: 0,
            skipped: true,
            skipReason,
          },
          options?.syncSource
        );
        return {
          activitiesSynced: 0,
          activitiesFetched: ffaActivities.length,
          emsPullLimit: emsPullLimitResolved,
          farmersSynced: 0,
          errors: [],
          syncType: 'incremental',
          lastSyncDate,
          skipped: true,
          skipReason,
        };
      }
      
      logger.info(`[FFA SYNC] Processing ${newActivities.length} new activities (${skippedCount} already synced)`);
    } else {
      newActivities = ffaActivities;
    }

    const dataBatchId = `sync-${Date.now()}`;

    // Set progress for UI
    syncProgress = {
      running: true,
      activitiesSynced: 0,
      totalActivities: newActivities.length,
      farmersSynced: 0,
      errorCount: 0,
      syncType: fullSync ? 'full' : 'incremental',
      message: `Syncing activities (${fullSync ? 'full' : 'incremental'})...`,
      dataBatchId,
    };
    persistLiveSyncProgress(true);

    for (const ffaActivity of newActivities) {
      try {
        if (!ffaActivity.activityId) {
          errors.push('Skipped activity: missing activityId');
          syncProgress.errorCount++;
          logger.warn('[FFA SYNC] Skipped activity with missing activityId');
          continue;
        }

        const activity = await syncActivity(ffaActivity, dataBatchId);
        activitiesSynced++;
        farmersSynced += activity.farmerIds.length;
        syncProgress.activitiesSynced = activitiesSynced;
        syncProgress.farmersSynced = farmersSynced;
        syncProgress.errorCount = errors.length;
        persistLiveSyncProgress();
      } catch (error) {
        const errorMsg = `Failed to sync activity ${ffaActivity.activityId || 'unknown'}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        syncProgress.errorCount = errors.length;
        persistLiveSyncProgress();
        logger.error(`[FFA SYNC] ${errorMsg}`, error);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`[FFA SYNC] FFA sync completed in ${duration}s (${fullSync ? 'full' : 'incremental'}): ${activitiesSynced} activities, ${farmersSynced} farmers, ${errors.length} errors`);

    const result = {
      activitiesSynced,
      activitiesFetched: ffaActivities.length,
      emsPullLimit: emsPullLimitResolved,
      farmersSynced,
      errors,
      syncType: (fullSync ? 'full' : 'incremental') as 'full' | 'incremental',
      lastSyncDate,
    };
    syncProgress.running = false;
    syncProgress.lastResult = result;
    persistLiveSyncProgress(true);
    isSyncing = false;
    lastSyncTime = Date.now();
    await maybeRecordLastSyncRun(result, options?.syncSource);

    return result;
  } catch (error) {
    syncProgress.running = false;
    syncProgress.lastResult = {
      activitiesSynced: syncProgress.activitiesSynced,
      farmersSynced: syncProgress.farmersSynced,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncType: (syncProgress.syncType || 'incremental') as 'full' | 'incremental',
    };
    persistLiveSyncProgress(true);
    isSyncing = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[FFA SYNC] FFA sync failed:', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

/**
 * Get sync status
 */
export const getSyncStatus = async (existingConfig?: Awaited<
  ReturnType<typeof import('./ffaSyncConfigService.js').getOrCreateFfaSyncConfig>
>) => {
  try {
    const { getOrCreateFfaSyncConfig, resolveUnifiedLastSyncRun } = await import(
      './ffaSyncConfigService.js'
    );
    const config = existingConfig ?? (await getOrCreateFfaSyncConfig());
    const [lastSyncRun, totalActivities, totalFarmers] = await Promise.all([
      resolveUnifiedLastSyncRun(config),
      Activity.countDocuments(),
      Farmer.countDocuments(),
    ]);

    return {
      lastSyncAt: lastSyncRun.lastSyncRunAt,
      lastSyncRun,
      totalActivities,
      totalFarmers,
      emsPullLimit: getEmsPullLimitConfig(),
    };
  } catch (error) {
    logger.error('Error getting sync status:', error);
    throw error;
  }
};

