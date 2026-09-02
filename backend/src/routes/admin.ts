import express, { Request, Response, NextFunction } from 'express';
import { parseQueryDateFrom, parseQueryDateTo } from '../utils/dateRangeQuery.js';
import { query, param, body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getActivitiesWithSampling,
  getActivitiesSamplingExportRows,
  getActivitiesSamplingStats,
  getActivitiesSamplingFilterOptions,
  getAgentQueues,
  getAgentQueue,
} from '../services/adminService.js';
import {
  ACTIVITY_PARK_KEYS,
  TASK_PARK_STATUSES,
  getStockParkingCounts,
  previewStockParking,
  applyStockParking,
  type ActivityParkKey,
  type TaskParkStatus,
} from '../services/stockParkingService.js';
import logger from '../config/logger.js';
import * as XLSX from 'xlsx';
import voiceAdminRoutes from './voiceAdmin.js';

const router = express.Router();

// All routes require authentication and MIS Admin role
router.use(authenticate);
router.use(requireRole('mis_admin'));

/**
 * @route   GET /api/admin/activities-sampling
 * @desc    Get all activities with sampling status and assigned agents
 * @access  Private (MIS Admin only)
 */
router.get(
  '/activities-sampling',
  [
    query('activityType').optional().isString(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('samplingStatus').optional().isIn(['sampled', 'not_sampled', 'partial']),
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

      const {
        activityType,
        territory,
        zone,
        bu,
        samplingStatus,
        dateFrom,
        dateTo,
        page,
        limit,
      } = req.query;

      // Convert date strings to Date objects if provided
      const dateFromParsed = parseQueryDateFrom(dateFrom as string | undefined);
      const dateToParsed = parseQueryDateTo(dateTo as string | undefined);

      const result = await getActivitiesWithSampling({
        activityType: activityType as string,
        territory: territory as string,
        zone: zone as string,
        bu: bu as string,
        samplingStatus: samplingStatus as 'sampled' | 'not_sampled' | 'partial',
        dateFrom: dateFromParsed,
        dateTo: dateToParsed,
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

/**
 * @route   GET /api/admin/activities-sampling/stats
 * @desc    Get activity sampling statistics for current filters (not paginated)
 * @access  Private (MIS Admin only)
 */
router.get(
  '/activities-sampling/stats',
  [
    query('activityType').optional().isString(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('samplingStatus').optional().isIn(['sampled', 'not_sampled', 'partial']),
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

      const {
        activityType,
        territory,
        zone,
        bu,
        samplingStatus,
        dateFrom,
        dateTo,
      } = req.query;

      const dateFromParsed = parseQueryDateFrom(dateFrom as string | undefined);
      const dateToParsed = parseQueryDateTo(dateTo as string | undefined);

      const stats = await getActivitiesSamplingStats({
        activityType: activityType as string,
        territory: territory as string,
        zone: zone as string,
        bu: bu as string,
        samplingStatus: samplingStatus as any,
        dateFrom: dateFromParsed,
        dateTo: dateToParsed,
      });

      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/admin/activities-sampling/options
 * @desc    Get distinct dropdown options for activity sampling filters (territory/zone/bu) scoped to current filters (not paginated)
 * @access  Private (MIS Admin only)
 */
router.get(
  '/activities-sampling/options',
  [
    query('activityType').optional().isString(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('samplingStatus').optional().isIn(['sampled', 'not_sampled', 'partial']),
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

      const {
        activityType,
        territory,
        zone,
        bu,
        samplingStatus,
        dateFrom,
        dateTo,
      } = req.query;

      const dateFromParsed = parseQueryDateFrom(dateFrom as string | undefined);
      const dateToParsed = parseQueryDateTo(dateTo as string | undefined);

      const options = await getActivitiesSamplingFilterOptions({
        activityType: activityType as string,
        territory: territory as string,
        zone: zone as string,
        bu: bu as string,
        samplingStatus: samplingStatus as any,
        dateFrom: dateFromParsed,
        dateTo: dateToParsed,
      });

      res.json({ success: true, data: options });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/admin/activities-sampling/export
 * @desc    Export activity sampling list (filtered) as Excel
 * @access  Private (MIS Admin only)
 */
router.get(
  '/activities-sampling/export',
  [
    query('activityType').optional().isString(),
    query('territory').optional().isString(),
    query('zone').optional().isString(),
    query('bu').optional().isString(),
    query('samplingStatus').optional().isIn(['sampled', 'not_sampled', 'partial']),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
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

      const {
        activityType,
        territory,
        zone,
        bu,
        samplingStatus,
        dateFrom,
        dateTo,
        page,
        limit,
      } = req.query;

      const dateFromParsed = parseQueryDateFrom(dateFrom as string | undefined);
      const dateToParsed = parseQueryDateTo(dateTo as string | undefined);

      const rows = await getActivitiesSamplingExportRows({
        activityType: activityType as string,
        territory: territory as string,
        zone: zone as string,
        bu: bu as string,
        samplingStatus: samplingStatus as any,
        dateFrom: dateFromParsed,
        dateTo: dateToParsed,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      const pad2 = (n: number) => String(n).padStart(2, '0');
      const fmtDate = (d: Date) =>
        d && !Number.isNaN(d.getTime()) ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';

      const samplingStatusLabel = (s: 'sampled' | 'not_sampled' | 'partial') =>
        s === 'sampled' ? 'Full' : s === 'partial' ? 'Partial (no farmers selected)' : 'Not Sampled';
      const sheetRows = rows.map((r) => ({
        'Activity ID': r.activityId,
        Type: r.type,
        Date: fmtDate(r.date),
        Territory: r.territory,
        Zone: r.zone,
        State: r.state,
        Region: r.region,
        BU: r.bu,
        Officer: r.officerName,
        'Total Farmers': r.totalFarmers,
        'Farmers Sampled': r.farmersSampled,
        'Sampling %': r.samplingPercentage,
        'Sampling Status': samplingStatusLabel(r.samplingStatus),
        'Tasks Total': r.tasksTotal,
        'Unassigned': r.unassigned,
        'In Queue': r.sampledInQueue,
        'In Progress': r.inProgress,
        Completed: r.completed,
        'Not Reachable': r.notReachable,
        'Invalid Number': r.invalidNumber,
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Activities');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const now = new Date();
      const filename = `activity_sampling_export_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(
        now.getHours()
      )}${pad2(now.getMinutes())}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/admin/agent-queues
 * @desc    Get task queues for all agents with status breakdown
 * @access  Private (MIS Admin only)
 */
router.get(
  '/agent-queues',
  [
    query('agentId').optional().isMongoId(),
    query('isActive').optional().isBoolean(),
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

      const { agentId, isActive } = req.query;

      const result = await getAgentQueues({
        agentId: agentId as string,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
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

/**
 * @route   GET /api/admin/agent-queues/:agentId
 * @desc    Get detailed queue for a specific agent
 * @access  Private (MIS Admin only)
 */
router.get(
  '/agent-queues/:agentId',
  [
    param('agentId').isMongoId().withMessage('Invalid agent ID'),
    query('dateFrom').optional().isString(),
    query('dateTo').optional().isString(),
    query('status').optional().isString(),
    query('language').optional().isString(),
    query('territory').optional().isString(),
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

      const { agentId } = req.params;
      const { dateFrom, dateTo, status, language, territory, page, limit } = req.query as Record<string, string | undefined>;

      const result = await getAgentQueue(agentId, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        status: status || undefined,
        language: language || undefined,
        territory: territory || undefined,
        page: page != null ? parseInt(String(page), 10) : undefined,
        limit: limit != null ? parseInt(String(limit), 10) : undefined,
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

/**
 * @route   GET /api/admin/stock-parking/counts
 * @desc    Activity + task stage counts for a required date range (Admin parking control)
 * @access  Private (MIS Admin)
 */
router.get(
  '/stock-parking/counts',
  [
    query('dateFrom').notEmpty().isISO8601().withMessage('dateFrom is required'),
    query('dateTo').notEmpty().isISO8601().withMessage('dateTo is required'),
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

      const { dateFrom, dateTo, bu, state } = req.query as Record<string, string | undefined>;
      const data = await getStockParkingCounts({
        dateFrom: dateFrom!,
        dateTo: dateTo!,
        bu,
        state,
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/admin/stock-parking/preview
 * @desc    Preview park counts for selected activity cohorts / task statuses
 * @access  Private (MIS Admin)
 */
router.post(
  '/stock-parking/preview',
  [
    body('dateFrom').notEmpty().isISO8601(),
    body('dateTo').notEmpty().isISO8601(),
    body('bu').optional().isString(),
    body('state').optional().isString(),
    body('activityKeys').optional().isArray(),
    body('activityKeys.*').optional().isIn([...ACTIVITY_PARK_KEYS]),
    body('taskStatuses').optional().isArray(),
    body('taskStatuses.*').optional().isIn([...TASK_PARK_STATUSES]),
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

      const { dateFrom, dateTo, bu, state, activityKeys, taskStatuses } = req.body as {
        dateFrom: string;
        dateTo: string;
        bu?: string;
        state?: string;
        activityKeys?: ActivityParkKey[];
        taskStatuses?: TaskParkStatus[];
      };

      const data = await previewStockParking(
        { dateFrom, dateTo, bu, state },
        activityKeys || [],
        taskStatuses || []
      );

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/admin/stock-parking/park
 * @desc    Park selected activity cohorts → inactive; selected task statuses → cancelled
 * @access  Private (MIS Admin)
 */
router.post(
  '/stock-parking/park',
  [
    body('dateFrom').notEmpty().isISO8601(),
    body('dateTo').notEmpty().isISO8601(),
    body('bu').optional().isString(),
    body('state').optional().isString(),
    body('activityKeys').optional().isArray(),
    body('activityKeys.*').optional().isIn([...ACTIVITY_PARK_KEYS]),
    body('taskStatuses').optional().isArray(),
    body('taskStatuses.*').optional().isIn([...TASK_PARK_STATUSES]),
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
      const { dateFrom, dateTo, bu, state, activityKeys, taskStatuses } = req.body as {
        dateFrom: string;
        dateTo: string;
        bu?: string;
        state?: string;
        activityKeys?: ActivityParkKey[];
        taskStatuses?: TaskParkStatus[];
      };

      const data = await applyStockParking(
        { dateFrom, dateTo, bu, state },
        activityKeys || [],
        taskStatuses || [],
        { userId: authReq.user._id.toString() }
      );

      res.json({
        success: true,
        message: `Parked ${data.activitiesInactivated} activit${data.activitiesInactivated === 1 ? 'y' : 'ies'} to inactive; cancelled ${data.tasksCancelled} task(s)`,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.use('/voice', voiceAdminRoutes);

export default router;

