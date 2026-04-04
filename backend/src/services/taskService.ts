import { CallTask, ICallTask, TaskStatus } from '../models/CallTask.js';
import { User } from '../models/User.js';
import { Farmer } from '../models/Farmer.js';
import { Activity } from '../models/Activity.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import * as XLSX from 'xlsx';

export interface TaskAssignmentOptions {
  agentId?: string;
  language?: string;
  territory?: string;
}

/**
 * Mongo match: task has no CC agent on file — `assignedAgentId` is null, absent, or empty.
 * Sampling "Unassigned", getUnassignedTasks, and allocation use this so counts match the DB field, not only `status`.
 */
export const callTaskNoAgentAssignedMatch = (): Record<string, unknown> => ({
  $or: [
    { assignedAgentId: null },
    { assignedAgentId: { $exists: false } },
    { assignedAgentId: '' },
  ],
});

/**
 * Tasks that still need assignment: no agent (see `callTaskNoAgentAssignedMatch`) and not in a terminal call outcome.
 */
export const callTaskNeedsAgentMongoFilter = (): Record<string, unknown> => ({
  status: { $nin: ['completed', 'not_reachable', 'invalid_number'] },
  ...callTaskNoAgentAssignedMatch(),
});

/**
 * Get all tasks for an agent that can be shown in the dialer (queue/in-progress + completed outcomes)
 * Returns list of tasks sorted by scheduledDate (earliest first)
 * Note: Returns lean documents (plain objects) for better performance
 */
export const getAvailableTasksForAgent = async (agentId: string): Promise<any[]> => {
  try {
    // Get agent to check language capabilities
    const agent = await User.findById(agentId);
    if (!agent || !agent.isActive || agent.role !== 'cc_agent') {
      throw new Error('Invalid or inactive agent');
    }

    // Get tasks assigned to agent with correct status
    // Note: Removed scheduledDate filter to show all tasks regardless of due date
    // Agents should be able to see and work on tasks immediately after sampling
    const tasks = await CallTask.find({
      assignedAgentId: new mongoose.Types.ObjectId(agentId),
      status: { $in: ['sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number'] },
    })
      .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
      // Agent view needs: FDA (officerName), TM, Territory, State (+ optional legacy territory)
      .populate('activityId', 'type date officerName tmName location territory territoryName state crops products')
      .sort({ scheduledDate: 1 }) // Earliest first
      .limit(50) // Reasonable limit
      .lean(); // Performance: return plain objects for read-only display

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
 * Get the next pending task for an agent
 * Prioritizes tasks by scheduledDate (earliest first)
 * Also returns in_progress tasks if agent is already working on them
 * Note: Returns lean document (plain object) for better performance
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
    const terminalStatuses: ICallTask['status'][] = ['completed', 'not_reachable', 'invalid_number'];
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
