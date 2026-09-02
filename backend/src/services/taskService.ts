import { CallTask, ICallTask, TaskStatus } from '../models/CallTask.js';
import { User } from '../models/User.js';
import { Farmer } from '../models/Farmer.js';
import { Activity } from '../models/Activity.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import * as XLSX from 'xlsx';
import { getIstCalendarDayBounds, parseQueryDateFrom, parseQueryDateTo } from '../utils/dateRangeQuery.js';

export interface TaskAssignmentOptions {
  agentId?: string;
  language?: string;
  territory?: string;
}

/**
 * Mongo match: task has no CC agent on file — `assignedAgentId` null or field absent.
 * Do not use `assignedAgentId: ''` here: Mongoose casts query values to ObjectId and throws
 * "Cast to ObjectId failed for value \"\" " on find/aggregate $match.
 */
export const callTaskNoAgentAssignedMatch = (): Record<string, unknown> => ({
  $or: [{ assignedAgentId: null }, { assignedAgentId: { $exists: false } }],
});

/**
 * Tasks that still need assignment: no agent (see `callTaskNoAgentAssignedMatch`) and not in a terminal call outcome.
 */
export const callTaskNeedsAgentMongoFilter = (): Record<string, unknown> => ({
  status: { $nin: ['completed', 'not_reachable', 'invalid_number', 'cancelled'] },
  ...callTaskNoAgentAssignedMatch(),
});

const OPEN_DIALER_STATUSES: TaskStatus[] = ['sampled_in_queue', 'in_progress'];
const TERMINAL_DIALER_STATUSES: TaskStatus[] = ['completed', 'not_reachable', 'invalid_number'];
const DIALER_DONE_STATUSES: TaskStatus[] = ['completed', 'not_reachable', 'invalid_number'];

export type DialerTab = 'in_progress' | 'queue' | 'done';
export type DialerFilterBy = 'territory' | 'tm' | 'fda' | '';

export interface DialerListOptions {
  tab: DialerTab;
  page?: number;
  limit?: number;
  search?: string;
  filterBy?: DialerFilterBy;
  filterValues?: string[];
}

async function getDialerAgent(agentId: string) {
  const agent = await User.findById(agentId);
  if (!agent || !agent.isActive || agent.role !== 'cc_agent') {
    throw new Error('Invalid or inactive agent');
  }
  return agent;
}

function buildDialerTaskMatch(agentObjectId: mongoose.Types.ObjectId, tab: DialerTab): Record<string, unknown> {
  const base: Record<string, unknown> = { assignedAgentId: agentObjectId };
  if (tab === 'in_progress') {
    base.status = 'in_progress';
  } else if (tab === 'queue') {
    base.status = 'sampled_in_queue';
  } else {
    const { start, end } = getIstCalendarDayBounds();
    base.status = { $in: DIALER_DONE_STATUSES };
    base.updatedAt = { $gte: start, $lte: end };
  }
  return base;
}

function buildDialerLookupFilterStages(
  languages: string[],
  search?: string,
  filterBy?: DialerFilterBy,
  filterValues?: string[]
): mongoose.PipelineStage[] {
  const stages: mongoose.PipelineStage[] = [
    {
      $lookup: {
        from: 'farmers',
        localField: 'farmerId',
        foreignField: '_id',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: false } },
    { $match: { 'farmer.preferredLanguage': { $in: languages } } },
    {
      $lookup: {
        from: 'activities',
        localField: 'activityId',
        foreignField: '_id',
        as: 'activity',
      },
    },
    { $unwind: { path: '$activity', preserveNullAndEmptyArrays: false } },
  ];

  if (filterBy && filterValues?.length) {
    if (filterBy === 'territory') {
      stages.push({
        $match: {
          $or: [
            { 'activity.territory': { $in: filterValues } },
            { 'activity.territoryName': { $in: filterValues } },
          ],
        },
      });
    } else if (filterBy === 'tm') {
      stages.push({ $match: { 'activity.tmName': { $in: filterValues } } });
    } else if (filterBy === 'fda') {
      stages.push({ $match: { 'activity.officerName': { $in: filterValues } } });
    }
  }

  const q = search?.trim();
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    stages.push({
      $match: {
        $or: [
          { 'farmer.name': regex },
          { 'farmer.mobileNumber': regex },
          { 'farmer.location': regex },
        ],
      },
    });
  }

  return stages;
}

/** Paginated dialer list for one tab (language-matched). */
export const getAvailableTasksForAgentPaginated = async (
  agentId: string,
  options: DialerListOptions
): Promise<{ tasks: any[]; page: number; limit: number; total: number; hasMore: boolean }> => {
  const agent = await getDialerAgent(agentId);
  const languages = agent.languageCapabilities || [];
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const skip = (page - 1) * limit;
  const agentObjectId = new mongoose.Types.ObjectId(agentId);
  const sortStage: mongoose.PipelineStage =
    options.tab === 'done' ? { $sort: { updatedAt: -1 } } : { $sort: { scheduledDate: 1 } };

  const pipeline: mongoose.PipelineStage[] = [
    { $match: buildDialerTaskMatch(agentObjectId, options.tab) },
    ...buildDialerLookupFilterStages(languages, options.search, options.filterBy, options.filterValues),
    sortStage,
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await CallTask.aggregate(pipeline);
  const items = result?.items ?? [];
  const total = Number(result?.total?.[0]?.count ?? 0);
  return {
    tasks: items,
    page,
    limit,
    total,
    hasMore: skip + items.length < total,
  };
};

/** Tab counts + filter facet options (deferred load in dialer UI). */
export const getAvailableTasksSummaryForAgent = async (
  agentId: string,
  options?: { filterBy?: DialerFilterBy; filterValues?: string[] }
): Promise<{
  inProgress: number;
  queue: number;
  doneToday: number;
  filterOptions: { territories: string[]; tms: string[]; fdas: string[] };
}> => {
  const agent = await getDialerAgent(agentId);
  const languages = agent.languageCapabilities || [];
  const agentObjectId = new mongoose.Types.ObjectId(agentId);
  const { start, end } = getIstCalendarDayBounds();

  const baseMatch: Record<string, unknown> = {
    assignedAgentId: agentObjectId,
    $or: [
      { status: { $in: OPEN_DIALER_STATUSES } },
      {
        status: { $in: DIALER_DONE_STATUSES },
        updatedAt: { $gte: start, $lte: end },
      },
    ],
  };

  const pipeline: mongoose.PipelineStage[] = [
    { $match: baseMatch },
    ...buildDialerLookupFilterStages(
      languages,
      undefined,
      options?.filterBy,
      options?.filterValues
    ),
    {
      $facet: {
        inProgress: [{ $match: { status: 'in_progress' } }, { $count: 'count' }],
        queue: [{ $match: { status: 'sampled_in_queue' } }, { $count: 'count' }],
        doneToday: [
          {
            $match: {
              status: { $in: DIALER_DONE_STATUSES },
              updatedAt: { $gte: start, $lte: end },
            },
          },
          { $count: 'count' },
        ],
        territories: [
          {
            $group: {
              _id: {
                $ifNull: [
                  { $cond: [{ $ne: ['$activity.territoryName', ''] }, '$activity.territoryName', null] },
                  '$activity.territory',
                ],
              },
            },
          },
        ],
        tms: [{ $group: { _id: '$activity.tmName' } }],
        fdas: [{ $group: { _id: '$activity.officerName' } }],
      },
    },
  ];

  const [result] = await CallTask.aggregate(pipeline);
  const pickCount = (arr: { count?: number }[] | undefined) => Number(arr?.[0]?.count ?? 0);
  const pickStrings = (arr: { _id?: string | null }[] | undefined) =>
    (arr || [])
      .map((r) => (typeof r._id === 'string' ? r._id.trim() : ''))
      .filter((s) => s.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  return {
    inProgress: pickCount(result?.inProgress),
    queue: pickCount(result?.queue),
    doneToday: pickCount(result?.doneToday),
    filterOptions: {
      territories: pickStrings(result?.territories),
      tms: pickStrings(result?.tms),
      fdas: pickStrings(result?.fdas),
    },
  };
};

/**
 * Get all tasks for an agent that can be shown in the dialer (queue/in-progress + today's Done)
 * Returns list of tasks sorted by scheduledDate (earliest first)
 * Note: Returns lean documents (plain objects) for better performance
 * Done (terminal) tasks are limited to the current IST calendar day so the Done tab resets daily.
 */
export const getAvailableTasksForAgent = async (agentId: string): Promise<any[]> => {
  try {
    // Get agent to check language capabilities
    const agent = await User.findById(agentId);
    if (!agent || !agent.isActive || agent.role !== 'cc_agent') {
      throw new Error('Invalid or inactive agent');
    }

    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const { start: todayStart, end: todayEnd, day: istDay } = getIstCalendarDayBounds();
    const populateFarmer = { path: 'farmerId', select: 'name location preferredLanguage mobileNumber photoUrl' };
    const populateActivity = {
      path: 'activityId',
      select: 'type date officerName tmName location territory territoryName state crops products',
    };

    // Open work: no date filter. Done: only terminal outcomes updated today (IST).
    // Fetch separately so today's Done is not crowded out by a large open queue under a shared 300 cap.
    const [openTasks, doneTodayTasks] = await Promise.all([
      CallTask.find({
        assignedAgentId: agentObjectId,
        status: { $in: OPEN_DIALER_STATUSES },
      })
        .populate(populateFarmer)
        .populate(populateActivity)
        .sort({ scheduledDate: 1 })
        .lean(),
      CallTask.find({
        assignedAgentId: agentObjectId,
        status: { $in: TERMINAL_DIALER_STATUSES },
        updatedAt: { $gte: todayStart, $lte: todayEnd },
      })
        .populate(populateFarmer)
        .populate(populateActivity)
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const tasks = [...openTasks, ...doneTodayTasks];

    // Filter tasks by agent's language capabilities
    const languageFilteredTasks = tasks.filter((task) => {
      const farmer = task.farmerId as any;
      if (!farmer || !farmer.preferredLanguage) {
        logger.warn(`Task ${task._id} has no farmer or preferredLanguage`);
        return false; // Skip tasks without farmer language info
      }
      const hasLanguageMatch = agent.languageCapabilities.includes(farmer.preferredLanguage);
      if (!hasLanguageMatch) {
        logger.debug(`Agent ${agent.email} does not have language capability ${farmer.preferredLanguage} for task ${task._id} (status: ${task.status})`);
      }
      return hasLanguageMatch;
    });

    logger.info(`getAvailableTasksForAgent: Found ${tasks.length} tasks, ${languageFilteredTasks.length} after language filtering for agent ${agent.email}`, {
      agentId: agent._id.toString(),
      agentLanguages: agent.languageCapabilities,
      totalTasks: tasks.length,
      languageFiltered: languageFilteredTasks.length,
      istDay,
      openCount: openTasks.length,
      doneTodayCount: doneTodayTasks.length,
      statusBreakdown: {
        sampled_in_queue: tasks.filter(t => t.status === 'sampled_in_queue').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        not_reachable: tasks.filter(t => t.status === 'not_reachable').length,
        invalid_number: tasks.filter(t => t.status === 'invalid_number').length,
      },
      languageFilteredStatusBreakdown: {
        sampled_in_queue: languageFilteredTasks.filter(t => t.status === 'sampled_in_queue').length,
        in_progress: languageFilteredTasks.filter(t => t.status === 'in_progress').length,
        completed: languageFilteredTasks.filter(t => t.status === 'completed').length,
        not_reachable: languageFilteredTasks.filter(t => t.status === 'not_reachable').length,
        invalid_number: languageFilteredTasks.filter(t => t.status === 'invalid_number').length,
      },
    });

    return languageFilteredTasks;
  } catch (error) {
    logger.error('Error fetching available tasks for agent:', error);
    throw error;
  }
};

/**
 * Next task for the voice orchestrator — matches human dialer open queue (no scheduledDate gate).
 * Human agents see all sampled_in_queue tasks in the workspace; voice should dequeue the same pool.
 */
export const getNextVoiceTaskForAgent = async (agentId: string): Promise<any | null> => {
  try {
    let task = await CallTask.findOne({
      assignedAgentId: new mongoose.Types.ObjectId(agentId),
      status: 'sampled_in_queue',
    })
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
      .sort({ scheduledDate: 1 })
      .limit(1)
      .lean();

    if (!task) {
      task = await CallTask.findOne({
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: 'in_progress',
      })
        .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
        .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
        .sort({ scheduledDate: 1 })
        .limit(1)
        .lean();
    }

    return task;
  } catch (error) {
    logger.error('Error fetching next voice task for agent:', error);
    throw error;
  }
};

/**
 * Get the next pending task for an agent (legacy /active route — due-date gate).
 * Prioritizes tasks by scheduledDate (earliest first).
 */
export const getNextTaskForAgent = async (agentId: string): Promise<any | null> => {
  try {
    // First, try to get a sampled_in_queue task
    let task = await CallTask.findOne({
      assignedAgentId: new mongoose.Types.ObjectId(agentId),
      status: 'sampled_in_queue',
      scheduledDate: { $lte: new Date() }, // Only tasks that are due
    })
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
      .sort({ scheduledDate: 1 }) // Earliest first
      .limit(1)
      .lean(); // Performance: return plain object for read-only display

    // If no pending task, check for in_progress tasks (agent might be continuing work)
    if (!task) {
      task = await CallTask.findOne({
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: 'in_progress',
        scheduledDate: { $lte: new Date() },
      })
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
      .sort({ scheduledDate: 1 })
      .limit(1)
      .lean(); // Performance: return plain object for read-only display
    }

    return task;
  } catch (error) {
    logger.error('Error fetching next task for agent:', error);
    throw error;
  }
};

/**
 * Get pending tasks (for Team Leads and Admins)
 */
export const getPendingTasks = async (filters?: {
  agentId?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  search?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  limit?: number;
}) => {
  try {
    const { agentId, territory, zone, bu, search, dateFrom, dateTo, page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const query: any = {
      status: { $in: ['sampled_in_queue', 'in_progress'] },
    };

    if (agentId) {
      query.assignedAgentId = new mongoose.Types.ObjectId(agentId);
    }

    // Filter by geo through activity (territory/zone/bu)
    // Optimized: Use lean() and limit activity IDs to prevent massive $in arrays
    if (territory || zone || bu) {
      const and: any[] = [];
      if (territory) and.push({ $or: [{ territoryName: territory }, { territory: territory }] });
      if (zone) and.push({ zoneName: zone });
      if (bu) and.push({ buName: bu });
      const activityQuery: any = and.length === 1 ? and[0] : { $and: and };
      // Use lean() for better performance and limit to recent activities
      const activities = await Activity.find(activityQuery)
        .select('_id')
        .sort({ date: -1 }) // Most recent first
        .limit(10000) // Cap to prevent memory issues with large datasets
        .lean();
      query.activityId = { $in: activities.map((a) => a._id) };
    }

    // Filter by scheduled date range
    if (dateFrom || dateTo) {
      query.scheduledDate = {};
      if (dateFrom) {
        const fromDate = typeof dateFrom === 'string' ? new Date(dateFrom) : dateFrom;
        fromDate.setHours(0, 0, 0, 0);
        query.scheduledDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = typeof dateTo === 'string' ? new Date(dateTo) : dateTo;
        toDate.setHours(23, 59, 59, 999);
        query.scheduledDate.$lte = toDate;
      }
    }

    const normalizedSearch = (search || '').trim();

    let tasks: any[] = [];
    let total = 0;

    if (normalizedSearch) {
      const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');

      const out = await CallTask.aggregate([
        { $match: query },
        { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
        { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: Activity.collection.name, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
        { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: User.collection.name, localField: 'assignedAgentId', foreignField: '_id', as: 'assignedAgentId' } },
        { $unwind: { path: '$assignedAgentId', preserveNullAndEmptyArrays: true } },
        {
          $match: {
            $or: [
              { 'farmerId.name': re },
              { 'farmerId.mobileNumber': re },
              { 'farmerId.location': re },
              { 'farmerId.preferredLanguage': re },
              { 'assignedAgentId.name': re },
              { 'assignedAgentId.email': re },
              { 'activityId.type': re },
              { 'activityId.officerName': re },
              { 'activityId.location': re },
              { 'activityId.territoryName': re },
              { 'activityId.territory': re },
              { 'activityId.activityId': re }, // FFA Activity ID
            ],
          },
        },
        { $sort: { scheduledDate: 1 } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ]);

      tasks = out?.[0]?.data || [];
      total = out?.[0]?.total?.[0]?.count || 0;
    } else {
      tasks = await CallTask.find(query)
        .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
        .populate('activityId', 'activityId type date officerName tmName location territory territoryName state zoneName buName crops products')
        .populate('assignedAgentId', 'name email employeeId')
        .sort({ scheduledDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

      total = await CallTask.countDocuments(query);
    }

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    logger.error('Error fetching pending tasks:', error);
    throw error;
  }
};

export const getPendingTasksStats = async (filters?: {
  agentId?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  search?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}) => {
  const { agentId, territory, zone, bu, search, dateFrom, dateTo } = filters || {};

  const query: any = {
    // include all open-ish statuses in the management stats
    status: { $in: ['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number'] },
  };

  if (agentId) query.assignedAgentId = new mongoose.Types.ObjectId(agentId);
  // Optimized: Use lean() and limit activity IDs to prevent massive $in arrays
  if (territory || zone || bu) {
    const and: any[] = [];
    if (territory) and.push({ $or: [{ territoryName: territory }, { territory: territory }] });
    if (zone) and.push({ zoneName: zone });
    if (bu) and.push({ buName: bu });
    const activityQuery: any = and.length === 1 ? and[0] : { $and: and };
    const activities = await Activity.find(activityQuery)
      .select('_id')
      .sort({ date: -1 })
      .limit(10000)
      .lean();
    query.activityId = { $in: activities.map((a) => a._id) };
  }

  if (dateFrom || dateTo) {
    query.scheduledDate = {};
    if (dateFrom) {
      const fromDate = typeof dateFrom === 'string' ? new Date(dateFrom) : dateFrom;
      fromDate.setHours(0, 0, 0, 0);
      query.scheduledDate.$gte = fromDate;
    }
    if (dateTo) {
      const toDate = typeof dateTo === 'string' ? new Date(dateTo) : dateTo;
      toDate.setHours(23, 59, 59, 999);
      query.scheduledDate.$lte = toDate;
    }
  }

  const normalizedSearch = (search || '').trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const base: any[] = [{ $match: query }];
  if (normalizedSearch) {
    const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    base.push(
      { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
      { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: Activity.collection.name, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
      { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: User.collection.name, localField: 'assignedAgentId', foreignField: '_id', as: 'assignedAgentId' } },
      { $unwind: { path: '$assignedAgentId', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { 'farmerId.name': re },
            { 'farmerId.mobileNumber': re },
            { 'farmerId.location': re },
            { 'farmerId.preferredLanguage': re },
            { 'assignedAgentId.name': re },
            { 'assignedAgentId.email': re },
            { 'activityId.type': re },
            { 'activityId.officerName': re },
            { 'activityId.location': re },
            { 'activityId.territoryName': re },
            { 'activityId.territory': re },
            { 'activityId.activityId': re },
          ],
        },
      }
    );
  }

  const agg = await CallTask.aggregate([
    ...base,
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ['$scheduledDate', today] },
                  { $in: ['$status', ['sampled_in_queue', 'in_progress']] },
                ],
              },
              1,
              0,
            ],
          },
        },
        dueToday: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$scheduledDate', today] }, { $lt: ['$scheduledDate', tomorrow] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const byStatus: Record<string, number> = {};
  let overdue = 0;
  let dueToday = 0;
  for (const r of agg) {
    byStatus[String(r._id)] = Number(r.count || 0);
    overdue += Number(r.overdue || 0);
    dueToday += Number(r.dueToday || 0);
  }

  const total = Object.values(byStatus).reduce((s, n) => s + (Number(n) || 0), 0);
  return {
    total,
    sampled_in_queue: Number(byStatus.sampled_in_queue || 0),
    in_progress: Number(byStatus.in_progress || 0),
    completed: Number(byStatus.completed || 0),
    not_reachable: Number(byStatus.not_reachable || 0),
    invalid_number: Number(byStatus.invalid_number || 0),
    unassigned: Number(byStatus.unassigned || 0),
    overdue,
    dueToday,
  };
};

export const exportPendingTasksXlsx = async (filters?: {
  agentId?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  search?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  exportAll?: boolean;
  page?: number;
  limit?: number;
}) => {
  const { exportAll = false } = filters || {};
  const page = exportAll ? 1 : (filters?.page || 1);
  // Safety cap: exporting huge datasets can be slow/heavy
  const limit = exportAll ? Math.min(Math.max(1, Number(filters?.limit || 5000)), 5000) : (filters?.limit || 20);
  const result = await getPendingTasks({ ...(filters || {}), page, limit });

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (v: any) => {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  const rows = (result.tasks || []).map((t: any) => {
    const farmer = t.farmerId || {};
    const agent = t.assignedAgentId || {};
    const act = t.activityId || {};
    const territory = String((act.territoryName || act.territory || '') ?? '').trim();
    return {
      'Task Unique ID': String(t._id || ''),
      Status: String(t.status || ''),
      'Scheduled Date': fmtDate(t.scheduledDate),
      'Farmer Name': String(farmer.name || ''),
      'Farmer Mobile': String(farmer.mobileNumber || ''),
      'Farmer Location': String(farmer.location || ''),
      'Farmer Language': String(farmer.preferredLanguage || ''),
      'Agent Name': String(agent.name || ''),
      'Agent Email': String(agent.email || ''),
      'Agent Employee ID': String(agent.employeeId || ''),
      'Activity ID': String(act.activityId || ''), // FFA Activity ID
      'Activity Type': String(act.type || ''),
      'Activity Date': fmtDate(act.date),
      'Activity Officer': String(act.officerName || ''),
      'Activity TM': String(act.tmName || ''),
      'Activity Territory': String(territory || ''),
      'Activity State': String(act.state || ''),
      'Activity Zone': String(act.zoneName || ''),
      'Activity BU': String(act.buName || ''),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const now = new Date();
  const filename = `tasks_export_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(
    now.getHours()
  )}${pad2(now.getMinutes())}.xlsx`;

  return { filename, buffer };
};

export const getPendingTasksFilterOptions = async (filters?: {
  agentId?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  search?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}) => {
  const { agentId, territory, zone, bu, search, dateFrom, dateTo } = filters || {};

  const taskQuery: any = {
    // match the Task Management list scope (queue + in-progress)
    status: { $in: ['sampled_in_queue', 'in_progress'] },
  };

  if (agentId) taskQuery.assignedAgentId = new mongoose.Types.ObjectId(agentId);

  if (dateFrom || dateTo) {
    taskQuery.scheduledDate = {};
    if (dateFrom) {
      const fromDate = typeof dateFrom === 'string' ? new Date(dateFrom) : dateFrom;
      fromDate.setHours(0, 0, 0, 0);
      taskQuery.scheduledDate.$gte = fromDate;
    }
    if (dateTo) {
      const toDate = typeof dateTo === 'string' ? new Date(dateTo) : dateTo;
      toDate.setHours(23, 59, 59, 999);
      taskQuery.scheduledDate.$lte = toDate;
    }
  }

  const normalizedSearch = (search || '').trim();
  const base: any[] = [{ $match: taskQuery }];

  // If search is present, we need the same join semantics as list/stats to ensure options match.
  if (normalizedSearch) {
    const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    base.push(
      { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
      { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: Activity.collection.name, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
      { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: User.collection.name, localField: 'assignedAgentId', foreignField: '_id', as: 'assignedAgentId' } },
      { $unwind: { path: '$assignedAgentId', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { 'farmerId.name': re },
            { 'farmerId.mobileNumber': re },
            { 'farmerId.location': re },
            { 'farmerId.preferredLanguage': re },
            { 'assignedAgentId.name': re },
            { 'assignedAgentId.email': re },
            { 'activityId.type': re },
            { 'activityId.officerName': re },
            { 'activityId.location': re },
            { 'activityId.territoryName': re },
            { 'activityId.territory': re },
            { 'activityId.activityId': re },
          ],
        },
      }
    );
  } else {
    base.push(
      { $lookup: { from: Activity.collection.name, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
      { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } }
    );
  }

  const buildGeoMatch = (exclude: 'territory' | 'zone' | 'bu') => {
    const clauses: any[] = [];
    if (exclude !== 'territory' && territory) clauses.push({ __territory: String(territory).trim() });
    if (exclude !== 'zone' && zone) clauses.push({ __zone: String(zone).trim() });
    if (exclude !== 'bu' && bu) clauses.push({ __bu: String(bu).trim() });
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  };

  const agg = await CallTask.aggregate([
    ...base,
    {
      $addFields: {
        __territory: {
          $trim: {
            input: {
              $ifNull: ['$activityId.territoryName', { $ifNull: ['$activityId.territory', ''] }],
            },
          },
        },
        __zone: { $trim: { input: { $ifNull: ['$activityId.zoneName', ''] } } },
        __bu: { $trim: { input: { $ifNull: ['$activityId.buName', ''] } } },
      },
    },
    {
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
    },
  ]);

  const first = agg?.[0] || {};
  const stripEmpty = (arr: any[]) => arr.filter((v) => v !== '' && v !== null && v !== undefined);
  const sortAlpha = (a: any, b: any) => String(a).localeCompare(String(b));

  const territoryOptions = stripEmpty(first?.territory?.[0]?.values || []).sort(sortAlpha);
  const zoneOptions = stripEmpty(first?.zone?.[0]?.values || []).sort(sortAlpha);
  const buOptions = stripEmpty(first?.bu?.[0]?.values || []).sort(sortAlpha);

  return { territoryOptions, zoneOptions, buOptions };
};

/**
 * Get unassigned tasks (Team Lead / Admin)
 * These tasks are created by sampling and must be assigned by Team Lead (manual or auto later).
 */
export const getUnassignedTasks = async (filters?: {
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  limit?: number;
}) => {
  try {
    const { dateFrom, dateTo, page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const query: any = { ...callTaskNeedsAgentMongoFilter() };

    if (dateFrom || dateTo) {
      query.scheduledDate = {};
      if (dateFrom) {
        const fromDate = typeof dateFrom === 'string' ? new Date(dateFrom) : dateFrom;
        fromDate.setHours(0, 0, 0, 0);
        query.scheduledDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = typeof dateTo === 'string' ? new Date(dateTo) : dateTo;
        toDate.setHours(23, 59, 59, 999);
        query.scheduledDate.$lte = toDate;
      }
    }

    const tasks = await CallTask.find(query)
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
      .sort({ scheduledDate: 1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Performance: return plain objects for read-only display

    const total = await CallTask.countDocuments(query);

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    logger.error('Error fetching unassigned tasks:', error);
    throw error;
  }
};

/**
 * Get team tasks (for Team Lead)
 */
export const getTeamTasks = async (teamLeadId: string, filters?: {
  status?: TaskStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  limit?: number;
}) => {
  try {
    // Find all agents assigned to this team lead
    const teamAgents = await User.find({
      teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
      role: 'cc_agent',
      isActive: true,
    }).select('_id').lean(); // Performance: return plain objects

    const agentIds = teamAgents.map(agent => agent._id);

    const { status, dateFrom, dateTo, page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const query: any = {
      assignedAgentId: { $in: agentIds },
    };

    // CRITICAL: Apply status filter if provided (check for truthy AND not empty string)
    if (status && status.trim() !== '') {
      query.status = status.trim();
      logger.info('✅ Filtering team tasks by status', { 
        teamLeadId, 
        status, 
        statusType: typeof status,
        statusTrimmed: status.trim(),
        queryStatus: query.status 
      });
    } else {
      logger.info('⚠️ No status filter applied', { 
        teamLeadId, 
        status, 
        statusType: typeof status,
        filters 
      });
    }

    // Filter by scheduled date range
    if (dateFrom || dateTo) {
      query.scheduledDate = {};
      if (dateFrom) {
        const fromDate = typeof dateFrom === 'string' ? new Date(dateFrom) : dateFrom;
        fromDate.setHours(0, 0, 0, 0);
        query.scheduledDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = typeof dateTo === 'string' ? new Date(dateTo) : dateTo;
        toDate.setHours(23, 59, 59, 999);
        query.scheduledDate.$lte = toDate;
      }
    }

    logger.info('🔍 Team tasks query being executed', { 
      teamLeadId, 
      agentIdsCount: agentIds.length, 
      query: JSON.stringify(query), 
      page, 
      limit,
      skip
    });

    const tasks = await CallTask.find(query)
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      .populate('activityId', 'type date officerName location territory crops products')
      .populate('assignedAgentId', 'name email employeeId')
      .sort({ scheduledDate: 1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Performance: return plain objects for read-only display

    const total = await CallTask.countDocuments(query);

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    logger.error('Error fetching team tasks:', error);
    throw error;
  }
};

/**
 * Assign task to agent based on language capabilities
 */
export const assignTaskToAgent = async (
  taskId: string,
  agentId: string
): Promise<ICallTask> => {
  try {
    const task = await CallTask.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Prevent reopening terminal tasks
    const terminalStatuses: ICallTask['status'][] = ['completed', 'not_reachable', 'invalid_number', 'cancelled'];
    if (terminalStatuses.includes(task.status)) {
      const err: any = new Error(`Cannot reassign a task in terminal state "${task.status}"`);
      err.statusCode = 400;
      throw err;
    }

    // Verify agent exists and is active
    const agent = await User.findById(agentId);
    if (!agent || !agent.isActive || agent.role !== 'cc_agent') {
      throw new Error('Invalid agent');
    }

    // Get farmer to check language
    const farmer = await Farmer.findById(task.farmerId);
    if (farmer && !agent.languageCapabilities.includes(farmer.preferredLanguage)) {
      logger.warn(`Agent ${agent.email} does not have language capability for farmer ${farmer.preferredLanguage}`);
    }

    task.assignedAgentId = new mongoose.Types.ObjectId(agentId);
    task.status = 'sampled_in_queue';
    await task.save();

    logger.info(`Task ${taskId} assigned to agent ${agent.email}`);

    return task;
  } catch (error) {
    logger.error('Error assigning task:', error);
    throw error;
  }
};

/**
 * Auto-assign tasks based on language capabilities
 * Optimized: Uses aggregation instead of N+1 queries for task counts
 */
export const autoAssignTask = async (taskId: string): Promise<ICallTask | null> => {
  try {
    const task = await CallTask.findById(taskId).populate('farmerId');
    if (!task) {
      throw new Error('Task not found');
    }

    const farmer = task.farmerId as any;
    if (!farmer) {
      throw new Error('Farmer not found');
    }

    // Find agents with matching language capability
    const agents = await User.find({
      role: 'cc_agent',
      isActive: true,
      languageCapabilities: farmer.preferredLanguage,
    }).lean();

    if (agents.length === 0) {
      logger.warn(`No agents found with language capability: ${farmer.preferredLanguage}`);
      return null;
    }

    const agentIds = agents.map(a => a._id);

    // OPTIMIZED: Get task counts for all agents in a single aggregation query
    // instead of N separate countDocuments calls
    const taskCountsAgg = await CallTask.aggregate([
      {
        $match: {
          assignedAgentId: { $in: agentIds },
          status: { $in: ['sampled_in_queue', 'in_progress'] },
        },
      },
      {
        $group: {
          _id: '$assignedAgentId',
          count: { $sum: 1 },
        },
      },
    ]);

    // Create a map of agent ID to task count
    const taskCountMap = new Map<string, number>();
    taskCountsAgg.forEach((item) => {
      taskCountMap.set(item._id.toString(), item.count);
    });

    // Build agent task counts array (agents with no tasks have count 0)
    const agentTaskCounts = agents.map((agent) => ({
      agent,
      count: taskCountMap.get(agent._id.toString()) || 0,
    }));

    // Sort by task count (ascending) and pick the first one
    agentTaskCounts.sort((a, b) => a.count - b.count);
    const selectedAgent = agentTaskCounts[0].agent;

    task.assignedAgentId = new mongoose.Types.ObjectId(selectedAgent._id.toString());
    task.status = 'sampled_in_queue';
    await task.save();

    logger.info(`Task ${taskId} auto-assigned to agent ${selectedAgent.email} (had ${agentTaskCounts[0].count} pending tasks)`);

    return task;
  } catch (error) {
    logger.error('Error auto-assigning task:', error);
    throw error;
  }
};

/**
 * Update task status
 */
export const updateTaskStatus = async (
  taskId: string,
  status: TaskStatus,
  notes?: string
): Promise<ICallTask> => {
  try {
    // Validate taskId is a valid MongoDB ObjectId format
    // This prevents "bulk" or other invalid strings from being passed to findById
    if (!taskId || !/^[0-9a-fA-F]{24}$/.test(taskId)) {
      logger.error('Invalid taskId provided to updateTaskStatus', { taskId, status });
      throw new Error(`Invalid task ID format: ${taskId}`);
    }

    const task = await CallTask.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const previousStatus = task.status;
    task.status = status;

    // Add to interaction history
    if (notes || previousStatus !== status) {
      task.interactionHistory.push({
        timestamp: new Date(),
        status: task.status,
        notes: notes || `Status changed from ${previousStatus} to ${status}`,
      });
    }

    await task.save();

    logger.info(`Task ${taskId} status updated to ${status}`);

    return task;
  } catch (error) {
    logger.error('Error updating task status:', error);
    throw error;
  }
};

export interface BulkCancelInput {
  taskIds?: string[];
  agentId?: string;
  supersedeActivities?: boolean;
  activityDateFrom?: string | Date;
  activityDateTo?: string | Date;
}

export interface BulkCancelPreviewResult {
  tasksToCancel: number;
  tasksSkippedInProgress: number;
  tasksSkippedOther: number;
  activitiesToSupersede: number;
}

export interface BulkCancelResult {
  cancelled: number;
  skippedInProgress: number;
  skippedOther: number;
  supersededActivities: number;
}

const getTeamAgentObjectIds = async (teamLeadId: string): Promise<mongoose.Types.ObjectId[]> => {
  const agents = await User.find({
    teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
    role: 'cc_agent',
    isActive: true,
  })
    .select('_id')
    .lean();
  return agents.map((a) => a._id as mongoose.Types.ObjectId);
};

const assertAgentInTeam = async (agentId: string, teamLeadId: string): Promise<void> => {
  const agent = await User.findById(agentId).select('_id role teamLeadId').lean();
  if (!agent) {
    const err: any = new Error('Agent not found');
    err.statusCode = 404;
    throw err;
  }
  if ((agent as any).role !== 'cc_agent') {
    const err: any = new Error('User is not a CC agent');
    err.statusCode = 400;
    throw err;
  }
  const agentTeamLeadId = (agent as any).teamLeadId?.toString?.() || null;
  if (agentTeamLeadId !== teamLeadId) {
    const err: any = new Error('Agent is not in your team');
    err.statusCode = 403;
    throw err;
  }
};

const assertTasksInTeam = async (taskIds: string[], teamLeadId: string): Promise<void> => {
  const teamAgentIds = await getTeamAgentObjectIds(teamLeadId);
  const teamAgentIdSet = new Set(teamAgentIds.map((id) => id.toString()));
  const tasks = await CallTask.find({ _id: { $in: taskIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('assignedAgentId')
    .lean();

  if (tasks.length !== taskIds.length) {
    const err: any = new Error('One or more tasks were not found');
    err.statusCode = 404;
    throw err;
  }

  for (const task of tasks) {
    const assignedId = (task as any).assignedAgentId?.toString?.() || null;
    if (!assignedId || !teamAgentIdSet.has(assignedId)) {
      const err: any = new Error('One or more tasks are not in your team scope');
      err.statusCode = 403;
      throw err;
    }
  }
};

const buildBulkCancelScopeQuery = (input: BulkCancelInput): Record<string, unknown> => {
  const { taskIds, agentId } = input;
  if (!agentId && (!taskIds || taskIds.length === 0)) {
    const err: any = new Error('Either agentId or taskIds is required');
    err.statusCode = 400;
    throw err;
  }

  const query: Record<string, unknown> = {};
  if (agentId) {
    query.assignedAgentId = new mongoose.Types.ObjectId(agentId);
  }
  if (taskIds && taskIds.length > 0) {
    query._id = { $in: taskIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  return query;
};

const countActivitiesToSupersede = async (
  supersedeActivities?: boolean,
  activityDateFrom?: string | Date,
  activityDateTo?: string | Date
): Promise<number> => {
  if (!supersedeActivities) return 0;

  const fromDate = parseQueryDateFrom(activityDateFrom);
  const toDate = parseQueryDateTo(activityDateTo);
  if (!fromDate || !toDate) {
    const err: any = new Error('activityDateFrom and activityDateTo are required when supersedeActivities is true');
    err.statusCode = 400;
    throw err;
  }
  if (fromDate > toDate) {
    const err: any = new Error('activityDateFrom must be on or before activityDateTo');
    err.statusCode = 400;
    throw err;
  }

  return Activity.countDocuments({
    lifecycleStatus: 'active',
    date: { $gte: fromDate, $lte: toDate },
  });
};

const supersedeActiveActivitiesInRange = async (
  activityDateFrom?: string | Date,
  activityDateTo?: string | Date
): Promise<number> => {
  const fromDate = parseQueryDateFrom(activityDateFrom);
  const toDate = parseQueryDateTo(activityDateTo);
  if (!fromDate || !toDate) {
    const err: any = new Error('activityDateFrom and activityDateTo are required when supersedeActivities is true');
    err.statusCode = 400;
    throw err;
  }

  const result = await Activity.updateMany(
    {
      lifecycleStatus: 'active',
      date: { $gte: fromDate, $lte: toDate },
    },
    {
      $set: {
        lifecycleStatus: 'superseded',
        lifecycleUpdatedAt: new Date(),
      },
    }
  );

  return result.modifiedCount || 0;
};

export const previewBulkCancelTasks = async (
  input: BulkCancelInput,
  actor: { role: string; userId: string }
): Promise<BulkCancelPreviewResult> => {
  const scopeQuery = buildBulkCancelScopeQuery(input);

  if (actor.role === 'team_lead') {
    if (input.agentId) {
      await assertAgentInTeam(input.agentId, actor.userId);
    }
    if (input.taskIds?.length) {
      await assertTasksInTeam(input.taskIds, actor.userId);
    }
  }

  const baseMatch = { ...scopeQuery };
  const [tasksToCancel, tasksSkippedInProgress, tasksSkippedOther, activitiesToSupersede] = await Promise.all([
    CallTask.countDocuments({ ...baseMatch, status: 'sampled_in_queue' }),
    CallTask.countDocuments({ ...baseMatch, status: 'in_progress' }),
    CallTask.countDocuments({
      ...baseMatch,
      status: { $nin: ['sampled_in_queue', 'in_progress'] },
    }),
    countActivitiesToSupersede(input.supersedeActivities, input.activityDateFrom, input.activityDateTo),
  ]);

  return {
    tasksToCancel,
    tasksSkippedInProgress,
    tasksSkippedOther,
    activitiesToSupersede,
  };
};

export const bulkCancelTasks = async (
  input: BulkCancelInput,
  actor: { role: string; userId: string }
): Promise<BulkCancelResult> => {
  const scopeQuery = buildBulkCancelScopeQuery(input);

  if (actor.role === 'team_lead') {
    if (input.agentId) {
      await assertAgentInTeam(input.agentId, actor.userId);
    }
    if (input.taskIds?.length) {
      await assertTasksInTeam(input.taskIds, actor.userId);
    }
  }

  const preview = await previewBulkCancelTasks(input, actor);
  const now = new Date();

  const cancelResult = await CallTask.updateMany(
    { ...scopeQuery, status: 'sampled_in_queue' },
    {
      $set: { status: 'cancelled' },
      $push: {
        interactionHistory: {
          timestamp: now,
          status: 'cancelled',
          notes: input.agentId
            ? `Bulk cancel queue for agent ${input.agentId}`
            : 'Bulk cancel selected tasks',
        },
      },
    }
  );

  let supersededActivities = 0;
  if (input.supersedeActivities) {
    supersededActivities = await supersedeActiveActivitiesInRange(
      input.activityDateFrom,
      input.activityDateTo
    );
  }

  logger.info('Bulk cancel completed', {
    actorId: actor.userId,
    actorRole: actor.role,
    cancelled: cancelResult.modifiedCount || 0,
    skippedInProgress: preview.tasksSkippedInProgress,
    supersededActivities,
  });

  return {
    cancelled: cancelResult.modifiedCount || 0,
    skippedInProgress: preview.tasksSkippedInProgress,
    skippedOther: preview.tasksSkippedOther,
    supersededActivities,
  };
};
