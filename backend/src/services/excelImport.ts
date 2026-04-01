import * as XLSX from 'xlsx';
import logger from '../config/logger.js';
import { Activity } from '../models/Activity.js';
import { Farmer } from '../models/Farmer.js';
import { getLanguageForState } from '../utils/stateLanguageMapper.js';

export type ImportExcelError = { sheet: 'Activities' | 'Farmers'; row: number; message: string };

export type ImportExcelProgressState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  activitiesProcessed: number;
  totalActivities: number;
  farmersProcessed: number;
  totalFarmers: number;
  /** Qualified totals/loaded counts for unified progress UI */
  totalQualifiedActivities?: number;
  totalQualifiedFarmers?: number;
  loadedQualifiedActivities?: number;
  loadedQualifiedFarmers?: number;
  errorCount: number;
  message: string;
  jobId: string | null;
  lastResult?: {
    activitiesRows: number;
    farmersRows: number;
    activitiesUpserted: number;
    farmersUpserted: number;
    linksUpdated: number;
    errorsCount: number;
    errors: ImportExcelError[];
    durationMs: number;
    skipped?: boolean;
    skipReason?: string;
  };
};

let importProgress: ImportExcelProgressState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  activitiesProcessed: 0,
  totalActivities: 0,
  farmersProcessed: 0,
  totalFarmers: 0,
  totalQualifiedActivities: 0,
  totalQualifiedFarmers: 0,
  loadedQualifiedActivities: 0,
  loadedQualifiedFarmers: 0,
  errorCount: 0,
  message: '',
  jobId: null,
};

export function getImportExcelProgress(): ImportExcelProgressState {
  return { ...importProgress };
}

type ExcelActivityRow = {
  activityId: string;
  type: string;
  date: string | number | Date;
  officerId: string;
  officerName: string;
  location: string;
  territory: string;
  state: string;
  territoryName?: string;
  zoneName?: string;
  buName?: string;
  tmEmpCode?: string;
  tmName?: string;
  crops?: string;
  products?: string;
};

type ExcelFarmerRow = {
  activityId: string;
  farmerId?: string;
  name: string;
  mobileNumber: string;
  location: string;
  photoUrl?: string;
  crops?: string;
};

const normalizeStr = (v: any) => String(v ?? '').trim();

const splitCSVCell = (value: any): string[] => {
  const raw = normalizeStr(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Excel serial conversion (no SSF dependency).
 * Excel day 1 = 1900-01-01; JS epoch uses ms.
 * Using 1899-12-30 base matches common XLSX behavior.
 */
const excelSerialToDate = (serial: number): Date => {
  const baseUtc = Date.UTC(1899, 11, 30);
  const ms = baseUtc + serial * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid excel date');
  return d;
};

const parseExcelDate = (value: any): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date');
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToDate(value);
  }

  const raw = normalizeStr(value);
  if (!raw) throw new Error('Invalid date (missing)');

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [ddStr, mmStr, yyyyStr] = raw.split('/');
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    const yyyy = Number(yyyyStr);
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
      throw new Error(`Invalid date (DD/MM/YYYY): ${raw}`);
    }
    return d;
  }

  // YYYY-MM-DD or ISO
  const d = new Date(raw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${raw}`);
  return d;
};

async function bulkWriteInChunks<T>(
  ops: any[],
  chunkSize: number,
  write: (chunk: any[]) => Promise<T>,
  onChunkDone?: (doneOps: number) => void
) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    // eslint-disable-next-line no-await-in-loop
    await write(chunk);
    onChunkDone?.(Math.min(i + chunkSize, ops.length));
  }
}

export async function startImportExcelJob(fileBuffer: Buffer): Promise<{ started: boolean; jobId: string; message: string }> {
  if (importProgress.running) {
    const reason = 'Another Excel import is already running';
    return { started: false, jobId: importProgress.jobId || 'running', message: reason };
  }

  const jobId = `excel-import-${Date.now()}`;
  importProgress = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    activitiesProcessed: 0,
    totalActivities: 0,
    farmersProcessed: 0,
    totalFarmers: 0,
    totalQualifiedActivities: 0,
    totalQualifiedFarmers: 0,
    loadedQualifiedActivities: 0,
    loadedQualifiedFarmers: 0,
    errorCount: 0,
    message: 'Excel import started',
    jobId,
  };

  // Kick off background work (don’t block HTTP request)
  (async () => {
    const t0 = Date.now();
    const errors: ImportExcelError[] = [];
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const activitiesSheetName = workbook.SheetNames.find((n) => n.toLowerCase() === 'activities');
      const farmersSheetName = workbook.SheetNames.find((n) => n.toLowerCase() === 'farmers');

      if (!activitiesSheetName || !farmersSheetName) {
        throw new Error('Workbook must include 2 sheets named exactly: Activities, Farmers');
      }

      const activitiesSheet = workbook.Sheets[activitiesSheetName];
      const farmersSheet = workbook.Sheets[farmersSheetName];

      const activitiesRows = XLSX.utils.sheet_to_json<ExcelActivityRow>(activitiesSheet, { defval: '', raw: true });
      const farmersRows = XLSX.utils.sheet_to_json<ExcelFarmerRow>(farmersSheet, { defval: '', raw: true });

      importProgress.totalActivities = activitiesRows.length;
      importProgress.totalFarmers = farmersRows.length;

      // Build activity map
      const activityById = new Map<string, { row: ExcelActivityRow; rowNum: number }>();
      activitiesRows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const activityId = normalizeStr((r as any).activityId);
        if (!activityId) {
          errors.push({ sheet: 'Activities', row: rowNum, message: 'Missing activityId' });
          return;
        }
        activityById.set(activityId, { row: r, rowNum });
      });

      // Group farmers by activityId (keep row numbers)
      const farmersByActivity = new Map<string, Array<{ row: ExcelFarmerRow; rowNum: number }>>();
      farmersRows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const activityId = normalizeStr((r as any).activityId);
        if (!activityId) {
          errors.push({ sheet: 'Farmers', row: rowNum, message: 'Missing activityId' });
          return;
        }
        if (!activityById.has(activityId)) {
          // This farmer row will never be processed (no matching activity), so surface it clearly.
          errors.push({ sheet: 'Farmers', row: rowNum, message: `Unknown activityId (not found in Activities sheet): ${activityId}` });
          return;
        }
        if (!farmersByActivity.has(activityId)) farmersByActivity.set(activityId, []);
        farmersByActivity.get(activityId)!.push({ row: r, rowNum });
      });

      // Memoize preferred language by state (only for states present)
      const states = new Set<string>();
      for (const { row } of activityById.values()) {
        const state = normalizeStr((row as any).state);
        if (state) states.add(state);
      }
      const languageByState = new Map<string, string>();
      await Promise.all(
        Array.from(states).map(async (state) => {
          try {
            const lang = await getLanguageForState(state);
            languageByState.set(state, lang);
          } catch (e) {
            languageByState.set(state, 'English');
            logger.warn('[EXCEL IMPORT] Failed to resolve language for state "%s"', state);
          }
        })
      );

      // Build farmer upserts and per-activity mobile lists
      const farmerOps: any[] = [];
      const mobilesByActivity = new Map<string, string[]>();
      const uniqueMobiles = new Set<string>();
      let qualifiedActivities = 0;

      for (const [activityId, { row: activityRow, rowNum }] of activityById.entries()) {
        const state = normalizeStr((activityRow as any).state);
        const territory = normalizeStr((activityRow as any).territory);
        const territoryName = normalizeStr((activityRow as any).territoryName || territory);
        const preferredLanguage = languageByState.get(state) || 'English';

        // Activities must qualify by required fields + valid date (same checks as upsert phase).
        try {
          const type = normalizeStr((activityRow as any).type);
          const officerId = normalizeStr((activityRow as any).officerId);
          const officerName = normalizeStr((activityRow as any).officerName);
          const location = normalizeStr((activityRow as any).location);
          const terr = normalizeStr((activityRow as any).territory);
          const st = normalizeStr((activityRow as any).state);
          if (!type || !officerId || !officerName || !location || !terr || !st) {
            throw new Error('Missing one or more required fields: type, officerId, officerName, location, territory, state');
          }
          void parseExcelDate((activityRow as any).date);
          qualifiedActivities += 1;
        } catch {
          // Not qualified; errors are surfaced later during activity upsert.
        }

        const farmerRowsForActivity = farmersByActivity.get(activityId) || [];
        const seenMobile = new Set<string>();
        const mobiles: string[] = [];

        for (const frw of farmerRowsForActivity) {
          const fr = frw.row;
          const name = normalizeStr((fr as any).name);
          const mobileNumber = normalizeStr((fr as any).mobileNumber);
          const location = normalizeStr((fr as any).location);
          const photoUrl = normalizeStr((fr as any).photoUrl || '');

          if (!name || !mobileNumber || !location) {
            errors.push({
              sheet: 'Farmers',
              row: frw.rowNum,
              message: `Missing required farmer fields (name/mobileNumber/location) for activityId=${activityId}`,
            });
            continue;
          }
          if (seenMobile.has(mobileNumber)) continue;
          seenMobile.add(mobileNumber);
          mobiles.push(mobileNumber);
          uniqueMobiles.add(mobileNumber);

          farmerOps.push({
            updateOne: {
              filter: { mobileNumber },
              update: {
                $set: {
                  name,
                  mobileNumber,
                  location,
                  preferredLanguage,
                  territory: territoryName || 'Unknown',
                  ...(photoUrl ? { photoUrl } : {}),
                },
              },
              upsert: true,
            },
          });
        }

        mobilesByActivity.set(activityId, mobiles);
        importProgress.activitiesProcessed += 1;
        importProgress.message = `Parsed activity ${importProgress.activitiesProcessed}/${importProgress.totalActivities}`;
        if (!state || !territoryName) {
          // not fatal; handled later by required fields check for activities
          void rowNum;
        }
      }

      importProgress.totalQualifiedActivities = qualifiedActivities;
      importProgress.totalQualifiedFarmers = uniqueMobiles.size;
      importProgress.loadedQualifiedActivities = 0;
      importProgress.loadedQualifiedFarmers = 0;

      // Bulk upsert farmers
      importProgress.message = 'Upserting farmers…';
      let farmersUpserted = 0;
      await bulkWriteInChunks(
        farmerOps,
        500,
        async (chunk) => {
          const res = await Farmer.bulkWrite(chunk, { ordered: false });
          // upserts + matches are both “processed” from user perspective
          farmersUpserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
        },
        (done) => {
          importProgress.farmersProcessed = Math.min(done, farmerOps.length);
          // Track unified progress based on qualified farmer upserts (deduped by mobile).
          importProgress.loadedQualifiedFarmers = Math.min(importProgress.farmersProcessed, importProgress.totalQualifiedFarmers || 0);
        }
      );

      // Fetch farmer ids by mobile number (for activity links)
      const mobileList = Array.from(uniqueMobiles);
      const farmerIdByMobile = new Map<string, any>();
      for (let i = 0; i < mobileList.length; i += 2000) {
        const slice = mobileList.slice(i, i + 2000);
        // eslint-disable-next-line no-await-in-loop
        const docs = await Farmer.find({ mobileNumber: { $in: slice } }).select('_id mobileNumber').lean();
        docs.forEach((d: any) => farmerIdByMobile.set(String(d.mobileNumber), d._id));
      }

      // Build activity upserts with farmerIds resolved
      importProgress.message = 'Upserting activities…';
      const activityOps: any[] = [];
      let linksUpdated = 0;

      for (const [activityId, { row: activityRow, rowNum }] of activityById.entries()) {
        try {
          const type = normalizeStr((activityRow as any).type);
          const officerId = normalizeStr((activityRow as any).officerId);
          const officerName = normalizeStr((activityRow as any).officerName);
          const location = normalizeStr((activityRow as any).location);
          const territory = normalizeStr((activityRow as any).territory);
          const state = normalizeStr((activityRow as any).state);

          if (!type || !officerId || !officerName || !location || !territory || !state) {
            throw new Error('Missing one or more required fields: type, officerId, officerName, location, territory, state');
          }

          const date = parseExcelDate((activityRow as any).date);
          const territoryName = normalizeStr((activityRow as any).territoryName || territory);

          const mobiles = mobilesByActivity.get(activityId) || [];
          const farmerIds = mobiles
            .map((m) => farmerIdByMobile.get(m))
            .filter(Boolean);

          activityOps.push({
            updateOne: {
              filter: { activityId },
              update: {
                $set: {
                  activityId,
                  type,
                  date,
                  officerId,
                  officerName,
                  location,
                  territory,
                  state,
                  territoryName,
                  zoneName: normalizeStr((activityRow as any).zoneName || ''),
                  buName: normalizeStr((activityRow as any).buName || ''),
                  tmEmpCode: normalizeStr((activityRow as any).tmEmpCode || ''),
                  tmName: normalizeStr((activityRow as any).tmName || ''),
                  crops: splitCSVCell((activityRow as any).crops),
                  products: splitCSVCell((activityRow as any).products),
                  farmerIds,
                  syncedAt: new Date(),
                  dataBatchId: jobId,
                },
                $setOnInsert: {
                  lifecycleStatus: 'active',
                  lifecycleUpdatedAt: new Date(),
                },
              },
              upsert: true,
            },
          });
          linksUpdated += 1;
        } catch (e: any) {
          errors.push({ sheet: 'Activities', row: rowNum, message: `activityId=${activityId}: ${e?.message || String(e)}` });
        }
      }

      // Qualified activities == those we actually attempt to upsert.
      importProgress.totalQualifiedActivities = activityOps.length;
      importProgress.loadedQualifiedActivities = 0;

      let activitiesUpserted = 0;
      await bulkWriteInChunks(
        activityOps,
        250,
        async (chunk) => {
          const res = await Activity.bulkWrite(chunk, { ordered: false });
          activitiesUpserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
        },
        (done) => {
          // activitiesProcessed is also used during parsing; never allow progress to go backwards
          // when switching phases (parsing -> upserting).
          importProgress.activitiesProcessed = Math.max(
            importProgress.activitiesProcessed,
            Math.min(done, activityOps.length)
          );
          importProgress.loadedQualifiedActivities = Math.min(
            Math.max(0, done),
            importProgress.totalQualifiedActivities || activityOps.length
          );
        }
      );

      const durationMs = Date.now() - t0;
      importProgress.running = false;
      importProgress.finishedAt = new Date().toISOString();
      importProgress.message = 'Excel import completed';
      importProgress.errorCount = errors.length;
      importProgress.lastResult = {
        activitiesRows: activitiesRows.length,
        farmersRows: farmersRows.length,
        activitiesUpserted,
        farmersUpserted,
        linksUpdated,
        errorsCount: errors.length,
        errors: errors.slice(0, 200),
        durationMs,
      };

      logger.info('[EXCEL IMPORT] Completed', {
        jobId,
        durationMs,
        activitiesRows: activitiesRows.length,
        farmersRows: farmersRows.length,
        errorsCount: errors.length,
      });
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      importProgress.running = false;
      importProgress.finishedAt = new Date().toISOString();
      importProgress.message = 'Excel import failed';
      importProgress.errorCount = errors.length + 1;
      importProgress.lastResult = {
        activitiesRows: importProgress.totalActivities,
        farmersRows: importProgress.totalFarmers,
        activitiesUpserted: 0,
        farmersUpserted: 0,
        linksUpdated: 0,
        errorsCount: errors.length + 1,
        errors: [...errors, { sheet: 'Activities' as const, row: 0, message: e?.message || String(e) }].slice(0, 200),
        durationMs,
      };
      logger.error('[EXCEL IMPORT] Failed', { jobId, error: e?.message || String(e) });
    }
  })().catch((err) => {
    logger.error('[EXCEL IMPORT] Background job crash', err);
    importProgress.running = false;
    importProgress.finishedAt = new Date().toISOString();
    importProgress.message = 'Excel import crashed';
    importProgress.errorCount += 1;
  });

  return { started: true, jobId, message: 'Excel import started. You can monitor progress on this page.' };
}

