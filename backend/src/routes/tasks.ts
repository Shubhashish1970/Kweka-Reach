import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult, query, param } from 'express-validator';
import { CallTask, ICallLog, TaskStatus } from '../models/CallTask.js';
import { User } from '../models/User.js';
import { Farmer } from '../models/Farmer.js';
import { AllocationRun } from '../models/AllocationRun.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getNextTaskForAgent,
  getAvailableTasksForAgent,
  getPendingTasks,
  getPendingTasksFilterOptions,
  getTeamTasks,
  getUnassignedTasks,
  assignTaskToAgent,
  updateTaskStatus,
  callTaskNeedsAgentMongoFilter,
} from '../services/taskService.js';
import { getOutcomeFromStatus } from '../utils/outcomeHelper.js';
import { getAgentQueue } from '../services/adminService.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Middleware to log route matching for debugging
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.includes('/bulk/')) {
    logger.info('Route matched (bulk):', { 
      method: req.method, 
      path: req.path, 
      originalUrl: req.originalUrl || req.url 
    });
  }
  next();
});

// @route   GET /api/tasks/available
// @desc    Get all available tasks for CC Agent (for selection)
// @access  Private (CC Agent only)
router.get(
  '/available',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const tasks = await getAvailableTasksForAgent(agentId);

      // Format tasks for response
      const formattedTasks = tasks.map((task) => {
        const farmer = task.farmerId as any;
        const activity = task.activityId as any;
        
        return {
          taskId: task._id.toString(),
          farmer: {
            name: farmer?.name || 'Unknown',
            mobileNumber: farmer?.mobileNumber || 'Unknown',
            location: farmer?.location || 'Unknown',
            preferredLanguage: farmer?.preferredLanguage || 'Unknown',
            photoUrl: farmer?.photoUrl,
          },
          activity: {
            type: activity?.type || 'Unknown',
            date: activity?.date || task.createdAt,
            // Agent-facing: FDA + TM + Territory + State
            officerName: activity?.officerName || 'Unknown', // FDA
            tmName: activity?.tmName || '',
            location: activity?.location || 'Unknown',
            territory: activity?.territoryName || activity?.territory || 'Unknown',
            state: activity?.state || '',
            crops: Array.isArray(activity?.crops) ? activity.crops : (activity?.crops ? [activity.crops] : []),
            products: Array.isArray(activity?.products) ? activity.products : (activity?.products ? [activity.products] : []),
          },
          status: task.status,
          scheduledDate: task.scheduledDate,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          // Callback fields
          isCallback: task.isCallback || false,
          callbackNumber: task.callbackNumber || 0,
          parentTaskId: task.parentTaskId?.toString() || null,
        };
      });

      res.json({
        success: true,
        data: {
          tasks: formattedTasks,
          count: formattedTasks.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/tasks/:id/load
// @desc    Load a specific task for CC Agent (sets status to in_progress)
// @access  Private (CC Agent only)
router.post(
  '/:id/load',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const taskId = req.params.id;

      // Get and verify task
      const task = await CallTask.findById(taskId)
        .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
        .populate('activityId', 'type date officerName tmName location territory territoryName state crops products');

      if (!task) {
        const error: AppError = new Error('Task not found');
        error.statusCode = 404;
        throw error;
      }

      // Verify task is assigned to this agent
      if (!task.assignedAgentId || task.assignedAgentId.toString() !== agentId) {
        const error: AppError = new Error('Task not assigned to you');
        error.statusCode = 403;
        throw error;
      }

      // Allow queue/active tasks plus terminal outcomes so agents can resume a follow-up call
      // (e.g. submitted No Answer earlier, farmer calls back later).
      const loadable: string[] = [
        'sampled_in_queue',
        'in_progress',
        'not_reachable',
        'invalid_number',
        'completed',
      ];
      if (!loadable.includes(String(task.status))) {
        const error: AppError = new Error('Task is not available to load');
        error.statusCode = 400;
        throw error;
      }

      // IMPORTANT: Do NOT auto-move to in_progress on load.
      // Status should move to in_progress only after agent selects an Outbound Status.

      // Format activity data
      const activity = task.activityId as any;
      // State should come from Activity API v2; keep legacy fallback only if state missing.
      const territory = activity?.territoryName || activity?.territory || 'Unknown';
      const state = activity?.state || (territory !== 'Unknown' ? territory.replace(/\s+Zone$/, '').trim() : '');
      
      const activityData = activity ? {
        type: activity.type || 'Unknown',
        date: activity.date || new Date(),
        officerName: activity.officerName || 'Unknown',
        tmName: activity.tmName || '',
        location: activity.location || 'Unknown', // village
        territory: territory,
        state: state,
        crops: Array.isArray(activity.crops) ? activity.crops : (activity.crops ? [activity.crops] : []),
        products: Array.isArray(activity.products) ? activity.products : (activity.products ? [activity.products] : []),
      } : null;

      res.json({
        success: true,
        data: {
          taskId: task._id,
          farmer: task.farmerId,
          activity: activityData,
          status: task.status,
          outcome: task.outcome || null, // Include stored outcome
          scheduledDate: task.scheduledDate,
          callStartedAt: task.callStartedAt,
          callLog: task.callLog || null, // Include callLog for completed tasks
          updatedAt: task.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/tasks/:id/mark-in-progress
// @desc    Mark task as in_progress (called when agent selects Outbound Status)
// @access  Private (CC Agent only)
router.post(
  '/:id/mark-in-progress',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const taskId = req.params.id;

      const task = await CallTask.findById(taskId);
      if (!task) {
        const error: AppError = new Error('Task not found');
        error.statusCode = 404;
        throw error;
      }

      if (!task.assignedAgentId || task.assignedAgentId.toString() !== agentId) {
        const error: AppError = new Error('Task not assigned to you');
        error.statusCode = 403;
        throw error;
      }

      if (task.status === 'sampled_in_queue') {
        // First meaningful action by agent -> mark attempt start
        if (!(task as any).callStartedAt) {
          (task as any).callStartedAt = new Date();
        }
        task.status = 'in_progress';
        task.outcome = getOutcomeFromStatus('in_progress');
        task.interactionHistory.push({
          timestamp: new Date(),
          status: 'in_progress',
          notes: 'Outbound status selected by agent',
        });
        await task.save();
      } else if (['not_reachable', 'invalid_number', 'completed'].includes(task.status)) {
        // Follow-up attempt after a prior submission (History → Continue in dialer)
        task.status = 'in_progress';
        task.outcome = getOutcomeFromStatus('in_progress');
        task.interactionHistory.push({
          timestamp: new Date(),
          status: 'in_progress',
          notes: 'Follow-up attempt from agent workspace',
        });
        await task.save();
      }

      res.json({ success: true, data: { taskId: task._id.toString(), status: task.status, callStartedAt: (task as any).callStartedAt || null } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/history
// @desc    Agent History (all own tasks except sampled_in_queue), with filters
// @access  Private (CC Agent)
router.get(
  '/own/history',
  requirePermission('tasks.view.own'),
  [
    query('status').optional().isIn(['in_progress', 'completed', 'not_reachable', 'invalid_number']),
    query('territory').optional().isString(),
    query('activityType').optional().isString(),
    query('search').optional().isString(),
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

      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();

      const { status, territory, activityType, search, dateFrom, dateTo, page, limit } = req.query as any;
      const p = page ? Number(page) : 1;
      const l = limit ? Number(limit) : 20;
      const skip = (p - 1) * l;

      const baseMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: { $ne: 'sampled_in_queue' },
      };
      if (status) baseMatch.status = String(status) as TaskStatus;

      // Date filter: use updatedAt as primary filter to show all tasks updated in the date range
      // Also include tasks where callStartedAt is in range but updatedAt might be null/outside range
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);
        
        // Primary: updatedAt in range (catches all tasks updated on the date)
        // Secondary: callStartedAt in range but updatedAt not set or outside range
        const dateConditions: any[] = [];
        
        if (from && to) {
          dateConditions.push(
            { updatedAt: { $gte: from, $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        } else if (from) {
          dateConditions.push(
            { updatedAt: { $gte: from } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } }
                ]}
              ]
            }
          );
        } else if (to) {
          dateConditions.push(
            { updatedAt: { $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        }
        
        if (dateConditions.length > 0) {
          baseMatch.$or = dateConditions;
        }
      }

      const normalizedSearch = String(search || '').trim();
      const hasActivityFilters = !!String(territory || '').trim() || !!String(activityType || '').trim();

      if (normalizedSearch || hasActivityFilters) {
        const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'i');

        const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;

        const agg = await CallTask.aggregate([
          { $match: baseMatch },
          { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
          { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
          { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
          ...(String(activityType || '').trim()
            ? [{ $match: { 'activityId.type': String(activityType).trim() } }]
            : []),
          ...(String(territory || '').trim()
            ? [
                {
                  $match: {
                    $or: [
                      { 'activityId.territoryName': String(territory).trim() },
                      { 'activityId.territory': String(territory).trim() },
                    ],
                  },
                },
              ]
            : []),
          ...(normalizedSearch
            ? [
                {
                  $match: {
                    $or: [
                      { 'farmerId.name': re },
                      { 'farmerId.mobileNumber': re },
                      { 'farmerId.location': re },
                      { 'farmerId.preferredLanguage': re },
                      { 'activityId.type': re },
                      { 'activityId.officerName': re },
                      { 'activityId.tmName': re },
                      { 'activityId.territoryName': re },
                      { 'activityId.territory': re },
                      { 'activityId.state': re },
                      { 'activityId.activityId': re },
                    ],
                  },
                },
              ]
            : []),
          { $sort: { updatedAt: -1 } },
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: l }],
              total: [{ $count: 'count' }],
            },
          },
        ]);

        const tasks = agg?.[0]?.data || [];
        const total = agg?.[0]?.total?.[0]?.count || 0;

        return res.json({
          success: true,
          data: {
            tasks,
            pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) },
          },
        });
      }

      const tasks = await CallTask.find(baseMatch)
        .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
        .populate('activityId', 'activityId type date officerName tmName location territory territoryName state zoneName buName')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(l)
        .lean();

      const total = await CallTask.countDocuments(baseMatch);

      res.json({
        success: true,
        data: {
          tasks,
          pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/history/export
// @desc    Export agent history (filtered) as Excel (ALL rows for current filters)
// @access  Private (CC Agent)
// NOTE: This route must come BEFORE /own/history/:id to avoid "export" being treated as an ID
router.get(
  '/own/history/export',
  requirePermission('tasks.view.own'),
  [
    query('status').optional().isIn(['in_progress', 'completed', 'not_reachable', 'invalid_number']),
    query('territory').optional().isString(),
    query('activityType').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('limit').optional().isInt({ min: 1, max: 5000 }),
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

      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const { status, territory, activityType, search, dateFrom, dateTo, limit } = req.query as any;
      const max = limit ? Number(limit) : 5000;

      const baseMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: { $ne: 'sampled_in_queue' },
      };
      if (status) baseMatch.status = String(status) as TaskStatus;

      // Use same date filter logic as history endpoint
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);
        
        const dateConditions: any[] = [];
        
        if (from && to) {
          dateConditions.push(
            { updatedAt: { $gte: from, $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        } else if (from) {
          dateConditions.push(
            { updatedAt: { $gte: from } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } }
                ]}
              ]
            }
          );
        } else if (to) {
          dateConditions.push(
            { updatedAt: { $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        }
        
        if (dateConditions.length > 0) {
          baseMatch.$or = dateConditions;
        }
      }

      const normalizedSearch = String(search || '').trim();
      const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = normalizedSearch ? new RegExp(escaped, 'i') : null;

      const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;
      const normTerritory = String(territory || '').trim();
      const normType = String(activityType || '').trim();

      const tasks = await CallTask.aggregate([
        { $match: baseMatch },
        { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
        { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
        { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
        ...(normType ? [{ $match: { 'activityId.type': normType } }] : []),
        ...(normTerritory
          ? [
              {
                $match: {
                  $or: [{ 'activityId.territoryName': normTerritory }, { 'activityId.territory': normTerritory }],
                },
              },
            ]
          : []),
        ...(re
          ? [
              {
                $match: {
                  $or: [
                    { 'farmerId.name': re },
                    { 'farmerId.mobileNumber': re },
                    { 'farmerId.location': re },
                    { 'farmerId.preferredLanguage': re },
                    { 'activityId.type': re },
                    { 'activityId.officerName': re },
                    { 'activityId.tmName': re },
                    { 'activityId.territoryName': re },
                    { 'activityId.territory': re },
                    { 'activityId.state': re },
                    { 'activityId.activityId': re },
                  ],
                },
              },
            ]
          : []),
        { $sort: { updatedAt: -1 } },
        { $limit: max },
      ]);

      const pad2 = (n: number) => String(n).padStart(2, '0');
      
      // Format date-time as DD/MM/YYYY HH:MM:SS
      const fmtDateTime = (d: any) => {
        const dt = d ? new Date(d) : null;
        if (!dt || Number.isNaN(dt.getTime())) return '';
        return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
      };
      
      // Format date as DD/MM/YYYY (for Updated column)
      const fmtDate = (d: any) => {
        const dt = d ? new Date(d) : null;
        return dt && !Number.isNaN(dt.getTime()) ? `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}` : '';
      };
      
      // Format duration from seconds to HH:MM:SS or MM:SS
      const fmtDuration = (seconds: number | null | undefined): string => {
        if (!seconds || seconds <= 0) return '';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
          return `${hrs}:${pad2(mins)}:${pad2(secs)}`;
        }
        return `${mins}:${pad2(secs)}`;
      };
      
      // Calculate call end time from start time + duration
      const getCallEndTime = (callStartedAt: any, callDurationSeconds: number | null | undefined): Date | null => {
        if (!callStartedAt || !callDurationSeconds || callDurationSeconds <= 0) return null;
        const start = new Date(callStartedAt);
        if (Number.isNaN(start.getTime())) return null;
        return new Date(start.getTime() + callDurationSeconds * 1000);
      };

      const sheetRows = tasks.map((t: any) => {
        const farmer = t.farmerId || {};
        const activity = t.activityId || {};
        const territoryStr = String((activity.territoryName || activity.territory || '')).trim();
        const callStartedAt = t.callStartedAt;
        const callDurationSeconds = t.callLog?.callDurationSeconds;
        const callEndedAt = getCallEndTime(callStartedAt, callDurationSeconds);
        
        return {
          'Task ID': String(t._id),
          'FFA Activity ID': String(activity.activityId || ''),
          'Activity Type': String(activity.type || ''),
          Territory: territoryStr,
          State: String(activity.state || ''),
          Farmer: String(farmer.name || ''),
          Mobile: String(farmer.mobileNumber || ''),
          Language: String(farmer.preferredLanguage || ''),
          Outcome: String(t.outcome || ''),
          'Outbound Status': String(t.callLog?.callStatus || ''),
          'Call Started': fmtDateTime(callStartedAt),
          'Call Ended': fmtDateTime(callEndedAt),
          'Duration': fmtDuration(callDurationSeconds),
          Updated: fmtDate(t.updatedAt || ''),
          'Farmer Comments': String(t.callLog?.farmerComments || ''),
          Sentiment: String(t.callLog?.sentiment || ''),
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Agent History');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const now = new Date();
      const filename = `agent_history_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(
        now.getMinutes()
      )}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/history/options
// @desc    Distinct territory & activity type for filters — all assigned tasks in date range (ignores status/territory/search so lists stay complete)
// @access  Private (CC Agent)
router.get(
  '/own/history/options',
  requirePermission('tasks.view.own'),
  [
    query('status').optional().isIn(['in_progress', 'completed', 'not_reachable', 'invalid_number']),
    query('territory').optional().isString(),
    query('activityType').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
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

      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const { dateFrom, dateTo } = req.query as any;

      const baseMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
      };

      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);

        const dateConditions: any[] = [];

        if (from && to) {
          dateConditions.push(
            { updatedAt: { $gte: from, $lte: to } },
            {
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from, $lte: to } },
                {
                  $or: [
                    { updatedAt: { $exists: false } },
                    { updatedAt: null },
                    { updatedAt: { $lt: from } },
                    { updatedAt: { $gt: to } },
                  ],
                },
              ],
            }
          );
        } else if (from) {
          dateConditions.push(
            { updatedAt: { $gte: from } },
            {
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from } },
                {
                  $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }, { updatedAt: { $lt: from } }],
                },
              ],
            }
          );
        } else if (to) {
          dateConditions.push(
            { updatedAt: { $lte: to } },
            {
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $lte: to } },
                {
                  $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }, { updatedAt: { $gt: to } }],
                },
              ],
            }
          );
        }

        if (dateConditions.length > 0) {
          baseMatch.$or = dateConditions;
        }
      }

      const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;

      const basePipeline: any[] = [
        { $match: baseMatch },
        { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
        { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
        { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            __territory: {
              $trim: {
                input: {
                  $ifNull: ['$activityId.territoryName', { $ifNull: ['$activityId.territory', ''] }],
                },
              },
            },
            __activityType: { $trim: { input: { $ifNull: ['$activityId.type', ''] } } },
          },
        },
      ];

      const stripEmpty = (arr: any[]) => (Array.isArray(arr) ? arr.filter((v) => v !== '' && v !== null && v !== undefined) : []);

      const agg = await CallTask.aggregate([
        ...basePipeline,
        {
          $facet: {
            territory: [
              { $group: { _id: null, values: { $addToSet: '$__territory' } } },
              { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
            ],
            activityType: [
              { $group: { _id: null, values: { $addToSet: '$__activityType' } } },
              { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
            ],
          },
        },
      ]);

      const territoryOptions = stripEmpty(agg?.[0]?.territory?.[0]?.values || [])
        .map((s: any) => String(s || '').trim())
        .filter((s: string) => !!s)
        .sort((a: string, b: string) => a.localeCompare(b));

      const activityTypeOptions = stripEmpty(agg?.[0]?.activityType?.[0]?.values || [])
        .map((s: any) => String(s || '').trim())
        .filter((s: string) => !!s)
        .sort((a: string, b: string) => a.localeCompare(b));

      res.json({ success: true, data: { territoryOptions, activityTypeOptions } });
    } catch (error: any) {
      logger.error(`Error in /own/history/options endpoint for agent ${(req as AuthRequest).user._id}:`, {
        error: error?.message,
        stack: error?.stack,
        query: req.query,
      });
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/history/stats
// @desc    Agent History stats strip (filter-based, not paginated)
// @access  Private (CC Agent)
router.get(
  '/own/history/stats',
  requirePermission('tasks.view.own'),
  [
    query('status').optional().isIn(['in_progress', 'completed', 'not_reachable', 'invalid_number']),
    query('territory').optional().isString(),
    query('activityType').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user?._id?.toString() || 'unknown';
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { status, territory, activityType, search, dateFrom, dateTo } = req.query as any;

      const baseMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: { $ne: 'sampled_in_queue' },
      };
      if (status) baseMatch.status = String(status) as TaskStatus;

      // Date filter: MUST match history endpoint logic exactly
      // History endpoint uses $or with both updatedAt and callStartedAt
      if (dateFrom || dateTo) {
        // dateFrom and dateTo are already Date objects from validation middleware (.toDate())
        // But handle both Date objects and strings defensively
        let from: Date | null = null;
        let to: Date | null = null;
        
        if (dateFrom) {
          from = dateFrom instanceof Date ? new Date(dateFrom) : new Date(dateFrom as string);
          if (!isNaN(from.getTime())) {
            from.setHours(0, 0, 0, 0);
          } else {
            from = null;
          }
        }
        if (dateTo) {
          to = dateTo instanceof Date ? new Date(dateTo) : new Date(dateTo as string);
          if (!isNaN(to.getTime())) {
            to.setHours(23, 59, 59, 999);
          } else {
            to = null;
          }
        }
        
        // Use the EXACT same date filter logic as history endpoint
        // Primary: updatedAt in range (catches all tasks updated on the date)
        // Secondary: callStartedAt in range but updatedAt not set or outside range
        const dateConditions: any[] = [];
        
        if (from && to) {
          dateConditions.push(
            { updatedAt: { $gte: from, $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        } else if (from) {
          dateConditions.push(
            { updatedAt: { $gte: from } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $gte: from } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $lt: from } }
                ]}
              ]
            }
          );
        } else if (to) {
          dateConditions.push(
            { updatedAt: { $lte: to } },
            { 
              $and: [
                { callStartedAt: { $exists: true, $ne: null, $lte: to } },
                { $or: [
                  { updatedAt: { $exists: false } },
                  { updatedAt: null },
                  { updatedAt: { $gt: to } }
                ]}
              ]
            }
          );
        }
        
        if (dateConditions.length > 0) {
          baseMatch.$or = dateConditions;
        }
      }

      const normalizedSearch = String(search || '').trim();
      const hasActivityFilters = !!String(territory || '').trim() || !!String(activityType || '').trim();

      const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;
      const normTerritory = String(territory || '').trim();
      const normType = String(activityType || '').trim();
      const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = normalizedSearch ? new RegExp(escaped, 'i') : null;

      const filteredHistoryPrefix: any[] = [
        { $match: baseMatch },
        { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
        { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
        { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
        ...(normType ? [{ $match: { 'activityId.type': normType } }] : []),
        ...(normTerritory
          ? [
              {
                $match: {
                  $or: [{ 'activityId.territoryName': normTerritory }, { 'activityId.territory': normTerritory }],
                },
              },
            ]
          : []),
        ...(re
          ? [
              {
                $match: {
                  $or: [
                    { 'farmerId.name': re },
                    { 'farmerId.mobileNumber': re },
                    { 'farmerId.location': re },
                    { 'farmerId.preferredLanguage': re },
                    { 'activityId.type': re },
                    { 'activityId.officerName': re },
                    { 'activityId.tmName': re },
                    { 'activityId.territoryName': re },
                    { 'activityId.territory': re },
                    { 'activityId.state': re },
                    { 'activityId.activityId': re },
                  ],
                },
              },
            ]
          : []),
      ];

      const statusCounts: Record<string, number> = {};
      if (normalizedSearch || hasActivityFilters) {
        const rows = await CallTask.aggregate([...filteredHistoryPrefix, { $group: { _id: '$status', count: { $sum: 1 } } }]);
        for (const r of rows) {
          if (r._id) statusCounts[String(r._id)] = Number(r.count || 0);
        }
      } else {
        const rows = await CallTask.aggregate([{ $match: baseMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
        for (const r of rows) {
          if (r._id) statusCounts[String(r._id)] = Number(r.count || 0);
        }
      }

      const inProgress = statusCounts['in_progress'] || 0;
      const completed = statusCounts['completed'] || 0;
      const notReachable = statusCounts['not_reachable'] || 0;
      const invalidNumber = statusCounts['invalid_number'] || 0;

      const inQueueMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: 'sampled_in_queue',
      };

      if (dateFrom || dateTo) {
        let fromDate: Date | null = null;
        let toDate: Date | null = null;

        if (dateFrom) {
          fromDate = dateFrom instanceof Date ? new Date(dateFrom) : new Date(dateFrom as string);
          fromDate.setHours(0, 0, 0, 0);
        }

        if (dateTo) {
          toDate = dateTo instanceof Date ? new Date(dateTo) : new Date(dateTo as string);
          toDate.setHours(23, 59, 59, 999);
        }

        if (fromDate && toDate) {
          inQueueMatch.updatedAt = { $gte: fromDate, $lte: toDate };
        } else if (fromDate) {
          inQueueMatch.updatedAt = { $gte: fromDate };
        } else if (toDate) {
          inQueueMatch.updatedAt = { $lte: toDate };
        }
      }

      let inQueueCount = 0;
      if (normalizedSearch || hasActivityFilters) {
        try {
          const inQueueAgg = await CallTask.aggregate([
            { $match: inQueueMatch },
            { $lookup: { from: Farmer.collection.name, localField: 'farmerId', foreignField: '_id', as: 'farmerId' } },
            { $unwind: { path: '$farmerId', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: activityCollection, localField: 'activityId', foreignField: '_id', as: 'activityId' } },
            { $unwind: { path: '$activityId', preserveNullAndEmptyArrays: true } },
            ...(normType ? [{ $match: { 'activityId.type': normType } }] : []),
            ...(normTerritory
              ? [
                  {
                    $match: {
                      $or: [{ 'activityId.territoryName': normTerritory }, { 'activityId.territory': normTerritory }],
                    },
                  },
                ]
              : []),
            ...(re
              ? [
                  {
                    $match: {
                      $or: [
                        { 'farmerId.name': re },
                        { 'farmerId.mobileNumber': re },
                        { 'farmerId.location': re },
                        { 'farmerId.preferredLanguage': re },
                        { 'activityId.type': re },
                        { 'activityId.officerName': re },
                        { 'activityId.tmName': re },
                        { 'activityId.territoryName': re },
                        { 'activityId.territory': re },
                        { 'activityId.state': re },
                        { 'activityId.activityId': re },
                      ],
                    },
                  },
                ]
              : []),
            { $count: 'count' },
          ]);
          inQueueCount = Number(inQueueAgg?.[0]?.count || 0);
        } catch (inQueueAggError: any) {
          logger.error(`Error in inQueue aggregation:`, {
            error: inQueueAggError?.message || String(inQueueAggError),
            stack: inQueueAggError?.stack,
            inQueueMatch: JSON.stringify(inQueueMatch, null, 2),
          });
          inQueueCount = 0;
        }
      } else {
        try {
          inQueueCount = await CallTask.countDocuments(inQueueMatch);
        } catch (countError: any) {
          logger.error(`Error counting inQueue documents:`, {
            error: countError?.message || String(countError),
            stack: countError?.stack,
            inQueueMatch: JSON.stringify(inQueueMatch, null, 2),
          });
          inQueueCount = 0;
        }
      }

      const total = inQueueCount + inProgress + completed + notReachable + invalidNumber;

      res.json({
        success: true,
        data: {
          total,
          inQueue: inQueueCount,
          inProgress,
          completedConversation: completed,
          unsuccessful: notReachable,
          invalid: invalidNumber,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/history/:id
// @desc    Agent History detail for a specific task
// @access  Private (CC Agent)
// NOTE: This route MUST come AFTER /own/history/options and /own/history/stats to avoid "options"/"stats" being treated as an ID
router.get(
  '/own/history/:id',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const taskId = req.params.id;

      const task = await CallTask.findById(taskId)
        .populate('farmerId', 'name location preferredLanguage mobileNumber photoUrl')
        .populate('activityId', 'activityId type date officerName tmName location territory territoryName state zoneName buName crops products')
        .populate('assignedAgentId', 'name email employeeId')
        .lean();

      if (!task) {
        const error: AppError = new Error('Task not found');
        error.statusCode = 404;
        throw error;
      }

      if (!task.assignedAgentId || (task.assignedAgentId as any)?._id?.toString?.() !== agentId) {
        const error: AppError = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }

      res.json({ success: true, data: { task } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/own/analytics
// @desc    Agent performance analytics (attempts + outcomes) with time-bucket toggle
// @access  Private (CC Agent)
router.get(
  '/own/analytics',
  requirePermission('tasks.view.own'),
  [
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('bucket').optional().isIn(['daily', 'weekly', 'monthly']),
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

      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const { dateFrom, dateTo, bucket } = req.query as any;

      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;
      if (from) from.setHours(0, 0, 0, 0);
      if (to) to.setHours(23, 59, 59, 999);

      const match: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
        status: { $ne: 'sampled_in_queue' }, // exclude in-queue
        callStartedAt: { $ne: null },
      };
      if (from || to) {
        match.callStartedAt = { ...(match.callStartedAt || {}), ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
      }

      const bucketKey = String(bucket || 'daily');
      const dateExpr =
        bucketKey === 'monthly'
          ? { $dateToString: { format: '%Y-%m', date: '$callStartedAt' } }
          : bucketKey === 'weekly'
          ? { $dateToString: { format: '%G-W%V', date: '$callStartedAt' } }
          : { $dateToString: { format: '%Y-%m-%d', date: '$callStartedAt' } };

      // Use aggregation with outcome field for consistency with stats endpoint
      const agg = await CallTask.aggregate([
        { $match: match },
        { $addFields: { __outbound: { $ifNull: ['$callLog.callStatus', ''] } } },
        {
          $group: {
            _id: { period: dateExpr, status: '$status', outbound: '$__outbound', outcome: '$outcome' },
            count: { $sum: 1 },
            connectedDuration: {
              $sum: {
                $cond: [
                  { $eq: ['$callLog.callStatus', 'Connected'] },
                  { $ifNull: ['$callLog.callDurationSeconds', 0] },
                  0,
                ],
              },
            },
            connectedCount: { $sum: { $cond: [{ $eq: ['$callLog.callStatus', 'Connected'] }, 1, 0] } },
          },
        },
      ]);

      const byPeriod: Record<string, any> = {};
      const totals = {
        attempted: 0,
        successful: 0,
        unsuccessful: 0,
        inProgress: 0,
        disconnected: 0,
        incomingNA: 0,
        invalid: 0,
        noAnswer: 0,
        connected: 0,
        connectedDurationSeconds: 0,
        connectedCount: 0,
      };

      const normOutbound = (s: string) => String(s || '').trim();
      
      // Helper to get outcome (matches stats endpoint logic: outcome || outcomeLabel(status))
      const getEffectiveOutcome = (outcome: string | undefined, status: string): string => {
        if (outcome) return String(outcome).trim();
        if (status === 'completed') return 'Completed Conversation';
        if (status === 'in_progress') return 'In Progress';
        if (status === 'invalid_number' || status === 'not_reachable') return 'Unsuccessful';
        return status || 'Unknown';
      };

      for (const row of agg) {
        const period = row._id?.period || 'Unknown';
        const status = row._id?.status || 'unknown';
        const outbound = normOutbound(row._id?.outbound);
        const storedOutcome = row._id?.outcome;
        const count = Number(row.count || 0);
        
        // Get effective outcome using same logic as stats endpoint
        const effectiveOutcome = getEffectiveOutcome(storedOutcome, status);
        const normalizedOutcome = effectiveOutcome.toLowerCase();

        if (!byPeriod[period]) {
          byPeriod[period] = {
            period,
            attempted: 0,
            successful: 0,
            unsuccessful: 0,
            inProgress: 0,
            disconnected: 0,
            incomingNA: 0,
            invalid: 0,
            noAnswer: 0,
            connected: 0,
          };
        }

        byPeriod[period].attempted += count;
        totals.attempted += count;

        // Use outcome-based classification (consistent with stats endpoint)
        if (normalizedOutcome === 'in progress') {
          byPeriod[period].inProgress += count;
          totals.inProgress += count;
        } else if (normalizedOutcome === 'completed conversation') {
          byPeriod[period].successful += count;
          totals.successful += count;
        } else if (normalizedOutcome === 'unsuccessful') {
          byPeriod[period].unsuccessful += count;
          totals.unsuccessful += count;
        }

        // Outbound status breakdown
        if (outbound === 'Connected') {
          byPeriod[period].connected += count;
          totals.connected += count;
        } else if (outbound === 'Disconnected') {
          byPeriod[period].disconnected += count;
          totals.disconnected += count;
        } else if (outbound === 'Incoming N/A' || outbound === 'Not Reachable') {
          byPeriod[period].incomingNA += count;
          totals.incomingNA += count;
        } else if (outbound === 'Invalid' || outbound === 'Invalid Number') {
          byPeriod[period].invalid += count;
          totals.invalid += count;
        } else if (outbound === 'No Answer') {
          byPeriod[period].noAnswer += count;
          totals.noAnswer += count;
        }

        totals.connectedDurationSeconds += Number(row.connectedDuration || 0);
        totals.connectedCount += Number(row.connectedCount || 0);
      }

      const trend = Object.values(byPeriod).sort((a: any, b: any) => String(a.period).localeCompare(String(b.period)));
      const avgConnectedDurationSeconds =
        totals.connectedCount > 0 ? Math.round(totals.connectedDurationSeconds / totals.connectedCount) : 0;
      
      // Calculate success rate
      const successRate = totals.attempted > 0 ? Math.round((totals.successful / totals.attempted) * 100) : 0;

      // Calculate days in range for calls/day metric
      const daysInRange = from && to ? Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))) : 1;
      const callsPerDay = totals.attempted > 0 ? (totals.attempted / daysInRange).toFixed(1) : '0';

      // Count total tasks due within date range (based on scheduledDate)
      const tasksDueMatch: any = {
        assignedAgentId: new mongoose.Types.ObjectId(agentId),
      };
      if (from || to) {
        tasksDueMatch.scheduledDate = {};
        if (from) tasksDueMatch.scheduledDate.$gte = from;
        if (to) tasksDueMatch.scheduledDate.$lte = to;
      }
      const totalTasksDue = await CallTask.countDocuments(tasksDueMatch);
      
      // Calculate efficiency (attempted / due)
      const efficiency = totalTasksDue > 0 ? Math.round((totals.attempted / totalTasksDue) * 100) : 0;

      res.json({
        success: true,
        data: {
          bucket: bucketKey,
          dateFrom: from ? from.toISOString() : null,
          dateTo: to ? to.toISOString() : null,
          totals: { ...totals, avgConnectedDurationSeconds, successRate, callsPerDay, daysInRange, totalTasksDue, efficiency },
          trend,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/active
// @desc    Get next assigned task for CC Agent (legacy - for backward compatibility)
// @access  Private (CC Agent only)
router.get(
  '/active',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const agentId = authReq.user._id.toString();
      const task = await getNextTaskForAgent(agentId);

      if (!task) {
        return res.json({
          success: true,
          data: { task: null, message: 'No tasks available in queue' },
        });
      }

      // IMPORTANT: Do NOT auto-move to in_progress on load.
      // Status should move to in_progress only after agent selects an Outbound Status.

      // Ensure activity data includes crops and products
      const activity = task.activityId as any;
      // State should come from Activity API v2; keep legacy fallback only if state missing.
      const territory = activity?.territoryName || activity?.territory || 'Unknown';
      const state = activity?.state || (territory !== 'Unknown' ? territory.replace(/\s+Zone$/, '').trim() : '');
      
      const activityData = activity ? {
        type: activity.type || 'Unknown',
        date: activity.date || new Date(),
        officerName: activity.officerName || 'Unknown',
        tmName: activity.tmName || '',
        location: activity.location || 'Unknown', // village
        territory: territory,
        state: state,
        crops: Array.isArray(activity.crops) ? activity.crops : (activity.crops ? [activity.crops] : []),
        products: Array.isArray(activity.products) ? activity.products : (activity.products ? [activity.products] : []),
      } : null;

      // Debug logging
      logger.info('Activity data in API response', {
        hasActivity: !!activity,
        crops: activity?.crops,
        products: activity?.products,
        cropsType: typeof activity?.crops,
        cropsIsArray: Array.isArray(activity?.crops),
      });

      res.json({
        success: true,
        data: {
          taskId: task._id,
          farmer: task.farmerId,
          activity: activityData,
          status: task.status,
          scheduledDate: task.scheduledDate,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/pending
// @desc    List pending tasks (Team Lead/Admin)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/pending',
  requirePermission('tasks.view.team'),
  [
    query('agentId').optional().isMongoId(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('search').optional().isString(),
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

      const { agentId, territory, zone, bu, search, dateFrom, dateTo, page, limit } = req.query;

      const result = await getPendingTasks({
        agentId: agentId as string,
        territory: territory as string,
        zone: (zone as string) || undefined,
        bu: (bu as string) || undefined,
        search: (search as string) || undefined,
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/pending/options
// @desc    Get distinct filter options (territory/zone/bu) for Task Management scoped to current filters (not paginated)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/pending/options',
  requirePermission('tasks.view.team'),
  [
    query('agentId').optional().isMongoId(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
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

      const { agentId, territory, zone, bu, search, dateFrom, dateTo } = req.query as any;

      const options = await getPendingTasksFilterOptions({
        agentId: agentId as string,
        territory: territory as string,
        zone: zone as string,
        bu: bu as string,
        search: (search as string) || undefined,
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
      });

      res.json({ success: true, data: options });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/pending/stats
// @desc    Task statistics for Task Management (filter-based, not paginated)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/pending/stats',
  requirePermission('tasks.view.team'),
  [
    query('agentId').optional().isMongoId(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
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

      const { agentId, territory, zone, bu, search, dateFrom, dateTo } = req.query;
      const stats = await (await import('../services/taskService.js')).getPendingTasksStats({
        agentId: agentId as string,
        territory: territory as string,
        zone: (zone as string) || undefined,
        bu: (bu as string) || undefined,
        search: (search as string) || undefined,
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
      });

      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/pending/export
// @desc    Export current filtered page of Task Management list as Excel
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/pending/export',
  requirePermission('tasks.view.team'),
  [
    query('agentId').optional().isMongoId(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('search').optional().isString(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('exportAll').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 5000 }),
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

      const { agentId, territory, zone, bu, search, dateFrom, dateTo, exportAll, page, limit } = req.query;
      const { filename, buffer } = await (await import('../services/taskService.js')).exportPendingTasksXlsx({
        agentId: agentId as string,
        territory: territory as string,
        zone: (zone as string) || undefined,
        bu: (bu as string) || undefined,
        search: (search as string) || undefined,
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
        exportAll: exportAll === 'true',
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/team
// @desc    List team tasks (Team Lead)
// @access  Private (Team Lead)
router.get(
  '/team',
  requirePermission('tasks.view.team'),
  [
    query('status').optional().isIn(['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number']),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const { status, dateFrom, dateTo, page, limit } = req.query;

      logger.info('📥 GET /api/tasks/team - Request received', {
        teamLeadId,
        queryParams: { status, dateFrom, dateTo, page, limit },
        statusType: typeof status,
        statusValue: status,
      });

      const result = await getTeamTasks(teamLeadId, {
        status: status ? (status as string).trim() as TaskStatus : undefined,
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/dashboard
// @desc    Task dashboard for Team Lead: unassigned by language + agent workload (sampled_in_queue/in_progress)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/dashboard',
  requirePermission('tasks.view.team'),
  [
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('bu').optional().isString(),
    query('state').optional().isString(),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const { dateFrom, dateTo, bu, state } = req.query as any;

      const dateMatch: any = {};
      if (dateFrom || dateTo) {
        dateMatch.scheduledDate = {};
        if (dateFrom) {
          const d = new Date(dateFrom);
          d.setHours(0, 0, 0, 0);
          dateMatch.scheduledDate.$gte = d;
        }
        if (dateTo) {
          const d = new Date(dateTo);
          d.setHours(23, 59, 59, 999);
          dateMatch.scheduledDate.$lte = d;
        }
      }

      // Team agents (for workload summary)
      const agents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      })
        .select('_id name email employeeId languageCapabilities')
        .sort({ name: 1 })
        .lean();

      const agentIds = agents.map((a) => a._id);

      const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;

      const activityFilter: any = {};
      if (bu) activityFilter['activity.buName'] = String(bu);
      if (state) activityFilter['activity.state'] = String(state);

      // Scope for dashboard: all task statuses so totals add up (unassigned, sampled_in_queue, in_progress, completed, not_reachable, invalid_number)
      const allMatch: any = { ...dateMatch };
      const openMatch: any = {
        ...dateMatch,
        status: { $in: ['unassigned', 'sampled_in_queue', 'in_progress'] },
        $or: [{ status: 'unassigned' }, { assignedAgentId: { $in: agentIds } }],
      };

      // 1) Unassigned tasks by farmer preferredLanguage (with BU/State activity filter)
      const byLanguageRaw = await CallTask.aggregate([
        { $match: { ...dateMatch, ...callTaskNeedsAgentMongoFilter() } },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: activityCollection,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        ...(bu || state ? [{ $match: activityFilter }] : []),
        {
          $group: {
            _id: { $ifNull: ['$farmer.preferredLanguage', 'Unknown'] },
            unassigned: { $sum: 1 },
          },
        },
        { $project: { _id: 0, language: '$_id', unassigned: 1 } },
      ]);

      // Stable order for language rows
      const languageOrder = ['Hindi', 'Telugu', 'Marathi', 'Kannada', 'Tamil', 'Bengali', 'Oriya', 'Malayalam', 'English', 'Unknown'];
      const languageRank = (l: string) => {
        const idx = languageOrder.indexOf(l);
        return idx === -1 ? 999 : idx;
      };

      const byLanguage = [...byLanguageRaw].sort((a: any, b: any) => {
        const ar = languageRank(a.language);
        const br = languageRank(b.language);
        if (ar !== br) return ar - br;
        return String(a.language).localeCompare(String(b.language));
      });

      const totalUnassigned = byLanguage.reduce((sum: number, r: any) => sum + (r.unassigned || 0), 0);

      // 2) By-language breakdown: all statuses so Total = unassigned + sampled_in_queue + in_progress + completed + not_reachable + invalid_number
      const openByLanguage = await CallTask.aggregate([
        { $match: allMatch },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: activityCollection,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        ...(bu || state ? [{ $match: activityFilter }] : []),
        {
          $group: {
            _id: { $ifNull: ['$farmer.preferredLanguage', 'Unknown'] },
            total: { $sum: 1 },
            unassigned: { $sum: { $cond: [{ $eq: ['$status', 'unassigned'] }, 1, 0] } },
            sampledInQueue: { $sum: { $cond: [{ $eq: ['$status', 'sampled_in_queue'] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            notReachable: { $sum: { $cond: [{ $eq: ['$status', 'not_reachable'] }, 1, 0] } },
            invalidNumber: { $sum: { $cond: [{ $eq: ['$status', 'invalid_number'] }, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            language: '$_id',
            total: 1,
            unassigned: 1,
            sampledInQueue: 1,
            inProgress: 1,
            completed: 1,
            notReachable: 1,
            invalidNumber: 1,
          },
        },
      ]);

      const openTotals = openByLanguage.reduce(
        (acc: any, r: any) => {
          acc.total += r.total || 0;
          acc.unassigned += r.unassigned || 0;
          acc.sampledInQueue += r.sampledInQueue || 0;
          acc.inProgress += r.inProgress || 0;
          acc.completed += r.completed || 0;
          acc.notReachable += r.notReachable || 0;
          acc.invalidNumber += r.invalidNumber || 0;
          return acc;
        },
        { total: 0, unassigned: 0, sampledInQueue: 0, inProgress: 0, completed: 0, notReachable: 0, invalidNumber: 0 }
      );

      // 3) Agent workload: all statuses (sampled_in_queue, in_progress, completed, not_reachable, invalid_number) so Total adds up
      const workloadAgg = agentIds.length
        ? await CallTask.aggregate([
            {
              $match: {
                assignedAgentId: { $in: agentIds },
                status: { $in: ['sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number'] },
                ...dateMatch,
              },
            },
            {
              $lookup: {
                from: activityCollection,
                localField: 'activityId',
                foreignField: '_id',
                as: 'activity',
              },
            },
            { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
            ...(bu || state ? [{ $match: activityFilter }] : []),
            {
              $group: {
                _id: { agentId: '$assignedAgentId', status: '$status' },
                count: { $sum: 1 },
              },
            },
          ])
        : [];

      type WorkloadCounts = { sampled_in_queue: number; in_progress: number; completed: number; not_reachable: number; invalid_number: number };
      const workloadMap = new Map<string, WorkloadCounts>();
      for (const row of workloadAgg) {
        const agentId = row._id?.agentId?.toString();
        const status = row._id?.status as keyof WorkloadCounts;
        if (!agentId) continue;
        const current = workloadMap.get(agentId) || {
          sampled_in_queue: 0, in_progress: 0, completed: 0, not_reachable: 0, invalid_number: 0,
        };
        if (current.hasOwnProperty(status)) current[status] = row.count || 0;
        workloadMap.set(agentId, current);
      }

      const agentWorkload = agents.map((a) => {
        const c = workloadMap.get(a._id.toString()) || {
          sampled_in_queue: 0, in_progress: 0, completed: 0, not_reachable: 0, invalid_number: 0,
        };
        const total = c.sampled_in_queue + c.in_progress + c.completed + c.not_reachable + c.invalid_number;
        return {
          agentId: a._id.toString(),
          name: a.name,
          email: a.email,
          employeeId: a.employeeId,
          languageCapabilities: Array.isArray((a as any).languageCapabilities) ? (a as any).languageCapabilities : [],
          sampledInQueue: c.sampled_in_queue,
          inProgress: c.in_progress,
          completed: c.completed,
          notReachable: c.not_reachable,
          invalidNumber: c.invalid_number,
          totalOpen: total,
        };
      });

      // 4) Filter option lists (BU/State) - scoped to current filters (date + other geo filters), but each list ignores its own current selection
      const filterOptionsAgg = await CallTask.aggregate([
        { $match: openMatch },
        {
          $lookup: {
            from: activityCollection,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            __bu: { $trim: { input: { $ifNull: ['$activity.buName', ''] } } },
            __state: { $trim: { input: { $ifNull: ['$activity.state', ''] } } },
          },
        },
        {
          $facet: {
            bu: [
              ...(state ? [{ $match: { __state: String(state).trim() } }] : []),
              { $group: { _id: null, values: { $addToSet: '$__bu' } } },
              { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
            ],
            state: [
              ...(bu ? [{ $match: { __bu: String(bu).trim() } }] : []),
              { $group: { _id: null, values: { $addToSet: '$__state' } } },
              { $project: { _id: 0, values: { $ifNull: ['$values', []] } } },
            ],
          },
        },
      ]);

      const stripEmpty = (arr: any[]) => (Array.isArray(arr) ? arr.filter((v) => v !== '' && v !== null && v !== undefined) : []);
      const sortAlpha = (a: any, b: any) => String(a).localeCompare(String(b));

      const buOptions = stripEmpty(filterOptionsAgg?.[0]?.bu?.[0]?.values || [])
        .map((s: any) => String(s || '').trim())
        .filter((s: string) => !!s)
        .sort(sortAlpha);
      const stateOptions = stripEmpty(filterOptionsAgg?.[0]?.state?.[0]?.values || [])
        .map((s: any) => String(s || '').trim())
        .filter((s: string) => !!s)
        .sort(sortAlpha);

      res.json({
        success: true,
        data: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          bu: bu || null,
          state: state || null,
          filterOptions: {
            buOptions,
            stateOptions,
          },
          unassignedByLanguage: byLanguage,
          totals: {
            totalUnassigned, // filtered unassigned pool (BU/State applied)
            total: openTotals.total,
            unassigned: openTotals.unassigned,
            sampledInQueue: openTotals.sampledInQueue,
            inProgress: openTotals.inProgress,
            completed: openTotals.completed,
            notReachable: openTotals.notReachable,
            invalidNumber: openTotals.invalidNumber,
          },
          openByLanguage,
          agentWorkload,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/dashboard/by-language
// @desc    Team Lead: queue statistics and task list for a single language (Tasks by Language drill-down)
// @query   language (required), dateFrom, dateTo, bu, state, agentId, status, page, limit (lazy load; default limit 30, max 100)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/dashboard/by-language',
  requirePermission('tasks.view.team'),
  [
    query('language').notEmpty().isString().trim(),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('bu').optional().isString(),
    query('state').optional().isString(),
    query('agentId').optional().isMongoId(),
    query('status').optional().isIn(['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number']),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const language = (req.query.language as string).trim();
      const { dateFrom, dateTo, bu, state, agentId: queryAgentId, status: queryStatus } = req.query as any;
      const page = req.query.page != null ? Number(req.query.page) : 1;
      const limit = req.query.limit != null ? Math.min(Number(req.query.limit), 100) : 30;
      const skip = (page - 1) * limit;

      const dateMatch: any = {};
      if (dateFrom || dateTo) {
        dateMatch.scheduledDate = {};
        if (dateFrom) {
          const d = new Date(dateFrom);
          d.setHours(0, 0, 0, 0);
          dateMatch.scheduledDate.$gte = d;
        }
        if (dateTo) {
          const d = new Date(dateTo);
          d.setHours(23, 59, 59, 999);
          dateMatch.scheduledDate.$lte = d;
        }
      }

      const agents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      })
        .select('_id name email languageCapabilities')
        .lean();
      const languageNorm = (language || '').trim().toLowerCase();
      const agentsForLanguage = languageNorm
        ? (agents as any[]).filter((a) =>
            (Array.isArray(a.languageCapabilities) ? a.languageCapabilities : []).some(
              (cap: string) => String(cap || '').trim().toLowerCase() === languageNorm
            )
          )
        : (agents as any[]);
      const agentIds = agents.map((a) => a._id);
      const agentOptions = agentsForLanguage.map((a: any) => ({
        agentId: a._id.toString(),
        agentName: (a.name || a.email || 'Unknown').trim(),
      }));

      const activityCollection = (await import('../models/Activity.js')).Activity.collection.name;
      const activityFilter: any = {};
      if (bu) activityFilter['activity.buName'] = String(bu);
      if (state) activityFilter['activity.state'] = String(state);

      // Assignee: either filter by one agent or allow unassigned + any team agent
      const assigneeMatch: any =
        queryAgentId
          ? { assignedAgentId: new mongoose.Types.ObjectId(queryAgentId) }
          : { $or: [{ status: 'unassigned' }, { assignedAgentId: { $in: agentIds } }] };
      // Call status filter
      const statusMatch: any =
        queryStatus === 'unassigned'
          ? { status: 'unassigned' }
          : queryStatus
            ? { status: String(queryStatus) }
            : {};
      const baseMatch: any = {
        ...dateMatch,
        ...assigneeMatch,
        ...statusMatch,
      };

      const result = await CallTask.aggregate([
        { $match: baseMatch },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
        { $match: { 'farmer.preferredLanguage': language } },
        {
          $lookup: {
            from: activityCollection,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        ...(bu || state ? [{ $match: activityFilter }] : []),
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
              { $sort: { scheduledDate: 1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: User.collection.name,
                  localField: 'assignedAgentId',
                  foreignField: '_id',
                  as: 'agent',
                },
              },
              { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
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
                    crops: { $ifNull: ['$activity.crops', []] },
                    products: { $ifNull: ['$activity.products', []] },
                  },
                  status: 1,
                  outcome: 1,
                  sentiment: '$callLog.sentiment',
                  scheduledDate: 1,
                  createdAt: 1,
                  assignedAgentName: { $ifNull: ['$agent.name', null] },
                },
              },
            ],
          },
        },
      ]);

      const facet = result?.[0];
      const statusBreakdown = facet?.statusBreakdown?.[0] || {
        sampled_in_queue: 0,
        in_progress: 0,
        completed: 0,
        not_reachable: 0,
        invalid_number: 0,
        total: 0,
      };
      const tasksTotal = statusBreakdown.total;
      const tasks = (facet?.tasks || []).map((t: any) => ({
        ...t,
        activity: {
          ...t.activity,
          territory: t.activity?.territory ?? 'Unknown',
          date: t.activity?.date ?? t.createdAt,
          crops: Array.isArray(t.activity?.crops) ? t.activity.crops : [],
          products: Array.isArray(t.activity?.products) ? t.activity.products : [],
        },
        outcome: t.outcome ?? null,
        sentiment: t.sentiment ?? null,
      }));

      res.json({
        success: true,
        data: {
          language,
          statusBreakdown,
          tasks,
          tasksTotal,
          page,
          limit,
          agentOptions,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/dashboard/agent/:agentId
// @desc    Team Lead: get agent queue detail for an agent in their team (opens Agent Queue detail view)
// @query   language - optional: filter tasks by farmer preferredLanguage
// @query   page, limit - optional: lazy load tasks (default limit 30, max 100)
// @query   dateFrom, dateTo, bu, state, status, fda - optional: filter by scheduled date, activity, task status, FDA (officer)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/dashboard/agent/:agentId',
  requirePermission('tasks.view.team'),
  [
    param('agentId').isMongoId().withMessage('Invalid agent ID'),
    query('language').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('bu').optional().isString(),
    query('state').optional().isString(),
    query('status').optional().isIn(['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number']),
    query('fda').optional().isString().trim(),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const agentId = req.params.agentId;
      const language = (req.query.language as string)?.trim() || undefined;
      const page = req.query.page != null ? Number(req.query.page) : undefined;
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const dateFrom = req.query.dateFrom != null ? String(req.query.dateFrom).trim() : undefined;
      const dateTo = req.query.dateTo != null ? String(req.query.dateTo).trim() : undefined;
      const bu = (req.query.bu as string)?.trim() || undefined;
      const state = (req.query.state as string)?.trim() || undefined;
      const status = (req.query.status as string)?.trim() || undefined;
      const fda = (req.query.fda as string)?.trim() || undefined;

      const agent = await User.findById(agentId).select('_id role teamLeadId').lean();
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: { message: 'Agent not found' },
        });
      }

      const agentObj = agent as any;
      if (agentObj.role !== 'cc_agent') {
        return res.status(400).json({
          success: false,
          error: { message: 'User is not a CC agent' },
        });
      }

      const agentTeamLeadId = agentObj.teamLeadId?.toString?.() || null;
      if (agentTeamLeadId !== teamLeadId) {
        return res.status(403).json({
          success: false,
          error: { message: 'Agent is not in your team' },
        });
      }

      const result = await getAgentQueue(agentId, {
        language,
        page,
        limit,
        dateFrom,
        dateTo,
        bu,
        state,
        status,
        fda,
      });
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/tasks/allocate
// @desc    Allocate unassigned tasks for a language to capable agents (round-robin); sets status to sampled_in_queue
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/allocate',
  requirePermission('tasks.reassign'),
  [
    body('language').isString().notEmpty(),
    // count is optional: when omitted or 0, allocate all matching tasks (bounded by server cap)
    body('count').optional().isInt({ min: 0, max: 5000 }),
    body('dateFrom').optional().isISO8601().toDate(),
    body('dateTo').optional().isISO8601().toDate(),
    body('bu').optional().isString(),
    body('state').optional().isString(),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const authUserId = authReq.user._id.toString();
      const { language, count, dateFrom, dateTo, bu, state } = req.body as any;

      const normalize = (s: any) => String(s ?? '').trim().toLowerCase();
      const desired = normalize(language);
      const isAllLanguages = desired === 'all' || desired === '__all__';
      const serverCap = 5000;
      const requestedCountRaw = typeof count === 'number' ? count : Number(count);
      const requestedCount = Number.isFinite(requestedCountRaw) ? requestedCountRaw : 0; // 0 means "all"

      // Find active agents under this team lead (then do robust matching in code)
      const teamAgents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      })
        .select('_id name email languageCapabilities')
        .sort({ name: 1 })
        .lean();

      const agentsByLanguage = new Map<string, any[]>();
      for (const a of teamAgents as any[]) {
        const caps: string[] = Array.isArray(a.languageCapabilities) ? a.languageCapabilities : [];
        for (const cap of caps) {
          const key = normalize(cap);
          if (!key) continue;
          const list = agentsByLanguage.get(key) || [];
          list.push(a);
          agentsByLanguage.set(key, list);
        }
      }

      const capableAgents = isAllLanguages ? teamAgents : (agentsByLanguage.get(desired) || []);
      if (!capableAgents.length) {
        return res.status(400).json({
          success: false,
          error: {
            message: `No active agents found under your team with language capability "${language}"`,
            details: {
              teamAgentsFound: teamAgents.length,
              teamAgents: teamAgents.map((a: any) => ({
                name: a.name,
                email: a.email,
                languageCapabilities: Array.isArray(a.languageCapabilities) ? a.languageCapabilities : [],
              })),
            },
          },
        });
      }

      const dateMatch: any = {};
      if (dateFrom || dateTo) {
        dateMatch.scheduledDate = {};
        if (dateFrom) {
          const d = new Date(dateFrom);
          d.setHours(0, 0, 0, 0);
          dateMatch.scheduledDate.$gte = d;
        }
        if (dateTo) {
          const d = new Date(dateTo);
          d.setHours(23, 59, 59, 999);
          dateMatch.scheduledDate.$lte = d;
        }
      }

      // Find unassigned tasks for farmers of this language
      const basePipeline: any[] = [
        { $match: { ...dateMatch, ...callTaskNeedsAgentMongoFilter() } },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: '$farmer' },
        {
          $lookup: {
            from: (await import('../models/Activity.js')).Activity.collection.name,
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
      ];

      const activityFilter: any = {};
      if (bu) activityFilter['activity.buName'] = String(bu);
      if (state) activityFilter['activity.state'] = String(state);

      const taskRows = await CallTask.aggregate([
        ...basePipeline,
        ...(isAllLanguages ? [] : [{ $match: { 'farmer.preferredLanguage': language } }]),
        ...(bu || state ? [{ $match: activityFilter }] : []),
        { $sort: { scheduledDate: 1, createdAt: 1 } },
        { $limit: serverCap },
        { $project: { _id: 1, farmerLanguage: '$farmer.preferredLanguage' } },
      ]);

      if (!taskRows.length) {
        return res.json({
          success: true,
          message: isAllLanguages ? 'No unassigned tasks found' : 'No unassigned tasks found for this language',
          data: { requested: requestedCount, allocated: 0 },
        });
      }

      // If ALL: pick tasks in a fair way across languages (round-robin by language) up to requestedCount
      // If requestedCount is 0 => allocate all tasks (bounded by serverCap).
      let selectedTasks: Array<{ _id: any; farmerLanguage: string }> = [];

      if (!isAllLanguages) {
        selectedTasks = taskRows.map((r: any) => ({ _id: r._id, farmerLanguage: r.farmerLanguage }));
        if (requestedCount > 0) selectedTasks = selectedTasks.slice(0, requestedCount);
      } else {
        const buckets = new Map<string, Array<{ _id: any; farmerLanguage: string }>>();
        for (const r of taskRows as any[]) {
          const langKey = normalize(r.farmerLanguage) || 'unknown';
          const arr = buckets.get(langKey) || [];
          arr.push({ _id: r._id, farmerLanguage: r.farmerLanguage });
          buckets.set(langKey, arr);
        }

        const langs = Array.from(buckets.keys()).sort(); // stable ordering
        const target = requestedCount > 0 ? Math.min(requestedCount, serverCap) : serverCap;
        let added = 0;
        while (added < target) {
          let progressed = false;
          for (const lk of langs) {
            const q = buckets.get(lk);
            if (!q || q.length === 0) continue;
            const t = q.shift()!;
            selectedTasks.push(t);
            added++;
            progressed = true;
            if (added >= target) break;
          }
          if (!progressed) break; // all empty
        }
      }

      if (!selectedTasks.length) {
        return res.json({
          success: true,
          message: 'No matching tasks found',
          data: { requested: requestedCount, allocated: 0 },
        });
      }

      // Create allocation run tracker (so UI can poll progress)
      const runDoc = await AllocationRun.create({
        createdByUserId: authUserId ? new mongoose.Types.ObjectId(authUserId) : null,
        status: 'running',
        startedAt: new Date(),
        filters: {
          language: language,
          count: requestedCount || null,
          dateFrom: dateFrom ? new Date(dateFrom) : null,
          dateTo: dateTo ? new Date(dateTo) : null,
        },
        total: selectedTasks.length,
        processed: 0,
        allocated: 0,
        skipped: 0,
        skippedByLanguage: {},
        errorCount: 0,
        errorMessages: [],
        lastProgressAt: new Date(),
      });

      // Round-robin assignment across capable agents
      const STATUS_QUEUED: TaskStatus = 'sampled_in_queue';

      const languageAgentCursor = new Map<string, number>();
      const skippedByLanguage: Record<string, number> = {};
      const errorMessages: string[] = [];
      let processed = 0;
      let allocated = 0;
      let skipped = 0;

      const BATCH_SIZE = 200;
      let batchOps: any[] = [];

      const flushBatch = async () => {
        if (!batchOps.length) return;
        try {
          const r = await CallTask.bulkWrite(batchOps as any, { ordered: false });
          allocated += r.modifiedCount || 0;
        } catch (e: any) {
          errorMessages.push(e?.message || 'Bulk write failed');
        } finally {
          batchOps = [];
        }
      };

      for (let idx = 0; idx < selectedTasks.length; idx++) {
        const t = selectedTasks[idx];
          const taskId = t._id;
          const farmerLangKey = normalize(t.farmerLanguage) || 'unknown';

          const langAgents = isAllLanguages ? (agentsByLanguage.get(farmerLangKey) || []) : capableAgents;
          if (!langAgents.length) {
            skippedByLanguage[farmerLangKey] = (skippedByLanguage[farmerLangKey] || 0) + 1;
            skipped++;
            processed++;
            // Persist progress occasionally even if we're only skipping
            if (processed % 50 === 0) {
              await AllocationRun.updateOne(
                { _id: runDoc._id },
                {
                  $set: {
                    processed,
                    allocated,
                    skipped,
                    skippedByLanguage,
                    errorCount: errorMessages.length,
                    errorMessages: errorMessages.slice(-50),
                    lastProgressAt: new Date(),
                  },
                }
              );
            }
            continue;
          }

          const cursor = languageAgentCursor.get(farmerLangKey) || 0;
          const agent = langAgents[cursor % langAgents.length];
          languageAgentCursor.set(farmerLangKey, cursor + 1);

          batchOps.push({
          updateOne: {
            filter: { _id: taskId, ...callTaskNeedsAgentMongoFilter() },
            update: {
              $set: {
                assignedAgentId: agent._id,
                status: STATUS_QUEUED,
              },
              $push: {
                interactionHistory: {
                  timestamp: new Date(),
                  status: STATUS_QUEUED,
                  notes: `Allocated by Team Lead (auto) to ${agent.email}`,
                },
              },
            },
          },
        });
        processed++;

        if (batchOps.length >= BATCH_SIZE) {
          await flushBatch();
        }

        // Persist progress every ~50 processed tasks
        if (processed % 50 === 0) {
          await AllocationRun.updateOne(
            { _id: runDoc._id },
            {
              $set: {
                processed,
                allocated,
                skipped,
                skippedByLanguage,
                errorCount: errorMessages.length,
                errorMessages: errorMessages.slice(-50),
                lastProgressAt: new Date(),
              },
            }
          );
        }
      }

      await flushBatch();

      await AllocationRun.updateOne(
        { _id: runDoc._id },
        {
          $set: {
            status: 'completed',
            finishedAt: new Date(),
            processed,
            allocated,
            skipped,
            skippedByLanguage,
            errorCount: errorMessages.length,
            errorMessages: errorMessages.slice(-50),
            lastProgressAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: 'Tasks allocated successfully',
        data: {
          runId: runDoc._id.toString(),
          language,
          requested: requestedCount,
          matchedTasks: selectedTasks.length,
          allocated,
          agentsUsed: capableAgents.map((a: any) => ({ agentId: a._id.toString(), name: a.name, email: a.email })),
          skippedByLanguage,
        },
      });
    } catch (error) {
      try {
        const authReq = req as AuthRequest;
        if (authReq?.user?._id) {
          await AllocationRun.create({
            createdByUserId: authReq.user._id,
            status: 'failed',
            startedAt: new Date(),
            finishedAt: new Date(),
            total: 0,
            processed: 0,
            allocated: 0,
            skipped: 0,
            errorCount: 1,
            errorMessages: [error instanceof Error ? error.message : 'Unknown error'],
          });
        }
      } catch {
        // ignore
      }
      next(error);
    }
  }
);

// @route   POST /api/tasks/reallocate
// @desc    Reallocate sampled-in-queue tasks from one agent to other agents (round-robin by language)
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/reallocate',
  requirePermission('tasks.reassign'),
  [
    body('agentId').isString().notEmpty().withMessage('Agent ID is required'),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const authUserId = authReq.user._id.toString();
      const { agentId } = req.body;

      const normalize = (s: any) => String(s ?? '').trim().toLowerCase();

      // Verify the agent belongs to this team lead
      const sourceAgent = await User.findOne({
        _id: new mongoose.Types.ObjectId(agentId),
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      }).lean();

      if (!sourceAgent) {
        return res.status(404).json({
          success: false,
          error: { message: 'Agent not found or not under your team' },
        });
      }

      // Find all active agents under this team lead (excluding the source agent)
      const teamAgents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
        _id: { $ne: new mongoose.Types.ObjectId(agentId) }, // Exclude source agent
      })
        .select('_id name email languageCapabilities')
        .sort({ name: 1 })
        .lean();

      if (!teamAgents.length) {
        return res.status(400).json({
          success: false,
          error: { message: 'No other active agents available for reallocation' },
        });
      }

      // Build agents by language map
      const agentsByLanguage = new Map<string, any[]>();
      for (const a of teamAgents as any[]) {
        const caps: string[] = Array.isArray(a.languageCapabilities) ? a.languageCapabilities : [];
        for (const cap of caps) {
          const key = normalize(cap);
          if (!key) continue;
          const list = agentsByLanguage.get(key) || [];
          list.push(a);
          agentsByLanguage.set(key, list);
        }
      }

      // Find all sampled-in-queue tasks assigned to the source agent
      const tasksToReallocate = await CallTask.aggregate([
        {
          $match: {
            assignedAgentId: new mongoose.Types.ObjectId(agentId),
            status: 'sampled_in_queue',
          },
        },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: '$farmer' },
        {
          $project: {
            _id: 1,
            farmerLanguage: '$farmer.preferredLanguage',
          },
        },
      ]);

      if (!tasksToReallocate.length) {
        return res.json({
          success: true,
          message: 'No tasks to reallocate',
          data: { reallocated: 0 },
        });
      }

      // Create allocation run tracker
      const runDoc = await AllocationRun.create({
        createdByUserId: authUserId ? new mongoose.Types.ObjectId(authUserId) : null,
        status: 'running',
        startedAt: new Date(),
        filters: {
          reallocateFromAgentId: agentId,
          reallocateFromAgentName: (sourceAgent as any).name,
        },
        total: tasksToReallocate.length,
        processed: 0,
        allocated: 0,
        skipped: 0,
        skippedByLanguage: {},
        errorCount: 0,
        errorMessages: [],
        lastProgressAt: new Date(),
      });

      // Round-robin assignment across capable agents (same logic as allocation)
      const STATUS_QUEUED: TaskStatus = 'sampled_in_queue';
      const languageAgentCursor = new Map<string, number>();
      const skippedByLanguage: Record<string, number> = {};
      const errorMessages: string[] = [];
      let processed = 0;
      let reallocated = 0;
      let skipped = 0;

      const BATCH_SIZE = 200;
      let batchOps: any[] = [];

      const flushBatch = async () => {
        if (!batchOps.length) return;
        try {
          const r = await CallTask.bulkWrite(batchOps as any, { ordered: false });
          reallocated += r.modifiedCount || 0;
        } catch (e: any) {
          errorMessages.push(e?.message || 'Bulk write failed');
        } finally {
          batchOps = [];
        }
      };

      for (let idx = 0; idx < tasksToReallocate.length; idx++) {
        const t = tasksToReallocate[idx];
        const taskId = t._id;
        const farmerLangKey = normalize(t.farmerLanguage) || 'unknown';

        const langAgents = agentsByLanguage.get(farmerLangKey) || [];
        if (!langAgents.length) {
          skippedByLanguage[farmerLangKey] = (skippedByLanguage[farmerLangKey] || 0) + 1;
          skipped++;
          processed++;
          if (processed % 50 === 0) {
            await AllocationRun.updateOne(
              { _id: runDoc._id },
              {
                $set: {
                  processed,
                  allocated: reallocated,
                  skipped,
                  skippedByLanguage,
                  errorCount: errorMessages.length,
                  errorMessages: errorMessages.slice(-50),
                  lastProgressAt: new Date(),
                },
              }
            );
          }
          continue;
        }

        const cursor = languageAgentCursor.get(farmerLangKey) || 0;
        const agent = langAgents[cursor % langAgents.length];
        languageAgentCursor.set(farmerLangKey, cursor + 1);

        batchOps.push({
          updateOne: {
            filter: { _id: taskId, assignedAgentId: new mongoose.Types.ObjectId(agentId), status: STATUS_QUEUED },
            update: {
              $set: {
                assignedAgentId: agent._id,
              },
              $push: {
                interactionHistory: {
                  timestamp: new Date(),
                  status: STATUS_QUEUED,
                  notes: `Reallocated from ${(sourceAgent as any).name} (${(sourceAgent as any).email}) to ${agent.name} (${agent.email}) by Team Lead`,
                },
              },
            },
          },
        });
        processed++;

        if (batchOps.length >= BATCH_SIZE) {
          await flushBatch();
        }

        if (processed % 50 === 0) {
          await AllocationRun.updateOne(
            { _id: runDoc._id },
            {
              $set: {
                processed,
                allocated: reallocated,
                skipped,
                skippedByLanguage,
                errorCount: errorMessages.length,
                errorMessages: errorMessages.slice(-50),
                lastProgressAt: new Date(),
              },
            }
          );
        }
      }

      await flushBatch();

      await AllocationRun.updateOne(
        { _id: runDoc._id },
        {
          $set: {
            status: 'completed',
            finishedAt: new Date(),
            processed,
            allocated: reallocated,
            skipped,
            skippedByLanguage,
            errorCount: errorMessages.length,
            errorMessages: errorMessages.slice(-50),
            lastProgressAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: 'Tasks reallocated successfully',
        data: {
          runId: runDoc._id.toString(),
          reallocated,
          skipped,
          skippedByLanguage,
          totalTasks: tasksToReallocate.length,
        },
      });
    } catch (error) {
      try {
        const authReq = req as AuthRequest;
        if (authReq?.user?._id) {
          await AllocationRun.create({
            createdByUserId: authReq.user._id,
            status: 'failed',
            startedAt: new Date(),
            finishedAt: new Date(),
            total: 0,
            processed: 0,
            allocated: 0,
            skipped: 0,
            errorCount: 1,
            errorMessages: [error instanceof Error ? error.message : 'Unknown error'],
          });
        }
      } catch {
        // ignore
      }
      next(error);
    }
  }
);

// @route   GET /api/tasks/allocate-status/latest
// @desc    Latest allocation run status for current user (for UI polling)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/allocate-status/latest',
  requirePermission('tasks.view.team'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.user._id;
      const run = await AllocationRun.findOne({ createdByUserId: userId }).sort({ startedAt: -1 }).lean();
      res.json({ success: true, data: { run: run || null } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/:id
// @desc    Get task by ID
// @access  Private
router.get(
  '/unassigned',
  requirePermission('tasks.view.team'),
  [
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

      const { dateFrom, dateTo, page, limit } = req.query;
      const result = await getUnassignedTasks({
        dateFrom: dateFrom ? (dateFrom as string) : undefined,
        dateTo: dateTo ? (dateTo as string) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthRequest;
      const taskId = req.params.id;
      const userId = authReq.user._id.toString();
      const userRole = authReq.user.role;

      const task = await CallTask.findById(taskId)
        .populate('farmerId')
        .populate('activityId')
        .populate('assignedAgentId', 'name email employeeId');

      if (!task) {
        const error: AppError = new Error('Task not found');
        error.statusCode = 404;
        throw error;
      }

      // Check permissions: CC Agent can only view own tasks
      if (userRole === 'cc_agent' && (!task.assignedAgentId || task.assignedAgentId.toString() !== userId)) {
        const error: AppError = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }

      res.json({
        success: true,
        data: { task },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/tasks/:id/submit
// @desc    Submit call interaction (CC Agent)
// @access  Private (CC Agent only)
router.post(
  '/:id/submit',
  requirePermission('tasks.submit'),
  [
    body('callStatus')
      .isIn(['Connected', 'Disconnected', 'Incoming N/A', 'No Answer', 'Invalid', 'Not Reachable', 'Invalid Number'])
      .withMessage('Invalid call status'),
    body('callDurationSeconds').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Invalid callDurationSeconds'),
    body('didAttend').optional().isIn(['Yes, I attended', 'No, I missed', "Don't recall", 'Identity Wrong', 'Not a Farmer', null]).withMessage('Invalid didAttend value'),
    body('didRecall').optional({ nullable: true }).isBoolean(),
    body('cropsDiscussed').optional().isArray(),
    body('productsDiscussed').optional().isArray(),
    body('hasPurchased').optional({ nullable: true }).isBoolean(),
    body('willingToPurchase').optional({ nullable: true }).isBoolean(),
    body('likelyPurchaseDate').optional({ nullable: true }).isString(),
    body('nonPurchaseReason').optional().isString(),
    body('purchasedProducts').optional().isArray(),
    body('purchasedProducts.*.product').optional().isString(),
    body('purchasedProducts.*.quantity').optional().isString(),
    body('purchasedProducts.*.unit').optional().isIn(['kg', 'gms', 'lt']),
    body('farmerComments').optional().isString(),
    body('sentiment').optional().isIn(['Positive', 'Negative', 'Neutral', 'N/A']).withMessage('Invalid sentiment value'),
    body('activityQuality').optional({ nullable: true }).isInt({ min: 1, max: 5 }).withMessage('activityQuality must be 1-5'),
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

      const authReq = req as AuthRequest;
      const taskId = req.params.id;
      const agentId = authReq.user._id.toString();

      const task = await CallTask.findById(taskId);
      if (!task) {
        const error: AppError = new Error('Task not found');
        error.statusCode = 404;
        throw error;
      }

      // Verify task is assigned to this agent
      if (!task.assignedAgentId || task.assignedAgentId.toString() !== agentId) {
        const error: AppError = new Error('Task not assigned to you');
        error.statusCode = 403;
        throw error;
      }

      // Create call log
      const callLog: ICallLog = {
        timestamp: new Date(),
        callStatus: req.body.callStatus,
        callDurationSeconds: Number(req.body.callDurationSeconds || 0),
        didAttend: req.body.didAttend ?? null,
        didRecall: req.body.didRecall ?? null,
        cropsDiscussed: req.body.cropsDiscussed || [],
        productsDiscussed: req.body.productsDiscussed || [],
        hasPurchased: req.body.hasPurchased ?? null,
        willingToPurchase: req.body.willingToPurchase ?? null,
        likelyPurchaseDate: req.body.likelyPurchaseDate || '',
        nonPurchaseReason: req.body.nonPurchaseReason || '',
        purchasedProducts: req.body.purchasedProducts || [],
        farmerComments: req.body.farmerComments || '',
        sentiment: req.body.sentiment || 'N/A',
        ...(req.body.activityQuality != null && { activityQuality: Number(req.body.activityQuality) }),
      };

      // Update task with call log
      task.callLog = callLog;

      // Determine final status based on call status
      let finalStatus: TaskStatus = 'completed';
      if (['Incoming N/A', 'No Answer', 'Disconnected', 'Not Reachable'].includes(req.body.callStatus)) {
        finalStatus = 'not_reachable';
      } else if (['Invalid', 'Invalid Number'].includes(req.body.callStatus)) {
        finalStatus = 'invalid_number';
      }

      // Calculate and set outcome based on final status
      const finalOutcome = getOutcomeFromStatus(finalStatus);

      // Add to interaction history (record previous status before update)
      const previousStatus = task.status;
      // Add to interaction history
      task.interactionHistory.push({
        timestamp: new Date(),
        status: previousStatus,
        notes: 'Call interaction submitted',
      });

      task.status = finalStatus;
      task.outcome = finalOutcome;
      await task.save();

      logger.info(`Task ${taskId} submitted by agent ${authReq.user.email}`);

      res.json({
        success: true,
        message: 'Call interaction submitted successfully',
        data: { task },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// CRITICAL: Bulk routes MUST be defined BEFORE parameterized routes (/:id/*)
// Express matches routes in order, so /bulk/status must come before /:id/status
// ============================================================================

// @route   PUT /api/tasks/bulk/reassign
// @desc    Bulk reassign tasks to an agent
// @access  Private (Team Lead, MIS Admin)
router.put(
  '/bulk/reassign',
  requirePermission('tasks.reassign'),
  [
    body('taskIds').isArray().withMessage('taskIds must be an array'),
    body('taskIds.*').isMongoId().withMessage('Each task ID must be valid'),
    body('agentId').isMongoId().withMessage('Valid agent ID is required'),
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

      const { taskIds, agentId } = req.body;
      const results = [];
      const errors_list: any[] = [];

      for (const taskId of taskIds) {
        try {
          const task = await assignTaskToAgent(taskId, agentId);
          results.push(task);
        } catch (err: any) {
          errors_list.push({ taskId, error: err.message });
        }
      }

      res.json({
        success: true,
        message: `Reassigned ${results.length} of ${taskIds.length} tasks`,
        data: {
          successful: results.length,
          failed: errors_list.length,
          results,
          errors: errors_list,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/tasks/bulk/status
// @desc    Bulk update task status
// @access  Private (Team Lead, MIS Admin)
// CRITICAL: This route MUST match /tasks/bulk/status exactly
router.put(
  '/bulk/status',
  requirePermission('tasks.reassign'),
  [
    body('taskIds').isArray().withMessage('taskIds must be an array'),
    body('taskIds.*').isMongoId().withMessage('Each task ID must be valid'),
    body('status').isIn(['sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number']).withMessage('Invalid status'),
    body('notes').optional().isString(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // CRITICAL: Explicitly verify we're in the correct route handler
      const path = req.path || req.url;
      if (!path.includes('/bulk/status')) {
        logger.error('Bulk status route handler called but path does not match!', {
          path,
          originalUrl: req.originalUrl,
          url: req.url,
          method: req.method,
        });
        const error: AppError = new Error('Internal route matching error');
        error.statusCode = 500;
        throw error;
      }

      // Log that we're in the bulk route handler
      logger.info('✅ Bulk status update route matched correctly', {
        path: req.path,
        originalUrl: req.originalUrl,
        method: req.method,
        body: { taskIds: req.body.taskIds?.length, status: req.body.status },
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const { taskIds, status, notes } = req.body;
      
      // CRITICAL: Validate taskIds is an array and not empty
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        logger.error('Invalid taskIds in request body', { taskIds, body: req.body });
        return res.status(400).json({
          success: false,
          error: { message: 'taskIds must be a non-empty array' },
        });
      }

      // CRITICAL: Filter out any invalid IDs (including 'bulk' if it somehow got in)
      const validTaskIds = taskIds.filter((id: string) => {
        if (typeof id !== 'string' || id === 'bulk' || id.toLowerCase() === 'bulk') {
          logger.warn('Filtering out invalid taskId from bulk update', { invalidId: id, allTaskIds: taskIds });
          return false;
        }
        return /^[0-9a-fA-F]{24}$/.test(id);
      });

      if (validTaskIds.length === 0) {
        logger.error('No valid taskIds after filtering', { originalTaskIds: taskIds });
        return res.status(400).json({
          success: false,
          error: { message: 'No valid task IDs provided' },
        });
      }

      if (validTaskIds.length !== taskIds.length) {
        logger.warn('Some invalid taskIds were filtered out', { 
          original: taskIds.length, 
          valid: validTaskIds.length,
          invalid: taskIds.filter((id: string) => !validTaskIds.includes(id))
        });
      }

      const results = [];
      const errors_list: any[] = [];

      for (const taskId of validTaskIds) {
        try {
          const task = await updateTaskStatus(taskId, status, notes);
          results.push(task);
        } catch (err: any) {
          errors_list.push({ taskId, error: err.message });
        }
      }

      res.json({
        success: true,
        message: `Updated status for ${results.length} of ${taskIds.length} tasks`,
        data: {
          successful: results.length,
          failed: errors_list.length,
          results,
          errors: errors_list,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/tasks/:id/reassign
// @desc    Reassign task to another agent (Team Lead/Admin)
// @access  Private (Team Lead, MIS Admin)
router.put(
  '/:id/reassign',
  requirePermission('tasks.reassign'),
  [
    body('agentId').isMongoId().withMessage('Valid agent ID is required'),
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

      const taskId = req.params.id;
      const { agentId } = req.body;

      const task = await assignTaskToAgent(taskId, agentId);

      res.json({
        success: true,
        message: 'Task reassigned successfully',
        data: { task },
      });
    } catch (error) {
      next(error);
    }
  }
);

    // @route   PUT /api/tasks/:id/status
    // @desc    Update task status
    // @access  Private (Team Lead, MIS Admin)
    router.put(
      '/:id/status',
      requirePermission('tasks.reassign'),
      // CRITICAL: Add param validation middleware BEFORE route handler
      (req: Request, res: Response, next: NextFunction) => {
        const taskId = req.params.id;
        // EXPLICITLY reject 'bulk' at the middleware level - before ANY other code runs
        if (taskId === 'bulk' || taskId?.toLowerCase() === 'bulk') {
          logger.error('❌ MIDDLEWARE REJECTION: /:id/status matched "bulk" - this should not happen!', {
            path: req.path,
            originalUrl: req.originalUrl,
            method: req.method,
            params: req.params,
            url: req.url,
          });
          const error: AppError = new Error('Invalid route: Use /bulk/status for bulk operations. Route matching error detected.');
          error.statusCode = 400;
          return next(error);
        }
        next();
      },
      [
        body('status').isIn(['sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number']).withMessage('Invalid status'),
        body('notes').optional().isString(),
      ],
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const taskId = req.params.id;
          
          // Double-check (defense in depth)
          if (taskId === 'bulk' || taskId?.toLowerCase() === 'bulk') {
            logger.error('❌ DOUBLE-CHECK FAILED: taskId is still "bulk" after middleware!', {
              path: req.path,
              originalUrl: req.originalUrl,
              method: req.method,
              params: req.params,
            });
            const error: AppError = new Error('Invalid route: Use /bulk/status for bulk operations');
            error.statusCode = 400;
            throw error;
          }

      // Validate taskId is a valid MongoDB ObjectId format
      const originalUrl = req.originalUrl || req.path;
      if (!/^[0-9a-fA-F]{24}$/.test(taskId)) {
        logger.warn('Invalid task ID format received', { taskId, path: req.path, originalUrl: originalUrl });
        const error: AppError = new Error('Invalid task ID format');
        error.statusCode = 400;
        throw error;
      }
      
      logger.info('Single task status update route matched', {
        taskId,
        path: req.path,
        originalUrl: originalUrl,
        method: req.method,
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }
      
      const { status, notes } = req.body;

      const task = await updateTaskStatus(taskId, status, notes);

      res.json({
        success: true,
        message: 'Task status updated successfully',
        data: { task },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// CALLBACK REQUEST ENDPOINTS (Team Lead)
// ============================================================================

// @route   GET /api/tasks/callback/candidates
// @desc    List tasks eligible for callback (completed/unsuccessful tasks under team)
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/callback/candidates',
  requirePermission('tasks.view.team'),
  [
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('outcome').optional().isIn(['Unsuccessful', 'Completed Conversation', 'all']),
    query('callType').optional().isIn(['original', 'callback', 'all']),
    query('agentId').optional().isMongoId(),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const { dateFrom, dateTo, outcome, callType, agentId, page = 1, limit = 50 } = req.query;

      // Get team agents
      const teamAgents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      }).select('_id name email').lean();

      const teamAgentIds = teamAgents.map(a => a._id);

      if (!teamAgentIds.length) {
        return res.json({
          success: true,
          data: {
            tasks: [],
            agents: [],
            pagination: { page: 1, limit: Number(limit), total: 0, pages: 0 },
          },
        });
      }

      // Build match query
      const match: any = {
        assignedAgentId: { $in: teamAgentIds },
        status: { $in: ['completed', 'not_reachable', 'invalid_number'] }, // Only completed/unsuccessful
        // Max 2 callbacks: handle tasks without callbackNumber field (treat as 0)
        $or: [
          { callbackNumber: { $exists: false } },
          { callbackNumber: null },
          { callbackNumber: { $lt: 2 } },
        ],
      };

      // Agent filter
      if (agentId) {
        match.assignedAgentId = new mongoose.Types.ObjectId(agentId as string);
      }

      // Date filter (using updatedAt for when call was completed)
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom as string) : null;
        const to = dateTo ? new Date(dateTo as string) : null;
        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);
        
        match.updatedAt = {};
        if (from) match.updatedAt.$gte = from;
        if (to) match.updatedAt.$lte = to;
      }

      // Outcome filter
      if (outcome && outcome !== 'all') {
        match.outcome = outcome;
      }

      // Call type filter
      if (callType === 'original') {
        match.isCallback = { $ne: true };
      } else if (callType === 'callback') {
        match.isCallback = true;
      }

      // Fetch tasks with farmer and activity data, excluding those that already have callbacks
      const tasks = await CallTask.aggregate([
        { $match: match },
        // Lookup to check if a callback already exists for this task
        {
          $lookup: {
            from: 'calltasks',
            localField: '_id',
            foreignField: 'parentTaskId',
            as: 'existingCallbacks',
          },
        },
        // Filter out tasks that already have a callback created
        { $match: { existingCallbacks: { $size: 0 } } },
        { $sort: { updatedAt: -1 } },
        { $skip: (Number(page) - 1) * Number(limit) },
        { $limit: Number(limit) },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'activities',
            localField: 'activityId',
            foreignField: '_id',
            as: 'activity',
          },
        },
        { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'users',
            localField: 'assignedAgentId',
            foreignField: '_id',
            as: 'agent',
          },
        },
        { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            status: 1,
            outcome: 1,
            callbackNumber: 1,
            isCallback: 1,
            updatedAt: 1,
            callLog: 1,
            'farmer._id': 1,
            'farmer.name': 1,
            'farmer.mobileNumber': 1,
            'farmer.preferredLanguage': 1,
            'farmer.location': 1,
            'activity._id': 1,
            'activity.type': 1,
            'activity.territoryName': 1,
            'agent._id': 1,
            'agent.name': 1,
            'agent.email': 1,
          },
        },
      ]);

      // Get total count (need separate aggregation for accurate count)
      const countResult = await CallTask.aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'calltasks',
            localField: '_id',
            foreignField: 'parentTaskId',
            as: 'existingCallbacks',
          },
        },
        { $match: { existingCallbacks: { $size: 0 } } },
        { $count: 'total' },
      ]);
      const total = countResult[0]?.total || 0;
      const pages = Math.ceil(total / Number(limit));

      res.json({
        success: true,
        data: {
          tasks,
          agents: teamAgents,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/tasks/callback/create
// @desc    Create callback tasks from selected task IDs (bulk)
// @access  Private (Team Lead, MIS Admin)
router.post(
  '/callback/create',
  requirePermission('tasks.reassign'),
  [
    body('taskIds').isArray({ min: 1 }).withMessage('At least one task ID is required'),
    body('taskIds.*').isMongoId().withMessage('Invalid task ID format'),
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

      const authReq = req as AuthRequest;
      const teamLeadId = authReq.user._id.toString();
      const { taskIds } = req.body;

      // Get team agents for allocation
      const teamAgents = await User.find({
        teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
        role: 'cc_agent',
        isActive: true,
      }).select('_id name email languageCapabilities').lean();

      if (!teamAgents.length) {
        return res.status(400).json({
          success: false,
          error: { message: 'No active agents available for callback allocation' },
        });
      }

      // Build agents by language map
      const normalize = (s: any) => String(s ?? '').trim().toLowerCase();
      const agentsByLanguage = new Map<string, any[]>();
      const agentRoundRobin = new Map<string, number>(); // Track round-robin index per language

      for (const a of teamAgents as any[]) {
        const caps: string[] = Array.isArray(a.languageCapabilities) ? a.languageCapabilities : [];
        for (const cap of caps) {
          const key = normalize(cap);
          if (!key) continue;
          const list = agentsByLanguage.get(key) || [];
          list.push(a);
          agentsByLanguage.set(key, list);
          if (!agentRoundRobin.has(key)) agentRoundRobin.set(key, 0);
        }
      }

      // Fetch original tasks with farmer data
      const originalTasks = await CallTask.aggregate([
        {
          $match: {
            _id: { $in: taskIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
            status: { $in: ['completed', 'not_reachable', 'invalid_number'] },
            // Max 2 callbacks: handle tasks without callbackNumber field (treat as 0)
            $or: [
              { callbackNumber: { $exists: false } },
              { callbackNumber: null },
              { callbackNumber: { $lt: 2 } },
            ],
          },
        },
        {
          $lookup: {
            from: Farmer.collection.name,
            localField: 'farmerId',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: '$farmer' },
      ]);

      if (!originalTasks.length) {
        return res.status(400).json({
          success: false,
          error: { message: 'No valid tasks found for callback creation (may have reached max callbacks)' },
        });
      }

      const created: any[] = [];
      const skipped: any[] = [];

      for (const task of originalTasks) {
        const farmerLang = normalize(task.farmer?.preferredLanguage);
        const candidateAgents = agentsByLanguage.get(farmerLang) || [];

        if (!candidateAgents.length) {
          skipped.push({
            taskId: task._id.toString(),
            reason: `No agent available for language: ${task.farmer?.preferredLanguage || 'Unknown'}`,
          });
          continue;
        }

        // Round-robin selection
        const rrIndex = agentRoundRobin.get(farmerLang) || 0;
        const selectedAgent = candidateAgents[rrIndex % candidateAgents.length];
        agentRoundRobin.set(farmerLang, rrIndex + 1);

        // Create callback task
        const newCallbackNumber = (task.callbackNumber || 0) + 1;
        
        try {
          const callbackTask = await CallTask.create({
            farmerId: task.farmerId,
            activityId: task.activityId,
            status: 'sampled_in_queue',
            retryCount: (task.retryCount || 0) + 1,
            assignedAgentId: selectedAgent._id,
            scheduledDate: new Date(),
            parentTaskId: task._id,
            isCallback: true,
            callbackNumber: newCallbackNumber,
            interactionHistory: [
              {
                timestamp: new Date(),
                status: 'sampled_in_queue',
                notes: `Callback #${newCallbackNumber} created by Team Lead from task ${task._id}`,
              },
            ],
          });

          created.push({
            originalTaskId: task._id.toString(),
            callbackTaskId: callbackTask._id.toString(),
            assignedTo: { id: selectedAgent._id, name: selectedAgent.name, email: selectedAgent.email },
            farmerName: task.farmer?.name,
            callbackNumber: newCallbackNumber,
          });
        } catch (err: any) {
          // Handle duplicate key error (callback already exists)
          if (err.code === 11000) {
            skipped.push({
              taskId: task._id.toString(),
              reason: 'Callback already exists for this task',
            });
          } else {
            throw err;
          }
        }
      }

      res.json({
        success: true,
        message: `Created ${created.length} callback task(s), skipped ${skipped.length}`,
        data: {
          created,
          skipped,
          summary: {
            requested: taskIds.length,
            created: created.length,
            skipped: skipped.length,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/tasks/:taskId/callback-history
// @desc    Get callback chain history for a task (original + all callbacks)
// @access  Private
router.get(
  '/:taskId/callback-history',
  requirePermission('tasks.view.own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { taskId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid task ID' },
        });
      }

      // Get the current task
      const currentTask = await CallTask.findById(taskId)
        .populate('farmerId', 'name mobileNumber preferredLanguage location')
        .populate('assignedAgentId', 'name email')
        .lean();

      if (!currentTask) {
        return res.status(404).json({
          success: false,
          error: { message: 'Task not found' },
        });
      }

      // Find the root task (original)
      let rootTaskId = currentTask._id;
      if (currentTask.parentTaskId) {
        // Traverse up to find the root
        let parentId = currentTask.parentTaskId;
        while (parentId) {
          const parent = await CallTask.findById(parentId).select('parentTaskId').lean();
          if (!parent || !parent.parentTaskId) {
            rootTaskId = parentId;
            break;
          }
          parentId = parent.parentTaskId;
        }
      }

      // Get all tasks in the chain (original + callbacks)
      const chain = await CallTask.find({
        $or: [
          { _id: rootTaskId },
          { parentTaskId: rootTaskId },
          // For deeper chains, find by activityId+farmerId
          { 
            activityId: currentTask.activityId, 
            farmerId: currentTask.farmerId,
          },
        ],
      })
        .populate('assignedAgentId', 'name email')
        .sort({ callbackNumber: 1, createdAt: 1 })
        .lean();

      // Deduplicate and sort
      const uniqueChain = Array.from(
        new Map(chain.map((t: any) => [t._id.toString(), t])).values()
      ).sort((a: any, b: any) => (a.callbackNumber || 0) - (b.callbackNumber || 0));

      res.json({
        success: true,
        data: {
          currentTaskId: taskId,
          chain: uniqueChain.map((t: any) => ({
            _id: t._id,
            callbackNumber: t.callbackNumber || 0,
            isCallback: t.isCallback || false,
            status: t.status,
            outcome: t.outcome,
            callLog: t.callLog,
            assignedAgent: t.assignedAgentId,
            callStartedAt: t.callStartedAt,
            updatedAt: t.updatedAt,
            createdAt: t.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

// Route fix deployed: Sun Jan  4 19:37:52 IST 2026