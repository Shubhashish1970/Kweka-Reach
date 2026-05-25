import { Activity, IActivity } from '../models/Activity.js';
import { Farmer, IFarmer } from '../models/Farmer.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import axios, { AxiosError } from 'axios';
import { getLanguageForState } from '../utils/stateLanguageMapper.js';
import {
  fetchEmsActivities,
  isEmsFfaApiEnabled,
  resolveActivitiesDateFrom,
} from './emsFfaClient.js';

interface FFAActivity {
  activityId: string;
  type: string;
  date: string;
  officerId: string; // FDA empCode
  officerName: string; // FDA name
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

/**
 * Parse FFA activity date string into a Date.
 * Supports:
 * - DD/MM/YYYY (new contract)
 * - YYYY-MM-DD (legacy contract)
 * - ISO strings (fallback)
 */
const parseFFADate = (value: string): Date => {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid activity date (missing)');
  }

  const raw = value.trim();

  // DD/MM/YYYY or D/M/YYYY (EMS may return single-digit day/month)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [ddStr, mmStr, yyyyStr] = raw.split('/');
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    const yyyy = Number(yyyyStr);

    const d = new Date(yyyy, mm - 1, dd);
    // Validate round-trip (catches invalid dates like 32/13/2026)
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
      throw new Error(`Invalid activity date (DD/MM/YYYY): ${raw}`);
    }
    return d;
  }

  // Legacy: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid activity date (YYYY-MM-DD): ${raw}`);
    }
    return d;
  }

  // Fallback: ISO or other parseable formats
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid activity date: ${raw}`);
  }
  return d;
};

/**
 * Fetch activities from FFA API with timeout and better error handling
 * @param dateFrom - Optional date to fetch activities after (for incremental sync)
 */
const fetchFFAActivities = async (dateFrom?: Date): Promise<FFAActivity[]> => {
  // Validate FFA_API_URL is set
  if (!process.env.FFA_API_URL) {
    logger.warn('FFA_API_URL environment variable is not set, using default: http://localhost:4000/api');
  }

  if (isEmsFfaApiEnabled()) {
    const emsDateFrom = resolveActivitiesDateFrom(dateFrom);
    logger.info('[FFA SYNC] Using NACL EMS API (authenticate + /EMS/activities)', {
      incremental: !!dateFrom,
      dateFrom: emsDateFrom.toISOString(),
    });
    return fetchEmsActivities(FFA_API_URL, emsDateFrom);
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

/**
 * Sync a single activity from FFA
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

    // Upsert activity
    const activity = await Activity.findOneAndUpdate(
      { activityId: ffaActivity.activityId },
      {
        $set: {
        activityId: ffaActivity.activityId,
        type: ffaActivity.type,
          date: parseFFADate(ffaActivity.date),
        officerId: ffaActivity.officerId,
        officerName: ffaActivity.officerName,
        location: ffaActivity.location,
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
  lastResult?: {
    activitiesSynced: number;
    farmersSynced: number;
    errors: string[];
    syncType: 'full' | 'incremental';
    skipped?: boolean;
    skipReason?: string;
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
};

export function getSyncProgress(): SyncProgressState {
  return { ...syncProgress };
}

// Minimum time between syncs (in milliseconds) - default 10 minutes
const MIN_SYNC_INTERVAL = parseInt(process.env.MIN_SYNC_INTERVAL || '600000', 10); // 10 minutes default

export const syncFFAData = async (fullSync: boolean = false): Promise<{
  activitiesSynced: number;
  farmersSynced: number;
  errors: string[];
  syncType: 'full' | 'incremental';
  lastSyncDate?: Date;
  skipped?: boolean;
  skipReason?: string;
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
      return {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: [skipReason],
        syncType: 'incremental',
        skipped: true,
        skipReason,
      };
    }

    // Check if sync was run recently (for incremental sync only)
    if (!fullSync && lastSyncTime && (Date.now() - lastSyncTime) < MIN_SYNC_INTERVAL) {
      const timeSinceLastSync = Math.round((Date.now() - lastSyncTime) / 1000 / 60); // minutes
      const skipReason = `Sync was completed ${timeSinceLastSync} minute(s) ago. Please wait at least ${Math.round(MIN_SYNC_INTERVAL / 1000 / 60)} minutes between syncs.`;
      logger.info(`[FFA SYNC] ${skipReason}`);
      syncProgress.running = false;
      syncProgress.lastResult = { activitiesSynced: 0, farmersSynced: 0, errors: [], syncType: 'incremental', skipped: true, skipReason };
      return {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: [],
        syncType: 'incremental',
        skipped: true,
        skipReason,
      };
    }

    // Set sync lock
    isSyncing = true;

    // Determine sync type and get last sync date for incremental sync
    if (!fullSync) {
      try {
        // Get the most recently synced activity to determine the cutoff date
        const lastActivity = await Activity.findOne().sort({ syncedAt: -1 });
        if (lastActivity && lastActivity.syncedAt) {
          // Use syncedAt timestamp (when activity was last synced) instead of date
          // This is more accurate for incremental sync as it reflects actual sync time
          // Subtract 1 hour as a buffer to account for API delays and timezone differences
          lastSyncDate = new Date(lastActivity.syncedAt);
          lastSyncDate.setHours(lastSyncDate.getHours() - 1);
          logger.info(`[FFA SYNC] Incremental sync: last activity synced at ${lastActivity.syncedAt.toISOString()}, fetching activities after ${lastSyncDate.toISOString()}`);
          
          // Additional check: if last sync was very recent (within last 5 minutes), skip
          const timeSinceLastSync = Date.now() - lastActivity.syncedAt.getTime();
          if (timeSinceLastSync < 5 * 60 * 1000) { // 5 minutes
            const skipReason = `Last sync completed ${Math.round(timeSinceLastSync / 1000)} seconds ago. No new data expected.`;
            logger.info(`[FFA SYNC] ${skipReason}`);
            isSyncing = false;
            syncProgress.running = false;
            syncProgress.lastResult = { activitiesSynced: 0, farmersSynced: 0, errors: [], syncType: 'incremental', skipped: true, skipReason };
            return {
              activitiesSynced: 0,
              farmersSynced: 0,
              errors: [],
              syncType: 'incremental',
              skipped: true,
              skipReason,
            };
          }
        } else {
          logger.info(`[FFA SYNC] No previous sync found, performing full sync`);
          fullSync = true; // Fall back to full sync if no previous sync exists
        }
      } catch (error) {
        logger.error('[FFA SYNC] Error determining last sync date, falling back to full sync:', error);
        fullSync = true; // Fall back to full sync on error
      }
    }

    logger.info(`[FFA SYNC] Starting FFA data sync (${fullSync ? 'full' : 'incremental'})...`, {
      ffaApiUrl: FFA_API_URL,
      hasEnvVar: !!process.env.FFA_API_URL,
      fullSync,
      lastSyncDate: lastSyncDate?.toISOString(),
    });

    let ffaActivities: FFAActivity[];
    try {
      ffaActivities = await fetchFFAActivities(fullSync ? undefined : lastSyncDate);
      logger.info(`[FFA SYNC] Fetched ${ffaActivities.length} activities from FFA API`);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : 'Failed to fetch activities from FFA API';
      logger.error('[FFA SYNC] Failed to fetch activities from FFA API:', errorMsg);
      throw new Error(`Failed to fetch activities from FFA API: ${errorMsg}`);
    }

    if (!ffaActivities || ffaActivities.length === 0) {
      logger.warn('[FFA SYNC] No activities returned from FFA API');
      isSyncing = false;
      syncProgress.running = false;
      syncProgress.lastResult = {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: ['No activities found in FFA API response'],
        syncType: fullSync ? 'full' : 'incremental',
      };
      lastSyncTime = Date.now();
      return {
        activitiesSynced: 0,
        farmersSynced: 0,
        errors: ['No activities found in FFA API response'],
        syncType: fullSync ? 'full' : 'incremental',
        lastSyncDate,
      };
    }

    // Check which activities are actually new (not already synced recently)
    // This prevents redundant processing when sync is run consecutively
    let newActivities: FFAActivity[] = [];
    if (!fullSync && ffaActivities.length > 0) {
      const existingActivityIds = await Activity.find({
        activityId: { $in: ffaActivities.map(a => a.activityId).filter(Boolean) },
        syncedAt: { $gte: lastSyncDate || new Date(0) }, // Only check activities synced after cutoff
      }).select('activityId').lean();

      const existingIds = new Set(existingActivityIds.map(a => a.activityId));
      newActivities = ffaActivities.filter(a => !existingIds.has(a.activityId));
      
      const skippedCount = ffaActivities.length - newActivities.length;
      if (skippedCount > 0) {
        logger.info(`[FFA SYNC] Skipping ${skippedCount} activities that were already synced recently`);
      }
      
      if (newActivities.length === 0) {
        logger.info(`[FFA SYNC] All ${ffaActivities.length} fetched activities were already synced. No new data to process.`);
        isSyncing = false;
        syncProgress.running = false;
        syncProgress.lastResult = {
          activitiesSynced: 0,
          farmersSynced: 0,
          errors: [],
          syncType: 'incremental',
          skipped: true,
          skipReason: `All ${ffaActivities.length} activities were already synced. No new data to process.`,
        };
        lastSyncTime = Date.now();
        return {
          activitiesSynced: 0,
          farmersSynced: 0,
          errors: [],
          syncType: 'incremental',
          lastSyncDate,
          skipped: true,
          skipReason: `All ${ffaActivities.length} activities were already synced. No new data to process.`,
        };
      }
      
      logger.info(`[FFA SYNC] Processing ${newActivities.length} new activities (${skippedCount} already synced)`);
    } else {
      newActivities = ffaActivities;
    }

    // Set progress for UI
    syncProgress = {
      running: true,
      activitiesSynced: 0,
      totalActivities: newActivities.length,
      farmersSynced: 0,
      errorCount: 0,
      syncType: fullSync ? 'full' : 'incremental',
      message: `Syncing activities (${fullSync ? 'full' : 'incremental'})...`,
    };

    const dataBatchId = `sync-${Date.now()}`;

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
      } catch (error) {
        const errorMsg = `Failed to sync activity ${ffaActivity.activityId || 'unknown'}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        syncProgress.errorCount = errors.length;
        logger.error(`[FFA SYNC] ${errorMsg}`, error);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`[FFA SYNC] FFA sync completed in ${duration}s (${fullSync ? 'full' : 'incremental'}): ${activitiesSynced} activities, ${farmersSynced} farmers, ${errors.length} errors`);

    const result = {
      activitiesSynced,
      farmersSynced,
      errors,
      syncType: (fullSync ? 'full' : 'incremental') as 'full' | 'incremental',
      lastSyncDate,
    };
    syncProgress.running = false;
    syncProgress.lastResult = result;
    isSyncing = false;
    lastSyncTime = Date.now();

    return result;
  } catch (error) {
    syncProgress.running = false;
    syncProgress.lastResult = {
      activitiesSynced: syncProgress.activitiesSynced,
      farmersSynced: syncProgress.farmersSynced,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncType: (syncProgress.syncType || 'incremental') as 'full' | 'incremental',
    };
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
export const getSyncStatus = async () => {
  try {
    const lastActivity = await Activity.findOne().sort({ syncedAt: -1 });
    const totalActivities = await Activity.countDocuments();
    const totalFarmers = await Farmer.countDocuments();

    return {
      lastSyncAt: lastActivity?.syncedAt || null,
      totalActivities,
      totalFarmers,
    };
  } catch (error) {
    logger.error('Error getting sync status:', error);
    throw error;
  }
};

