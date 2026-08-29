import { Activity } from '../models/Activity.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import logger from '../config/logger.js';
import { parseQueryDateFrom, parseQueryDateTo } from '../utils/dateRangeQuery.js';

export type ActivityParkKey =
  | 'active_not_sampled'
  | 'active_partial'
  | 'active_sampled'
  | 'lifecycle_sampled';

export type TaskParkStatus =
  | 'unassigned'
  | 'sampled_in_queue'
  | 'in_progress'
  | 'completed'
  | 'not_reachable'
  | 'invalid_number';

const ACTIVITY_PARK_KEYS: ActivityParkKey[] = [
  'active_not_sampled',
  'active_partial',
  'active_sampled',
  'lifecycle_sampled',
];

const TASK_PARK_STATUSES: TaskParkStatus[] = [
  'unassigned',
  'sampled_in_queue',
  'in_progress',
  'completed',
  'not_reachable',
  'invalid_number',
];

export type StockParkingFilters = {
  dateFrom: string | Date;
  dateTo: string | Date;
  bu?: string;
  state?: string;
};

export type StockParkingCounts = {
  dateFrom: string;
  dateTo: string;
  bu: string | null;
  state: string | null;
  activities: {
    activeNotSampled: number;
    activePartial: number;
    activeSampled: number;
    lifecycleSampled: number;
    inactive: number;
    notEligible: number;
    superseded: number;
    total: number;
  };
  tasks: {
    unassigned: number;
    sampledInQueue: number;
    inProgress: number;
    completed: number;
    notReachable: number;
    invalidNumber: number;
    cancelled: number;
    total: number;
  };
};

export type StockParkingPreview = {
  activitiesToInactivate: number;
  tasksToCancel: number;
  byActivityKey: Record<ActivityParkKey, number>;
  byTaskStatus: Record<TaskParkStatus, number>;
};

export type StockParkingResult = {
  activitiesInactivated: number;
  tasksCancelled: number;
  byActivityKey: Record<ActivityParkKey, number>;
  byTaskStatus: Record<TaskParkStatus, number>;
};

function requireDateRange(filters: StockParkingFilters): { from: Date; to: Date; fromStr: string; toStr: string } {
  const from = parseQueryDateFrom(filters.dateFrom);
  const to = parseQueryDateTo(filters.dateTo);
  if (!from || !to) {
    const err: any = new Error('dateFrom and dateTo are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  if (from > to) {
    const err: any = new Error('dateFrom must be on or before dateTo');
    err.statusCode = 400;
    throw err;
  }
  const fromStr =
    typeof filters.dateFrom === 'string'
      ? String(filters.dateFrom).slice(0, 10)
      : from.toISOString().slice(0, 10);
  const toStr =
    typeof filters.dateTo === 'string'
      ? String(filters.dateTo).slice(0, 10)
      : to.toISOString().slice(0, 10);
  return { from, to, fromStr, toStr };
}

function activityBaseMatch(from: Date, to: Date, bu?: string, state?: string): Record<string, unknown> {
  const match: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
  };
  if (bu) match.buName = String(bu).trim();
  if (state) match.state = String(state).trim();
  return match;
}

/** Active (or missing lifecycle) activities with computed samplingStatus. */
async function countActiveBySamplingStatus(
  from: Date,
  to: Date,
  bu?: string,
  state?: string
): Promise<{ not_sampled: number; partial: number; sampled: number }> {
  const samplingAuditColl = SamplingAudit.collection.name;
  const rows = await Activity.aggregate([
    {
      $match: {
        ...activityBaseMatch(from, to, bu, state),
        $or: [{ lifecycleStatus: 'active' }, { lifecycleStatus: { $exists: false } }, { lifecycleStatus: null }],
      },
    },
    {
      $lookup: {
        from: samplingAuditColl,
        localField: '_id',
        foreignField: 'activityId',
        as: 'audits',
      },
    },
    {
      $addFields: {
        sampledCount: { $ifNull: [{ $arrayElemAt: ['$audits.sampledCount', 0] }, 0] },
        hasAudit: { $gt: [{ $size: { $ifNull: ['$audits', []] } }, 0] },
      },
    },
    {
      $addFields: {
        samplingStatus: {
          $switch: {
            branches: [
              { case: { $eq: ['$hasAudit', false] }, then: 'not_sampled' },
              { case: { $gt: ['$sampledCount', 0] }, then: 'sampled' },
            ],
            default: 'partial',
          },
        },
      },
    },
    {
      $group: {
        _id: '$samplingStatus',
        count: { $sum: 1 },
      },
    },
  ]);

  const out = { not_sampled: 0, partial: 0, sampled: 0 };
  for (const row of rows) {
    const key = row._id as keyof typeof out;
    if (key in out) out[key] = row.count || 0;
  }
  return out;
}

async function countLifecycle(
  from: Date,
  to: Date,
  status: string,
  bu?: string,
  state?: string
): Promise<number> {
  return Activity.countDocuments({
    ...activityBaseMatch(from, to, bu, state),
    lifecycleStatus: status,
  });
}

async function findActiveIdsBySamplingStatus(
  from: Date,
  to: Date,
  samplingStatus: 'not_sampled' | 'partial' | 'sampled',
  bu?: string,
  state?: string
): Promise<any[]> {
  const samplingAuditColl = SamplingAudit.collection.name;
  const rows = await Activity.aggregate([
    {
      $match: {
        ...activityBaseMatch(from, to, bu, state),
        $or: [{ lifecycleStatus: 'active' }, { lifecycleStatus: { $exists: false } }, { lifecycleStatus: null }],
      },
    },
    {
      $lookup: {
        from: samplingAuditColl,
        localField: '_id',
        foreignField: 'activityId',
        as: 'audits',
      },
    },
    {
      $addFields: {
        sampledCount: { $ifNull: [{ $arrayElemAt: ['$audits.sampledCount', 0] }, 0] },
        hasAudit: { $gt: [{ $size: { $ifNull: ['$audits', []] } }, 0] },
      },
    },
    {
      $addFields: {
        samplingStatus: {
          $switch: {
            branches: [
              { case: { $eq: ['$hasAudit', false] }, then: 'not_sampled' },
              { case: { $gt: ['$sampledCount', 0] }, then: 'sampled' },
            ],
            default: 'partial',
          },
        },
      },
    },
    { $match: { samplingStatus } },
    { $project: { _id: 1 } },
  ]);
  return rows.map((r) => r._id);
}

async function taskCounts(
  from: Date,
  to: Date,
  bu?: string,
  state?: string
): Promise<StockParkingCounts['tasks']> {
  const match: Record<string, unknown> = {
    scheduledDate: { $gte: from, $lte: to },
  };

  const pipeline: any[] = [{ $match: match }];

  if (bu || state) {
    const activityCollection = Activity.collection.name;
    pipeline.push(
      {
        $lookup: {
          from: activityCollection,
          localField: 'activityId',
          foreignField: '_id',
          as: 'activity',
        },
      },
      { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } }
    );
    const activityFilter: Record<string, unknown> = {};
    if (bu) activityFilter['activity.buName'] = String(bu).trim();
    if (state) activityFilter['activity.state'] = String(state).trim();
    pipeline.push({ $match: activityFilter });
  }

  pipeline.push({
    $group: {
      _id: '$status',
      count: { $sum: 1 },
    },
  });

  const rows = await CallTask.aggregate(pipeline);
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[String(row._id)] = row.count || 0;
  }

  const tasks = {
    unassigned: map.unassigned || 0,
    sampledInQueue: map.sampled_in_queue || 0,
    inProgress: map.in_progress || 0,
    completed: map.completed || 0,
    notReachable: map.not_reachable || 0,
    invalidNumber: map.invalid_number || 0,
    cancelled: map.cancelled || 0,
    total: 0,
  };
  tasks.total =
    tasks.unassigned +
    tasks.sampledInQueue +
    tasks.inProgress +
    tasks.completed +
    tasks.notReachable +
    tasks.invalidNumber +
    tasks.cancelled;
  return tasks;
}

function emptyByActivityKey(): Record<ActivityParkKey, number> {
  return {
    active_not_sampled: 0,
    active_partial: 0,
    active_sampled: 0,
    lifecycle_sampled: 0,
  };
}

function emptyByTaskStatus(): Record<TaskParkStatus, number> {
  return {
    unassigned: 0,
    sampled_in_queue: 0,
    in_progress: 0,
    completed: 0,
    not_reachable: 0,
    invalid_number: 0,
  };
}

export async function getStockParkingCounts(filters: StockParkingFilters): Promise<StockParkingCounts> {
  const { from, to, fromStr, toStr } = requireDateRange(filters);
  const bu = filters.bu?.trim() || undefined;
  const state = filters.state?.trim() || undefined;

  const [activeSplit, lifecycleSampled, inactive, notEligible, superseded, tasks] = await Promise.all([
    countActiveBySamplingStatus(from, to, bu, state),
    countLifecycle(from, to, 'sampled', bu, state),
    countLifecycle(from, to, 'inactive', bu, state),
    countLifecycle(from, to, 'not_eligible', bu, state),
    countLifecycle(from, to, 'superseded', bu, state),
    taskCounts(from, to, bu, state),
  ]);

  const activities = {
    activeNotSampled: activeSplit.not_sampled,
    activePartial: activeSplit.partial,
    activeSampled: activeSplit.sampled,
    lifecycleSampled,
    inactive,
    notEligible,
    superseded,
    total:
      activeSplit.not_sampled +
      activeSplit.partial +
      activeSplit.sampled +
      lifecycleSampled +
      inactive +
      notEligible +
      superseded,
  };

  return {
    dateFrom: fromStr,
    dateTo: toStr,
    bu: bu || null,
    state: state || null,
    activities,
    tasks,
  };
}

async function resolveActivityIdsForKeys(
  keys: ActivityParkKey[],
  from: Date,
  to: Date,
  bu?: string,
  state?: string
): Promise<{ ids: any[]; byKey: Record<ActivityParkKey, number> }> {
  const byKey = emptyByActivityKey();
  const idSet = new Set<string>();
  const ids: any[] = [];

  for (const key of keys) {
    if (!ACTIVITY_PARK_KEYS.includes(key)) continue;
    let batch: any[] = [];
    if (key === 'active_not_sampled') {
      batch = await findActiveIdsBySamplingStatus(from, to, 'not_sampled', bu, state);
    } else if (key === 'active_partial') {
      batch = await findActiveIdsBySamplingStatus(from, to, 'partial', bu, state);
    } else if (key === 'active_sampled') {
      batch = await findActiveIdsBySamplingStatus(from, to, 'sampled', bu, state);
    } else if (key === 'lifecycle_sampled') {
      batch = (
        await Activity.find({
          ...activityBaseMatch(from, to, bu, state),
          lifecycleStatus: 'sampled',
        })
          .select('_id')
          .lean()
      ).map((a) => a._id);
    }
    byKey[key] = batch.length;
    for (const id of batch) {
      const s = String(id);
      if (!idSet.has(s)) {
        idSet.add(s);
        ids.push(id);
      }
    }
  }

  return { ids, byKey };
}

async function countTasksForStatuses(
  statuses: TaskParkStatus[],
  from: Date,
  to: Date,
  bu?: string,
  state?: string
): Promise<Record<TaskParkStatus, number>> {
  const byStatus = emptyByTaskStatus();
  const valid = statuses.filter((s) => TASK_PARK_STATUSES.includes(s));
  if (!valid.length) return byStatus;

  const match: Record<string, unknown> = {
    scheduledDate: { $gte: from, $lte: to },
    status: { $in: valid },
  };

  const pipeline: any[] = [{ $match: match }];
  if (bu || state) {
    pipeline.push(
      {
        $lookup: {
          from: Activity.collection.name,
          localField: 'activityId',
          foreignField: '_id',
          as: 'activity',
        },
      },
      { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          ...(bu ? { 'activity.buName': String(bu).trim() } : {}),
          ...(state ? { 'activity.state': String(state).trim() } : {}),
        },
      }
    );
  }
  pipeline.push({ $group: { _id: '$status', count: { $sum: 1 } } });

  const rows = await CallTask.aggregate(pipeline);
  for (const row of rows) {
    const st = row._id as TaskParkStatus;
    if (st in byStatus) byStatus[st] = row.count || 0;
  }
  return byStatus;
}

export async function previewStockParking(
  filters: StockParkingFilters,
  activityKeys: ActivityParkKey[],
  taskStatuses: TaskParkStatus[]
): Promise<StockParkingPreview> {
  const { from, to } = requireDateRange(filters);
  const bu = filters.bu?.trim() || undefined;
  const state = filters.state?.trim() || undefined;

  const keys = (activityKeys || []).filter((k) => ACTIVITY_PARK_KEYS.includes(k));
  const statuses = (taskStatuses || []).filter((s) => TASK_PARK_STATUSES.includes(s));

  const [{ ids, byKey }, byTaskStatus] = await Promise.all([
    resolveActivityIdsForKeys(keys, from, to, bu, state),
    countTasksForStatuses(statuses, from, to, bu, state),
  ]);

  return {
    activitiesToInactivate: ids.length,
    tasksToCancel: Object.values(byTaskStatus).reduce((a, b) => a + b, 0),
    byActivityKey: byKey,
    byTaskStatus,
  };
}

export async function applyStockParking(
  filters: StockParkingFilters,
  activityKeys: ActivityParkKey[],
  taskStatuses: TaskParkStatus[],
  actor: { userId: string }
): Promise<StockParkingResult> {
  const { from, to, fromStr, toStr } = requireDateRange(filters);
  const bu = filters.bu?.trim() || undefined;
  const state = filters.state?.trim() || undefined;

  const keys = (activityKeys || []).filter((k) => ACTIVITY_PARK_KEYS.includes(k));
  const statuses = (taskStatuses || []).filter((s) => TASK_PARK_STATUSES.includes(s));

  if (!keys.length && !statuses.length) {
    const err: any = new Error('Select at least one activity cohort or task status to park');
    err.statusCode = 400;
    throw err;
  }

  const { ids, byKey } = await resolveActivityIdsForKeys(keys, from, to, bu, state);
  const byTaskStatus = await countTasksForStatuses(statuses, from, to, bu, state);

  const now = new Date();
  let activitiesInactivated = 0;
  if (ids.length) {
    const actResult = await Activity.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          lifecycleStatus: 'inactive',
          lifecycleUpdatedAt: now,
        },
      }
    );
    activitiesInactivated = actResult.modifiedCount || 0;
  }

  let tasksCancelled = 0;
  if (statuses.length) {
    const taskMatch: Record<string, unknown> = {
      scheduledDate: { $gte: from, $lte: to },
      status: { $in: statuses },
    };

    let taskIds: any[] | null = null;
    if (bu || state) {
      const pipeline: any[] = [
        { $match: taskMatch },
        {
          $lookup: {
            from: Activity.collection.name,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        {
          $match: {
            ...(bu ? { 'activity.buName': String(bu).trim() } : {}),
            ...(state ? { 'activity.state': String(state).trim() } : {}),
          },
        },
        { $project: { _id: 1 } },
      ];
      taskIds = (await CallTask.aggregate(pipeline)).map((r) => r._id);
    }

    const cancelQuery =
      taskIds != null ? { _id: { $in: taskIds } } : taskMatch;

    const cancelResult = await CallTask.updateMany(cancelQuery, {
      $set: { status: 'cancelled' },
      $push: {
        interactionHistory: {
          timestamp: now,
          status: 'cancelled',
          notes: `Admin stock parking (${fromStr}–${toStr})`,
        },
      },
    });
    tasksCancelled = cancelResult.modifiedCount || 0;
  }

  logger.info('Stock parking applied', {
    actorId: actor.userId,
    dateFrom: fromStr,
    dateTo: toStr,
    bu: bu || null,
    state: state || null,
    activityKeys: keys,
    taskStatuses: statuses,
    activitiesInactivated,
    tasksCancelled,
    byActivityKey: byKey,
    byTaskStatus,
  });

  return {
    activitiesInactivated,
    tasksCancelled,
    byActivityKey: byKey,
    byTaskStatus,
  };
}

export { ACTIVITY_PARK_KEYS, TASK_PARK_STATUSES };
