import { Activity, IActivity } from '../models/Activity.js';
import { CallTask, TaskStatus } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import { User } from '../models/User.js';
import { Farmer } from '../models/Farmer.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import * as XLSX from 'xlsx';
import { QUEUE_CALL_SORT } from './taskService.js';

const AGENT_QUEUE_EXPORT_MAX = 5000;

const TASK_STATUS_LABELS: Record<string, string> = {
  unassigned: 'Unassigned',
  sampled_in_queue: 'Sampled - in queue',
  in_progress: 'In Progress',
  completed: 'Completed',
  not_reachable: 'Not Reachable',
  invalid_number: 'Invalid Number',
};

export interface ActivitySamplingStatus {
  activity: IActivity;
  samplingStatus: 'sampled' | 'not_sampled' | 'partial';
  samplingAudit?: {
    samplingPercentage: number;
    totalFarmers: number;
    sampledCount: number;
    createdAt: Date;
  };
  tasksCount: number;
  assignedAgents: Array<{
    agentId: string;
    agentName: string;
    agentEmail: string;
    tasksCount: number;
  }>;
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
  };
  farmers: Array<{
    farmerId: string;
    name: string;
    mobileNumber: string;
    preferredLanguage: string;
    location: string;
    photoUrl?: string;
    isSampled: boolean;
    taskId?: string;
    assignedAgentId?: string;
    assignedAgentName?: string;
    taskStatus?: TaskStatus;
  }>;
}

export interface AgentQueueSummary {
  agentId: string;
  agentName: string;
  agentEmail: string;
  employeeId: string;
  agentKind: 'human' | 'virtual';
  languageCapabilities: string[];
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    total: number;
  };
}

export interface AgentQueueDetail {
  agent: {
    agentId: string;
    agentName: string;
    agentEmail: string;
    employeeId: string;
    agentKind: 'human' | 'virtual';
    languageCapabilities: string[];
  };
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    total: number;
  };
  tasks: Array<{
    taskId: string;
    farmer: {
      name: string;
      mobileNumber: string;
      preferredLanguage: string;
      location: string;
    };
    activity: {
      type: string;
      date: Date;
      officerName: string;
      territory: string;
      zone?: string;
      bu?: string;
      crops?: string[];
      products?: string[];
    };
    status: TaskStatus;
    outcome?: string | null;
    sentiment?: string | null;
    scheduledDate: Date;
    createdAt: Date;
  }>;
}

type ActivitySamplingQueryFilters = {
  activityType?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  dateFrom?: Date;
  dateTo?: Date;
};

function buildActivitySamplingMatch(filters: ActivitySamplingQueryFilters = {}): Record<string, unknown> {
  const { activityType, territory, zone, bu, dateFrom, dateTo } = filters;
  const activityQuery: Record<string, unknown> = {};
  if (activityType) activityQuery.type = activityType;
  if (territory) {
    activityQuery.$or = [{ territoryName: territory }, { territory: territory }];
  }
  if (zone) activityQuery.zoneName = zone;
  if (bu) activityQuery.buName = bu;
  if (dateFrom || dateTo) {
    const date: Record<string, Date> = {};
    if (dateFrom) date.$gte = dateFrom;
    if (dateTo) date.$lte = dateTo;
    activityQuery.date = date;
  }
  return activityQuery;
}

/**
 * Resolve page (or export) activity ids sorted by date desc.
 * When samplingStatus is unset, sort+paginate first so Mongo can use the date index
 * and never sorts lookup-bloated documents (prod 32MB sort limit).
 * When samplingStatus is set, project to {_id, date} before sort and allow disk use.
 */
async function resolveActivitySamplingIds(opts: {
  activityQuery: Record<string, unknown>;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  skip: number;
  limit: number;
}): Promise<{ total: number; ids: mongoose.Types.ObjectId[] }> {
  const { activityQuery, samplingStatus, skip, limit } = opts;

  if (!samplingStatus) {
    const [total, docs] = await Promise.all([
      Activity.countDocuments(activityQuery),
      Activity.find(activityQuery).sort({ date: -1 }).skip(skip).limit(limit).select('_id').lean(),
    ]);
    return { total, ids: docs.map((d) => d._id as mongoose.Types.ObjectId) };
  }

  const listPipeline: any[] = [
    { $match: activityQuery },
    {
      $lookup: {
        from: SamplingAudit.collection.name,
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
    { $project: { _id: 1, date: 1 } },
    { $sort: { date: -1 } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        page: [{ $skip: skip }, { $limit: limit }, { $project: { _id: 1 } }],
      },
    },
  ];

  const [facetResult] = await Activity.aggregate(listPipeline).allowDiskUse(true);
  const total = (facetResult?.total?.[0] as { count: number } | undefined)?.count ?? 0;
  const ids: mongoose.Types.ObjectId[] = (facetResult?.page ?? []).map(
    (d: { _id: mongoose.Types.ObjectId }) => d._id
  );
  return { total, ids };
}

/**
 * Get all activities with sampling status and assigned agents
 * Returns activities with their sampling audit info, task counts, and assigned agents
 */
export const getActivitiesWithSampling = async (filters?: {
  activityType?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}): Promise<{
  activities: ActivitySamplingStatus[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}> => {
  try {
    const {
      activityType,
      territory,
      zone,
      bu,
      samplingStatus,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = filters || {};

    const skip = (page - 1) * limit;

    const activityQuery = buildActivitySamplingMatch({
      activityType,
      territory,
      zone,
      bu,
      dateFrom,
      dateTo,
    });
    const { total: totalActivities, ids: pageIds } = await resolveActivitySamplingIds({
      activityQuery,
      samplingStatus,
      skip,
      limit,
    });

    const activities = await Activity.find({ _id: { $in: pageIds } })
      .sort({ date: -1 })
      .lean();
    const activitiesOrdered = pageIds
      .map((id) => activities.find((a) => (a._id as mongoose.Types.ObjectId).equals(id)))
      .filter((a): a is NonNullable<typeof a> => a != null);

    const activityIds = activitiesOrdered.map((a) => a._id);

    // Get all sampling audits for these activities
    const samplingAudits = await SamplingAudit.find({
      activityId: { $in: activityIds },
    });

    // Create a map of activityId -> sampling audit
    const auditMap = new Map(
      samplingAudits.map((audit) => [audit.activityId.toString(), audit])
    );

    // Get all tasks for these activities (with indexes for performance)
    const tasks = await CallTask.find({
      activityId: { $in: activityIds },
    })
      .populate('assignedAgentId', 'name email employeeId')
      .populate('farmerId', 'name mobileNumber preferredLanguage location photoUrl')
      .lean(); // Use lean() for better performance with large datasets

    // Group tasks by activityId and create farmer-to-task mapping
    const tasksByActivity = new Map<string, typeof tasks>();
    // Create a map of activityId -> Map<farmerId -> task info> for quick lookup
    const farmerTaskMapByActivity = new Map<string, Map<string, {
      taskId: string;
      assignedAgentId: string;
      assignedAgentName: string;
      taskStatus: TaskStatus;
    }>>();

    for (const task of tasks) {
      const activityId = (task.activityId as any)?._id?.toString() || (task.activityId as any)?.toString();
      if (!activityId) continue;

      if (!tasksByActivity.has(activityId)) {
        tasksByActivity.set(activityId, []);
      }
      tasksByActivity.get(activityId)!.push(task);

      // Initialize farmer task map for this activity if needed
      if (!farmerTaskMapByActivity.has(activityId)) {
        farmerTaskMapByActivity.set(activityId, new Map());
      }

      // Map farmer to task for quick lookup
      const farmerId = (task.farmerId as any)?._id?.toString() || (task.farmerId as any)?.toString();
      if (farmerId) {
        const agent = task.assignedAgentId as any;
        const activityFarmerMap = farmerTaskMapByActivity.get(activityId)!;
        activityFarmerMap.set(farmerId, {
          taskId: task._id.toString(),
          assignedAgentId: agent?._id?.toString() || agent?.toString() || '',
          assignedAgentName: agent?.name || 'Unknown',
          taskStatus: task.status,
        });
      }
    }

    // Collect all farmer IDs across all activities for batch fetching
    const allFarmerIds = new Set<string>();
    for (const activity of activitiesOrdered) {
      if (activity.farmerIds && Array.isArray(activity.farmerIds)) {
        for (const farmerId of activity.farmerIds) {
          // Handle different formats: ObjectId, populated object, or string
          let farmerIdStr: string | null = null;
          if (mongoose.Types.ObjectId.isValid(farmerId)) {
            if (typeof farmerId === 'string') {
              farmerIdStr = farmerId;
            } else if (farmerId instanceof mongoose.Types.ObjectId) {
              farmerIdStr = farmerId.toString();
            } else if ((farmerId as any)?._id) {
              farmerIdStr = (farmerId as any)._id.toString();
            } else if ((farmerId as any)?.toString) {
              farmerIdStr = (farmerId as any).toString();
            }
          }
          if (farmerIdStr && mongoose.Types.ObjectId.isValid(farmerIdStr)) {
            allFarmerIds.add(farmerIdStr);
          }
        }
      }
    }
    
    logger.info(`Collected ${allFarmerIds.size} unique farmer IDs from ${activitiesOrdered.length} activities`);
    
    // Log sample of farmer IDs for debugging
    if (allFarmerIds.size === 0 && activitiesOrdered.length > 0) {
      logger.warn('No farmer IDs found in activities. Sample activity:', {
        activityId: activitiesOrdered[0]._id,
        farmerIds: activitiesOrdered[0].farmerIds,
        farmerIdsType: Array.isArray(activitiesOrdered[0].farmerIds) ? 'array' : typeof activitiesOrdered[0].farmerIds,
        farmerIdsLength: Array.isArray(activitiesOrdered[0].farmerIds) ? activitiesOrdered[0].farmerIds.length : 'N/A',
      });
    }

    // Batch fetch all farmers for all activities (optimized for large datasets)
    const farmersMap = new Map<string, any>();
    if (allFarmerIds.size > 0) {
      const farmers = await Farmer.find({
        _id: { $in: Array.from(allFarmerIds).map(id => new mongoose.Types.ObjectId(id)) },
      })
        .select('name mobileNumber preferredLanguage location photoUrl')
        .lean();

      for (const farmer of farmers) {
        farmersMap.set(farmer._id.toString(), farmer);
      }
      
      logger.info(`Fetched ${farmers.length} farmer documents out of ${allFarmerIds.size} requested`);
      
      if (farmers.length < allFarmerIds.size) {
        const missingCount = allFarmerIds.size - farmers.length;
        logger.warn(`${missingCount} farmer documents not found in database - will include with minimal data`);
      }
    }

    // Build result array (activitiesOrdered already filtered by samplingStatus in aggregation)
    const result: ActivitySamplingStatus[] = [];

    for (const activity of activitiesOrdered) {
      const activityId = (activity._id as mongoose.Types.ObjectId).toString();
      const audit = auditMap.get(activityId);
      const activityTasks = tasksByActivity.get(activityId) || [];

      // Determine sampling status: full = at least one farmer selected; partial = no farmers selected (but had sampling run)
      let status: 'sampled' | 'not_sampled' | 'partial' = 'not_sampled';
      if (audit) {
        status = (audit.sampledCount ?? 0) > 0 ? 'sampled' : 'partial';
      }

      // Calculate status breakdown
      const statusBreakdown = {
        unassigned: 0,
        sampled_in_queue: 0,
        in_progress: 0,
        completed: 0,
        not_reachable: 0,
        invalid_number: 0,
      };

      // Group tasks by agent
      const agentMap = new Map<
        string,
        { agentId: string; agentName: string; agentEmail: string; tasksCount: number }
      >();

      for (const task of activityTasks) {
        // Update status breakdown - ensure all tasks are counted
        const taskStatus = task.status || 'unassigned'; // Default to unassigned if missing
        const statusKey = taskStatus;
        
        if (statusBreakdown.hasOwnProperty(statusKey)) {
          statusBreakdown[statusKey as keyof typeof statusBreakdown]++;
        } else {
          // If status is not in breakdown, log warning and count as unassigned
          logger.warn(`Task ${task._id} has unknown status: ${taskStatus}, counting as unassigned`);
          statusBreakdown.unassigned++;
        }

        // Group by agent
        const agent = task.assignedAgentId as any;
        if (agent && (agent._id || agent)) {
          const agentId = agent._id?.toString() || agent.toString();
          if (!agentMap.has(agentId)) {
            agentMap.set(agentId, {
              agentId,
              agentName: agent.name || 'Unknown',
              agentEmail: agent.email || 'Unknown',
              tasksCount: 0,
            });
          }
          agentMap.get(agentId)!.tasksCount++;
        }
      }

      // Build farmers list for this activity with sampling status
      const farmersList: Array<{
        farmerId: string;
        name: string;
        mobileNumber: string;
        preferredLanguage: string;
        location: string;
        photoUrl?: string;
        isSampled: boolean;
        taskId?: string;
        assignedAgentId?: string;
        assignedAgentName?: string;
        taskStatus?: TaskStatus;
      }> = [];

      // Get farmer task map for this activity
      const activityFarmerMap = farmerTaskMapByActivity.get(activityId) || new Map();

      if (activity.farmerIds && Array.isArray(activity.farmerIds) && activity.farmerIds.length > 0) {
        logger.debug(`Processing ${activity.farmerIds.length} farmer IDs for activity ${activityId}`);
        
        for (const farmerRef of activity.farmerIds) {
          // Extract farmer ID from reference - handle different formats
          let farmerId: string | null = null;
          
          // Try different methods to extract farmer ID
          if (typeof farmerRef === 'string' && mongoose.Types.ObjectId.isValid(farmerRef)) {
            farmerId = farmerRef;
          } else if (farmerRef instanceof mongoose.Types.ObjectId) {
            farmerId = farmerRef.toString();
          } else if ((farmerRef as any)?._id) {
            // Populated farmer object
            const id = (farmerRef as any)._id;
            farmerId = id instanceof mongoose.Types.ObjectId ? id.toString() : String(id);
          } else if ((farmerRef as any)?.toString && mongoose.Types.ObjectId.isValid((farmerRef as any).toString())) {
            farmerId = (farmerRef as any).toString();
          } else if (mongoose.Types.ObjectId.isValid(farmerRef)) {
            // Try to convert directly
            try {
              const objId = new mongoose.Types.ObjectId(farmerRef);
              farmerId = objId.toString();
            } catch (e) {
              logger.warn(`Could not convert farmer ID in activity ${activityId}:`, farmerRef);
            }
          }
          
          if (!farmerId || !mongoose.Types.ObjectId.isValid(farmerId)) {
            logger.warn(`Invalid farmer ID in activity ${activityId}:`, {
              farmerRef,
              type: typeof farmerRef,
              isObjectId: farmerRef instanceof mongoose.Types.ObjectId,
            });
            continue;
          }

          // Get farmer data from batch-fetched map
          const farmerData = farmersMap.get(farmerId);
          
          // Get task info if this farmer was sampled
          const farmerTask = activityFarmerMap.get(farmerId);

          // Always include farmer in list, even if document doesn't exist
          // This ensures all farmers in the activity are visible
          farmersList.push({
            farmerId: farmerId,
            name: farmerData?.name || 'Unknown Farmer',
            mobileNumber: farmerData?.mobileNumber || 'Unknown',
            preferredLanguage: farmerData?.preferredLanguage || 'Unknown',
            location: farmerData?.location || 'Unknown',
            photoUrl: farmerData?.photoUrl,
            isSampled: !!farmerTask,
            taskId: farmerTask?.taskId,
            assignedAgentId: farmerTask?.assignedAgentId,
            assignedAgentName: farmerTask?.assignedAgentName,
            taskStatus: farmerTask?.taskStatus,
          });
          
          // Log warning if farmer data not found
          if (!farmerData) {
            logger.debug(`Farmer document not found for ID: ${farmerId} in activity ${activityId} - including with minimal data`);
          }
        }
      } else {
        logger.warn(`Activity ${activityId} has no farmerIds or empty array. Activity data:`, {
          hasFarmerIds: !!activity.farmerIds,
          farmerIdsType: typeof activity.farmerIds,
          farmerIdsIsArray: Array.isArray(activity.farmerIds),
          farmerIdsLength: Array.isArray(activity.farmerIds) ? activity.farmerIds.length : 'N/A',
        });
      }
      
      logger.info(`Activity ${activityId}: ${farmersList.length} farmers processed (activity has ${activity.farmerIds?.length || 0} farmer IDs)`);
      
      // Activity may be a Mongoose document (.toObject()) or a lean plain object (no toObject)
      const activityObj =
        typeof (activity as any).toObject === 'function'
          ? (activity as any).toObject()
          : { ...activity };

      // Ensure farmerIds is always an array in the response (even if empty)
      if (!activityObj.farmerIds || !Array.isArray(activityObj.farmerIds)) {
        activityObj.farmerIds = [];
        logger.warn(`Activity ${activityId}: farmerIds was not an array, setting to empty array`);
      }
      
      // Ensure farmers array is always included (even if empty)
      // This helps frontend debug and display proper messages
      const farmersArray = farmersList || [];
      
      logger.debug(`Activity ${activityId} response: ${farmersArray.length} farmers in array, ${activityObj.farmerIds?.length || 0} farmerIds in activity`);

      // Ensure farmers array is always present and is an array
      const finalFarmersArray = Array.isArray(farmersArray) ? farmersArray : [];
      
      result.push({
        activity: activityObj,
        samplingStatus: status,
        samplingAudit: audit
          ? {
              samplingPercentage: audit.samplingPercentage,
              totalFarmers: audit.totalFarmers,
              sampledCount: audit.sampledCount,
              createdAt: audit.createdAt,
            }
          : undefined,
        tasksCount: activityTasks.length,
        assignedAgents: Array.from(agentMap.values()),
        statusBreakdown,
        farmers: finalFarmersArray, // Always include farmers array (may be empty)
      });
      
      logger.debug(`Activity ${activityId} final response: ${finalFarmersArray.length} farmers in array`);
    }

    return {
      activities: result,
      pagination: {
        page,
        limit,
        total: totalActivities,
        pages: Math.ceil(totalActivities / limit),
      },
    };
  } catch (error) {
    logger.error('Error fetching activities with sampling:', error);
    throw error;
  }
};

export type ActivitySamplingExportRow = {
  activityId: string;
  type: string;
  date: Date;
  territory: string;
  zone: string;
  state: string;
  region: string;
  bu: string;
  officerName: string;
  totalFarmers: number;
  farmersSampled: number;
  samplingPercentage: number;
  samplingStatus: 'sampled' | 'not_sampled' | 'partial';
  tasksTotal: number;
  sampledInQueue: number;
  inProgress: number;
  completed: number;
  notReachable: number;
  invalidNumber: number;
  unassigned: number;
};

export const getActivitiesSamplingExportRows = async (filters?: {
  activityType?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number; // safety cap
}): Promise<ActivitySamplingExportRow[]> => {
  const {
    activityType,
    territory,
    zone,
    bu,
    samplingStatus,
    dateFrom,
    dateTo,
    limit = 5000,
  } = filters || {};

  const safeLimit = Math.min(Math.max(1, limit), 5000);

  const activityQuery = buildActivitySamplingMatch({
    activityType,
    territory,
    zone,
    bu,
    dateFrom,
    dateTo,
  });
  const { ids: activityIds } = await resolveActivitySamplingIds({
    activityQuery,
    samplingStatus,
    skip: 0,
    limit: safeLimit,
  });

  if (activityIds.length === 0) {
    return [];
  }

  const activities = await Activity.find({ _id: { $in: activityIds } })
    .sort({ date: -1 })
    .lean();
  const activitiesOrdered = activityIds
    .map((id) => activities.find((a) => (a._id as mongoose.Types.ObjectId).equals(id)))
    .filter((a): a is NonNullable<typeof a> => a != null);

  const samplingAudits = await SamplingAudit.find({ activityId: { $in: activityIds } }).lean();
  const auditMap = new Map<string, any>(samplingAudits.map((a: any) => [String(a.activityId), a]));

  // Tasks breakdown by status per activity (same activity set as list/stats)
  const taskAgg = await CallTask.aggregate([
    { $match: { activityId: { $in: activityIds } } },
    {
      $group: {
        _id: { activityId: '$activityId', status: '$status' },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.activityId',
        counts: { $push: { k: '$_id.status', v: '$count' } },
        total: { $sum: '$count' },
      },
    },
  ]);

  const taskMap = new Map<string, { total: number; byStatus: Record<string, number> }>();
  for (const row of taskAgg) {
    const byStatus: Record<string, number> = {};
    for (const kv of row.counts || []) {
      if (kv?.k) byStatus[String(kv.k)] = Number(kv.v || 0);
    }
    taskMap.set(String(row._id), { total: Number(row.total || 0), byStatus });
  }

  const out: ActivitySamplingExportRow[] = [];

  for (const a of activitiesOrdered as any[]) {
    const totalFarmers = Array.isArray(a.farmerIds) ? a.farmerIds.length : 0;
    const audit = auditMap.get(String(a._id));
    const farmersSampled = audit?.sampledCount ? Number(audit.sampledCount) : 0;
    const samplingPercentage = audit?.samplingPercentage ? Number(audit.samplingPercentage) : 0;

    let computedSamplingStatus: 'sampled' | 'not_sampled' | 'partial' = 'not_sampled';
    if (audit) {
      computedSamplingStatus = farmersSampled > 0 ? 'sampled' : 'partial';
    }

    const t = taskMap.get(String(a._id));
    const by = t?.byStatus || {};
    const row: ActivitySamplingExportRow = {
      activityId: String(a.activityId || ''),
      type: String(a.type || ''),
      date: a.date ? new Date(a.date) : new Date(0),
      territory: String((a.territoryName || a.territory || '')).trim(),
      zone: String((a.zoneName || '')).trim(),
      state: String((a.state || '')).trim(),
      region: String((a as any).regionName || '').trim(),
      bu: String((a.buName || '')).trim(),
      officerName: String((a.officerName || '')).trim(),
      totalFarmers,
      farmersSampled,
      samplingPercentage,
      samplingStatus: computedSamplingStatus,
      tasksTotal: Number(t?.total || 0),
      sampledInQueue: Number(by.sampled_in_queue || 0),
      inProgress: Number(by.in_progress || 0),
      completed: Number(by.completed || 0),
      notReachable: Number(by.not_reachable || 0),
      invalidNumber: Number(by.invalid_number || 0),
      unassigned: Number(by.unassigned || 0),
    };

    out.push(row);
  }

  return out;
};

export const getActivitiesSamplingStats = async (filters?: {
  activityType?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<{
  totalActivities: number;
  activitiesWithSampling: number;
  activitiesFullySampled: number;
  activitiesPartiallySampled: number;
  activitiesNotSampled: number;
  /** Unique farmers by mobileNumber across matched activities */
  totalFarmers: number;
  /** Legacy: sum of farmerIds per activity (counts duplicates across activities) */
  totalFarmerLinks: number;
  farmersSampled: number;
  totalTasks: number;
  tasksSampledInQueue: number;
  tasksInProgress: number;
  tasksCompleted: number;
  tasksNotReachable: number;
  tasksInvalidNumber: number;
  tasksUnassigned: number;
  callbackTasks: number;
  activitiesWithSamplingAdhoc: number;
  farmersSampledAdhoc: number;
  tasksAdhoc: number;
}> => {
  const {
    activityType,
    territory,
    zone,
    bu,
    samplingStatus,
    dateFrom,
    dateTo,
  } = filters || {};

  const activityQuery = buildActivitySamplingMatch({
    activityType,
    territory,
    zone,
    bu,
    dateFrom,
    dateTo,
  });

  const samplingAuditCollection = SamplingAudit.collection.name;
  const farmerCollection = Farmer.collection.name;

  const activityAggPipeline: any[] = [
    { $match: activityQuery },
    {
      $addFields: {
        farmerCount: { $size: { $ifNull: ['$farmerIds', []] } },
      },
    },
    {
      $lookup: {
        from: samplingAuditCollection,
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
    ...(samplingStatus ? [{ $match: { samplingStatus } }] : []),
    {
      $facet: {
        stats: [
          {
            $group: {
              _id: null,
              totalActivities: { $sum: 1 },
              totalFarmers: { $sum: '$farmerCount' },
              farmersSampled: { $sum: '$sampledCount' },
              activitiesWithSampling: { $sum: { $cond: [{ $in: ['$samplingStatus', ['sampled', 'partial']] }, 1, 0] } },
              activitiesFullySampled: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'sampled'] }, 1, 0] } },
              activitiesPartiallySampled: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'partial'] }, 1, 0] } },
              activitiesNotSampled: { $sum: { $cond: [{ $eq: ['$samplingStatus', 'not_sampled'] }, 1, 0] } },
              activitiesWithSamplingAdhoc: { $sum: { $cond: [{ $and: [{ $eq: ['$samplingStatus', 'sampled'] }, { $ne: ['$firstSampleRun', true] }] }, 1, 0] } },
              farmersSampledAdhoc: { $sum: { $cond: [{ $and: [{ $eq: ['$samplingStatus', 'sampled'] }, { $ne: ['$firstSampleRun', true] }] }, '$sampledCount', 0] } },
            },
          },
        ],
        uniqueFarmers: [
          { $project: { farmerIds: 1 } },
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
          { $group: { _id: '$farmer.mobileNumber' } },
          { $count: 'count' },
        ],
        ids: [{ $project: { _id: 1 } }],
      },
    },
  ];

  const activityAggResult = await Activity.aggregate(activityAggPipeline);
  const facetRow = activityAggResult?.[0];
  const a0 = (facetRow?.stats?.[0] as Record<string, unknown>) || {};
  const uniqueFarmersCount = Number((facetRow?.uniqueFarmers?.[0]?.count as any) || 0);
  const matchingActivityIds: mongoose.Types.ObjectId[] = (facetRow?.ids ?? []).map(
    (d: { _id: mongoose.Types.ObjectId }) => d._id
  );

  // Task aggregation: count tasks only for activities in the filtered set (same as list/stats filter)
  const taskAgg = await CallTask.aggregate([
    { $match: matchingActivityIds.length > 0 ? { activityId: { $in: matchingActivityIds } } : { _id: null } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        callbackCount: { $sum: { $cond: [{ $eq: ['$isCallback', true] }, 1, 0] } },
      },
    },
  ]);

  const byStatus: Record<string, number> = {};
  let totalCallbacks = 0;
  for (const r of taskAgg) {
    byStatus[String(r._id)] = Number(r.count || 0);
    totalCallbacks += Number(r.callbackCount || 0);
  }

  const totalTasks = Object.values(byStatus).reduce((s, n) => s + (Number(n) || 0), 0);

  const tasksAdhoc =
    matchingActivityIds.length > 0
      ? await CallTask.countDocuments({
          activityId: { $in: matchingActivityIds },
          samplingRunType: 'adhoc',
        })
      : 0;

  return {
    totalActivities: Number(a0.totalActivities || 0),
    activitiesWithSampling: Number(a0.activitiesWithSampling || 0),
    activitiesFullySampled: Number(a0.activitiesFullySampled || 0),
    activitiesPartiallySampled: Number(a0.activitiesPartiallySampled || 0),
    activitiesNotSampled: Number(a0.activitiesNotSampled || 0),
    totalFarmers: uniqueFarmersCount,
    totalFarmerLinks: Number(a0.totalFarmers || 0),
    farmersSampled: Number(a0.farmersSampled || 0),
    totalTasks,
    tasksSampledInQueue: Number(byStatus.sampled_in_queue || 0),
    tasksInProgress: Number(byStatus.in_progress || 0),
    tasksCompleted: Number(byStatus.completed || 0),
    tasksNotReachable: Number(byStatus.not_reachable || 0),
    tasksInvalidNumber: Number(byStatus.invalid_number || 0),
    tasksUnassigned: Number(byStatus.unassigned || 0),
    callbackTasks: totalCallbacks,
    activitiesWithSamplingAdhoc: Number((a0 as any).activitiesWithSamplingAdhoc || 0),
    farmersSampledAdhoc: Number((a0 as any).farmersSampledAdhoc || 0),
    tasksAdhoc,
  };
};

export const getActivitiesSamplingFilterOptions = async (filters?: {
  activityType?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<{ territoryOptions: string[]; zoneOptions: string[]; buOptions: string[] }> => {
  const { activityType, territory, zone, bu, samplingStatus, dateFrom, dateTo } = filters || {};

  const baseMatch: any = {};
  if (activityType) baseMatch.type = activityType;
  if (dateFrom || dateTo) {
    baseMatch.date = {};
    if (dateFrom) baseMatch.date.$gte = dateFrom;
    if (dateTo) baseMatch.date.$lte = dateTo;
  }

  const normalize = (v: any) => String(v || '').trim();
  const territoryNorm = normalize(territory);
  const zoneNorm = normalize(zone);
  const buNorm = normalize(bu);

  const buildGeoMatch = (exclude: 'territory' | 'zone' | 'bu') => {
    const clauses: any[] = [];
    if (exclude !== 'territory' && territoryNorm) clauses.push({ __territory: territoryNorm });
    if (exclude !== 'zone' && zoneNorm) clauses.push({ __zone: zoneNorm });
    if (exclude !== 'bu' && buNorm) clauses.push({ __bu: buNorm });
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  };

  // IMPORTANT: Options must be fast and consistent across pages.
  // Only compute samplingStatus (needs lookups) if the user is actually filtering by it.
  const pipeline: any[] = [
    { $match: baseMatch },
    {
      $addFields: {
        __territory: {
          $trim: {
            input: {
              $ifNull: ['$territoryName', { $ifNull: ['$territory', ''] }],
            },
          },
        },
        __zone: { $trim: { input: { $ifNull: ['$zoneName', ''] } } },
        __bu: { $trim: { input: { $ifNull: ['$buName', ''] } } },
      },
    },
  ];

  if (samplingStatus) {
    pipeline.push(
      {
        $lookup: {
          from: SamplingAudit.collection.name,
          localField: '_id',
          foreignField: 'activityId',
          as: '__audit',
        },
      },
      { $unwind: { path: '$__audit', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: CallTask.collection.name,
          let: { aid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$activityId', '$$aid'] } } },
            { $count: 'count' },
          ],
          as: '__tasksCount',
        },
      },
      {
        $addFields: {
          __taskCount: {
            $ifNull: [{ $arrayElemAt: ['__$tasksCount.count', 0] }, 0],
          },
          __sampledCount: {
            $ifNull: ['__$audit.sampledCount', 0],
          },
          __hasAudit: {
            $cond: [{ $ifNull: ['__$audit', false] }, true, false],
          },
        },
      },
      {
        $addFields: {
          __samplingStatus: {
            $cond: [
              { $eq: ['__$hasAudit', false] },
              'not_sampled',
              { $cond: [{ $gt: ['$__sampledCount', 0] }, 'sampled', 'partial'] },
            ],
          },
        },
      },
      { $match: { __samplingStatus: samplingStatus } }
    );
  }

  pipeline.push({
    $facet: {
      territory: [
        ...(buildGeoMatch('territory') ? [{ $match: buildGeoMatch('territory') }] : []),
        { $group: { _id: null, values: { $addToSet: '$__territory' } } },
        { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
      ],
      zone: [
        ...(buildGeoMatch('zone') ? [{ $match: buildGeoMatch('zone') }] : []),
        { $group: { _id: null, values: { $addToSet: '$__zone' } } },
        { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
      ],
      bu: [
        ...(buildGeoMatch('bu') ? [{ $match: buildGeoMatch('bu') }] : []),
        { $group: { _id: null, values: { $addToSet: '$__bu' } } },
        { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
      ],
    },
  });

  const out = await Activity.aggregate(pipeline);
  const first = out?.[0] || {};
  const stripEmpty = (arr: any[]) => (Array.isArray(arr) ? arr.filter((v) => v !== '' && v !== null && v !== undefined) : []);
  const sortAlpha = (a: any, b: any) => String(a).localeCompare(String(b));

  const territoryOptions = stripEmpty(first?.territory?.[0]?.values || []).sort(sortAlpha);
  const zoneOptions = stripEmpty(first?.zone?.[0]?.values || []).sort(sortAlpha);
  const buOptions = stripEmpty(first?.bu?.[0]?.values || []).sort(sortAlpha);

  return { territoryOptions, zoneOptions, buOptions };
};

/**
 * Get task queues for all agents with status breakdown
 * Returns summary of all agents with their task counts by status
 */
export const getAgentQueues = async (filters?: {
  agentId?: string;
  isActive?: boolean;
}): Promise<AgentQueueSummary[]> => {
  try {
    const { agentId, isActive = true } = filters || {};

    // Build query for agents
    const agentQuery: any = {
      role: 'cc_agent',
    };
    if (isActive !== undefined) {
      agentQuery.isActive = isActive;
    }
    if (agentId) {
      agentQuery._id = new mongoose.Types.ObjectId(agentId);
    }

    // Get all CC agents
    const agents = await User.find(agentQuery).select(
      'name email employeeId languageCapabilities isActive agentKind'
    );

    // Get all tasks for these agents
    const agentIds = agents.map((a) => a._id);
    const tasks = await CallTask.find({
      assignedAgentId: { $in: agentIds },
    });

    // Group tasks by agent and status
    const tasksByAgent = new Map<
      string,
      { sampled_in_queue: number; in_progress: number; completed: number; not_reachable: number; invalid_number: number }
    >();

    for (const task of tasks) {
      if (!task.assignedAgentId) {
        continue;
      }
      const agentIdStr = task.assignedAgentId.toString();
      if (!tasksByAgent.has(agentIdStr)) {
        tasksByAgent.set(agentIdStr, {
          sampled_in_queue: 0,
          in_progress: 0,
          completed: 0,
          not_reachable: 0,
          invalid_number: 0,
        });
      }
      const breakdown = tasksByAgent.get(agentIdStr)!;
      const statusKey = task.status === 'sampled_in_queue' ? 'sampled_in_queue' : task.status;
      if (breakdown.hasOwnProperty(statusKey)) {
        breakdown[statusKey as keyof typeof breakdown]++;
      }
    }

    // Build result array
    const result: AgentQueueSummary[] = [];

    for (const agent of agents) {
      const agentIdStr = agent._id.toString();
      const breakdown = tasksByAgent.get(agentIdStr) || {
        sampled_in_queue: 0,
        in_progress: 0,
        completed: 0,
        not_reachable: 0,
        invalid_number: 0,
      };

      const total =
        breakdown.sampled_in_queue +
        breakdown.in_progress +
        breakdown.completed +
        breakdown.not_reachable +
        breakdown.invalid_number;

      result.push({
        agentId: agentIdStr,
        agentName: agent.name,
        agentEmail: agent.email,
        employeeId: agent.employeeId,
        agentKind: agent.agentKind === 'virtual' ? 'virtual' : 'human',
        languageCapabilities: agent.languageCapabilities || [],
        statusBreakdown: {
          ...breakdown,
          total,
        },
      });
    }

    // Sort by total tasks (descending)
    result.sort((a, b) => b.statusBreakdown.total - a.statusBreakdown.total);

    return result;
  } catch (error) {
    logger.error('Error fetching agent queues:', error);
    throw error;
  }
};

const TASK_PAGE_SIZE_DEFAULT = 30;
const TASK_PAGE_SIZE_MAX = 100;

/**
 * Get detailed queue for a specific agent
 * Returns agent info, status breakdown, and task list (all or paginated)
 * @param options.language - optional: filter tasks by farmer preferredLanguage
 * @param options.page - optional: 1-based page for lazy load (requires limit)
 * @param options.limit - optional: page size (default 30, max 100)
 * @param options.dateFrom, dateTo, bu, state, status, fda - optional: filter by scheduled date, activity, task status, MDO (officer)
 */
export const getAgentQueue = async (
  agentId: string,
  options?: {
    language?: string;
    page?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    bu?: string;
    state?: string;
    status?: string;
    fda?: string;
    territory?: string;
  }
): Promise<AgentQueueDetail & { tasksTotal?: number; page?: number; limit?: number; officerOptions?: string[]; territoryOptions?: string[] }> => {
  try {
    // Validate agentId
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      throw new Error('Invalid agent ID');
    }

    // Get agent
    const agent = await User.findById(agentId).select(
      'name email employeeId languageCapabilities role isActive agentKind'
    );

    if (!agent) {
      throw new Error('Agent not found');
    }

    if (agent.role !== 'cc_agent') {
      throw new Error('User is not a CC agent');
    }

    const language = options?.language?.trim();
    const page = options?.page != null && options.page >= 1 ? options.page : undefined;
    const limit =
      options?.limit != null && options.limit >= 1
        ? Math.min(options.limit, TASK_PAGE_SIZE_MAX)
        : undefined;
    const usePagination = page != null && limit != null;

    const dateMatch: Record<string, unknown> = {};
    if (options?.dateFrom || options?.dateTo) {
      dateMatch.scheduledDate = {};
      if (options.dateFrom) {
        const d = new Date(options.dateFrom);
        d.setHours(0, 0, 0, 0);
        (dateMatch.scheduledDate as Record<string, Date>).$gte = d;
      }
      if (options.dateTo) {
        const d = new Date(options.dateTo);
        d.setHours(23, 59, 59, 999);
        (dateMatch.scheduledDate as Record<string, Date>).$lte = d;
      }
    }
    const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;
    const activityFilter: Record<string, string> = {};
    if (options?.bu) activityFilter['activity.buName'] = String(options.bu).trim();
    if (options?.state) activityFilter['activity.state'] = String(options.state).trim();
    if (options?.fda) activityFilter['activity.officerName'] = String(options.fda).trim();
    const territoryTrim = options?.territory?.trim();
    const statusMatch = options?.status?.trim() ? { status: options.status.trim() as TaskStatus } : {};

    if (usePagination) {
      // Paginated path: aggregation for breakdown + total and one page of tasks (no full load)
      const skip = (page - 1) * limit;
      const basePipeline: mongoose.PipelineStage[] = [
        { $match: { assignedAgentId: new mongoose.Types.ObjectId(agentId), ...dateMatch, ...statusMatch } },
        {
          $lookup: {
            from: activityCollection,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        ...(Object.keys(activityFilter).length ? [{ $match: activityFilter }] : []),
        ...(territoryTrim ? [{ $match: { $or: [{ 'activity.territoryName': territoryTrim }, { 'activity.territory': territoryTrim }] } }] : []),
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      ];
      if (language) {
        basePipeline.push({ $match: { 'farmer.preferredLanguage': language } });
      }
      const facetPipeline: mongoose.PipelineStage[] = [
        ...basePipeline,
        {
          $facet: {
            statusBreakdown: [
              {
                $group: {
                  _id: null,
                  sampled_in_queue: { $sum: { $cond: [{ $eq: ['$status', 'sampled_in_queue'] }, 1, 0] } },
                  in_progress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
                  completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                  not_reachable: { $sum: { $cond: [{ $eq: ['$status', 'not_reachable'] }, 1, 0] } },
                  invalid_number: { $sum: { $cond: [{ $eq: ['$status', 'invalid_number'] }, 1, 0] } },
                  total: { $sum: 1 },
                },
              },
              { $project: { _id: 0 } },
            ],
            tasks: [
              { $sort: QUEUE_CALL_SORT },
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: (await import('../models/Activity.js')).Activity.collection.name,
                  localField: 'activityId',
                  foreignField: '_id',
                  as: 'activity',
                },
              },
              { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
              {
                $project: {
                  taskId: { $toString: '$_id' },
                  farmer: {
                    name: { $ifNull: ['$farmer.name', 'Unknown'] },
                    mobileNumber: { $ifNull: ['$farmer.mobileNumber', 'Unknown'] },
                    preferredLanguage: { $ifNull: ['$farmer.preferredLanguage', 'Unknown'] },
                    location: { $ifNull: ['$farmer.location', 'Unknown'] },
                  },
                  activity: {
                    type: { $ifNull: ['$activity.type', 'Unknown'] },
                    date: '$activity.date',
                    officerName: { $ifNull: ['$activity.officerName', 'Unknown'] },
                    territory: { $ifNull: ['$activity.territoryName', '$activity.territory'] },
                    zone: { $ifNull: ['$activity.zoneName', ''] },
                    bu: { $ifNull: ['$activity.buName', ''] },
                    crops: { $ifNull: ['$activity.crops', []] },
                    products: { $ifNull: ['$activity.products', []] },
                  },
                  status: 1,
                  outcome: 1,
                  sentiment: '$callLog.sentiment',
                  scheduledDate: 1,
                  createdAt: 1,
                },
              },
            ],
          },
        },
      ];
      const aggResult = await CallTask.aggregate(facetPipeline);
      const facet = aggResult?.[0];
      const statusBreakdown = facet?.statusBreakdown?.[0] || {
        sampled_in_queue: 0,
        in_progress: 0,
        completed: 0,
        not_reachable: 0,
        invalid_number: 0,
        total: 0,
      };
      const tasksTotal = statusBreakdown.total;
      const rawTasks = facet?.tasks || [];
      const taskDetails = rawTasks.map((t: any) => ({
        taskId: t.taskId,
        farmer: t.farmer || {},
        activity: {
          ...t.activity,
          territory: t.activity?.territory ?? 'Unknown',
          date: t.activity?.date ?? t.createdAt,
          crops: Array.isArray(t.activity?.crops) ? t.activity.crops : [],
          products: Array.isArray(t.activity?.products) ? t.activity.products : [],
        },
        status: t.status,
        outcome: t.outcome ?? null,
        sentiment: t.sentiment ?? null,
        scheduledDate: t.scheduledDate,
        createdAt: t.createdAt,
      }));

      // Distinct MDO (officer) names for this agent's tasks (same date/bu/state, no status filter)
      const activityFilterForOfficers: Record<string, string> = {};
      if (options?.bu) activityFilterForOfficers['activity.buName'] = String(options.bu).trim();
      if (options?.state) activityFilterForOfficers['activity.state'] = String(options.state).trim();
      const officerOptAgg = await CallTask.aggregate([
        { $match: { assignedAgentId: new mongoose.Types.ObjectId(agentId), ...dateMatch } },
        { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activity' } },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        ...(Object.keys(activityFilterForOfficers).length ? [{ $match: activityFilterForOfficers }] : []),
        { $group: { _id: '$activity.officerName' } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { _id: 1 } },
        { $group: { _id: null, names: { $push: '$_id' } } },
        { $project: { _id: 0, names: 1 } },
      ]);
      const officerOptions: string[] = officerOptAgg?.[0]?.names ?? [];

      const territoryOptAgg = await CallTask.aggregate([
        { $match: { assignedAgentId: new mongoose.Types.ObjectId(agentId), ...dateMatch } },
        { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activity' } },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        { $project: { territory: { $ifNull: ['$activity.territoryName', '$activity.territory'] } } },
        { $match: { territory: { $nin: [null, ''] } } },
        { $group: { _id: '$territory' } },
        { $sort: { _id: 1 } },
        { $group: { _id: null, names: { $push: '$_id' } } },
        { $project: { _id: 0, names: 1 } },
      ]);
      const territoryOptions: string[] = territoryOptAgg?.[0]?.names ?? [];

      return {
        agent: {
          agentId: agent._id.toString(),
          agentName: agent.name,
          agentEmail: agent.email,
          employeeId: agent.employeeId,
          agentKind: agent.agentKind === 'virtual' ? 'virtual' : 'human',
          languageCapabilities: agent.languageCapabilities || [],
        },
        statusBreakdown,
        tasks: taskDetails,
        tasksTotal,
        page,
        limit,
        officerOptions,
        territoryOptions,
      };
    }

    // Non-paginated path: load all tasks (backward compatible)
    const findMatch: Record<string, unknown> = { assignedAgentId: new mongoose.Types.ObjectId(agentId) };
    if (Object.keys(dateMatch).length) Object.assign(findMatch, dateMatch);
    if (options?.status?.trim()) (findMatch as any).status = options.status.trim();
    let tasks = await CallTask.find(findMatch)
      .populate('farmerId', 'name mobileNumber preferredLanguage location')
      .populate('activityId', 'type date officerName territory territoryName zoneName buName state crops products')
      .sort(QUEUE_CALL_SORT);

    if (language) {
      tasks = tasks.filter((task) => {
        const farmer = task.farmerId as any;
        return farmer?.preferredLanguage === language;
      });
    }
    if (options?.bu || options?.state || options?.fda || territoryTrim) {
      tasks = tasks.filter((task) => {
        const activity = task.activityId as any;
        if (options?.bu && (activity?.buName ?? '') !== options.bu.trim()) return false;
        if (options?.state && (activity?.state ?? '') !== options.state.trim()) return false;
        if (options?.fda && (activity?.officerName ?? '') !== options.fda.trim()) return false;
        if (territoryTrim && (activity?.territoryName ?? activity?.territory ?? '') !== territoryTrim) return false;
        return true;
      });
    }

    const statusBreakdown = {
      sampled_in_queue: 0,
      in_progress: 0,
      completed: 0,
      not_reachable: 0,
      invalid_number: 0,
      total: tasks.length,
    };

    for (const task of tasks) {
      const statusKey = task.status === 'sampled_in_queue' ? 'sampled_in_queue' : task.status;
      if (statusBreakdown.hasOwnProperty(statusKey)) {
        statusBreakdown[statusKey as keyof typeof statusBreakdown]++;
      }
    }

    const taskDetails = tasks.map((task) => {
      const farmer = task.farmerId as any;
      const activity = task.activityId as any;
      const callTask = task as any;

      return {
        taskId: task._id.toString(),
        farmer: {
          name: farmer?.name || 'Unknown',
          mobileNumber: farmer?.mobileNumber || 'Unknown',
          preferredLanguage: farmer?.preferredLanguage || 'Unknown',
          location: farmer?.location || 'Unknown',
        },
        activity: {
          type: activity?.type || 'Unknown',
          date: activity?.date || task.createdAt,
          officerName: activity?.officerName || 'Unknown',
          territory: activity?.territoryName || activity?.territory || 'Unknown',
          zone: activity?.zoneName || '',
          bu: activity?.buName || '',
          crops: Array.isArray(activity?.crops) ? activity.crops : [],
          products: Array.isArray(activity?.products) ? activity.products : [],
        },
        status: task.status,
        outcome: callTask.outcome ?? null,
        sentiment: callTask.callLog?.sentiment ?? null,
        scheduledDate: task.scheduledDate,
        createdAt: task.createdAt,
      };
    });

    const officerOptions = [...new Set(tasks.map((t) => (t.activityId as any)?.officerName).filter(Boolean))].sort();
    const territoryOptions = [...new Set(tasks.map((t) => (t.activityId as any)?.territoryName || (t.activityId as any)?.territory).filter(Boolean))].sort();

    return {
      agent: {
        agentId: agent._id.toString(),
        agentName: agent.name,
        agentEmail: agent.email,
        employeeId: agent.employeeId,
        agentKind: agent.agentKind === 'virtual' ? 'virtual' : 'human',
        languageCapabilities: agent.languageCapabilities || [],
      },
      statusBreakdown,
      tasks: taskDetails,
      officerOptions,
      territoryOptions,
    };
  } catch (error) {
    logger.error(`Error fetching agent queue for ${agentId}:`, error);
    throw error;
  }
};

export const exportAgentQueueTasksXlsx = async (
  agentId: string,
  options?: {
    language?: string;
    dateFrom?: string;
    dateTo?: string;
    bu?: string;
    state?: string;
    status?: string;
    fda?: string;
    territory?: string;
  }
): Promise<{ filename: string; buffer: Buffer }> => {
  const queue = await getAgentQueue(agentId, options);
  const agent = queue.agent;
  const tasks = (queue.tasks || []).slice(0, AGENT_QUEUE_EXPORT_MAX);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (v: unknown) => {
    const d = v ? new Date(v as string | Date) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const fmtDateTime = (v: unknown) => {
    const d = v ? new Date(v as string | Date) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const statusLabel = (status: string) => TASK_STATUS_LABELS[status] || status;

  const rows = tasks.map((task) => ({
    'Task ID': task.taskId,
    Status: statusLabel(task.status),
    Outcome: task.outcome || '',
    Sentiment: task.sentiment || '',
    'Scheduled Date': fmtDate(task.scheduledDate),
    'Created At': fmtDateTime(task.createdAt),
    'Farmer Name': task.farmer?.name || '',
    'Farmer Mobile': task.farmer?.mobileNumber || '',
    'Farmer Location': task.farmer?.location || '',
    'Farmer Language': task.farmer?.preferredLanguage || '',
    'Activity Type': task.activity?.type || '',
    'Activity Date': fmtDate(task.activity?.date),
    Territory: task.activity?.territory || '',
    Zone: task.activity?.zone || '',
    BU: task.activity?.bu || '',
    Officer: task.activity?.officerName || '',
    Crops: Array.isArray(task.activity?.crops) ? task.activity.crops.join(', ') : '',
    Products: Array.isArray(task.activity?.products) ? task.activity.products.join(', ') : '',
    'Agent Name': agent.agentName,
    'Agent Email': agent.agentEmail,
    'Agent Employee ID': agent.employeeId,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const safeAgent = String(agent.agentName || 'agent')
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const now = new Date();
  const filename = `agent_tasks_${safeAgent || agent.agentId}_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate()
  )}_${pad2(now.getHours())}${pad2(now.getMinutes())}.xlsx`;

  return { filename, buffer };
};

