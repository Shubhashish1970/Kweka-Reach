import express, { Request, Response, NextFunction } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getDailyReport, getPeriodReport, getTaskDetailExportRows } from '../services/reportService.js';
import { getEmsProgress, getEmsDrilldown, type EmsDrilldownGroupBy } from '../services/kpiService.js';
import {
  getEmsReportSummary,
  getEmsReportLineLevel,
  getEmsReportTrends,
  type EmsReportGroupBy,
  type EmsReportSummaryRow,
  type EmsReportLineRow,
  type EmsTrendBucket,
} from '../services/emsReportService.js';
import * as XLSX from 'xlsx';

const router = express.Router();

router.use(authenticate);
// Permission-based: mis_admin has reports.weekly; normalizes "admin" -> mis_admin so Admin always has access
router.use(requirePermission('reports.weekly'));

function parseFilters(req: Request): {
  dateFrom?: Date;
  dateTo?: Date;
  state?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  activityType?: string;
} {
  return {
    dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
    dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
    state: (req.query.state as string) || undefined,
    territory: (req.query.territory as string) || undefined,
    zone: (req.query.zone as string) || undefined,
    bu: (req.query.bu as string) || undefined,
    activityType: (req.query.activityType as string) || undefined,
  };
}

const filterValidators = [
  query('dateFrom').optional().isISO8601().toDate(),
  query('dateTo').optional().isISO8601().toDate(),
  query('state').optional().isString().trim(),
  query('territory').optional().isString().trim(),
  query('zone').optional().isString().trim(),
  query('bu').optional().isString().trim(),
  query('activityType').optional().isString().trim(),
];

/**
 * GET /api/reports/daily
 * Daily report rows (date, activities, tasks, farmers, completion %).
 */
router.get('/daily', filterValidators, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
    }
    const filters = parseFilters(req);
    const rows = await getDailyReport(filters);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/weekly
 * Weekly aggregated report.
 */
router.get('/weekly', filterValidators, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
    }
    const filters = parseFilters(req);
    const rows = await getPeriodReport(filters, 'weekly');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/monthly
 * Monthly aggregated report.
 */
router.get('/monthly', filterValidators, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
    }
    const filters = parseFilters(req);
    const rows = await getPeriodReport(filters, 'monthly');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/drilldown
 * Drilldown data (same as KPI drilldown). groupBy: state | territory | zone | bu | activityType.
 */
router.get(
  '/drilldown',
  [
    ...filterValidators,
    query('groupBy').isIn(['state', 'territory', 'zone', 'bu', 'activityType']).withMessage('Invalid groupBy'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
      }
      const filters = parseFilters(req);
      const groupBy = req.query.groupBy as EmsDrilldownGroupBy;
      const rows = await getEmsDrilldown(filters, groupBy);
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

const emsReportGroupByValues: EmsReportGroupBy[] = ['tm', 'fda', 'bu', 'zone', 'region', 'territory'];

/**
 * GET /api/reports/ems
 * EMS report: summary or line-level rows grouped by TM, FDA, BU, Zone, Region, Territory.
 * Query: groupBy (required), level=summary|line (default summary), + filters.
 */
router.get(
  '/ems',
  [
    ...filterValidators,
    query('groupBy').isIn(emsReportGroupByValues).withMessage('Invalid groupBy'),
    query('level').optional().isIn(['summary', 'line']).withMessage('Invalid level'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
      }
      const filters = parseFilters(req);
      const groupBy = req.query.groupBy as EmsReportGroupBy;
      const level = (req.query.level as string) || 'summary';
      const rows =
        level === 'line'
          ? await getEmsReportLineLevel(filters, groupBy)
          : await getEmsReportSummary(filters, groupBy);
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/reports/ems/trends
 * EMS trends: time-series by period. Query: bucket=daily|weekly|monthly (required), + filters.
 */
router.get(
  '/ems/trends',
  [
    ...filterValidators,
    query('bucket').isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid bucket'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
      }
      const filters = parseFilters(req);
      const bucket = req.query.bucket as EmsTrendBucket;
      const rows = await getEmsReportTrends(filters, bucket);
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/reports/ems/export
 * EMS report Excel export. Query: groupBy (required), level=summary|line (default summary), + filters.
 */
router.get(
  '/ems/export',
  [
    ...filterValidators,
    query('groupBy').isIn(emsReportGroupByValues).withMessage('Invalid groupBy'),
    query('level').optional().isIn(['summary', 'line']).withMessage('Invalid level'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
      }
      const filters = parseFilters(req);
      const groupBy = req.query.groupBy as EmsReportGroupBy;
      const level = (req.query.level as string) || 'summary';
      const rows =
        level === 'line'
          ? await getEmsReportLineLevel(filters, groupBy)
          : await getEmsReportSummary(filters, groupBy);

      const wb = XLSX.utils.book_new();
      if (level === 'summary') {
        const summaryRows = rows as EmsReportSummaryRow[];
        const groupLabels = summaryRows.map((r) => r.groupLabel);
        const totals = summaryRows.reduce(
          (acc, r) => ({
            totalAttempted: acc.totalAttempted + r.totalAttempted,
            totalConnected: acc.totalConnected + r.totalConnected,
            disconnectedCount: acc.disconnectedCount + r.disconnectedCount,
            incomingNACount: acc.incomingNACount + r.incomingNACount,
            invalidCount: acc.invalidCount + r.invalidCount,
            noAnswerCount: acc.noAnswerCount + r.noAnswerCount,
            identityWrongCount: acc.identityWrongCount + r.identityWrongCount,
            dontRecallCount: acc.dontRecallCount + r.dontRecallCount,
            noMissedCount: acc.noMissedCount + r.noMissedCount,
            notAFarmerCount: acc.notAFarmerCount + r.notAFarmerCount,
            yesAttendedCount: acc.yesAttendedCount + r.yesAttendedCount,
            notPurchasedCount: acc.notPurchasedCount + r.notPurchasedCount,
            purchasedCount: acc.purchasedCount + r.purchasedCount,
            willingMaybeCount: acc.willingMaybeCount + r.willingMaybeCount,
            willingNoCount: acc.willingNoCount + r.willingNoCount,
            willingYesCount: acc.willingYesCount + r.willingYesCount,
            yesPlusPurchasedCount: acc.yesPlusPurchasedCount + r.yesPlusPurchasedCount,
            activityQualitySum: acc.activityQualitySum + (r.activityQualitySum ?? 0),
            activityQualityCount: acc.activityQualityCount + (r.activityQualityCount ?? 0),
            qualityCount1: acc.qualityCount1 + (r.qualityCount1 ?? 0),
            qualityCount2: acc.qualityCount2 + (r.qualityCount2 ?? 0),
            qualityCount3: acc.qualityCount3 + (r.qualityCount3 ?? 0),
            qualityCount4: acc.qualityCount4 + (r.qualityCount4 ?? 0),
            qualityCount5: acc.qualityCount5 + (r.qualityCount5 ?? 0),
          }),
          {
            totalAttempted: 0,
            totalConnected: 0,
            disconnectedCount: 0,
            incomingNACount: 0,
            invalidCount: 0,
            noAnswerCount: 0,
            identityWrongCount: 0,
            dontRecallCount: 0,
            noMissedCount: 0,
            notAFarmerCount: 0,
            yesAttendedCount: 0,
            notPurchasedCount: 0,
            purchasedCount: 0,
            willingMaybeCount: 0,
            willingNoCount: 0,
            willingYesCount: 0,
            yesPlusPurchasedCount: 0,
            activityQualitySum: 0,
            activityQualityCount: 0,
            qualityCount1: 0,
            qualityCount2: 0,
            qualityCount3: 0,
            qualityCount4: 0,
            qualityCount5: 0,
          }
        );
        const totalsTotalCsScore = totals.activityQualitySum || 0;
        const totalsMaxCsScore = totals.totalAttempted * 5;
        const totalsHygienePct = totals.totalConnected > 0 ? Math.round(((totals.totalConnected - totals.identityWrongCount - totals.notAFarmerCount) / totals.totalConnected) * 100) : 0;
        const totalsMeetingConversionPct = totals.totalConnected > 0 ? Math.round((totals.purchasedCount / totals.totalConnected) * 100) : 0;
        const totalsPurchaseIntentionPct = totals.totalConnected > 0 ? Math.round((totals.yesPlusPurchasedCount / totals.totalConnected) * 100) : 0;
        const totalsCropSolutionsFocusPct =
          totalsMaxCsScore > 0 ? Math.round((totalsTotalCsScore / totalsMaxCsScore) * 100) : 0;
        const totalsEmsScore = Math.round(
          0.25 * totalsMeetingConversionPct + 0.25 * totalsPurchaseIntentionPct + 0.5 * totalsCropSolutionsFocusPct
        );
        const totalsQualityCount0 = totals.totalAttempted - (totals.qualityCount1 + totals.qualityCount2 + totals.qualityCount3 + totals.qualityCount4 + totals.qualityCount5);

        // Snapshot format: sections with headers, matching Excel layout
        const metricRows: [string, ...(string | number)[]][] = [
          ['Call Status'],
          ['Connected', ...summaryRows.map((r) => r.totalConnected), totals.totalConnected],
          ['Disconnected', ...summaryRows.map((r) => r.disconnectedCount), totals.disconnectedCount],
          ['Incoming not Allowed', ...summaryRows.map((r) => r.incomingNACount), totals.incomingNACount],
          ['Invalid', ...summaryRows.map((r) => r.invalidCount), totals.invalidCount],
          ['No Ans', ...summaryRows.map((r) => r.noAnswerCount), totals.noAnswerCount],
          ['Total calls', ...summaryRows.map((r) => r.totalAttempted), totals.totalAttempted],
          ['Meeting attendance'],
          ['Maybe', ...summaryRows.map((r) => r.dontRecallCount), totals.dontRecallCount],
          ['No', ...summaryRows.map((r) => r.noMissedCount), totals.noMissedCount],
          ['Wrong identity', ...summaryRows.map((r) => r.identityWrongCount), totals.identityWrongCount],
          ['Yes', ...summaryRows.map((r) => r.yesAttendedCount), totals.yesAttendedCount],
          ['Hygiene %', ...summaryRows.map((r) => r.hygienePct), totalsHygienePct],
          ['Product purchase'],
          ['Not Purchased', ...summaryRows.map((r) => r.notPurchasedCount), totals.notPurchasedCount],
          ['Purchased', ...summaryRows.map((r) => r.purchasedCount), totals.purchasedCount],
          ['Meeting conversion (%)', ...summaryRows.map((r) => r.meetingConversionPct), totalsMeetingConversionPct],
          ['Purchase Intention'],
          ['Maybe', ...summaryRows.map((r) => r.willingMaybeCount), totals.willingMaybeCount],
          ['No', ...summaryRows.map((r) => r.willingNoCount), totals.willingNoCount],
          ['Yes', ...summaryRows.map((r) => r.willingYesCount), totals.willingYesCount],
          ['Yes + Purchased', ...summaryRows.map((r) => r.yesPlusPurchasedCount), totals.yesPlusPurchasedCount],
          ['Purchase Intention (%)', ...summaryRows.map((r) => r.purchaseIntentionPct), totalsPurchaseIntentionPct],
          ['Crop Solution Rating'],
          ['1', ...summaryRows.map((r) => r.qualityCount1 ?? 0), totals.qualityCount1],
          ['2', ...summaryRows.map((r) => r.qualityCount2 ?? 0), totals.qualityCount2],
          ['3', ...summaryRows.map((r) => r.qualityCount3 ?? 0), totals.qualityCount3],
          ['4', ...summaryRows.map((r) => r.qualityCount4 ?? 0), totals.qualityCount4],
          ['5', ...summaryRows.map((r) => r.qualityCount5 ?? 0), totals.qualityCount5],
          ['0', ...summaryRows.map((r) => r.totalAttempted - ((r.qualityCount1 ?? 0) + (r.qualityCount2 ?? 0) + (r.qualityCount3 ?? 0) + (r.qualityCount4 ?? 0) + (r.qualityCount5 ?? 0))), totalsQualityCount0],
          ['Total CS Score', ...summaryRows.map((r) => r.totalCsScore ?? r.activityQualitySum ?? 0), totalsTotalCsScore],
          ['Max CS Score', ...summaryRows.map((r) => r.maxCsScore ?? r.totalAttempted * 5), totalsMaxCsScore],
          ['Crop Solutions Score (%)', ...summaryRows.map((r) => r.cropSolutionsFocusPct), totalsCropSolutionsFocusPct],
          ['EMS Score', ...summaryRows.map((r) => r.emsScore), totalsEmsScore],
        ];
        const headerRow = ['', ...groupLabels, 'Totals'];
        const groupByLabel = { tm: 'TM', fda: 'FDA', bu: 'BU', zone: 'Zone', region: 'Region', territory: 'Territory' }[groupBy] || groupBy;
        const groupByNote = `Group By: ${groupByLabel}`;
        const taskAllocNote =
          'When date range is used, EMS uses task scheduled date so Total calls = Completed + Not reachable + Invalid from Team Lead Task Allocation (same scope).';
        const sheetData = [headerRow, [groupByNote], [taskAllocNote], [], ...metricRows];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), 'EMS Report');
      } else {
        const lineRows = rows as EmsReportLineRow[];
        const sheetData = [
          [
            'Group',
            'Task ID',
            'Activity Date',
            'Farmer Name',
            'Farmer Mobile',
            'Officer (FDA)',
            'TM',
            'Territory',
            'Zone',
            'BU',
            'State',
            'Connected',
            'Mobile Validity (%)',
            'Hygiene (%)',
            'Meeting Validity (%)',
            'Meeting Conversion (%)',
            'Purchase Intention (%)',
            'Crop Solutions Focus (%)',
            'EMS Score',
            'Relative Remarks',
          ],
          ...lineRows.map((r) => [
            r.groupLabel,
            r.taskId,
            r.activityDate,
            r.farmerName,
            r.farmerMobile,
            r.officerName,
            r.tmName,
            r.territoryName,
            r.zoneName,
            r.buName,
            r.state,
            r.connected,
            r.mobileValidityPct,
            r.hygienePct,
            r.meetingValidityPct,
            r.meetingConversionPct,
            r.purchaseIntentionPct,
            r.cropSolutionsFocusPct,
            r.emsScore,
            r.relativeRemarks,
          ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), 'EMS Report (Line)');
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `ems-report-${groupBy}-${level}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buf);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/reports/export
 * Export EMS progress summary + drilldown (by state) as Excel. Query params: same filters + format=xlsx.
 */
router.get('/export', filterValidators, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
    }
    const filters = parseFilters(req);
    const [summary, drilldownState] = await Promise.all([
      getEmsProgress(filters),
      getEmsDrilldown(filters, 'state'),
    ]);

    const wb = XLSX.utils.book_new();
    const summaryRows = [
      ['Metric', 'Value'],
      ['Activities Total', summary.activities.total],
      ['Activities Full (farmers selected)', summary.activities.sampledCount],
      ['Activities Not Sampled', summary.activities.notSampledCount],
      ['Activities Partial (no farmers selected)', summary.activities.partialCount],
      ['Tasks Total', summary.tasks.total],
      ['Tasks Completed', summary.tasks.completed],
      ['Tasks In Queue', summary.tasks.sampled_in_queue + summary.tasks.unassigned],
      ['Tasks In Progress', summary.tasks.in_progress],
      ['Completion Rate %', summary.tasks.completionRatePct],
      ['Farmers in Activities', summary.farmers.totalInActivities],
      ['Farmers Sampled', summary.farmers.sampled],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');

    const drillRows = [
      [
        'State',
        'Activities Total',
        'Activities Full (farmers selected)',
        'Tasks Total',
        'Tasks Completed',
        'Completion %',
        'Farmers Total',
        'Farmers Sampled',
      ],
      ...drilldownState.map((r) => [
        r.label,
        r.activitiesTotal,
        r.activitiesSampled,
        r.tasksTotal,
        r.tasksCompleted,
        r.completionRatePct,
        r.farmersTotal,
        r.farmersSampled,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drillRows), 'By State');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `ems-progress-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/tasks-detail-export
 * Excel export: 1) Activity details 2) Sampling details 3) Task details 4) Agent/Calling details 5) Final outcome and comments.
 */
router.get('/tasks-detail-export', filterValidators, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: { message: 'Validation failed', errors: errors.array() } });
    }
    const filters = parseFilters(req);
    const rows = await getTaskDetailExportRows(filters);

    const wb = XLSX.utils.book_new();
    // Section 1: Activity details
    const headers = [
      'Activity ID',
      'Activity Type',
      'Activity Date',
      'Officer Name (FDA)',
      'Officer ID (FDA)',
      'TM Name',
      'TM Emp Code',
      'Activity Location',
      'Territory',
      'Territory Name',
      'Zone',
      'BU',
      'State',
      'Activity Crops',
      'Activity Products',
      'Lifecycle Status',
      'Activity Synced At',
      // Section 2: Sampling details
      'Sampling Percentage',
      'Sampling Total Farmers',
      'Sampling Sampled Count',
      'Sampling Algorithm',
      'Sampling Created At',
      // Section 3: Task details
      'Task ID',
      'Farmer Name',
      'Farmer Mobile',
      'Farmer Location',
      'Farmer Preferred Language',
      'Farmer Territory',
      'Task Scheduled Date',
      'Task Status',
      'Task Outcome',
      'Retry Count',
      'Is Callback',
      'Callback Number',
      'Task Created At',
      'Task Updated At',
      'Call Started At',
      // Section 4: Agent / Calling details
      'Agent Name',
      'Agent Email',
      'Agent Employee ID',
      'Call Timestamp',
      'Call Status',
      'Call Duration (sec)',
      'Did Attend',
      'Did Recall',
      'Crops Discussed',
      'Products Discussed',
      'Has Purchased',
      'Willing to Purchase',
      'Likely Purchase Date',
      'Non-Purchase Reason',
      'Purchased Products',
      // Section 5: Final outcome and comments
      'Outcome',
      'Final Status',
      'Farmer Comments',
      'Sentiment',
      'Last Status Note',
    ];
    const data = [headers, ...rows.map((r) => [
      r.activityId,
      r.activityType,
      r.activityDate,
      r.officerName,
      r.officerId,
      r.tmName,
      r.tmEmpCode,
      r.activityLocation,
      r.territory,
      r.territoryName,
      r.zoneName,
      r.buName,
      r.state,
      r.activityCrops,
      r.activityProducts,
      r.lifecycleStatus,
      r.activitySyncedAt,
      r.samplingPercentage,
      r.samplingTotalFarmers,
      r.samplingSampledCount,
      r.samplingAlgorithm,
      r.samplingCreatedAt,
      r.taskId,
      r.farmerName,
      r.farmerMobile,
      r.farmerLocation,
      r.farmerPreferredLanguage,
      r.farmerTerritory,
      r.taskScheduledDate,
      r.taskStatus,
      r.taskOutcome,
      r.retryCount,
      r.isCallback,
      r.callbackNumber,
      r.taskCreatedAt,
      r.taskUpdatedAt,
      r.callStartedAt,
      r.agentName,
      r.agentEmail,
      r.agentEmployeeId,
      r.callTimestamp,
      r.callStatus,
      r.callDurationSeconds,
      r.didAttend,
      r.didRecall,
      r.cropsDiscussed,
      r.productsDiscussed,
      r.hasPurchased,
      r.willingToPurchase,
      r.likelyPurchaseDate,
      r.nonPurchaseReason,
      r.purchasedProducts,
      r.outcome,
      r.finalStatus,
      r.farmerComments,
      r.sentiment,
      r.lastStatusNote,
    ])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Task Details');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `ems-task-details-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

export default router;
