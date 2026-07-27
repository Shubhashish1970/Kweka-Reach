import { Activity } from '../models/Activity.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import mongoose from 'mongoose';
import type { EmsProgressFilters } from './kpiService.js';
import { buildActivityMatch } from './kpiService.js';

/**
 * One row per task for Excel task-detail export.
 * Sections: 1) Activity details 2) Sampling details 3) Task details 4) Agent/Calling details 5) Final outcome and comments.
 */
export interface TaskDetailExportRow {
  // ---- 1. Activity details ----
  activityId: string;
  activityType: string;
  activityDate: string;
  officerName: string;       // MDO name
  officerId: string;         // MDO ID
  tmName: string;
  tmEmpCode: string;
  activityLocation: string;
  territory: string;
  territoryName: string;
  zoneName: string;
  buName: string;
  state: string;
  activityCrops: string;
  activityProducts: string;
  lifecycleStatus: string;
  activitySyncedAt: string;
  // ---- 2. Sampling details ----
  samplingPercentage: number;
  samplingTotalFarmers: number;
  samplingSampledCount: number;
  samplingAlgorithm: string;
  samplingCreatedAt: string;
  // ---- 3. Task details (task + farmer) ----
  taskId: string;
  farmerName: string;
  farmerMobile: string;
  farmerLocation: string;
  farmerPreferredLanguage: string;
  farmerTerritory: string;
  taskScheduledDate: string;
  taskStatus: string;
  taskOutcome: string;
  retryCount: number;
  isCallback: string;
  callbackNumber: number;
  taskCreatedAt: string;
  taskUpdatedAt: string;
  callStartedAt: string;
  // ---- 4. Agent / Calling details ----
  agentName: string;
  agentEmail: string;
  agentEmployeeId: string;
  callTimestamp: string;
  callStatus: string;
  callDurationSeconds: number;
  didAttend: string;
  didRecall: string;
  cropsDiscussed: string;
  productsDiscussed: string;
  hasPurchased: string;
  willingToPurchase: string;
  likelyPurchaseDate: string;
  nonPurchaseReason: string;
  purchasedProducts: string;
  // ---- 5. Final outcome and comments ----
  outcome: string;
  finalStatus: string;
  farmerComments: string;
  sentiment: string;
  lastStatusNote: string;    // last interaction history note if any
}

export interface ReportFilters extends EmsProgressFilters {
  bucket?: 'daily' | 'weekly' | 'monthly';
}

export interface DailyReportRow {
  date: string; // YYYY-MM-DD
  activitiesTotal: number;
  activitiesSampled: number;
  tasksTotal: number;
  tasksCompleted: number;
  farmersTotal: number;
  farmersSampled: number;
  completionRatePct: number;
}

/**
 * Daily aggregation for report: one row per day in range.
 */
export async function getDailyReport(filters?: ReportFilters): Promise<DailyReportRow[]> {
  const activityMatch = buildActivityMatch(filters);
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
        dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
      },
    },
    {
      $group: {
        _id: '$dateStr',
        activitiesTotal: { $sum: 1 },
        farmersTotal: { $sum: '$farmerCount' },
        farmersSampled: { $sum: '$sampledCount' },
        activityIds: { $push: '$_id' },
      },
    },
  ]).exec();

  if (activityAgg.length === 0) {
    return [];
  }

  const allActivityIds = activityAgg.flatMap((r: any) => r.activityIds || []).map((id: mongoose.Types.ObjectId) => id);
  const taskAgg = await CallTask.aggregate([
    { $match: { activityId: { $in: allActivityIds } } },
    {
      $lookup: {
        from: activityCollection,
        localField: 'activityId',
        foreignField: '_id',
        as: 'act',
      },
    },
    { $unwind: '$act' },
    {
      $addFields: {
        dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$act.date' } },
      },
    },
    {
      $group: {
        _id: { dateStr: '$dateStr', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]).exec();

  const byDate = new Map<string, { tasksTotal: number; tasksCompleted: number }>();
  for (const row of activityAgg) {
    byDate.set(row._id, {
      tasksTotal: 0,
      tasksCompleted: 0,
    });
  }
  for (const row of taskAgg) {
    const dateStr = row._id?.dateStr;
    if (!dateStr) continue;
    if (!byDate.has(dateStr)) byDate.set(dateStr, { tasksTotal: 0, tasksCompleted: 0 });
    const rec = byDate.get(dateStr)!;
    rec.tasksTotal += Number(row.count || 0);
    if (row._id?.status === 'completed') rec.tasksCompleted += Number(row.count || 0);
  }

  const rows: DailyReportRow[] = [];
  for (const row of activityAgg) {
    const dateStr = row._id;
    const taskRec = byDate.get(dateStr) || { tasksTotal: 0, tasksCompleted: 0 };
    const completionRatePct = taskRec.tasksTotal > 0 ? Math.round((taskRec.tasksCompleted / taskRec.tasksTotal) * 100) : 0;
    rows.push({
      date: dateStr,
      activitiesTotal: Number(row.activitiesTotal || 0),
      activitiesSampled: 0, // not computed per-day here for brevity; use summary for that
      tasksTotal: taskRec.tasksTotal,
      tasksCompleted: taskRec.tasksCompleted,
      farmersTotal: Number(row.farmersTotal || 0),
      farmersSampled: Number(row.farmersSampled || 0),
      completionRatePct,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export interface ReportSummaryRow {
  period: string; // e.g. "2026-01" or "2026-W03" or "2026-01-15"
  activitiesTotal: number;
  tasksTotal: number;
  tasksCompleted: number;
  farmersTotal: number;
  farmersSampled: number;
  completionRatePct: number;
}

/**
 * Weekly or monthly report: aggregate by week/month.
 */
export async function getPeriodReport(
  filters: ReportFilters | undefined,
  period: 'weekly' | 'monthly'
): Promise<ReportSummaryRow[]> {
  const activityMatch = buildActivityMatch(filters);
  const activityCollection = Activity.collection.name;
  const auditCollection = SamplingAudit.collection.name;
  const dateFormat = period === 'monthly' ? '%Y-%m' : '%Y-%U'; // ISO week

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
        periodStr: { $dateToString: { format: dateFormat, date: '$date' } },
      },
    },
    {
      $group: {
        _id: '$periodStr',
        activitiesTotal: { $sum: 1 },
        farmersTotal: { $sum: '$farmerCount' },
        farmersSampled: { $sum: '$sampledCount' },
        activityIds: { $push: '$_id' },
      },
    },
  ]).exec();

  if (activityAgg.length === 0) return [];

  const allActivityIds = activityAgg.flatMap((r: any) => r.activityIds || []).map((id: mongoose.Types.ObjectId) => id);
  const taskAgg = await CallTask.aggregate([
    { $match: { activityId: { $in: allActivityIds } } },
    {
      $lookup: {
        from: activityCollection,
        localField: 'activityId',
        foreignField: '_id',
        as: 'act',
      },
    },
    { $unwind: '$act' },
    {
      $addFields: {
        periodStr: { $dateToString: { format: dateFormat, date: '$act.date' } },
      },
    },
    {
      $group: {
        _id: { periodStr: '$periodStr', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]).exec();

  const byPeriod = new Map<string, { tasksTotal: number; tasksCompleted: number }>();
  for (const row of activityAgg) {
    byPeriod.set(row._id, { tasksTotal: 0, tasksCompleted: 0 });
  }
  for (const row of taskAgg) {
    const p = row._id?.periodStr;
    if (!p) continue;
    if (!byPeriod.has(p)) byPeriod.set(p, { tasksTotal: 0, tasksCompleted: 0 });
    const rec = byPeriod.get(p)!;
    rec.tasksTotal += Number(row.count || 0);
    if (row._id?.status === 'completed') rec.tasksCompleted += Number(row.count || 0);
  }

  const rows: ReportSummaryRow[] = activityAgg.map((row: any) => {
    const taskRec = byPeriod.get(row._id) || { tasksTotal: 0, tasksCompleted: 0 };
    const completionRatePct = taskRec.tasksTotal > 0 ? Math.round((taskRec.tasksCompleted / taskRec.tasksTotal) * 100) : 0;
    return {
      period: row._id,
      activitiesTotal: Number(row.activitiesTotal || 0),
      tasksTotal: taskRec.tasksTotal,
      tasksCompleted: taskRec.tasksCompleted,
      farmersTotal: Number(row.farmersTotal || 0),
      farmersSampled: Number(row.farmersSampled || 0),
      completionRatePct,
    };
  });
  rows.sort((a, b) => a.period.localeCompare(b.period));
  return rows;
}

const fmtDate = (d: Date | undefined | null): string => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * Task-level detail rows for Excel. Sections: Activity details, Sampling details,
 * Task details, Agent/Calling details, Final outcome and comments. No field omitted.
 */
export async function getTaskDetailExportRows(filters?: ReportFilters): Promise<TaskDetailExportRow[]> {
  const activityMatch = buildActivityMatch(filters);
  const activities = await Activity.find(activityMatch as any)
    .select('_id activityId type date officerId officerName tmName tmEmpCode location territory territoryName zoneName buName state crops products lifecycleStatus syncedAt')
    .lean();
  const activityIds = activities.map((a: any) => a._id);
  if (activityIds.length === 0) return [];

  const audits = await SamplingAudit.find({ activityId: { $in: activityIds } }).lean();
  const auditByActivity = new Map<string, any>();
  for (const a of audits as any[]) {
    auditByActivity.set(String(a.activityId), a);
  }

  const tasks = await CallTask.find({ activityId: { $in: activityIds } })
    .populate('farmerId', 'name mobileNumber preferredLanguage location territory')
    .populate('activityId', 'activityId type date officerId officerName tmName tmEmpCode location territory territoryName zoneName buName state crops products lifecycleStatus syncedAt')
    .populate('assignedAgentId', 'name email employeeId')
    .sort({ scheduledDate: -1, createdAt: -1 })
    .lean();

  const rows: TaskDetailExportRow[] = [];
  for (const t of tasks as any[]) {
    const act = t.activityId;
    const farmer = t.farmerId;
    const agent = t.assignedAgentId;
    const log = t.callLog || {};
    const audit = act ? auditByActivity.get(String(act._id)) : null;
    const hist = Array.isArray(t.interactionHistory) ? t.interactionHistory : [];
    const lastNote = hist.length > 0 ? (hist[hist.length - 1] as any)?.notes ?? '' : '';

    const crops = Array.isArray(act?.crops) ? act.crops.join(', ') : String(act?.crops ?? '');
    const products = Array.isArray(act?.products) ? act.products.join(', ') : String(act?.products ?? '');
    const cropsDiscussed = Array.isArray(log.cropsDiscussed) ? log.cropsDiscussed.join(', ') : String(log.cropsDiscussed ?? '');
    const productsDiscussed = Array.isArray(log.productsDiscussed) ? log.productsDiscussed.join(', ') : String(log.productsDiscussed ?? '');
    const purchasedProducts = Array.isArray(log.purchasedProducts)
      ? log.purchasedProducts.map((p: any) => `${p.product || ''} (${p.quantity || ''} ${p.unit || ''})`).filter(Boolean).join('; ')
      : '';

    rows.push({
      // 1. Activity details
      activityId: act?.activityId ?? '',
      activityType: act?.type ?? '',
      activityDate: fmtDate(act?.date),
      officerName: act?.officerName ?? '',
      officerId: act?.officerId ?? '',
      tmName: act?.tmName ?? '',
      tmEmpCode: act?.tmEmpCode ?? '',
      activityLocation: act?.location ?? '',
      territory: act?.territory ?? '',
      territoryName: act?.territoryName ?? '',
      zoneName: act?.zoneName ?? '',
      buName: act?.buName ?? '',
      state: act?.state ?? '',
      activityCrops: crops,
      activityProducts: products,
      lifecycleStatus: act?.lifecycleStatus ?? '',
      activitySyncedAt: fmtDate(act?.syncedAt),
      // 2. Sampling details
      samplingPercentage: audit?.samplingPercentage ?? 0,
      samplingTotalFarmers: audit?.totalFarmers ?? 0,
      samplingSampledCount: audit?.sampledCount ?? 0,
      samplingAlgorithm: audit?.algorithm ?? '',
      samplingCreatedAt: fmtDate(audit?.createdAt),
      // 3. Task details
      taskId: t._id?.toString() ?? '',
      farmerName: farmer?.name ?? '',
      farmerMobile: farmer?.mobileNumber ?? '',
      farmerLocation: farmer?.location ?? '',
      farmerPreferredLanguage: farmer?.preferredLanguage ?? '',
      farmerTerritory: farmer?.territory ?? '',
      taskScheduledDate: fmtDate(t.scheduledDate),
      taskStatus: t.status ?? '',
      taskOutcome: t.outcome ?? '',
      retryCount: t.retryCount ?? 0,
      isCallback: t.isCallback ? 'Yes' : 'No',
      callbackNumber: t.callbackNumber ?? 0,
      taskCreatedAt: fmtDate(t.createdAt),
      taskUpdatedAt: fmtDate(t.updatedAt),
      callStartedAt: fmtDate(t.callStartedAt),
      // 4. Agent / Calling details
      agentName: agent?.name ?? '',
      agentEmail: agent?.email ?? '',
      agentEmployeeId: agent?.employeeId ?? '',
      callTimestamp: fmtDate(log.timestamp),
      callStatus: log.callStatus ?? '',
      callDurationSeconds: log.callDurationSeconds ?? 0,
      didAttend: log.didAttend != null ? String(log.didAttend) : '',
      didRecall: log.didRecall != null ? String(log.didRecall) : '',
      cropsDiscussed,
      productsDiscussed,
      hasPurchased: log.hasPurchased != null ? String(log.hasPurchased) : '',
      willingToPurchase: log.willingToPurchase != null ? String(log.willingToPurchase) : '',
      likelyPurchaseDate: log.likelyPurchaseDate ?? '',
      nonPurchaseReason: log.nonPurchaseReason ?? '',
      purchasedProducts,
      // 5. Final outcome and comments
      outcome: t.outcome ?? '',
      finalStatus: t.outcome ?? t.status ?? '',
      farmerComments: log.farmerComments ?? '',
      sentiment: log.sentiment ?? '',
      lastStatusNote: lastNote,
    });
  }
  return rows;
}
