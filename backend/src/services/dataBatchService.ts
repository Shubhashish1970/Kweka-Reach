import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { Activity } from '../models/Activity.js';
import { Farmer } from '../models/Farmer.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import logger from '../config/logger.js';

export type DataBatchSummary = {
  batchId: string;
  activityCount: number;
  lastSyncedAt: string | null;
  /** Earliest activity.date in batch (ISO) */
  minActivityDate: string | null;
  /** Latest activity.date in batch (ISO) */
  maxActivityDate: string | null;
  source: 'excel' | 'sync' | 'unknown';
  canDelete: boolean;
  blockReason?: string;
};

function inferSource(batchId: string): DataBatchSummary['source'] {
  if (batchId.startsWith('excel-import-')) return 'excel';
  if (batchId.startsWith('sync-')) return 'sync';
  return 'unknown';
}

async function batchCanDelete(
  activityObjectIds: mongoose.Types.ObjectId[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (activityObjectIds.length === 0) return { ok: false, reason: 'No activities in this batch.' };

  const [auditExists, taskExists] = await Promise.all([
    SamplingAudit.exists({ activityId: { $in: activityObjectIds } }),
    CallTask.exists({ activityId: { $in: activityObjectIds } }),
  ]);

  if (auditExists) {
    return {
      ok: false,
      reason:
        'Sampling has run for one or more activities in this batch (sampling audit exists). Batch delete is not allowed.',
    };
  }
  if (taskExists) {
    return {
      ok: false,
      reason:
        'Call tasks exist for activities in this batch (usually created after sampling). Batch delete is not allowed.',
    };
  }
  return { ok: true };
}

async function summarizeBatchRow(r: {
  _id: string;
  activityCount: number;
  lastSyncedAt: Date | null;
  minActivityDate: Date | null;
  maxActivityDate: Date | null;
}): Promise<DataBatchSummary> {
  const batchId = r._id;
  const objectIds = (await Activity.distinct('_id', {
    dataBatchId: batchId,
  })) as mongoose.Types.ObjectId[];
  const gate = await batchCanDelete(objectIds);
  return {
    batchId,
    activityCount: r.activityCount,
    lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
    minActivityDate: r.minActivityDate ? new Date(r.minActivityDate).toISOString() : null,
    maxActivityDate: r.maxActivityDate ? new Date(r.maxActivityDate).toISOString() : null,
    source: inferSource(batchId),
    canDelete: gate.ok,
    blockReason: gate.ok ? undefined : gate.reason,
  };
}

export async function listDataBatches(limit = 25): Promise<DataBatchSummary[]> {
  const rows = await Activity.aggregate<{
    _id: string;
    activityCount: number;
    lastSyncedAt: Date | null;
    minActivityDate: Date | null;
    maxActivityDate: Date | null;
  }>([
    { $match: { dataBatchId: { $exists: true, $nin: [null, ''] } } },
    {
      $group: {
        _id: '$dataBatchId',
        activityCount: { $sum: 1 },
        lastSyncedAt: { $max: '$syncedAt' },
        minActivityDate: { $min: '$date' },
        maxActivityDate: { $max: '$date' },
      },
    },
    { $sort: { lastSyncedAt: -1 } },
    { $limit: limit },
  ]);

  return Promise.all(rows.map((r) => summarizeBatchRow(r)));
}

/** Latest API sync batch — used to reconcile last-sync display across admin pages. */
export async function getLatestSyncBatchSummary(): Promise<{
  lastSyncedAt: string;
  activitiesSynced: number;
  farmersSynced: number;
  batchId: string;
} | null> {
  const batchRows = await Activity.aggregate<{
    _id: string;
    activityCount: number;
    lastSyncedAt: Date | null;
  }>([
    { $match: { dataBatchId: { $regex: /^sync-/ } } },
    {
      $group: {
        _id: '$dataBatchId',
        activityCount: { $sum: 1 },
        lastSyncedAt: { $max: '$syncedAt' },
      },
    },
    { $sort: { lastSyncedAt: -1 } },
    { $limit: 1 },
  ]);

  const latest = batchRows[0];
  if (!latest?.lastSyncedAt) return null;

  const farmerAgg = await Activity.aggregate<{ total: number }>([
    { $match: { dataBatchId: latest._id } },
    {
      $group: {
        _id: null,
        total: { $sum: { $size: { $ifNull: ['$farmerIds', []] } } },
      },
    },
  ]);

  return {
    lastSyncedAt: new Date(latest.lastSyncedAt).toISOString(),
    activitiesSynced: latest.activityCount,
    farmersSynced: farmerAgg[0]?.total ?? 0,
    batchId: latest._id,
  };
}

export async function deleteDataBatch(batchId: string): Promise<{
  deletedActivities: number;
  deletedTasks: number;
  deletedAudits: number;
  deletedFarmers: number;
}> {
  const trimmed = (batchId || '').trim();
  if (!trimmed) throw new Error('batchId is required');

  const activities = await Activity.find({ dataBatchId: trimmed }).select('_id farmerIds').lean();
  if (activities.length === 0) throw new Error('No activities found for this batch');

  const activityObjectIds = activities.map((a) => a._id as mongoose.Types.ObjectId);
  const gate = await batchCanDelete(activityObjectIds);
  if (!gate.ok) throw new Error(gate.reason);

  const farmerIdSet = new Set<string>();
  for (const a of activities) {
    for (const fid of a.farmerIds || []) {
      farmerIdSet.add(String(fid));
    }
  }

  const [taskDel, auditDel] = await Promise.all([
    CallTask.deleteMany({ activityId: { $in: activityObjectIds } }),
    SamplingAudit.deleteMany({ activityId: { $in: activityObjectIds } }),
  ]);

  const actDel = await Activity.deleteMany({ dataBatchId: trimmed });

  const candidateOids = [...farmerIdSet].map((id) => new mongoose.Types.ObjectId(id));
  let deletedFarmers = 0;
  if (candidateOids.length > 0) {
    const stillReferenced = await Activity.find({ farmerIds: { $in: candidateOids } }).distinct('farmerIds');
    const stillSet = new Set((stillReferenced as mongoose.Types.ObjectId[]).map((x) => String(x)));
    const toDelete = candidateOids.filter((oid) => !stillSet.has(String(oid)));
    if (toDelete.length > 0) {
      const fr = await Farmer.deleteMany({ _id: { $in: toDelete } });
      deletedFarmers = fr.deletedCount || 0;
    }
  }

  logger.info('[DATA BATCH] Deleted batch', {
    batchId: trimmed,
    deletedActivities: actDel.deletedCount,
    deletedTasks: taskDel.deletedCount,
    deletedAudits: auditDel.deletedCount,
    deletedFarmers,
  });

  return {
    deletedActivities: actDel.deletedCount || 0,
    deletedTasks: taskDel.deletedCount || 0,
    deletedAudits: auditDel.deletedCount || 0,
    deletedFarmers,
  };
}

const formatActivityDateForExport = (d: Date): string => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
};

const joinCsv = (values?: string[] | null): string =>
  Array.isArray(values) ? values.filter(Boolean).join(',') : '';

export type DataBatchActivityExportRow = {
  activityId: string;
  type: string;
  date: string;
  officerId: string;
  officerName: string;
  location: string;
  territory: string;
  state: string;
  territoryName: string;
  zoneName: string;
  buName: string;
  tmEmpCode: string;
  tmName: string;
  crops: string;
  products: string;
};

export type DataBatchFarmerExportRow = {
  activityId: string;
  farmerId: string;
  name: string;
  mobileNumber: string;
  location: string;
  photoUrl: string;
  crops: string;
};

/** Reconstruct API/Excel-shaped rows for all activities in an ingest batch. */
export async function buildDataBatchExportRows(batchId: string): Promise<{
  activities: DataBatchActivityExportRow[];
  farmers: DataBatchFarmerExportRow[];
}> {
  const trimmed = (batchId || '').trim();
  if (!trimmed) throw new Error('batchId is required');

  const activities = await Activity.find({ dataBatchId: trimmed }).sort({ date: -1, activityId: 1 }).lean();
  if (activities.length === 0) throw new Error('No activities found for this batch');

  const farmerOidSet = new Set<string>();
  for (const a of activities) {
    for (const fid of a.farmerIds || []) {
      farmerOidSet.add(String(fid));
    }
  }

  const farmerDocs =
    farmerOidSet.size > 0
      ? await Farmer.find({ _id: { $in: [...farmerOidSet].map((id) => new mongoose.Types.ObjectId(id)) } }).lean()
      : [];
  const farmerMap = new Map(farmerDocs.map((f) => [String(f._id), f]));

  const activityRows: DataBatchActivityExportRow[] = [];
  const farmerRows: DataBatchFarmerExportRow[] = [];

  for (const a of activities) {
    activityRows.push({
      activityId: String(a.activityId || ''),
      type: String(a.type || ''),
      date: a.date ? formatActivityDateForExport(new Date(a.date)) : '',
      officerId: String(a.officerId || ''),
      officerName: String(a.officerName || ''),
      location: String(a.location || ''),
      territory: String(a.territory || a.territoryName || ''),
      state: String(a.state || ''),
      territoryName: String(a.territoryName || a.territory || ''),
      zoneName: String(a.zoneName || ''),
      buName: String(a.buName || ''),
      tmEmpCode: String(a.tmEmpCode || ''),
      tmName: String(a.tmName || ''),
      crops: joinCsv(a.crops),
      products: joinCsv(a.products),
    });

    for (const fid of a.farmerIds || []) {
      const farmer = farmerMap.get(String(fid));
      if (!farmer) continue;
      farmerRows.push({
        activityId: String(a.activityId || ''),
        farmerId: '',
        name: String(farmer.name || ''),
        mobileNumber: String(farmer.mobileNumber || ''),
        location: String(farmer.location || ''),
        photoUrl: String(farmer.photoUrl || ''),
        crops: '',
      });
    }
  }

  return { activities: activityRows, farmers: farmerRows };
}

export async function exportDataBatchXlsxBuffer(batchId: string): Promise<Buffer> {
  const { activities, farmers } = await buildDataBatchExportRows(batchId);
  const wb = XLSX.utils.book_new();
  const wsActivities = XLSX.utils.json_to_sheet(activities, { skipHeader: false });
  const wsFarmers = XLSX.utils.json_to_sheet(farmers, { skipHeader: false });
  XLSX.utils.book_append_sheet(wb, wsActivities, 'Activities');
  XLSX.utils.book_append_sheet(wb, wsFarmers, 'Farmers');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
