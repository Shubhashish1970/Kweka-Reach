import mongoose from 'mongoose';
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

  const [auditCount, taskCount] = await Promise.all([
    SamplingAudit.countDocuments({ activityId: { $in: activityObjectIds } }),
    CallTask.countDocuments({ activityId: { $in: activityObjectIds } }),
  ]);

  if (auditCount > 0) {
    return {
      ok: false,
      reason:
        'Sampling has run for one or more activities in this batch (sampling audit exists). Batch delete is not allowed.',
    };
  }
  if (taskCount > 0) {
    return {
      ok: false,
      reason:
        'Call tasks exist for activities in this batch (usually created after sampling). Batch delete is not allowed.',
    };
  }
  return { ok: true };
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

  const out: DataBatchSummary[] = [];
  for (const r of rows) {
    const batchId = r._id;
    const ids = await Activity.find({ dataBatchId: batchId }).select('_id').lean();
    const objectIds = ids.map((d) => d._id as mongoose.Types.ObjectId);
    const gate = await batchCanDelete(objectIds);
    out.push({
      batchId,
      activityCount: r.activityCount,
      lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      minActivityDate: r.minActivityDate ? new Date(r.minActivityDate).toISOString() : null,
      maxActivityDate: r.maxActivityDate ? new Date(r.maxActivityDate).toISOString() : null,
      source: inferSource(batchId),
      canDelete: gate.ok,
      blockReason: gate.ok ? undefined : gate.reason,
    });
  }
  return out;
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
