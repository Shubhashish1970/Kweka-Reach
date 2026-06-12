import { FfaSyncConfig, IFfaSyncConfig, FfaDataSource, FfaScheduleMode } from '../models/FfaSyncConfig.js';
import { syncFFAData } from './ffaSync.js';
import {
  getEmsPullLimitConfig,
  parseFfaEmsDefaultDateFrom,
  getFfaEmsDefaultDateFromDisplay,
  getFfaEmsDefaultDateFromIso,
  formatDateFromParam,
  formatEmsActivitiesDateFromParam,
} from './emsFfaClient.js';
import logger from '../config/logger.js';

const DEFAULT_SEED = {
  key: 'default' as const,
  dataSource: 'api' as FfaDataSource,
  activitiesPullLimit: null as number | null,
  scheduleEnabled: false,
  scheduleMode: 'daily' as FfaScheduleMode,
  scheduleIntervalMinutes: 60,
  scheduleDailyHour: 6,
  scheduleDailyMinute: 0,
  scheduleTimezone: 'Asia/Kolkata',
};

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
};

const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
};

const zonedDayKey = (date: Date, timeZone: string) => {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
};

const zonedHourKey = (date: Date, timeZone: string) => {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}-${String(p.hour).padStart(2, '0')}`;
};

export const getOrCreateFfaSyncConfig = async (): Promise<IFfaSyncConfig> => {
  const existing = await FfaSyncConfig.findOne({ key: 'default' });
  if (existing) return existing;
  const seedDate = parseFfaEmsDefaultDateFrom();
  return FfaSyncConfig.create({
    ...DEFAULT_SEED,
    emsActivitiesDateFrom: seedDate,
  });
};

/** Activity date sent to EMS as dateFrom (admin config → env FFA_EMS_DEFAULT_DATE_FROM → 01/01/2020). */
export const resolveEmsActivitiesDateFrom = async (): Promise<Date> => {
  const config = await getOrCreateFfaSyncConfig();
  if (config.emsActivitiesDateFrom) {
    return new Date(config.emsActivitiesDateFrom);
  }
  return parseFfaEmsDefaultDateFrom();
};

const toIsoDateOnly = (d: Date | null | undefined): string | null => {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
};

export const formatFfaSyncConfigResponse = (config: IFfaSyncConfig | Record<string, unknown> | null) => {
  const c = config as IFfaSyncConfig | null;
  const emsPullLimit = getEmsPullLimitConfig();
  const serverDefaultPullLimit = emsPullLimit.globalLimit ?? emsPullLimit.fullLimit ?? 0;
  const serverDefaultActivitiesDateFrom = getFfaEmsDefaultDateFromDisplay() ?? '01/01/2020';
  const serverDefaultActivitiesDateFromIso = getFfaEmsDefaultDateFromIso() ?? '2020-01-01';
  const effectiveActivityDate = c?.emsActivitiesDateFrom
    ? new Date(c.emsActivitiesDateFrom)
    : parseFfaEmsDefaultDateFrom();
  const scheduledSyncActive =
    c?.scheduleEnabled === true && c?.dataSource === 'api' && c?.scheduleMode !== 'off';

  return {
    dataSource: c?.dataSource ?? 'api',
    activitiesPullLimit: c?.activitiesPullLimit ?? null,
    emsActivitiesDateFrom: toIsoDateOnly(c?.emsActivitiesDateFrom ?? null),
    emsActivitiesDateFromDisplay: formatEmsActivitiesDateFromParam(effectiveActivityDate),
    emsActivitiesDateFromDisplayShort: formatDateFromParam(effectiveActivityDate),
    serverDefaultActivitiesDateFrom,
    serverDefaultActivitiesDateFromIso,
    scheduleEnabled: c?.scheduleEnabled === true,
    scheduleMode: c?.scheduleMode ?? 'daily',
    scheduleIntervalMinutes: c?.scheduleIntervalMinutes ?? 60,
    scheduleDailyHour: c?.scheduleDailyHour ?? 6,
    scheduleDailyMinute: c?.scheduleDailyMinute ?? 0,
    scheduleTimezone: c?.scheduleTimezone ?? 'Asia/Kolkata',
    lastScheduledRunAt: c?.lastScheduledRunAt ?? null,
    lastScheduledRunActivitiesSynced: c?.lastScheduledRunActivitiesSynced ?? null,
    lastScheduledRunFarmersSynced: c?.lastScheduledRunFarmersSynced ?? null,
    lastScheduledRunSkipped: c?.lastScheduledRunSkipped ?? false,
    lastScheduledRunMessage: c?.lastScheduledRunMessage ?? null,
    scheduledSyncActive,
    serverDefaultPullLimit,
    nextScheduledRunAt: c && scheduledSyncActive ? computeNextScheduledRunAt(c) : null,
    updatedAt: c?.updatedAt ?? null,
  };
};

export const computeNextScheduledRunAt = (config: Pick<
  IFfaSyncConfig,
  | 'scheduleEnabled'
  | 'scheduleMode'
  | 'scheduleIntervalMinutes'
  | 'scheduleDailyHour'
  | 'scheduleDailyMinute'
  | 'scheduleTimezone'
  | 'lastScheduledRunAt'
>): Date | null => {
  if (!config.scheduleEnabled || config.scheduleMode === 'off') return null;

  const tz = config.scheduleTimezone || 'Asia/Kolkata';
  const now = new Date();

  if (config.scheduleMode === 'interval') {
    const base = config.lastScheduledRunAt ? new Date(config.lastScheduledRunAt) : now;
    return new Date(base.getTime() + config.scheduleIntervalMinutes * 60 * 1000);
  }

  if (config.scheduleMode === 'hourly') {
    const p = getZonedParts(now, tz);
    const next = new Date(now);
    if (p.minute === 0) {
      next.setMinutes(0, 0, 0);
      next.setTime(next.getTime() + 60 * 60 * 1000);
    } else {
      next.setMinutes(0, 0, 0);
      next.setTime(next.getTime() + 60 * 60 * 1000);
    }
    return next;
  }

  if (config.scheduleMode === 'daily') {
    // Scan forward up to 48h in 1-minute steps (cheap for display only)
    for (let i = 0; i <= 48 * 60; i++) {
      const candidate = new Date(now.getTime() + i * 60 * 1000);
      const p = getZonedParts(candidate, tz);
      if (p.hour === config.scheduleDailyHour && p.minute === config.scheduleDailyMinute) {
        if (i === 0 && config.lastScheduledRunAt && zonedDayKey(config.lastScheduledRunAt, tz) === zonedDayKey(candidate, tz)) {
          continue;
        }
        return candidate;
      }
    }
  }

  return null;
};

export const isScheduledFfaSyncDue = (config: IFfaSyncConfig, now = new Date()): boolean => {
  if (!config.scheduleEnabled || config.scheduleMode === 'off') return false;
  if (config.dataSource !== 'api') return false;

  const tz = config.scheduleTimezone || 'Asia/Kolkata';
  const lastRun = config.lastScheduledRunAt ? new Date(config.lastScheduledRunAt) : null;

  if (config.scheduleMode === 'interval') {
    if (!lastRun) return true;
    const elapsed = now.getTime() - lastRun.getTime();
    return elapsed >= config.scheduleIntervalMinutes * 60 * 1000;
  }

  const parts = getZonedParts(now, tz);

  if (config.scheduleMode === 'hourly') {
    if (parts.minute !== 0) return false;
    if (!lastRun) return true;
    return zonedHourKey(lastRun, tz) !== zonedHourKey(now, tz);
  }

  if (config.scheduleMode === 'daily') {
    if (parts.hour !== config.scheduleDailyHour || parts.minute !== config.scheduleDailyMinute) return false;
    if (!lastRun) return true;
    return zonedDayKey(lastRun, tz) !== zonedDayKey(now, tz);
  }

  return false;
};

export const updateFfaSyncConfig = async (
  body: Partial<{
    dataSource: FfaDataSource;
    activitiesPullLimit: number | null;
    emsActivitiesDateFrom: string | Date | null;
    scheduleEnabled: boolean;
    scheduleMode: FfaScheduleMode;
    scheduleIntervalMinutes: number;
    scheduleDailyHour: number;
    scheduleDailyMinute: number;
    scheduleTimezone: string;
  }>,
  userId?: string
) => {
  const update: Record<string, unknown> = { ...body, updatedByUserId: userId || null };

  if ('emsActivitiesDateFrom' in body) {
    const raw = body.emsActivitiesDateFrom;
    if (raw === null || raw === undefined || raw === '') {
      update.emsActivitiesDateFrom = null;
    } else if (typeof raw === 'string') {
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        update.emsActivitiesDateFrom = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      } else {
        update.emsActivitiesDateFrom = parseFfaEmsDefaultDateFrom(raw);
      }
    } else {
      update.emsActivitiesDateFrom = raw;
    }
  }

  if (body.activitiesPullLimit === undefined) {
    // keep existing
  } else if (body.activitiesPullLimit === null || body.activitiesPullLimit === ('' as unknown)) {
    update.activitiesPullLimit = null;
  }

  if (body.scheduleEnabled === false) {
    update.scheduleMode = 'off';
  } else if (body.scheduleEnabled === true && body.scheduleMode === undefined) {
    // leave mode as-is or default daily when turning on
  }

  const config = await FfaSyncConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: update, $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return config;
};

export const recordScheduledRunResult = async (
  result: {
    activitiesSynced: number;
    farmersSynced: number;
    skipped?: boolean;
    skipReason?: string;
    infoMessage?: string;
  }
) => {
  const message =
    result.skipReason ||
    result.infoMessage ||
    `${result.activitiesSynced} activities, ${result.farmersSynced} farmers`;

  await FfaSyncConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        lastScheduledRunAt: new Date(),
        lastScheduledRunActivitiesSynced: result.activitiesSynced,
        lastScheduledRunFarmersSynced: result.farmersSynced,
        lastScheduledRunSkipped: result.skipped === true,
        lastScheduledRunMessage: message,
      },
    },
    { upsert: true }
  );
};

export const runScheduledFfaSyncIfDue = async (): Promise<void> => {
  const config = await getOrCreateFfaSyncConfig();
  if (!isScheduledFfaSyncDue(config)) return;

  try {
    logger.info('[FFA CRON] Starting scheduled incremental FFA sync...');
    const activitiesLimit =
      config.activitiesPullLimit !== null && config.activitiesPullLimit !== undefined
        ? config.activitiesPullLimit
        : undefined;

    const result = await syncFFAData(false, { activitiesLimit });
    await recordScheduledRunResult(result);

    logger.info(
      `[FFA CRON] Scheduled sync finished: ${result.activitiesSynced} activities, ${result.farmersSynced} farmers` +
        (result.skipped ? ` (skipped: ${result.skipReason})` : '')
    );
  } catch (error) {
    logger.error('[FFA CRON] Scheduled FFA sync failed:', error);
    await recordScheduledRunResult({
      activitiesSynced: 0,
      farmersSynced: 0,
      skipped: true,
      skipReason: error instanceof Error ? error.message : String(error),
    });
  }
};
