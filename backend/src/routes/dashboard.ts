import express, { Request, Response, NextFunction } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getEmsProgress,
  getEmsDrilldown,
  getEmsFilterOptions,
  parseEmsProgressFilters,
  EmsDrilldownGroupBy,
} from '../services/kpiService.js';

const router = express.Router();

router.use(authenticate);
router.use(requireRole('mis_admin'));

const validGroupBy: EmsDrilldownGroupBy[] = ['state', 'territory', 'zone', 'bu', 'activityType'];

/**
 * GET /api/kpi/ems
 * EMS progress summary (activities lifecycle, task status, farmers). Supports filters.
 */
router.get(
  '/ems',
  [
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('state').optional().isString().trim(),
    query('territory').optional().isString().trim(),
    query('zone').optional().isString().trim(),
    query('bu').optional().isString().trim(),
    query('activityType').optional().isString().trim(),
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
      const filters = {
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
        state: (req.query.state as string) || undefined,
        territory: (req.query.territory as string) || undefined,
        zone: (req.query.zone as string) || undefined,
        bu: (req.query.bu as string) || undefined,
        activityType: (req.query.activityType as string) || undefined,
      };
      const summary = await getEmsProgress(filters);
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/kpi/ems/drilldown
 * Drilldown by state, territory, zone, bu, or activityType. Same filters as summary.
 */
router.get(
  '/ems/drilldown',
  [
    query('groupBy').isIn(validGroupBy).withMessage('groupBy must be one of: state, territory, zone, bu, activityType'),
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('state').optional().isString().trim(),
    query('territory').optional().isString().trim(),
    query('zone').optional().isString().trim(),
    query('bu').optional().isString().trim(),
    query('activityType').optional().isString().trim(),
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
      const groupBy = req.query.groupBy as EmsDrilldownGroupBy;
      const filters = {
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
        state: (req.query.state as string) || undefined,
        territory: (req.query.territory as string) || undefined,
        zone: (req.query.zone as string) || undefined,
        bu: (req.query.bu as string) || undefined,
        activityType: (req.query.activityType as string) || undefined,
      };
      const rows = await getEmsDrilldown(filters, groupBy);
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/kpi/ems/filter-options
 * Distinct values for state, territory, zone, bu, activity type (optionally filtered by date).
 */
router.get(
  '/ems/filter-options',
  [
    query('dateFrom').optional().isISO8601().toDate(),
    query('dateTo').optional().isISO8601().toDate(),
    query('state').optional().isString().trim(),
    query('territory').optional().isString().trim(),
    query('zone').optional().isString().trim(),
    query('bu').optional().isString().trim(),
    query('activityType').optional().isString().trim(),
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
      const filters = parseEmsProgressFilters(req.query as Record<string, unknown>);
      const options = await getEmsFilterOptions(filters);
      res.json({ success: true, data: options });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
