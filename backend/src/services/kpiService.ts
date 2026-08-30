import { Activity } from '../models/Activity.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';

export interface EmsProgressFilters {
  dateFrom?: Date;
  dateTo?: Date;
  state?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  activityType?: string;
}

export function buildActivityMatch(filters: EmsProgressFilters | undefined): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (!filters) return match;
  if (filters.activityType) match.type = filters.activityType;
  if (filters.state) match.state = filters.state;
  if (filters.territory) {
    match.$or = [
      { territoryName: filters.territory },
      { territory: filters.territory },
    ];
  }
  if (filters.zone) match.zoneName = filters.zone;
  if (filters.bu) match.buName = filters.bu;
  if (filters.dateFrom || filters.dateTo) {
    match.date = {};
    if (filters.dateFrom) (match.date as Record<string, Date>).$gte = filters.dateFrom;
    if (filters.dateTo) (match.date as Record<string, Date>).$lte = filters.dateTo;
  }
  return match;
}

/** Activity match without date (used when filtering by task scheduledDate so EMS totals tally with Task Allocation). */
export function buildActivityMatchWithoutDate(filters: EmsProgressFilters | undefined): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (!filters) return match;
  if (filters.activityType) match.type = filters.activityType;
  if (filters.state) match.state = filters.state;
  if (filters.territory) {
    match.$or = [
      { territoryName: filters.territory },
      { territory: filters.territory },
    ];
  }
  if (filters.zone) match.zoneName = filters.zone;
  if (filters.bu) match.buName = filters.bu;
  return match;
}

/** EMS dashboards filter tasks by scheduledDate when a date range is set (same scope as Task Allocation). */
export function hasEmsDateFilter(filters?: EmsProgressFilters): boolean {
  return !!(filters?.dateFrom || filters?.dateTo);
}

export function buildEmsScheduledDateMatch(filters?: EmsProgressFilters): Record<string, Date> | null {
  if (!hasEmsDateFilter(filters)) return null;
  const scheduledDate: Record<string, Date> = {};
  if (filters!.dateFrom) {
    const d = new Date(filters!.dateFrom);
    d.setHours(0, 0, 0, 0);
    scheduledDate.$gte = d;
  }
  if (filters!.dateTo) {
    const d = new Date(filters!.dateTo);
    d.setHours(23, 59, 59, 999);
    scheduledDate.$lte = d;
  }
  return Object.keys(scheduledDate).length ? scheduledDate : null;
}

export function buildEmsTaskBaseMatch(filters?: EmsProgressFilters): Record<string, unknown> {
  const taskMatch: Record<string, unknown> = {
    status: { $in: ['completed', 'not_reachable', 'invalid_number'] },
    callLog: { $exists: true, $ne: null },
  };
  const scheduledDate = buildEmsScheduledDateMatch(filters);
  if (scheduledDate) taskMatch.scheduledDate = scheduledDate;
  return taskMatch;
}

/** Prefix activity fields for $lookup pipelines (e.g. activity.state). */
export function buildActivityPipelineMatch(
  activityMatch: Record<string, unknown>,
  activityPrefix = 'activity'
): Record<string, unknown> {
  if (!Object.keys(activityMatch).length) return {};
  const matchForPipeline: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(activityMatch)) {
    if (k === '$or' && Array.isArray(v)) {
      matchForPipeline.$or = v.map((cond: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [ck, cv] of Object.entries(cond)) out[`${activityPrefix}.${ck}`] = cv;
        return out;
      });
    } else {
      matchForPipeline[`${activityPrefix}.${k}`] = v;
    }
  }
  return matchForPipeline;
}

export function parseEmsProgressFilters(query: Record<string, unknown>): EmsProgressFilters {
  const dateFrom = query.dateFrom ? new Date(String(query.dateFrom)) : undefined;
  const dateTo = query.dateTo ? new Date(String(query.dateTo)) : undefined;
  if (dateFrom && !Number.isNaN(dateFrom.getTime())) dateFrom.setHours(0, 0, 0, 0);
  if (dateTo && !Number.isNaN(dateTo.getTime())) dateTo.setHours(23, 59, 59, 999);
  return {
    dateFrom,
    dateTo,
    state: (query.state as string)?.trim() || undefined,
    territory: (query.territory as string)?.trim() || undefined,
    zone: (query.zone as string)?.trim() || undefined,
    bu: (query.bu as string)?.trim() || undefined,
    activityType: (query.activityType as string)?.trim() || undefined,
  };
}

export interface EmsProgressSummary {
  activities: {
    total: number;
    byLifecycle: { active: number; sampled: number; inactive: number; not_eligible: number };
    sampledCount: number;
    notSampledCount: number;
    partialCount: number;
  };
  tasks: {
    total: number;
    unassigned: number;
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    completionRatePct: number;
  };
  farmers: {
    totalInActivities: number;
    sampled: number;
  };
}

/**
 * EMS progress summary for MIS Admin dashboard.
 * Uses aggregation for performance; respects date/state/territory/zone/bu/activityType filters.
 */
export async function getEmsProgress(filters?: EmsProgressFilters): Promise<EmsProgressSummary> {
  const activityMatch = buildActivityMatch(filters);
  const activityCollection = Activity.collection.name;
  const auditCollection = SamplingAudit.collection.name;

  // Activity lifecycle + sampling status in one pipeline
  const activityAgg = await Activity.aggregate([
    { $match: activityMatch },
    {
      $lookup: {
        from: auditCollection,
        localField: '_id',
        foreignField: 'activityId',
        as: 'audits',
      },
    },
    {
      $addFields: {
        farmerCount: { $size: { $ifNull: ['$farmerIds', []] } },
        sampledCount: { $ifNull: [{ $arrayElemAt: ['$audits.sampledCount', 0] }, 0] },
        hasAudit: { $gt: [{ $size: { $ifNull: ['$audits', []] } }, 0] },
        lifecycleStatus: { $ifNull: ['$lifecycleStatus', 'active'] },
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
        _id: null,
        totalActivities: { $sum: 1 },
        totalFarmers: { $sum: '$farmerCount' },
        farmersSampled: { $sum: '$sampledCount' },
        active: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'active'] }, 1, 0] } },
        sampled: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'sampled'] }, 1, 0] } },
        inactive: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'inactive'] }, 1, 0] } },
        not_eligible: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'not_eligible'] }, 1, 0] } },
        sampledStatusCount: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'sampled'] }, 1, 0] } },
        notSampledStatusCount: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'not_sampled'] }, 1, 0] } },
        partialStatusCount: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'partial'] }, 1, 0] } },
      },
    },
    {
      $project: {
        totalActivities: 1,
        totalFarmers: 1,
        farmersSampled: 1,
        lifecycle: {
          active: '$active',
          sampled: '$sampled',
          inactive: '$inactive',
          not_eligible: '$not_eligible',
        },
        sampling: {
          sampled: '$sampledStatusCount',
          not_sampled: '$notSampledStatusCount',
          partial: '$partialStatusCount',
        },
      },
    },
  ]).exec();

  const a0 = activityAgg?.[0] || {};
  const lifecycle = (a0.lifecycle as Record<string, number>) || {};
  const sampling = (a0.sampling as Record<string, number>) || {};
  const sampledCount = Number(sampling.sampled ?? 0);
  const notSampledCount = Number(sampling.not_sampled ?? 0);
  const partialCount = Number(sampling.partial ?? 0);

  // Task counts: join tasks to activities and apply same filters (match on joined 'activity' doc)
  const taskMatchJoined: Record<string, unknown> = {};
  if (filters?.activityType) taskMatchJoined['activity.type'] = filters.activityType;
  if (filters?.state) taskMatchJoined['activity.state'] = filters.state;
  if (filters?.territory) {
    taskMatchJoined['$or'] = [
      { 'activity.territoryName': filters.territory },
      { 'activity.territory': filters.territory },
    ];
  }
  if (filters?.zone) taskMatchJoined['activity.zoneName'] = filters.zone;
  if (filters?.bu) taskMatchJoined['activity.buName'] = filters.bu;
  if (filters?.dateFrom || filters?.dateTo) {
    taskMatchJoined['activity.date'] = {};
    if (filters.dateFrom) (taskMatchJoined['activity.date'] as Record<string, Date>).$gte = filters.dateFrom;
    if (filters.dateTo) (taskMatchJoined['activity.date'] as Record<string, Date>).$lte = filters.dateTo;
  }

  const taskAgg = await CallTask.aggregate([
    {
      $lookup: {
        from: activityCollection,
        localField: 'activityId',
        foreignField: '_id',
        as: 'activity',
      },
    },
    { $unwind: '$activity' },
    ...(Object.keys(taskMatchJoined).length > 0 ? [{ $match: taskMatchJoined }] : []),
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).exec();

  const taskByStatus: Record<string, number> = {};
  let totalTasks = 0;
  for (const r of taskAgg) {
    taskByStatus[String(r._id)] = Number(r.count || 0);
    totalTasks += Number(r.count || 0);
  }

  const completed = Number(taskByStatus.completed || 0);
  const completionRatePct = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;

  return {
    activities: {
      total: Number(a0.totalActivities || 0),
      byLifecycle: {
        active: Number(lifecycle.active || 0),
        sampled: Number(lifecycle.sampled || 0),
        inactive: Number(lifecycle.inactive || 0),
        not_eligible: Number(lifecycle.not_eligible || 0),
      },
      sampledCount,
      notSampledCount,
      partialCount,
    },
    tasks: {
      total: totalTasks,
      unassigned: Number(taskByStatus.unassigned || 0),
      sampled_in_queue: Number(taskByStatus.sampled_in_queue || 0),
      in_progress: Number(taskByStatus.in_progress || 0),
      completed,
      not_reachable: Number(taskByStatus.not_reachable || 0),
      invalid_number: Number(taskByStatus.invalid_number || 0),
      completionRatePct,
    },
    farmers: {
      totalInActivities: Number(a0.totalFarmers || 0),
      sampled: Number(a0.farmersSampled || 0),
    },
  };
}

export type EmsDrilldownGroupBy = 'state' | 'territory' | 'zone' | 'bu' | 'activityType';

/**
 * Map territory/district names (often stored in Activity.state by mistake) to actual state names.
 * Used when "Group by State" is selected so drill-down shows states (e.g. Andhra Pradesh) not territories (Guntur, Vijayawada).
 */
const TERRITORY_TO_STATE: Record<string, string> = {
  // Andhra Pradesh districts/territories
  Guntur: 'Andhra Pradesh',
  Vijayawada: 'Andhra Pradesh',
  Nellore: 'Andhra Pradesh',
  Visakhapatnam: 'Andhra Pradesh',
  Kurnool: 'Andhra Pradesh',
  Tirupati: 'Andhra Pradesh',
  Kadapa: 'Andhra Pradesh',
  Anantapur: 'Andhra Pradesh',
  Kakinada: 'Andhra Pradesh',
  Rajahmundry: 'Andhra Pradesh',
  // Telangana
  Hyderabad: 'Telangana',
  Warangal: 'Telangana',
  Nizamabad: 'Telangana',
  Karimnagar: 'Telangana',
  // Karnataka
  Bangalore: 'Karnataka',
  Bengaluru: 'Karnataka',
  Mysore: 'Karnataka',
  Hubli: 'Karnataka',
  Mangalore: 'Karnataka',
  Belgaum: 'Karnataka',
  Dharwad: 'Karnataka',
  // Tamil Nadu
  Chennai: 'Tamil Nadu',
  Coimbatore: 'Tamil Nadu',
  Madurai: 'Tamil Nadu',
  Trichy: 'Tamil Nadu',
  Tiruchirappalli: 'Tamil Nadu',
  Erode: 'Tamil Nadu',
  Salem: 'Tamil Nadu',
  // Kerala
  Kochi: 'Kerala',
  Thiruvananthapuram: 'Kerala',
  Kozhikode: 'Kerala',
  // Others (expand as needed)
  Chittorgarh: 'Rajasthan',
  Fatehpur: 'Uttar Pradesh',
  Jodhpur: 'Rajasthan',
  Imphal: 'Manipur',
};

function normalizeStateForDrilldown(value: string): string {
  if (!value || typeof value !== 'string') return value || '—';
  const trimmed = value.trim();
  return TERRITORY_TO_STATE[trimmed] ?? trimmed;
}

export interface EmsDrilldownRow {
  key: string;
  label: string;
  activitiesTotal: number;
  activitiesSampled: number;
  activitiesNotSampled: number;
  activitiesPartial: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksInQueue: number;
  tasksInProgress: number;
  farmersTotal: number;
  farmersSampled: number;
  completionRatePct: number;
}

/**
 * Drilldown by state, territory, zone, bu, or activityType.
 * Returns one row per group with same metrics as summary.
 */
export async function getEmsDrilldown(
  filters: EmsProgressFilters | undefined,
  groupBy: EmsDrilldownGroupBy
): Promise<EmsDrilldownRow[]> {
  const activityMatch = buildActivityMatch(filters);
  // Activity model uses zoneName/buName, not zone/bu
  const fieldName =
    groupBy === 'activityType'
      ? 'type'
      : groupBy === 'territory'
        ? 'territoryName'
        : groupBy === 'zone'
          ? 'zoneName'
          : groupBy === 'bu'
            ? 'buName'
            : groupBy;

  const activityCollection = Activity.collection.name;
  const auditCollection = SamplingAudit.collection.name;

  const activityAgg = await Activity.aggregate([
    { $match: activityMatch },
    {
      $lookup: {
        from: auditCollection,
        localField: '_id',
        foreignField: 'activityId',
        as: 'audits',
      },
    },
    {
      $addFields: {
        farmerCount: { $size: { $ifNull: ['$farmerIds', []] } },
        sampledCount: { $ifNull: [{ $arrayElemAt: ['$audits.sampledCount', 0] }, 0] },
        hasAudit: { $gt: [{ $size: { $ifNull: ['$audits', []] } }, 0] },
        __group:
          groupBy === 'territory'
            ? { $ifNull: ['$territoryName', '$territory'] }
            : groupBy === 'zone'
              ? { $ifNull: ['$zoneName', '—'] }
              : groupBy === 'bu'
                ? { $ifNull: ['$buName', '—'] }
                : `$${fieldName}`,
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
        _id: '$__group',
        activitiesTotal: { $sum: 1 },
        activitiesSampled: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'sampled'] }, 1, 0] } },
        activitiesNotSampled: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'not_sampled'] }, 1, 0] } },
        activitiesPartial: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'partial'] }, 1, 0] } },
        farmersTotal: { $sum: '$farmerCount' },
        farmersSampled: { $sum: '$sampledCount' },
        activityIds: { $push: '$_id' },
      },
    },
  ]).exec();

  if (activityAgg.length === 0) {
    return [];
  }

  // When groupBy is 'state', normalize territory names (e.g. Guntur, Vijayawada) to actual state (e.g. Andhra Pradesh) and merge rows
  let rowsToUse = activityAgg;
  if (groupBy === 'state') {
    const mergedByState = new Map<
      string,
      {
        _id: string;
        activitiesTotal: number;
        activitiesSampled: number;
        activitiesNotSampled: number;
        activitiesPartial: number;
        farmersTotal: number;
        farmersSampled: number;
        activityIds: mongoose.Types.ObjectId[];
      }
    >();
    for (const row of activityAgg) {
      const rawKey = row._id != null ? String(row._id).trim() || '—' : '—';
      const stateKey = normalizeStateForDrilldown(rawKey);
      const existing = mergedByState.get(stateKey);
      const activityIds = (row.activityIds || []) as mongoose.Types.ObjectId[];
      if (existing) {
        existing.activitiesTotal += Number(row.activitiesTotal || 0);
        existing.activitiesSampled += Number(row.activitiesSampled || 0);
        existing.activitiesNotSampled += Number(row.activitiesNotSampled || 0);
        existing.activitiesPartial += Number(row.activitiesPartial || 0);
        existing.farmersTotal += Number(row.farmersTotal || 0);
        existing.farmersSampled += Number(row.farmersSampled || 0);
        existing.activityIds.push(...activityIds);
      } else {
        mergedByState.set(stateKey, {
          _id: stateKey,
          activitiesTotal: Number(row.activitiesTotal || 0),
          activitiesSampled: Number(row.activitiesSampled || 0),
          activitiesNotSampled: Number(row.activitiesNotSampled || 0),
          activitiesPartial: Number(row.activitiesPartial || 0),
          farmersTotal: Number(row.farmersTotal || 0),
          farmersSampled: Number(row.farmersSampled || 0),
          activityIds: [...activityIds],
        });
      }
    }
    rowsToUse = Array.from(mergedByState.values());
  }

  // Task breakdown per group (by activityId -> group mapping)
  const idToGroup = new Map<string, string>();
  for (const row of rowsToUse) {
    const key = row._id != null ? String(row._id).trim() || '—' : '—';
    const activityIds = (row as any).activityIds || [];
    for (const id of activityIds) {
      idToGroup.set(String(id), key);
    }
  }

  const allActivityIds = Array.from(idToGroup.keys()).map((id) => new mongoose.Types.ObjectId(id));
  const tasks = await CallTask.find({ activityId: { $in: allActivityIds } })
    .select('activityId status')
    .lean();
  const taskByGroup = new Map<string, { total: number; byStatus: Record<string, number> }>();
  for (const t of tasks) {
    const activityIdStr = (t.activityId as any)?.toString?.() || String(t.activityId);
    const key = idToGroup.get(activityIdStr) ?? '—';
    if (!taskByGroup.has(key)) {
      taskByGroup.set(key, { total: 0, byStatus: {} });
    }
    const rec = taskByGroup.get(key)!;
    rec.total += 1;
    const st = (t.status as string) || 'unassigned';
    rec.byStatus[st] = (rec.byStatus[st] || 0) + 1;
  }

  const rows: EmsDrilldownRow[] = [];
  for (const row of rowsToUse) {
    const key = row._id != null ? String(row._id).trim() || '—' : '—';
    const label = key;
    const tasks = taskByGroup.get(key);
    const totalTasks = tasks?.total ?? 0;
    const completed = tasks?.byStatus?.completed ?? 0;
    const completionRatePct = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;

    rows.push({
      key,
      label,
      activitiesTotal: Number(row.activitiesTotal || 0),
      activitiesSampled: Number(row.activitiesSampled || 0),
      activitiesNotSampled: Number(row.activitiesNotSampled || 0),
      activitiesPartial: Number(row.activitiesPartial || 0),
      tasksTotal: totalTasks,
      tasksCompleted: completed,
      tasksInQueue: Number(tasks?.byStatus?.sampled_in_queue || 0) + Number(tasks?.byStatus?.unassigned || 0),
      tasksInProgress: Number(tasks?.byStatus?.in_progress || 0),
      farmersTotal: Number(row.farmersTotal || 0),
      farmersSampled: Number(row.farmersSampled || 0),
      completionRatePct,
    });
  }

  // Sort by activities total descending
  rows.sort((a, b) => b.activitiesTotal - a.activitiesTotal);
  return rows;
}

export interface EmsFilterOptions {
  stateOptions: string[];
  territoryOptions: string[];
  zoneOptions: string[];
  buOptions: string[];
  activityTypeOptions: string[];
}

/**
 * Distinct filter options for EMS dashboard (state, territory, zone, bu, activity type).
 * When a date range is set, uses task scheduledDate (same scope as EMS report / Task Allocation).
 */
export async function getEmsFilterOptions(filters?: EmsProgressFilters): Promise<EmsFilterOptions> {
  const cleanDistinct = (arr: unknown[]) =>
    (arr || [])
      .filter((v) => v != null && String(v).trim() !== '')
      .map((v) => String(v).trim())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  if (hasEmsDateFilter(filters)) {
    const activityCollection = Activity.collection.name;
    const pipeline: any[] = [
      { $match: buildEmsTaskBaseMatch(filters) },
      {
        $lookup: {
          from: activityCollection,
          localField: 'activityId',
          foreignField: '_id',
          as: 'activity',
        },
      },
      { $unwind: '$activity' },
    ];
    const activityMatchNoDate = buildActivityMatchWithoutDate(filters);
    const activityPipelineMatch = buildActivityPipelineMatch(activityMatchNoDate);
    if (Object.keys(activityPipelineMatch).length) pipeline.push({ $match: activityPipelineMatch });
    pipeline.push({
      $group: {
        _id: null,
        states: { $addToSet: '$activity.state' },
        territories: { $addToSet: { $ifNull: ['$activity.territoryName', '$activity.territory'] } },
        zones: { $addToSet: '$activity.zoneName' },
        bus: { $addToSet: '$activity.buName' },
        types: { $addToSet: '$activity.type' },
      },
    });

    const agg = await CallTask.aggregate(pipeline).exec();
    const row = agg[0] || {};
    return {
      stateOptions: cleanDistinct(row.states),
      territoryOptions: cleanDistinct(row.territories),
      zoneOptions: cleanDistinct(row.zones),
      buOptions: cleanDistinct(row.bus),
      activityTypeOptions: cleanDistinct(row.types),
    };
  }

  const baseMatch = buildActivityMatch(filters);

  const stateOpts = await Activity.distinct('state', baseMatch).then((arr) => arr.filter(Boolean).sort());
  const territoryOpts = await Activity.aggregate([
    { $match: baseMatch },
    { $project: { t: { $ifNull: ['$territoryName', '$territory'] } } },
    { $group: { _id: '$t' } },
    { $match: { _id: { $nin: [null, ''] } } },
    { $sort: { _id: 1 } },
  ]).then((arr) => arr.map((r: { _id: string }) => r._id));
  const zoneOpts = await Activity.distinct('zoneName', baseMatch).then((arr) => arr.filter(Boolean).sort());
  const buOpts = await Activity.distinct('buName', baseMatch).then((arr) => arr.filter(Boolean).sort());
  const typeOpts = await Activity.distinct('type', baseMatch).then((arr) => arr.filter(Boolean).sort());

  return {
    stateOptions: stateOpts,
    territoryOptions: territoryOpts,
    zoneOptions: zoneOpts,
    buOptions: buOpts,
    activityTypeOptions: typeOpts,
  };
}
