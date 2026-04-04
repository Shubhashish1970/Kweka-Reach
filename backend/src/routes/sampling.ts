import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { sampleAndCreateTasks } from '../services/samplingService.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import { Activity } from '../models/Activity.js';
import { Farmer } from '../models/Farmer.js';
import { SamplingConfig } from '../models/SamplingConfig.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingRun } from '../models/SamplingRun.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/** Compute auto date range for next first-sample run: (last run's dateTo inclusive) to today so late-arriving activities are not missed. If no previous first_sample run, returns null. */
const getFirstSampleAutoRange = async (userId: mongoose.Types.ObjectId): Promise<{ dateFrom: Date; dateTo: Date } | null> => {
  const lastFirst = await SamplingRun.findOne({
    createdByUserId: userId,
    runType: 'first_sample',
  })
    .sort({ startedAt: -1 })
    .select('filters')
    .lean();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (lastFirst?.filters?.dateTo) {
    const rangeStart = new Date(lastFirst.filters.dateTo);
    rangeStart.setHours(0, 0, 0, 0);
    return { dateFrom: rangeStart, dateTo: today };
  }
  return null; // no previous first-sample run → use suggested range
};

/** Fallback when no activities exist: last 30 days. */
const getFirstSampleSuggestedRangeFallback = (): { dateFrom: Date; dateTo: Date } => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dateFrom = new Date(today);
  dateFrom.setDate(dateFrom.getDate() - 30);
  dateFrom.setHours(0, 0, 0, 0);
  return { dateFrom, dateTo: today };
};

/** Suggested default range for the very first first-sample run: from earliest to latest activity date among eligible activities (firstSampleRun !== true, active), so all synced activities are included. */
const getFirstSampleSuggestedRange = async (): Promise<{ dateFrom: Date; dateTo: Date }> => {
  const agg = await Activity.aggregate([
    { $match: { firstSampleRun: { $ne: true }, lifecycleStatus: 'active' } },
    { $group: { _id: null, minDate: { $min: '$date' }, maxDate: { $max: '$date' } } },
  ]);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (agg.length && agg[0].minDate != null && agg[0].maxDate != null) {
    const dateFrom = new Date(agg[0].minDate);
    dateFrom.setHours(0, 0, 0, 0);
    const dateTo = new Date(agg[0].maxDate);
    dateTo.setHours(23, 59, 59, 999);
    return { dateFrom, dateTo };
  }
  return getFirstSampleSuggestedRangeFallback();
};

/** Single place for "later run" / first_sample activity query: active, never sampled, date in range, non-empty farmerIds. Change here when sampling logic changes. */
function buildFirstSampleRunQuery(rangeStart: Date, rangeEnd: Date, lifecycleStatus: string = 'active'): Record<string, unknown> {
  return {
    firstSampleRun: { $ne: true },
    lifecycleStatus: lifecycleStatus || 'active',
    date: { $gte: rangeStart, $lte: rangeEnd },
    farmerIds: { $exists: true, $ne: [] },
  };
}

/** Count of activities eligible for a later run (auto range). Returns { count, range } or { count: 0, range: null } if not a later run. */
async function getLaterRunEligibleCount(userId: mongoose.Types.ObjectId): Promise<{ count: number; range: { dateFrom: Date; dateTo: Date } | null }> {
  const autoRange = await getFirstSampleAutoRange(userId);
  if (!autoRange) return { count: 0, range: null };
  const q = buildFirstSampleRunQuery(autoRange.dateFrom, autoRange.dateTo);
  const count = await Activity.countDocuments(q);
  return { count, range: autoRange };
}

/** Group activities by FDA (officerId); allocate proportional target sample size per FDA. Every FDA gets at least 1 (mandatory representation). */
type FdaGroupDoc = { _id: mongoose.Types.ObjectId; officerId: string; officerName?: string; farmerIds?: unknown[] };
async function buildFdaGroups(
  docs: FdaGroupDoc[],
  samplingPercentage?: number | null
): Promise<{ officerId: string; officerName: string; activities: { id: string; farmerCount: number }[]; totalFarmers: number; target: number }[]> {
  const withFarmers = docs.filter((d) => d.farmerIds && Array.isArray(d.farmerIds) && d.farmerIds.length > 0);
  const byOfficer = new Map<string, { officerName: string; activities: { id: string; farmerCount: number }[]; totalFarmers: number }>();
  for (const d of withFarmers) {
    const count = (d.farmerIds as unknown[]).length;
    const oid = (d.officerId || 'unknown').trim() || 'unknown';
    const existing = byOfficer.get(oid);
    const entry = { id: d._id.toString(), farmerCount: count };
    if (!existing) {
      byOfficer.set(oid, {
        officerName: (d.officerName as string) || oid,
        activities: [entry],
        totalFarmers: count,
      });
    } else {
      existing.activities.push(entry);
      existing.totalFarmers += count;
    }
  }
  for (const g of byOfficer.values()) {
    g.activities.sort((a, b) => b.farmerCount - a.farmerCount);
  }
  const totalWeight = Array.from(byOfficer.values()).reduce((s, g) => s + g.totalFarmers, 0);
  if (totalWeight === 0) {
    return [];
  }
  let resolvedPct = samplingPercentage ?? 10;
  const config = await SamplingConfig.findOne({ key: 'default' }).select('defaultPercentage').lean();
  if (config && (samplingPercentage == null || samplingPercentage === undefined)) {
    resolvedPct = (config as any).defaultPercentage ?? 10;
  }
  const desiredTotal = Math.min(totalWeight, Math.max(1, Math.ceil((totalWeight * resolvedPct) / 100)));
  const out: { officerId: string; officerName: string; activities: { id: string; farmerCount: number }[]; totalFarmers: number; target: number }[] = [];
  for (const [officerId, g] of byOfficer.entries()) {
    const target = Math.max(1, Math.round((g.totalFarmers / totalWeight) * desiredTotal));
    out.push({
      officerId,
      officerName: g.officerName,
      activities: g.activities,
      totalFarmers: g.totalFarmers,
      target,
    });
  }
  return out;
}

// ============================================================================
// Sampling Control (Team Lead + MIS Admin)
// ============================================================================

// @route   GET /api/sampling/stats
// @desc    Sampling dashboard stats for a date range (counts by type + lifecycle + farmers sampled + tasks created)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/stats',
  requirePermission('config.sampling'),
  [
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { dateFrom, dateTo } = req.query as any;
      const match: any = {};
      if (dateFrom || dateTo) {
        match.date = {};
        if (dateFrom) match.date.$gte = new Date(dateFrom);
        if (dateTo) match.date.$lte = new Date(dateTo);
      }

      const auditCollection = SamplingAudit.collection.name;
      const taskCollection = CallTask.collection.name;
      const farmerCollection = Farmer.collection.name;

      /** Dedupe farmer ObjectIds on an activity, then resolve distinct mobile numbers (matches admin activities-sampling stats). */
      const farmerIdBasis = [
        { $addFields: { farmerIds: { $setUnion: [{ $ifNull: ['$farmerIds', []] }, []] } } },
        { $project: { type: 1, farmerIds: 1 } },
        { $unwind: { path: '$farmerIds', preserveNullAndEmptyArrays: false } },
        {
          $lookup: {
            from: farmerCollection,
            localField: 'farmerIds',
            foreignField: '_id',
            as: 'farmer',
            pipeline: [{ $project: { _id: 0, mobileNumber: 1 } }],
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: false } },
      ];

      const pipeline: any[] = [
        { $match: match },
        {
          $lookup: {
            from: auditCollection,
            localField: '_id',
            foreignField: 'activityId',
            as: 'audit',
          },
        },
        {
          $lookup: {
            from: taskCollection,
            localField: '_id',
            foreignField: 'activityId',
            as: 'tasks',
          },
        },
        {
          $addFields: {
            // Farmers sampled = distinct farmers with at least one CallTask (first-time + ad-hoc), not just latest audit
            sampledFarmers: {
              $size: {
                $ifNull: [
                  { $setUnion: { $map: { input: { $ifNull: ['$tasks', []] }, as: 't', in: '$$t.farmerId' } } },
                  [],
                ],
              },
            },
            tasksCreated: { $size: { $ifNull: ['$tasks', []] } },
            // Non-terminal tasks with no CC agent. $ifNull(assignedAgentId, sentinel) === sentinel covers both
            // missing field and BSON null; plain $eq to null inside $filter often misses absent fields.
            unassignedTasks: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$tasks', []] },
                  as: 't',
                  cond: {
                    $and: [
                      {
                        $not: {
                          $in: [
                            { $ifNull: ['$$t.status', 'unassigned'] },
                            ['completed', 'not_reachable', 'invalid_number'],
                          ],
                        },
                      },
                      {
                        $eq: [
                          { $ifNull: ['$$t.assignedAgentId', '__no_cc_agent__'] },
                          '__no_cc_agent__',
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: '$type',
            totalActivities: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'active'] }, 1, 0] } },
            sampled: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'sampled'] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'inactive'] }, 1, 0] } },
            notEligible: { $sum: { $cond: [{ $eq: ['$lifecycleStatus', 'not_eligible'] }, 1, 0] } },
            sampledFarmers: { $sum: '$sampledFarmers' },
            tasksCreated: { $sum: '$tasksCreated' },
            unassignedTasks: { $sum: '$unassignedTasks' },
          },
        },
        { $sort: { totalActivities: -1 } },
      ];

      const uniqueFarmersByTypePipeline: any[] = [
        { $match: match },
        ...farmerIdBasis,
        { $group: { _id: { type: '$type', mobile: '$farmer.mobileNumber' } } },
        { $group: { _id: '$_id.type', farmersTotal: { $sum: 1 } } },
      ];

      const uniqueFarmersGlobalPipeline: any[] = [
        { $match: match },
        ...farmerIdBasis,
        { $group: { _id: '$farmer.mobileNumber' } },
        { $count: 'count' },
      ];

      const configLean = await SamplingConfig.findOne({ key: 'default' }).select('eligibleActivityTypes').lean();
      const eligibleTypesArr = Array.isArray((configLean as { eligibleActivityTypes?: string[] })?.eligibleActivityTypes)
        ? (configLean as { eligibleActivityTypes: string[] }).eligibleActivityTypes.filter(
            (t) => typeof t === 'string' && t.length > 0
          )
        : [];
      const restrictsByEligibleTypes = eligibleTypesArr.length > 0;

      let activeButTypeNotInEligibleList = 0;
      if (restrictsByEligibleTypes) {
        activeButTypeNotInEligibleList = await Activity.countDocuments({
          ...match,
          lifecycleStatus: 'active',
          type: { $nin: eligibleTypesArr },
        });
      }

      const [byType, uniqueByTypeRows, uniqueGlobalRow] = await Promise.all([
        Activity.aggregate(pipeline),
        Activity.aggregate(uniqueFarmersByTypePipeline),
        Activity.aggregate(uniqueFarmersGlobalPipeline),
      ]);

      const farmersTotalByType = new Map<string, number>(
        uniqueByTypeRows.map((r: any) => [String(r._id ?? ''), Number(r.farmersTotal || 0)])
      );
      const globalUniqueFarmers = Number(uniqueGlobalRow?.[0]?.count ?? 0);

      const byTypeWithFarmers = byType.map((r: any) => ({
        ...r,
        farmersTotal: farmersTotalByType.get(String(r._id ?? '')) ?? 0,
      }));

      const totals = byTypeWithFarmers.reduce(
        (acc: any, row: any) => {
          acc.totalActivities += row.totalActivities || 0;
          acc.active += row.active || 0;
          acc.sampled += row.sampled || 0;
          acc.inactive += row.inactive || 0;
          acc.notEligible += row.notEligible || 0;
          acc.sampledFarmers += row.sampledFarmers || 0;
          acc.tasksCreated += row.tasksCreated || 0;
          acc.unassignedTasks += row.unassignedTasks || 0;
          return acc;
        },
        {
          totalActivities: 0,
          active: 0,
          sampled: 0,
          inactive: 0,
          notEligible: 0,
          farmersTotal: globalUniqueFarmers,
          sampledFarmers: 0,
          tasksCreated: 0,
          unassignedTasks: 0,
        }
      );

      res.json({
        success: true,
        data: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          totals,
          /** Explains why "Ineligible" lifecycle counts can be 0 (config vs DB lifecycle). */
          eligibility: {
            restrictsByEligibleTypes,
            eligibleActivityTypes: eligibleTypesArr,
            activeButTypeExcludedFromList: activeButTypeNotInEligibleList,
          },
          byType: byTypeWithFarmers.map((r: any) => ({
            type: r._id,
            totalActivities: r.totalActivities,
            active: r.active,
            sampled: r.sampled,
            inactive: r.inactive,
            notEligible: r.notEligible,
            farmersTotal: r.farmersTotal,
            sampledFarmers: r.sampledFarmers,
            tasksCreated: r.tasksCreated,
            unassignedTasks: r.unassignedTasks,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/sampling/activities
// @desc    List activities by lifecycle status (Sampling Control)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/activities',
  requirePermission('config.sampling'),
  [
    query('lifecycleStatus').optional().isIn(['active', 'sampled', 'inactive', 'not_eligible']),
    query('type').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { lifecycleStatus, type, dateFrom, dateTo, page = 1, limit = 20 } = req.query as any;
      const skip = (Number(page) - 1) * Number(limit);

      const q: any = {};
      if (lifecycleStatus) q.lifecycleStatus = lifecycleStatus;
      if (type) q.type = type;
      if (dateFrom || dateTo) {
        q.date = {};
        if (dateFrom) q.date.$gte = new Date(dateFrom);
        if (dateTo) q.date.$lte = new Date(dateTo);
      }

      const [activities, total] = await Promise.all([
        Activity.find(q)
          .select('activityId type date officerName tmName location territory territoryName state zoneName buName lifecycleStatus lifecycleUpdatedAt lastSamplingRunAt')
          .sort({ date: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        Activity.countDocuments(q),
      ]);

      res.json({
        success: true,
        data: {
          activities,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/sampling/config
// @desc    Get sampling configuration (Sampling Control)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/config',
  requirePermission('config.sampling'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await SamplingConfig.findOne({ key: 'default' }).lean();
      res.json({ success: true, data: { config } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/sampling/config
// @desc    Update sampling configuration (Sampling Control)
// @access  Private (Team Lead, MIS Admin)
router.put(
  '/config',
  requirePermission('config.sampling'),
  [
    body('activityCoolingDays').optional().isInt({ min: 0, max: 365 }),
    body('farmerCoolingDays').optional().isInt({ min: 0, max: 365 }),
    body('defaultPercentage').optional().isFloat({ min: 1, max: 100 }),
    body('activityTypePercentages').optional().isObject(),
    body('eligibleActivityTypes').optional().isArray(),
    body('autoRunEnabled').optional().isBoolean(),
    body('autoRunThreshold').optional().isInt({ min: 1, max: 100000 }),
    body('autoRunActivateFrom').optional({ checkFalsy: true }).isISO8601(),
    body('taskDueInDays').optional().isInt({ min: 0, max: 365 }),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const authUserId = (req as any).user?._id;
      const body = req.body as any;
      const update: any = {
        ...body,
        updatedByUserId: authUserId || null,
      };
      if (body.autoRunActivateFrom === '' || body.autoRunActivateFrom === null || body.autoRunActivateFrom === undefined) {
        update.autoRunActivateFrom = null;
      }

      const config = await SamplingConfig.findOneAndUpdate(
        { key: 'default' },
        { $set: update, $setOnInsert: { key: 'default', isActive: true } },
        { upsert: true, new: true }
      );

      res.json({ success: true, message: 'Sampling config updated', data: { config } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/sampling/apply-eligibility
// @desc    Apply eligibility rules: mark disabled activity types as not_eligible (does NOT auto-reactivate)
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/apply-eligibility',
  requirePermission('config.sampling'),
  [body('eligibleActivityTypes').isArray().withMessage('eligibleActivityTypes array is required')],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { eligibleActivityTypes } = req.body as { eligibleActivityTypes: string[] };
      const allTypes = ['Field Day', 'Group Meeting', 'Demo Visit', 'OFM', 'Other'];
      const eligibleSet = new Set(eligibleActivityTypes || []);
      // If eligibleActivityTypes is empty, treat as "all eligible" (consistent with config semantics)
      const enabledTypes =
        !eligibleActivityTypes || eligibleActivityTypes.length === 0 ? allTypes : Array.from(eligibleSet);
      const enabledSet = new Set(enabledTypes);
      const disabledTypes = allTypes.filter((t) => !enabledSet.has(t));

      // Persist config as well (source-of-truth)
      await SamplingConfig.findOneAndUpdate(
        { key: 'default' },
        { $set: { eligibleActivityTypes: eligibleActivityTypes || [] } },
        { upsert: true, new: true }
      );

      // 1) Mark activities of disabled types as not_eligible, but do not touch already-sampled activities.
      const toNotEligible = await Activity.updateMany(
        {
          type: { $in: disabledTypes },
          lifecycleStatus: { $ne: 'sampled' },
        },
        { $set: { lifecycleStatus: 'not_eligible', lifecycleUpdatedAt: new Date() } }
      );

      // 2) Re-enable: move not_eligible activities back to active for enabled types (again, do not touch sampled)
      // This makes eligibility toggles reversible via "Save & Apply".
      const toActive = await Activity.updateMany(
        {
          type: { $in: enabledTypes },
          lifecycleStatus: 'not_eligible',
        },
        { $set: { lifecycleStatus: 'active', lifecycleUpdatedAt: new Date() } }
      );

    res.json({
      success: true,
        message: 'Eligibility applied (disabled types moved to Not Eligible)',
      data: {
          disabledTypes,
          enabledTypes,
          movedToNotEligible: toNotEligible.modifiedCount,
          movedToActive: toActive.modifiedCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/sampling/reactivate-preview
// @desc    Preview counts for reactivation (matching activities, tasks with/without calls) for Confirm modal
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/reactivate-preview',
  requirePermission('config.sampling'),
  [
    query('fromStatus').optional().isIn(['inactive', 'not_eligible', 'sampled']),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { fromStatus, dateFrom, dateTo } = req.query as any;
      const filter: any = {};
      if (fromStatus) filter.lifecycleStatus = fromStatus;
      if (dateFrom || dateTo) {
        filter.date = {};
        if (dateFrom) filter.date.$gte = new Date(dateFrom);
        if (dateTo) filter.date.$lte = new Date(dateTo);
      }

      const activities = await Activity.find(filter).select('_id').lean();
      const activityIds = activities.map((a) => a._id);

      if (activityIds.length === 0) {
        return res.json({
          success: true,
          data: {
            matchingActivityCount: 0,
            totalTasks: 0,
            tasksWithCalls: 0,
            tasksWithoutCalls: 0,
          },
        });
      }

      const [totalTasks, tasksWithCalls] = await Promise.all([
        CallTask.countDocuments({ activityId: { $in: activityIds } }),
        CallTask.countDocuments({
          activityId: { $in: activityIds },
          callLog: { $exists: true, $ne: null },
        }),
      ]);

      res.json({
        success: true,
        data: {
          matchingActivityCount: activityIds.length,
          totalTasks,
          tasksWithCalls,
          tasksWithoutCalls: totalTasks - tasksWithCalls,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/sampling/reactivate
// @desc    Bulk reactivate activities (set to active) with confirmation; optionally clears existing tasks/audit
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/reactivate',
  requirePermission('config.sampling'),
  [
    body('confirm').isIn(['YES']).withMessage('Type YES to confirm'),
    body('activityIds').optional().isArray(),
    body('fromStatus').optional().isIn(['inactive', 'not_eligible', 'sampled']),
    body('dateFrom').optional().isISO8601(),
    body('dateTo').optional().isISO8601(),
    body('deleteExistingTasks').optional().isBoolean(),
    body('deleteExistingAudit').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { activityIds, fromStatus, dateFrom, dateTo, deleteExistingTasks, deleteExistingAudit } = req.body as any;
      const query: any = {};
      // Default: reactivate the current filtered lifecycle bucket
      if (fromStatus) query.lifecycleStatus = fromStatus;
      if (dateFrom || dateTo) {
        query.date = {};
        if (dateFrom) query.date.$gte = new Date(dateFrom);
        if (dateTo) query.date.$lte = new Date(dateTo);
      }

      // Prefer explicit IDs if provided; otherwise reactivate all matching filters
      if (activityIds && Array.isArray(activityIds) && activityIds.length > 0) {
        query._id = { $in: activityIds };
      }

      const activities = await Activity.find(query).select('_id').lean();
      const ids = activities.map((a) => a._id);

      if (ids.length === 0) {
        return res.json({
          success: true,
          message: 'No activities to reactivate',
          data: { count: 0, modifiedCount: 0 },
        });
      }

      if (deleteExistingTasks === true) {
        // Delete only tasks that have no call made (no callLog). Tasks with calls are kept.
        const taskResult = await CallTask.deleteMany({
          activityId: { $in: ids },
          $or: [{ callLog: null }, { callLog: { $exists: false } }],
        });
        logger.info('Reactivate: deleted tasks without calls', {
          deletedCount: taskResult.deletedCount,
          activityIds: ids.length,
        });
      }
      if (deleteExistingAudit === true) {
        const auditResult = await SamplingAudit.deleteMany({ activityId: { $in: ids } });
        logger.info('Reactivate: deleted existing sampling audits', {
          count: auditResult.deletedCount,
          activityIds: ids.length,
        });
      }

      const result = await Activity.updateMany(
        { _id: { $in: ids } },
        { $set: { lifecycleStatus: 'active', lifecycleUpdatedAt: new Date() } }
      );

      res.json({
        success: true,
        message: 'Activities reactivated to Active',
        data: { count: ids.length, modifiedCount: result.modifiedCount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/sampling/first-sample-range
// @desc    Get range for first-sample run: if previous first_sample run exists, auto range; else isFirstRun=true and suggested range for manual selection.
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/first-sample-range',
  requirePermission('config.sampling'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUserId = (req as any).user?._id;
      if (!authUserId) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
      const laterRun = await getLaterRunEligibleCount(authUserId);
      if (laterRun.range) {
        return res.json({
          success: true,
          data: {
            isFirstRun: false,
            dateFrom: laterRun.range.dateFrom.toISOString().split('T')[0],
            dateTo: laterRun.range.dateTo.toISOString().split('T')[0],
            matchedCount: laterRun.count,
          },
        });
      }
      const suggested = await getFirstSampleSuggestedRange();
      const qSuggested = buildFirstSampleRunQuery(suggested.dateFrom, suggested.dateTo);
      const matchedCount = await Activity.countDocuments(qSuggested);
      return res.json({
        success: true,
        data: {
          isFirstRun: true,
          dateFrom: suggested.dateFrom.toISOString().split('T')[0],
          dateTo: suggested.dateTo.toISOString().split('T')[0],
          matchedCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/sampling/auto-run
// @desc    Check config (enabled, activate-from date, threshold) and optionally run a later Run Sample. Used by cron/scheduler.
// @access  Private (Team Lead, MIS Admin) – call with scheduler service account
router.post(
  '/auto-run',
  requirePermission('config.sampling'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUserId = (req as any).user?._id;
      if (!authUserId) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
      const config = await SamplingConfig.findOne({ key: 'default' }).lean();
      const autoRunEnabled = (config as any)?.autoRunEnabled === true;
      const autoRunThreshold = Number((config as any)?.autoRunThreshold ?? 200);
      const autoRunActivateFrom = (config as any)?.autoRunActivateFrom ? new Date((config as any).autoRunActivateFrom) : null;

      if (!autoRunEnabled) {
        return res.json({ success: true, ran: false, reason: 'auto_run_disabled' });
      }
      if (autoRunActivateFrom) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activateStart = new Date(autoRunActivateFrom);
        activateStart.setHours(0, 0, 0, 0);
        if (today < activateStart) {
          return res.json({ success: true, ran: false, reason: 'before_activate_date', activateFrom: autoRunActivateFrom.toISOString().split('T')[0] });
        }
      }
      const { count, range } = await getLaterRunEligibleCount(authUserId);
      if (!range || count === 0) {
        return res.json({ success: true, ran: false, reason: 'first_run_or_no_eligible', unsampledCount: count });
      }
      if (count < autoRunThreshold) {
        return res.json({ success: true, ran: false, reason: 'below_threshold', unsampledCount: count, threshold: autoRunThreshold });
      }
      const alreadyRunning = await SamplingRun.findOne({
        createdByUserId: authUserId,
        runType: 'first_sample',
        status: 'running',
      }).lean();
      if (alreadyRunning) {
        return res.json({ success: true, ran: false, reason: 'run_already_in_progress' });
      }
      req.body = { runType: 'first_sample', trigger: 'scheduled' };
      return runSamplingHandler(req, res, next);
    } catch (error) {
      next(error);
    }
  }
);

const runSamplingRunValidators = [
  body('runType').optional().isIn(['first_sample', 'adhoc']),
  body('activityIds').optional().isArray(),
  body('lifecycleStatus').optional().isIn(['active', 'sampled', 'inactive', 'not_eligible']),
  body('dateFrom').optional().isISO8601(),
  body('dateTo').optional().isISO8601(),
  body('samplingPercentage').optional().isFloat({ min: 1, max: 100 }),
  body('forceRun').optional().isBoolean(),
  body('includeResults').optional().isBoolean(),
];

async function runSamplingHandler(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
  try {
    const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const authUserId = (req as any).user?._id?.toString();
      const authUserObjId = (req as any).user?._id;
      const { runType, activityIds, lifecycleStatus, dateFrom, dateTo, samplingPercentage, forceRun, includeResults } = req.body as any;

      const effectiveRunType = runType === 'first_sample' ? 'first_sample' : 'adhoc';
      const MAX_BULK = 5000;
      let matchedCount = 0;
      let resolvedDateFrom: string | null = null;
      let resolvedDateTo: string | null = null;

      let ids: string[] = [];

      type FdaGroup = { officerId: string; officerName: string; activities: { id: string; farmerCount: number }[]; totalFarmers: number; target: number };
      let fdaGroups: FdaGroup[] | null = null;

      if (Array.isArray(activityIds) && activityIds.length > 0) {
        ids = activityIds;
        matchedCount = activityIds.length;
      } else if (effectiveRunType === 'first_sample') {
        const autoRange = await getFirstSampleAutoRange(authUserObjId);
        let rangeStart: Date;
        let rangeEnd: Date;
        if (dateFrom && dateTo) {
          rangeStart = new Date(dateFrom);
          rangeEnd = new Date(dateTo);
        } else if (autoRange) {
          rangeStart = autoRange.dateFrom;
          rangeEnd = autoRange.dateTo;
        } else {
          const suggested = await getFirstSampleSuggestedRange();
          rangeStart = suggested.dateFrom;
          rangeEnd = suggested.dateTo;
        }
        resolvedDateFrom = rangeStart.toISOString().split('T')[0];
        resolvedDateTo = rangeEnd.toISOString().split('T')[0];
        const q: any = buildFirstSampleRunQuery(rangeStart, rangeEnd, lifecycleStatus || 'active');
        matchedCount = await Activity.countDocuments(q);
        const docs = await Activity.find(q)
          .select('_id officerId officerName farmerIds')
          .sort({ date: -1 })
          .limit(MAX_BULK)
          .lean();
        fdaGroups = await buildFdaGroups(docs, samplingPercentage);
        ids = docs.map((a) => (a as any)._id.toString());
      } else {
        if (!dateFrom || !dateTo) {
          return res.status(400).json({
            success: false,
            error: { message: 'Ad-hoc run requires dateFrom and dateTo' },
          });
        }
        resolvedDateFrom = dateFrom;
        resolvedDateTo = dateTo;
        const q: any = {
          date: { $gte: new Date(dateFrom), $lte: new Date(dateTo) },
          farmerIds: { $exists: true, $ne: [] },
        };
        if (lifecycleStatus) q.lifecycleStatus = lifecycleStatus;
        matchedCount = await Activity.countDocuments(q);
        const docs = await Activity.find(q)
          .select('_id officerId officerName farmerIds')
          .sort({ date: -1 })
          .limit(MAX_BULK)
          .lean();
        fdaGroups = await buildFdaGroups(docs, samplingPercentage);
        ids = docs.map((a) => (a as any)._id.toString());
      }

      if (matchedCount > MAX_BULK) {
        logger.warn('Sampling run truncated by safety cap', { matchedCount, processed: ids.length, MAX_BULK });
      }

      logger.info('Sampling run requested', { runType: effectiveRunType, requestedCount: ids.length, forceRun: !!forceRun, fdaCount: fdaGroups?.length ?? 0 });

      const samplingConfig = await SamplingConfig.findOne({ key: 'default' }).select('taskDueInDays').lean();
      const taskDueInDays = Math.max(0, Math.min(365, Number((samplingConfig as any)?.taskDueInDays ?? 0)));
      const baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
      const scheduledDate = new Date(baseDate);
      scheduledDate.setDate(baseDate.getDate() + taskDueInDays);

      const shouldIncludeResults = includeResults === true;
      const results: any[] = [];
      let tasksCreatedTotal = 0;
      let sampledActivities = 0;
      let inactiveActivities = 0;
      let skipped = 0;
      const errorsList: string[] = [];

      const runDoc = await SamplingRun.create({
        createdByUserId: authUserId ? new mongoose.Types.ObjectId(authUserId) : null,
        runType: effectiveRunType,
        status: 'running',
        startedAt: new Date(),
        filters: {
          lifecycleStatus: lifecycleStatus || 'active',
          dateFrom: resolvedDateFrom ? new Date(resolvedDateFrom) : null,
          dateTo: resolvedDateTo ? new Date(resolvedDateTo) : null,
          samplingPercentage: samplingPercentage ?? null,
          forceRun: !!forceRun,
        },
        matched: matchedCount,
        processed: 0,
        tasksCreatedTotal: 0,
        sampledActivities: 0,
        inactiveActivities: 0,
        skipped: 0,
        errorCount: 0,
        lastProgressAt: new Date(),
        errorMessages: [],
      });

      const runId = runDoc._id.toString();
      const setFirstSampleRun = effectiveRunType === 'first_sample';

      let processed = 0;

      const processOne = async (id: string, opts: { maxFarmersToSample?: number; minFarmersToSample?: number }) => {
        // Ad-hoc: do not delete existing tasks; sampleAndCreateTasks will exclude already-sampled farmers
        return sampleAndCreateTasks(id, samplingPercentage, {
          runByUserId: authUserId,
          forceRun: !!forceRun,
          scheduledDate,
          setFirstSampleRun,
          samplingRunId: runDoc._id,
          samplingRunType: effectiveRunType,
          ...opts,
        });
      };

      if (fdaGroups && fdaGroups.length > 0) {
        for (const group of fdaGroups) {
          let createdForFDA = 0;
          for (const act of group.activities) {
            try {
              const maxFarmers = Math.max(0, group.target - createdForFDA);
              const minFarmers = createdForFDA === 0 ? 1 : undefined;
              const r = await processOne(act.id, {
                maxFarmersToSample: maxFarmers > 0 ? maxFarmers : undefined,
                minFarmersToSample: minFarmers,
              });
              if (shouldIncludeResults) {
                results.push({ activityId: act.id, ...r });
              }
              tasksCreatedTotal += r.tasksCreated || 0;
              createdForFDA += r.tasksCreated || 0;
              if (r.skipped) skipped++;
              if (r.activityLifecycleStatus === 'sampled') sampledActivities++;
              if (r.activityLifecycleStatus === 'inactive') inactiveActivities++;
            } catch (e: any) {
              const msg = `Failed activity ${act.id}: ${e?.message || 'Unknown error'}`;
              errorsList.push(msg);
              logger.error(msg, e);
            } finally {
              processed++;
              if (processed % 5 === 0) {
                await SamplingRun.updateOne(
                  { _id: runDoc._id },
                  {
                    $set: {
                      processed,
                      tasksCreatedTotal,
                      sampledActivities,
                      inactiveActivities,
                      skipped,
                      errorCount: errorsList.length,
                      lastProgressAt: new Date(),
                      lastActivityId: act.id,
                      ...(errorsList.length ? { errorMessages: errorsList.slice(-50) } : {}),
                    },
                  }
                );
              }
            }
          }
        }
      } else {
        for (const id of ids) {
          try {
            const r = await processOne(id, {});
            if (shouldIncludeResults) {
              results.push({ activityId: id, ...r });
            }
            tasksCreatedTotal += r.tasksCreated || 0;
            if (r.skipped) skipped++;
            if (r.activityLifecycleStatus === 'sampled') sampledActivities++;
            if (r.activityLifecycleStatus === 'inactive') inactiveActivities++;
          } catch (e: any) {
            const msg = `Failed activity ${id}: ${e?.message || 'Unknown error'}`;
            errorsList.push(msg);
            logger.error(msg, e);
          } finally {
            processed++;
            if (processed % 5 === 0 || processed === ids.length) {
              await SamplingRun.updateOne(
                { _id: runDoc._id },
                {
                  $set: {
                    processed,
                    tasksCreatedTotal,
                    sampledActivities,
                    inactiveActivities,
                    skipped,
                    errorCount: errorsList.length,
                    lastProgressAt: new Date(),
                    lastActivityId: id,
                    ...(errorsList.length ? { errorMessages: errorsList.slice(-50) } : {}),
                  },
                }
              );
            }
          }
        }
      }

      const finalStatus = errorsList.length > 0 && processed === 0 ? 'failed' : 'completed';
      await SamplingRun.updateOne(
        { _id: runDoc._id },
        {
          $set: {
            status: finalStatus,
            finishedAt: new Date(),
            processed,
            tasksCreatedTotal,
            sampledActivities,
            inactiveActivities,
            skipped,
            errorCount: errorsList.length,
            lastProgressAt: new Date(),
            errorMessages: errorsList.slice(-50),
          },
        }
      );

      if ((req.body as any)?.trigger === 'scheduled') {
        await SamplingConfig.findOneAndUpdate(
          { key: 'default' },
          {
            $set: {
              lastAutoRunAt: new Date(),
              lastAutoRunRunId: runId,
              lastAutoRunMatched: matchedCount,
              lastAutoRunProcessed: processed,
              lastAutoRunTasksCreated: tasksCreatedTotal,
            },
          },
          { upsert: true }
        );
      }

      res.json({
        success: true,
        message: 'Sampling run completed',
        data: {
          runId,
          runType: effectiveRunType,
          dateFrom: resolvedDateFrom,
          dateTo: resolvedDateTo,
          matched: matchedCount,
          processed,
          sampledActivities,
          inactiveActivities,
          skipped,
          tasksCreatedTotal,
          errorCount: errorsList.length,
          errors: errorsList.slice(-10),
          ...(shouldIncludeResults ? { results } : {}),
        },
      });
  } catch (error) {
    next(error);
  }
}

// @route   GET /api/sampling/run-status/latest
// @desc    Latest sampling run status for the current user (for UI polling)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/run-status/latest',
  requirePermission('config.sampling'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUserId = (req as any).user?._id;
      const run = await SamplingRun.findOne({ createdByUserId: authUserId })
        .sort({ startedAt: -1 })
        .lean();
      res.json({ success: true, data: { run: run || null } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/sampling/audit
// @desc    Get sampling audit logs
// @access  Private (MIS Admin)
router.get(
  '/audit',
  requirePermission('config.sampling'),
  [
    query('activityId').optional().isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { activityId, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const query: any = {};
      if (activityId) {
        query.activityId = activityId;
      }

      const audits = await SamplingAudit.find(query)
        .populate('activityId', 'type date location territory')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await SamplingAudit.countDocuments(query);

      res.json({
        success: true,
        data: {
          audits,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/sampling/run
// @desc    Run sampling: first_sample (auto date range, firstSampleRun=false only) or adhoc (user date range, firstSampleRun=true only). Creates Unassigned tasks; sets Activity to Sampled/Inactive.
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/run',
  requirePermission('config.sampling'),
  runSamplingRunValidators,
  runSamplingHandler
);

export default router;


