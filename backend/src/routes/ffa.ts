import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { syncFFAData, getSyncStatus, getSyncProgress, beginSyncProgress } from '../services/ffaSync.js';
import {
  getOrCreateFfaSyncConfig,
  formatFfaSyncConfigResponse,
  updateFfaSyncConfig,
} from '../services/ffaSyncConfigService.js';
import { parseEmsActivitiesLimit } from '../services/emsFfaClient.js';
import { Activity } from '../models/Activity.js';
import { Farmer } from '../models/Farmer.js';
import { CallTask } from '../models/CallTask.js';
import { SamplingAudit } from '../models/SamplingAudit.js';
import { CoolingPeriod } from '../models/CoolingPeriod.js';
import { SamplingConfig } from '../models/SamplingConfig.js';
import { MasterCrop, MasterProduct, NonPurchaseReason, Sentiment, MasterLanguage } from '../models/MasterData.js';
import { StateLanguageMapping } from '../models/StateLanguageMapping.js';
import { SamplingRun } from '../models/SamplingRun.js';
import { AllocationRun } from '../models/AllocationRun.js';
import { InboundQuery } from '../models/InboundQuery.js';
import { User } from '../models/User.js';
import { getImportExcelProgress, startImportExcelJob } from '../services/excelImport.js';
import { deleteDataBatch, listDataBatches } from '../services/dataBatchService.js';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { getLanguageForState } from '../utils/stateLanguageMapper.js';
import logger from '../config/logger.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB
const TEMPLATE_FILENAME = 'ffa_ems_template.xlsx';

// ---------------------------------------------------------------------------
// GET /api/ffa/master-data – active crops & products for Mock FFA API (API-key protected, no JWT)
// Set FFA_MASTER_KEY on EMS backend; FFA (mock or real) sends X-FFA-Master-Key with same value.
// ---------------------------------------------------------------------------
router.get(
  '/master-data',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const expectedKey = process.env.FFA_MASTER_KEY;
      const providedKey = (req.headers['x-ffa-master-key'] as string)?.trim();

      if (!expectedKey || !expectedKey.trim()) {
        logger.warn('[FFA] Master-data endpoint: FFA_MASTER_KEY not set');
        return res.status(503).json({
          success: false,
          error: { message: 'Master-data for FFA is not configured (FFA_MASTER_KEY missing).' },
        });
      }
      if (providedKey !== expectedKey) {
        return res.status(401).json({
          success: false,
          error: { message: 'Invalid or missing X-FFA-Master-Key.' },
        });
      }

      const [crops, products] = await Promise.all([
        MasterCrop.find({ isActive: true }).select('name').sort({ name: 1 }).lean(),
        MasterProduct.find({ isActive: true }).select('name').sort({ name: 1 }).lean(),
      ]);

      const cropNames = crops.map((c: any) => (c.name || '').trim()).filter(Boolean);
      const productNames = products.map((p: any) => (p.name || '').trim()).filter(Boolean);

      res.json({
        success: true,
        data: {
          crops: cropNames,
          products: productNames,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// All other routes require authentication
router.use(authenticate);

type ExcelActivityRow = {
  activityId: string;
  type: string;
  date: string | number | Date;
  officerId: string;
  officerName: string;
  location: string;
  territory: string;
  state: string;
  territoryName?: string;
  zoneName?: string;
  buName?: string;
  tmEmpCode?: string;
  tmName?: string;
  crops?: string;
  products?: string;
};

type ExcelFarmerRow = {
  activityId: string;
  farmerId?: string;
  name: string;
  mobileNumber: string;
  location: string;
  photoUrl?: string;
  crops?: string;
};

const normalizeStr = (v: any) => String(v ?? '').trim();

const parseExcelDate = (value: any): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date');
    return value;
  }

  // Excel serial number
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) throw new Error('Invalid excel date');
    return new Date(d.y, d.m - 1, d.d);
  }

  const raw = normalizeStr(value);
  if (!raw) throw new Error('Invalid date (missing)');

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [ddStr, mmStr, yyyyStr] = raw.split('/');
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    const yyyy = Number(yyyyStr);
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
      throw new Error(`Invalid date (DD/MM/YYYY): ${raw}`);
    }
    return d;
  }

  // YYYY-MM-DD or ISO
  const d = new Date(raw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${raw}`);
  return d;
};

const splitCSVCell = (value: any): string[] => {
  const raw = normalizeStr(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const formatDDMMYYYY = (d: Date): string => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
};

// @route   GET /api/ffa/sync-progress
// @desc    Get current FFA sync progress (for progress bar / polling)
// @access  Private (MIS Admin)
router.get(
  '/sync-progress',
  requirePermission('config.ffa'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const progress = getSyncProgress();
      res.json({
        success: true,
        data: progress,
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/ffa/sync
// @desc    Manually trigger FFA sync (MIS Admin only). Runs in background; client should poll GET /sync-progress.
// @access  Private (MIS Admin)
router.post(
  '/sync',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ffaApiUrl = process.env.FFA_API_URL || 'http://localhost:4000/api';
      const fullSync = req.query.fullSync === 'true' || req.body?.fullSync === true;
      const limitRaw = req.query.limit ?? req.body?.limit ?? req.body?.activitiesLimit;
      const activitiesLimit =
        limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== ''
          ? parseEmsActivitiesLimit(String(limitRaw))
          : undefined;

      logger.info(`[FFA SYNC] Manual FFA sync triggered (${fullSync ? 'full' : 'incremental'})`, {
        userId: (req as any).user?.id,
        userEmail: (req as any).user?.email,
        ffaApiUrl: ffaApiUrl,
        hasEnvVar: !!process.env.FFA_API_URL,
        fullSync,
        activitiesLimit: activitiesLimit ?? 'server-default',
      });

      beginSyncProgress(fullSync ? 'full' : 'incremental');
      syncFFAData(fullSync, { activitiesLimit }).catch((err) => {
        logger.error('[FFA SYNC] Background sync error:', err);
      });

      res.json({
        success: true,
        started: true,
        message: 'FFA sync started. Poll /api/ffa/sync-progress for progress.',
        data: { fullSync, activitiesLimit: activitiesLimit ?? null },
      });
    } catch (error) {
      const ffaApiUrl = process.env.FFA_API_URL || 'http://localhost:4000/api';
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('FFA sync endpoint error:', {
        error: errorMessage,
        ffaApiUrl: ffaApiUrl,
        hasEnvVar: !!process.env.FFA_API_URL,
      });

      const statusCode = errorMessage.includes('Cannot connect') || errorMessage.includes('timeout') ? 503 : 500;
      res.status(statusCode).json({
        success: false,
        message: `FFA sync failed to start: ${errorMessage}`,
        error: errorMessage,
        details: { ffaApiUrl: ffaApiUrl, hasEnvVar: !!process.env.FFA_API_URL },
      });
    }
  }
);

// @route   GET /api/ffa/excel-template
// @desc    Download Excel template (2 sheets: Activities + Farmers) with sample rows
// @access  Private (MIS Admin)
router.get(
  '/excel-template',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Instructions – column meanings and date format (matches import program)
      const instructionRows = [
        ['ACTIVITIES + FARMERS UPLOAD – INSTRUCTIONS'],
        [''],
        ['This workbook must have 2 data sheets named exactly: Activities, Farmers'],
        [''],
        ['ACTIVITIES SHEET – use these column headers (order can vary):'],
        ['• activityId     = Unique activity ID (required)'],
        ['• type          = Field Day | Group Meeting | Demo Visit | OFM | Other (required)'],
        ['• date          = Activity date – use DD/MM/YYYY or YYYY-MM-DD (required)'],
        ['• officerId     = FDA / Officer code (required)'],
        ['• officerName   = FDA / Officer name (required)'],
        ['• location      = Village / location name (required)'],
        ['• territory     = Territory name (required)'],
        ['• state         = State name – used for language (required)'],
        ['• territoryName = Territory display name (optional; defaults to territory)'],
        ['• zoneName      = Zone name (optional)'],
        ['• buName        = Business unit (optional)'],
        ['• tmEmpCode     = TM employee code (optional)'],
        ['• tmName        = TM name (optional)'],
        ['• crops         = Comma-separated crops e.g. Rice,Wheat (optional)'],
        ['• products      = Comma-separated products e.g. NACL Pro,NACL Gold (optional)'],
        [''],
        ['FARMERS SHEET – use these column headers:'],
        ['• activityId    = Must match an activityId from Activities sheet (required)'],
        ['• name          = Farmer name (required)'],
        ['• mobileNumber  = 10-digit mobile number (required, unique per farmer)'],
        ['• location      = Village, District, State (required)'],
        ['• photoUrl      = URL to photo (optional)'],
        ['• farmerId      = Optional reference ID'],
        ['• crops         = Optional; not stored on farmer record'],
        [''],
        ['Then upload this file in Activity Monitoring → Upload Excel.'],
      ];
      const wsInstructions = XLSX.utils.aoa_to_sheet(instructionRows);
      wsInstructions['!cols'] = [{ wch: 75 }];
      XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

      const activitiesSample = [
        {
          activityId: 'FFA-ACT-EX-0001',
          type: 'Field Day',
          date: formatDDMMYYYY(new Date()),
          officerId: 'FDA-0001',
          officerName: 'Officer Name',
          tmEmpCode: 'TM-0001',
          tmName: 'TM Name',
          location: 'Village Name',
          territory: 'Karnataka Zone',
          state: 'Karnataka',
          territoryName: 'Karnataka Zone',
          zoneName: 'South Zone',
          buName: 'BU - Seeds',
          crops: 'Rice,Wheat',
          products: 'NACL Pro,NACL Gold',
        },
      ];

      const farmersSample = [
        {
          activityId: 'FFA-ACT-EX-0001',
          farmerId: 'FFA-FARM-EX-1',
          name: 'Farmer Name',
          mobileNumber: '9000000000',
          location: 'Village, District, State',
          photoUrl: '',
          crops: 'Rice',
        },
        {
          activityId: 'FFA-ACT-EX-0001',
          farmerId: 'FFA-FARM-EX-2',
          name: 'Farmer Name 2',
          mobileNumber: '9000000001',
          location: 'Village, District, State',
          photoUrl: '',
          crops: 'Wheat',
        },
      ];

      const wsActivities = XLSX.utils.json_to_sheet(activitiesSample, { skipHeader: false });
      const wsFarmers = XLSX.utils.json_to_sheet(farmersSample, { skipHeader: false });
      XLSX.utils.book_append_sheet(wb, wsActivities, 'Activities');
      XLSX.utils.book_append_sheet(wb, wsFarmers, 'Farmers');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${TEMPLATE_FILENAME}"`);
      res.status(200).send(buf);
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/ffa/hierarchy-template
// @desc    Download Sales Hierarchy Excel template (Territory Code, Territory Name, Region Code, Region, Zone Code, Zone Name, BU)
// @access  Private (MIS Admin)
router.get(
  '/hierarchy-template',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Instructions – easy to identify what each column means
      const instructionRows = [
        ['SALES HIERARCHY UPLOAD – INSTRUCTIONS'],
        [''],
        ['Fill the "Sales Hierarchy" sheet (next tab) with one row per territory.'],
        ['Use exactly these column headers in row 1: Territory Code, Territory Name, Region Code, Region, Zone Code, Zone Name, BU'],
        [''],
        ['COLUMN MEANINGS:'],
        ['• Territory Code  = Optional code (e.g. 714, 715)'],
        ['• Territory Name  = Territory / location name (e.g. Palakolu, Eluru)'],
        ['• Region Code     = Optional region code (e.g. 2204)'],
        ['• Region          = Region name (e.g. Vijayawada, Guntur)'],
        ['• Zone Code       = Optional zone code (e.g. 2200)'],
        ['• Zone Name       = Zone name (e.g. AP & South KA)'],
        ['• BU              = Business Unit – use acronym (e.g. SBU, EBU, CBU)'],
        [''],
        ['Then upload this file in Data Management → Generate data via Mock FFA API.'],
      ];
      const wsInstructions = XLSX.utils.aoa_to_sheet(instructionRows);
      wsInstructions['!cols'] = [{ wch: 70 }];
      XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

      // Sheet 2: Sales Hierarchy – exact format: Territory Code, Territory Name, Region Code, Region, Zone Code, Zone Name, BU
      const sample = [
        { 'Territory Code': '714', 'Territory Name': 'Palakolu', 'Region Code': '2204', 'Region': 'Vijayawada', 'Zone Code': '2200', 'Zone Name': 'AP & South KA', 'BU': 'SBU' },
        { 'Territory Code': '715', 'Territory Name': 'Eluru', 'Region Code': '2204', 'Region': 'Vijayawada', 'Zone Code': '2200', 'Zone Name': 'AP & South KA', 'BU': 'SBU' },
        { 'Territory Code': '720', 'Territory Name': 'Vijayawada', 'Region Code': '2204', 'Region': 'Vijayawada', 'Zone Code': '2200', 'Zone Name': 'AP & South KA', 'BU': 'SBU' },
      ];
      const ws = XLSX.utils.json_to_sheet(sample);
      ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Sales Hierarchy');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="sales_hierarchy_template.xlsx"');
      res.status(200).send(buf);
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/ffa/import-excel
// @desc    Import Activities + Farmers via Excel (2 sheets) as fallback when FFA API is unavailable
// @access  Private (MIS Admin)
router.post(
  '/import-excel',
  requirePermission('config.ffa'),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ success: false, error: { message: 'Missing file. Use multipart/form-data with field name "file".' } });
      }
      const started = await startImportExcelJob(file.buffer);
      if (!started.started) {
        return res.status(409).json({
          success: false,
          error: { message: started.message },
          data: { jobId: started.jobId, running: true },
        });
      }

      return res.status(202).json({
        success: true,
        message: started.message,
        data: { jobId: started.jobId },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/ffa/import-excel-progress
// @desc    Get current Excel import progress (for progress bar / polling)
// @access  Private (MIS Admin)
router.get('/import-excel-progress', requirePermission('config.ffa'), (req: Request, res: Response) => {
  res.json({ success: true, data: getImportExcelProgress() });
});

// @route   GET /api/ffa/data-batches
// @desc    List ingest batches (Excel / FFA sync) for selective delete before sampling
// @access  Private (MIS Admin)
router.get('/data-batches', requirePermission('config.ffa'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batches = await listDataBatches(3);
    res.json({ success: true, data: { batches } });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/ffa/delete-data-batch
// @desc    Delete all activities (and orphan farmers) for a batch; blocked if sampling audit or tasks exist
// @access  Private (MIS Admin)
router.post('/delete-data-batch', requirePermission('config.ffa'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batchId = (req.body as { batchId?: string })?.batchId;
    if (!batchId || typeof batchId !== 'string' || !batchId.trim()) {
      return res.status(400).json({
        success: false,
        error: { message: 'batchId is required' },
      });
    }
    const result = await deleteDataBatch(batchId.trim());
    res.json({
      success: true,
      message: 'Batch deleted.',
      data: result,
    });
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('No activities found')) {
      return res.status(404).json({ success: false, error: { message: msg } });
    }
    if (
      msg.includes('not allowed') ||
      msg.includes('Sampling has run') ||
      msg.includes('Call tasks exist') ||
      msg.includes('No activities in this batch')
    ) {
      return res.status(409).json({ success: false, error: { message: msg } });
    }
    next(error);
  }
});

// @route   GET /api/ffa/admin-config
// @desc    FFA data source, pull limit, and scheduled sync settings (Admin → Data Management)
// @access  Private (MIS Admin)
router.get(
  '/admin-config',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getOrCreateFfaSyncConfig();
      res.json({
        success: true,
        data: { config: formatFfaSyncConfigResponse(config) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/ffa/admin-config
// @desc    Update FFA admin settings
// @access  Private (MIS Admin)
router.put(
  '/admin-config',
  requirePermission('config.ffa'),
  [
    body('dataSource').optional().isIn(['api', 'excel']),
    body('scheduleEnabled').optional().isBoolean(),
    body('scheduleMode').optional().isIn(['off', 'hourly', 'daily', 'interval']),
    body('scheduleIntervalMinutes').optional().isInt({ min: 10, max: 10080 }),
    body('scheduleDailyHour').optional().isInt({ min: 0, max: 23 }),
    body('scheduleDailyMinute').optional().isInt({ min: 0, max: 59 }),
    body('scheduleTimezone').optional().isString().isLength({ min: 1, max: 64 }),
    body('emsActivitiesDateFrom').optional({ nullable: true }).isString(),
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

      const authUserId = (req as any).user?._id?.toString?.() ?? (req as any).user?.id;
      const bodyPayload = req.body as Record<string, unknown>;

      if ('activitiesPullLimit' in bodyPayload) {
        const raw = bodyPayload.activitiesPullLimit;
        if (raw === '' || raw === null || raw === undefined) {
          bodyPayload.activitiesPullLimit = null;
        } else {
          const n = Number.parseInt(String(raw), 10);
          if (!Number.isFinite(n) || n < 0) {
            return res.status(400).json({
              success: false,
              error: { message: 'activitiesPullLimit must be a non-negative integer or empty for server default' },
            });
          }
          bodyPayload.activitiesPullLimit = n;
        }
      }

      if (bodyPayload.scheduleEnabled === true && !bodyPayload.scheduleMode) {
        const existing = await getOrCreateFfaSyncConfig();
        if (existing.scheduleMode === 'off') {
          bodyPayload.scheduleMode = 'daily';
        }
      }

      const config = await updateFfaSyncConfig(bodyPayload as any, authUserId);

      res.json({
        success: true,
        message: 'FFA settings updated',
        data: { config: formatFfaSyncConfigResponse(config) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/ffa/status
// @desc    Get FFA sync status
// @access  Private (MIS Admin)
router.get(
  '/status',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await getSyncStatus();
      const adminConfig = formatFfaSyncConfigResponse(await getOrCreateFfaSyncConfig());

      res.json({
        success: true,
        data: { ...status, adminConfig },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/ffa/activities
// @desc    List synced activities
// @access  Private (MIS Admin)
router.get(
  '/activities',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const activities = await Activity.find()
        .populate('farmerIds', 'name mobileNumber location')
        .sort({ syncedAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await Activity.countDocuments();

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

// @route   GET /api/ffa/farmers
// @desc    List synced farmers
// @access  Private (MIS Admin)
router.get(
  '/farmers',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const farmers = await Farmer.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await Farmer.countDocuments();

      res.json({
        success: true,
        data: {
          farmers,
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

// @route   POST /api/ffa/clear-data
// @desc    Clear transaction and/or master data (Admin). Use for dev/test DB reset.
// @access  Private (MIS Admin)
router.post(
  '/clear-data',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      type ClearEntity =
        | 'tasks'
        | 'samplingAudits'
        | 'coolingPeriods'
        | 'samplingConfigs'
        | 'samplingRuns'
        | 'allocationRuns'
        | 'inboundQueries'
        | 'activities'
        | 'farmers'
        | 'users'
        | 'crops'
        | 'products'
        | 'nonPurchaseReasons'
        | 'sentiments'
        | 'languages'
        | 'stateLanguageMappings';

      const body = (req.body || {}) as {
        clearTransactions?: boolean;
        clearMasters?: boolean;
        transactionEntities?: ClearEntity[];
        masterEntities?: ClearEntity[];
      };

      const clearTransactions = Boolean(body.clearTransactions);
      const clearMasters = Boolean(body.clearMasters);

      const txAll: ClearEntity[] = [
        'tasks',
        'samplingAudits',
        'coolingPeriods',
        'samplingConfigs',
        'samplingRuns',
        'allocationRuns',
        'inboundQueries',
        'activities',
        'farmers',
      ];
      const masterAll: ClearEntity[] = [
        'crops',
        'products',
        'nonPurchaseReasons',
        'sentiments',
        'languages',
        'stateLanguageMappings',
        'users',
      ];

      const requestedTx = Array.isArray(body.transactionEntities) ? body.transactionEntities : [];
      const requestedMaster = Array.isArray(body.masterEntities) ? body.masterEntities : [];

      // Backward compat: if no explicit entity arrays, fall back to legacy booleans.
      let txEntities: ClearEntity[] = requestedTx.length > 0 ? requestedTx : clearTransactions ? txAll : [];
      let masterEntities: ClearEntity[] = requestedMaster.length > 0 ? requestedMaster : clearMasters ? masterAll : [];

      if (txEntities.length === 0 && masterEntities.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Select at least one entity (or set clearTransactions/clearMasters).' },
        });
      }

      const data: Record<string, number> = {};
      const autoSelected: { addedTransactionEntities: ClearEntity[]; addedMasterEntities: ClearEntity[] } = {
        addedTransactionEntities: [],
        addedMasterEntities: [],
      };

      // Auto-selection (dependency safety):
      // - Clearing activities requires clearing farmers too (activities store farmerIds and farmers are only meaningful with activities).
      if (txEntities.includes('activities') && !txEntities.includes('farmers')) {
        txEntities = [...txEntities, 'farmers'];
        autoSelected.addedTransactionEntities.push('farmers');
      }

      const txSet = new Set<ClearEntity>(txEntities);
      if (txSet.size > 0) {
        // Delete in dependency-friendly order.
        if (txSet.has('tasks')) data.tasksDeleted = (await CallTask.deleteMany({})).deletedCount;
        if (txSet.has('samplingAudits')) data.samplingAuditsDeleted = (await SamplingAudit.deleteMany({})).deletedCount;
        if (txSet.has('coolingPeriods')) data.coolingPeriodsDeleted = (await CoolingPeriod.deleteMany({})).deletedCount;
        if (txSet.has('samplingConfigs')) data.samplingConfigsDeleted = (await SamplingConfig.deleteMany({})).deletedCount;
        if (txSet.has('samplingRuns')) data.samplingRunsDeleted = (await SamplingRun.deleteMany({})).deletedCount;
        if (txSet.has('allocationRuns')) data.allocationRunsDeleted = (await AllocationRun.deleteMany({})).deletedCount;
        if (txSet.has('inboundQueries')) data.inboundQueriesDeleted = (await InboundQuery.deleteMany({})).deletedCount;
        if (txSet.has('activities')) data.activitiesDeleted = (await Activity.deleteMany({})).deletedCount;
        if (txSet.has('farmers')) data.farmersDeleted = (await Farmer.deleteMany({})).deletedCount;
        logger.info('[FFA] Cleared selected transaction entities', { entities: Array.from(txSet), data, autoSelected });
      }

      const masterSet = new Set<ClearEntity>(masterEntities);
      if (masterSet.size > 0) {
        if (masterSet.has('crops')) data.cropsDeleted = (await MasterCrop.deleteMany({})).deletedCount;
        if (masterSet.has('products')) data.productsDeleted = (await MasterProduct.deleteMany({})).deletedCount;
        if (masterSet.has('nonPurchaseReasons')) data.nonPurchaseReasonsDeleted = (await NonPurchaseReason.deleteMany({})).deletedCount;
        if (masterSet.has('sentiments')) data.sentimentsDeleted = (await Sentiment.deleteMany({})).deletedCount;
        if (masterSet.has('languages')) data.languagesDeleted = (await MasterLanguage.deleteMany({})).deletedCount;
        if (masterSet.has('stateLanguageMappings')) data.stateLanguageMappingsDeleted = (await StateLanguageMapping.deleteMany({})).deletedCount;
        if (masterSet.has('users')) {
          // Hard delete all users except System Administrator and the currently logged-in user.
          const keepEmails = ['shubhashish@kweka.ai'];
          const keepEmployeeIds = ['ADMIN001'];
          const currentUserId = req.user?._id?.toString();

          const resUsers = await User.deleteMany({
            $and: [
              currentUserId ? { _id: { $ne: currentUserId } } : {},
              { email: { $nin: keepEmails } },
              { employeeId: { $nin: keepEmployeeIds } },
            ],
          });
          data.usersDeleted = resUsers.deletedCount;
        }
        logger.info('[FFA] Cleared selected master entities', { entities: Array.from(masterSet), data, autoSelected });
      }

      res.json({
        success: true,
        message: 'Database clear completed.',
        data,
        meta: autoSelected.addedTransactionEntities.length || autoSelected.addedMasterEntities.length ? { autoSelected } : undefined,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Expected Excel columns for Sales Hierarchy: Territory Code, Territory Name, Region Code, Region, Zone Code, Zone Name, BU
function normalizeHeader(str: unknown): string {
  if (str == null || typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
}
function getRowValue(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
/** Find first column key that matches any of the regex patterns (case-insensitive) */
function findColumnKey(row: Record<string, unknown> | undefined, patterns: RegExp[]): string | null {
  if (!row || typeof row !== 'object') return null;
  for (const key of Object.keys(row)) {
    const n = normalizeHeader(key).toLowerCase().replace(/\s/g, '');
    if (patterns.some((p) => p.test(n))) return key;
  }
  return null;
}
/** Capitalize first letter of each word, rest lowercase (proper case) */
function toProperCase(s: string): string {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s|[-+])\S/g, (c) => c.toUpperCase());
}

// @route   POST /api/ffa/seed-from-hierarchy
// @desc    Upload Sales Hierarchy Excel + activity/farmer counts; Mock FFA regenerates data, then full sync into EMS.
// @access  Private (MIS Admin)
router.post(
  '/seed-from-hierarchy',
  requirePermission('config.ffa'),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activityCount = Math.max(1, Math.min(500, Number((req.body as any).activityCount) || 50));
      const farmersPerActivity = Math.max(1, Math.min(50, Number((req.body as any).farmersPerActivity) || 12));

      let hierarchy: Array<{ territoryCode?: string; territoryName: string; regionCode?: string; region: string; zoneCode?: string; zoneName: string; bu: string }> = [];

      const file = (req as any).file as Express.Multer.File | undefined;
      if (file?.buffer) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const allNames = workbook.SheetNames;
        const hierarchySheetName = allNames.find((n) => /sales\s*hierarchy|hierarchy/i.test(n.trim()));
        const sheetName = hierarchySheetName ?? allNames[0];
        if (!sheetName) {
          return res.status(400).json({ success: false, error: { message: 'Excel file has no sheets.' } });
        }
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
        const first = rows[0] as Record<string, unknown> | undefined;
        // Standard format: Territory Code, Territory Name, Region Code, Region, Zone Code, Zone Name, BU – prefer exact names when present
        const exact = (key: string) => (first && Object.prototype.hasOwnProperty.call(first, key) ? key : null);
        const territoryCode = exact('Territory Code') ?? findColumnKey(first, [/territorycode/, /territory_code/]);
        const territoryName = exact('Territory Name') ?? findColumnKey(first, [/territoryname/, /territory_name/, /territory\s*name/, /^territory$/]);
        const regionCode = exact('Region Code') ?? findColumnKey(first, [/regioncode/, /region_code/]);
        const region = exact('Region') ?? findColumnKey(first, [/^region$/]);
        const zoneCode = exact('Zone Code') ?? findColumnKey(first, [/zonecode/, /zone_code/]);
        const zoneName = exact('Zone Name') ?? findColumnKey(first, [/zonename/, /zone_name/, /zone\s*name/, /^zone$/]);
        const bu = exact('BU') ?? findColumnKey(first, [/^bu$/, /^bu\(/, /buname/, /businessunit/, /business\s*unit/]);

        const territoryNameKey = territoryName || 'Territory Name';
        const regionKey = region || 'Region';
        const zoneNameKey = zoneName || 'Zone Name';
        const buKey = bu || 'BU';
        const territoryCodeKey = territoryCode || 'Territory Code';
        const regionCodeKey = regionCode || 'Region Code';
        const zoneCodeKey = zoneCode || 'Zone Code';

        for (const row of rows) {
          const r = row as Record<string, unknown>;
          const tCode = getRowValue(r, territoryCodeKey, 'Territory Code');
          const tName = toProperCase(getRowValue(r, territoryNameKey, 'Territory Name'));
          const rCode = getRowValue(r, regionCodeKey, 'Region Code');
          const rName = toProperCase(getRowValue(r, regionKey, 'Region'));
          const zCode = getRowValue(r, zoneCodeKey, 'Zone Code');
          const zName = toProperCase(getRowValue(r, zoneNameKey, 'Zone Name'));
          const bRaw = getRowValue(r, buKey, 'BU');
          const b = bRaw ? bRaw.trim().toUpperCase() : 'SBU';
          if (!tName && !rName && !zName && !bRaw) continue;
          hierarchy.push({
            territoryCode: tCode || undefined,
            territoryName: tName || 'Territory',
            regionCode: rCode || undefined,
            region: rName || 'Region',
            zoneCode: zCode || undefined,
            zoneName: zName || 'Zone',
            bu: b,
          });
        }
        if (hierarchy.length === 0 && rows.length > 0) {
          const headersSeen = first ? Object.keys(first).join(', ') : 'none';
          logger.warn('[FFA] Seed-from-hierarchy: Excel had %d rows but no hierarchy parsed. Headers seen: %s', rows.length, headersSeen);
          return res.status(400).json({
            success: false,
            error: {
              message: 'Could not parse hierarchy from Excel. Ensure the first sheet has columns: Territory Name (or Territory), Region, Zone Name (or Zone), BU. Headers seen: ' + headersSeen,
            },
          });
        }
        if (hierarchy.length > 0) {
          logger.info('[FFA] Seed-from-hierarchy: parsed %d hierarchy rows from Excel. First territory: %s', hierarchy.length, hierarchy[0]?.territoryName);
        }
      }

      // Do not clear existing data: generate more data in same territories with same TM & FDA names when possible
      const existingRows = await Activity.aggregate<{ _id: { territoryName: string; tmName: string; officerName: string }; territory: string; zoneName: string; buName: string }>([
        { $match: { $or: [{ territoryName: { $exists: true, $ne: '' } }, { territory: { $exists: true, $ne: '' } }] } },
        { $project: { territoryName: { $ifNull: ['$territoryName', '$territory'] }, territory: 1, tmName: { $ifNull: ['$tmName', ''] }, officerName: 1, zoneName: { $ifNull: ['$zoneName', ''] }, buName: { $ifNull: ['$buName', ''] } } },
        { $group: { _id: { territoryName: '$territoryName', tmName: '$tmName', officerName: '$officerName' }, territory: { $first: '$territory' }, zoneName: { $first: '$zoneName' }, buName: { $first: '$buName' } } },
      ]).exec();
      const existingTerritoryTmFda = existingRows.length > 0
        ? existingRows.map((r) => {
            const tName = (r._id?.territoryName || r.territory || '').trim();
            const t = (r.territory || r._id?.territoryName || '').trim();
            return {
              territoryName: tName || t,
              territory: t || tName,
              tmName: (r._id?.tmName || '').trim(),
              officerName: (r._id?.officerName || '').trim(),
              zoneName: (r.zoneName || '').trim(),
              buName: (r.buName || '').trim(),
            };
          })
        : undefined;
      if (existingTerritoryTmFda?.length) {
        logger.info('[FFA] Using %d existing territory/TM/FDA combinations for new data (no data cleared)', existingTerritoryTmFda.length);
      }

      const baseUrl = (process.env.FFA_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
      const seedUrl = `${baseUrl}/seed`;
      const body = {
        activityCount,
        farmersPerActivity,
        hierarchy: hierarchy.length > 0 ? hierarchy : undefined,
        existingTerritoryTmFda,
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const ffaToken = process.env.FFA_API_TOKEN;
      const ffaKey = process.env.FFA_API_KEY;
      if (ffaToken?.trim()) headers['Authorization'] = `Bearer ${ffaToken.trim()}`;
      else if (ffaKey?.trim()) headers['X-API-Key'] = ffaKey.trim();

      const seedRes = await fetch(seedUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!seedRes.ok) {
        const errText = await seedRes.text();
        logger.error('[FFA] Mock seed failed', { status: seedRes.status, body: errText });
        return res.status(502).json({
          success: false,
          error: { message: `Mock FFA seed failed: ${seedRes.status} ${errText.slice(0, 200)}` },
        });
      }

      const seedData = await seedRes.json() as { success?: boolean; data?: { activitiesGenerated?: number; farmersGenerated?: number } };
      logger.info('[FFA] Mock FFA seed completed', seedData);

      // When hierarchy was used: run sync in same request so the same Mock instance is likely to serve both seed and activities
      if (hierarchy.length > 0) {
        try {
          const syncResult = await syncFFAData(true);
          logger.info('[FFA] Sync after seed completed', syncResult);
          return res.json({
            success: true,
            message: existingTerritoryTmFda?.length
              ? 'More data generated using existing territory/TM/FDA names and synced. No existing data was cleared.'
              : 'Data generated from your hierarchy file and synced to EMS. No existing data was cleared.',
            data: {
              seed: seedData?.data ?? {},
              sync: syncResult ? { activitiesSynced: syncResult.activitiesSynced, farmersSynced: syncResult.farmersSynced } : undefined,
              activityCount,
              farmersPerActivity,
              hierarchyRowsUsed: hierarchy.length,
            },
          });
        } catch (syncErr) {
          logger.error('[FFA] Sync after seed failed', syncErr);
          return res.status(500).json({
            success: false,
            error: { message: 'Seed succeeded but sync failed: ' + (syncErr instanceof Error ? syncErr.message : String(syncErr)) },
          });
        }
      }

      syncFFAData(true).catch((err) => logger.error('[FFA] Background sync after seed failed', err));
      res.json({
        success: true,
        message: existingTerritoryTmFda?.length
          ? 'More data generated using existing territory/TM/FDA. Full sync started. No existing data was cleared.'
          : 'Data generated via Mock FFA and full sync started. No existing data was cleared. Poll /api/ffa/sync-progress for progress.',
        data: {
          seed: seedData?.data ?? {},
          activityCount,
          farmersPerActivity,
          hierarchyRowsUsed: hierarchy.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/ffa/reset
// @desc    Clear all synced FFA data (for development/testing)
// @access  Private (MIS Admin)
router.post(
  '/reset',
  requirePermission('config.ffa'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Clearing all FFA data...');
      
      // DEV SAFE RESET (Option A):
      // Delete operational/synced data, preserve users/master data.
      const taskResult = await CallTask.deleteMany({});
      const auditResult = await SamplingAudit.deleteMany({});
      const coolingResult = await CoolingPeriod.deleteMany({});
      const samplingConfigResult = await SamplingConfig.deleteMany({});
      const activityResult = await Activity.deleteMany({});
      const farmerResult = await Farmer.deleteMany({});
      
      logger.info(
        `Cleared ${farmerResult.deletedCount} farmers, ${activityResult.deletedCount} activities, ${taskResult.deletedCount} tasks`
      );

      res.json({
        success: true,
        message: 'Dev operational data cleared successfully',
        data: {
          tasksDeleted: taskResult.deletedCount,
          samplingAuditsDeleted: auditResult.deletedCount,
          coolingPeriodsDeleted: coolingResult.deletedCount,
          samplingConfigsDeleted: samplingConfigResult.deletedCount,
          farmersDeleted: farmerResult.deletedCount,
          activitiesDeleted: activityResult.deletedCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

