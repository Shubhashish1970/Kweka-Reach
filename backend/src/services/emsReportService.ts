import { Activity } from '../models/Activity.js';
import { CallTask } from '../models/CallTask.js';
import mongoose from 'mongoose';
import {
  buildEmsCallTaskMatch,
  getEmsScopedActivityIds,
  type EmsProgressFilters,
} from './kpiService.js';

export type EmsReportGroupBy = 'tm' | 'fda' | 'bu' | 'zone' | 'region' | 'territory';

/** Purchase Intention % = (Willing Yes + Purchased) / (Willing Yes + Willing No + Purchased) among answered commercial conversion. */
export function computePurchaseIntentionPct(
  willingYesCount: number,
  willingNoCount: number,
  purchasedCount: number
): number {
  const numerator = willingYesCount + purchasedCount;
  const denominator = numerator + willingNoCount;
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

type PurchaseIntentionLog = {
  hasPurchased?: boolean | null;
  willingToPurchase?: boolean | null;
  nonPurchaseReason?: string | null;
};

/** Willing Yes = not purchased and explicitly likely to buy. */
export function isWillingYes(log: PurchaseIntentionLog): boolean {
  return log.hasPurchased === false && log.willingToPurchase === true;
}

/**
 * Willing No = not purchased and either clicked "Likely to buy? → No"
 * or captured a non-purchase reason (agents often skip the No toggle).
 */
export function isWillingNo(log: PurchaseIntentionLog): boolean {
  if (log.hasPurchased !== false || log.willingToPurchase === true) return false;
  if (log.willingToPurchase === false) return true;
  return Boolean(String(log.nonPurchaseReason ?? '').trim());
}

const NON_EMPTY_NON_PURCHASE_REASON = {
  $gt: [
    { $strLenCP: { $trim: { input: { $ifNull: ['$callLog.nonPurchaseReason', ''] } } } },
    0,
  ],
};

const WILLING_YES_EXPR = {
  $and: [
    { $eq: ['$callLog.hasPurchased', false] },
    { $eq: ['$callLog.willingToPurchase', true] },
  ],
};

const WILLING_NO_EXPR = {
  $and: [
    { $eq: ['$callLog.hasPurchased', false] },
    {
      $or: [
        { $eq: ['$callLog.willingToPurchase', false] },
        {
          $and: [
            { $ne: ['$callLog.willingToPurchase', true] },
            NON_EMPTY_NON_PURCHASE_REASON,
          ],
        },
      ],
    },
  ],
};

/** Connected = callStatus === 'Connected' AND (didAttend set OR hasPurchased set OR willingToPurchase set) */
function isConnectedAndProgressed(log: { callStatus?: string; didAttend?: string | null; hasPurchased?: boolean | null; willingToPurchase?: boolean | null }): boolean {
  if (!log || log.callStatus !== 'Connected') return false;
  const didAttendSet = log.didAttend != null && String(log.didAttend).trim() !== '';
  const hasPurchasedSet = log.hasPurchased != null;
  const willingSet = log.willingToPurchase != null;
  return didAttendSet || hasPurchasedSet || willingSet;
}

/** One row per group with aggregated EMS metrics (full breakdown for report structure) */
export interface EmsReportSummaryRow {
  groupKey: string;
  groupLabel: string;
  totalAttempted: number;
  totalConnected: number;
  /** callStatus Connected but did not yet capture didAttend / purchase / willing (excluded from hygiene denominator) */
  connectedIntakePendingCount: number;
  disconnectedCount: number;
  incomingNACount: number;
  invalidCount: number;
  noAnswerCount: number;
  identityWrongCount: number;
  dontRecallCount: number;
  noMissedCount: number;
  notAFarmerCount: number;
  yesAttendedCount: number;
  notPurchasedCount: number;
  purchasedCount: number;
  willingMaybeCount: number;
  willingNoCount: number;
  willingYesCount: number;
  yesPlusPurchasedCount: number;
  mobileValidityPct: number;
  hygienePct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  activityQualitySum: number;
  activityQualityCount: number;
  /** Rating distribution for Crop Solution Rating section (0 = no rating) */
  qualityCount1: number;
  qualityCount2: number;
  qualityCount3: number;
  qualityCount4: number;
  qualityCount5: number;
  /** Total CS Score = sum(rating × count) for 1–5; Max CS Score = totalAttempted × 5 */
  totalCsScore: number;
  maxCsScore: number;
  emsScore: number;
  relativeRemarks: string;
  /** Geo hierarchy fields for column ordering (BU → Zone → Region → Territory) */
  buName?: string;
  zoneName?: string;
  regionName?: string;
  territoryName?: string;
  /** Identity helpers for Raw Excel export */
  officerId?: string;
  location?: string;
  tmName?: string;
  tmEmpCode?: string;
}

/** One row per call with call-level metrics and relative remarks */
export interface EmsReportLineRow {
  taskId: string;
  groupKey: string;
  groupLabel: string;
  activityId: string;
  activityDate: string;
  farmerName: string;
  farmerMobile: string;
  officerName: string;
  tmName: string;
  territoryName: string;
  zoneName: string;
  buName: string;
  state: string;
  totalAttempted: 1;
  connected: 0 | 1;
  invalid: 0 | 1;
  identityWrong: 0 | 1;
  notAFarmer: 0 | 1;
  yesAttended: 0 | 1;
  purchased: 0 | 1;
  willingYes: 0 | 1;
  mobileValidityPct: number;
  hygienePct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  emsScore: number;
  relativeRemarks: string;
}

function getGroupField(groupBy: EmsReportGroupBy): string {
  switch (groupBy) {
    case 'tm': return 'tmName';
    case 'fda': return 'officerName';
    case 'bu': return 'buName';
    case 'zone': return 'zoneName';
    case 'region': return 'state';
    case 'territory': return 'territoryName';
    default: return 'territoryName';
  }
}

type EmsHierarchySortable = {
  groupLabel: string;
  buName?: string;
  zoneName?: string;
  regionName?: string;
  territoryName?: string;
  state?: string;
};

function hierarchySortValue(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  return trimmed || '\uffff';
}

function compareHierarchyStrings(a: string | undefined | null, b: string | undefined | null): number {
  return hierarchySortValue(a).localeCompare(hierarchySortValue(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

function hierarchyFieldValue(
  row: EmsHierarchySortable,
  dimension: 'bu' | 'zone' | 'region' | 'territory' | 'group',
  groupBy: EmsReportGroupBy
): string {
  switch (dimension) {
    case 'bu':
      return row.buName || (groupBy === 'bu' ? row.groupLabel : '') || '';
    case 'zone':
      return row.zoneName || (groupBy === 'zone' ? row.groupLabel : '') || '';
    case 'region':
      return row.regionName || row.state || (groupBy === 'region' ? row.groupLabel : '') || '';
    case 'territory':
      return row.territoryName || (groupBy === 'territory' ? row.groupLabel : '') || '';
    case 'group':
      return row.groupLabel || '';
    default:
      return '';
  }
}

/** Sort EMS report rows: BU → Zone → Region → Territory, then group label for MDO/TM. */
export function compareEmsReportByHierarchy(
  a: EmsHierarchySortable,
  b: EmsHierarchySortable,
  groupBy: EmsReportGroupBy
): number {
  const dimensions: Array<'bu' | 'zone' | 'region' | 'territory' | 'group'> = ['bu'];
  if (groupBy !== 'bu') dimensions.push('zone');
  if (groupBy !== 'bu' && groupBy !== 'zone') dimensions.push('region');
  if (groupBy === 'territory' || groupBy === 'fda' || groupBy === 'tm') dimensions.push('territory');
  if (groupBy === 'fda' || groupBy === 'tm') dimensions.push('group');

  for (const dimension of dimensions) {
    const cmp = compareHierarchyStrings(
      hierarchyFieldValue(a, dimension, groupBy),
      hierarchyFieldValue(b, dimension, groupBy)
    );
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function first10Words(text: string | undefined | null): string {
  if (text == null || typeof text !== 'string') return '—';
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 10);
  return words.join(' ') || '—';
}

function buildRelativeRemarks(meetingValidityPct: number, meetingConversionPct: number, emsScore: number): string {
  if (emsScore >= 80) return 'Good performance across parameters';
  if (meetingValidityPct >= 70 && meetingConversionPct < 50) return 'Good meeting validity, but poor conversion';
  if (meetingValidityPct >= 50 && meetingValidityPct < 70 && meetingConversionPct < 50) return 'Moderate meeting validity and poor conversion';
  if (emsScore >= 50 && emsScore < 70) return 'Moderate score across parameters';
  if (emsScore < 50) return 'Need to be reviewed';
  if (meetingValidityPct < 50 && meetingConversionPct < 50) return 'Low meeting validity & conversion';
  return 'Moderate performance, need improvement in meeting conversion';
}

/**
 * EMS Report summary: one row per group (TM, MDO, BU, Zone, Region, Territory).
 * Includes all attempted calls: status completed (Connected), not_reachable (Disconnected/Incoming N/A/No Answer), invalid_number (Invalid).
 * Date range filters use activity.date (validation calls may complete after the activity due to cooling period).
 * Connected = callLog.callStatus === 'Connected' and progressed to next stage or beyond.
 */
export async function getEmsReportSummary(
  filters: EmsProgressFilters | undefined,
  groupBy: EmsReportGroupBy
): Promise<EmsReportSummaryRow[]> {
  const activityCollection = Activity.collection.name;
  const groupField = getGroupField(groupBy);

  const activityIds = await getEmsScopedActivityIds(filters);
  if (activityIds.length === 0) return [];
  const taskMatch = buildEmsCallTaskMatch(activityIds);

  const pipeline: any[] = [
    { $match: taskMatch },
    {
      $lookup: {
        from: activityCollection,
        localField: 'activityId',
        foreignField: '_id',
        as: 'activity',
      },
    },
    { $unwind: '$activity' },
  ];

  pipeline.push(
    {
      $addFields: {
        __group: { $ifNull: [`$activity.${groupField}`, '—'] },
        __callStatus: { $ifNull: ['$callLog.callStatus', ''] },
        __didAttend: '$callLog.didAttend',
        __hasPurchased: '$callLog.hasPurchased',
        __willingToPurchase: '$callLog.willingToPurchase',
        __isConnected: {
          $and: [
            { $eq: ['$callLog.callStatus', 'Connected'] },
            {
              $or: [
                { $and: [{ $ne: ['$callLog.didAttend', null] }, { $ne: [{ $type: '$callLog.didAttend' }, 'missing'] }] },
                { $eq: ['$callLog.hasPurchased', true] },
                { $eq: ['$callLog.willingToPurchase', true] },
              ],
            },
          ],
        },
        __disconnected: { $eq: ['$callLog.callStatus', 'Disconnected'] },
        __incomingNA: { $in: ['$callLog.callStatus', ['Incoming N/A', 'Not Reachable']] },
        __isInvalid: { $in: ['$callLog.callStatus', ['Invalid', 'Invalid Number']] },
        __noAnswer: { $eq: ['$callLog.callStatus', 'No Answer'] },
        __identityWrong: { $eq: ['$callLog.didAttend', 'Identity Wrong'] },
        __dontRecall: { $eq: ['$callLog.didAttend', "Don't recall"] },
        __noMissed: { $eq: ['$callLog.didAttend', 'No, I missed'] },
        __notAFarmer: { $eq: ['$callLog.didAttend', 'Not a Farmer'] },
        __yesAttended: { $eq: ['$callLog.didAttend', 'Yes, I attended'] },
        __notPurchased: { $eq: ['$callLog.hasPurchased', false] },
        __purchased: { $eq: ['$callLog.hasPurchased', true] },
        __willingMaybe: { $and: [{ $ne: ['$callLog.willingToPurchase', true] }, { $ne: ['$callLog.willingToPurchase', false] }] },
        __willingNo: WILLING_NO_EXPR,
        __willingYes: WILLING_YES_EXPR,
        __hasQualityRating: {
          $and: [
            { $gte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 1] },
            { $lte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 5] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$__group',
        buName: { $first: { $ifNull: ['$activity.buName', ''] } },
        zoneName: { $first: { $ifNull: ['$activity.zoneName', ''] } },
        regionName: { $first: { $ifNull: ['$activity.state', ''] } },
        territoryName: {
          $first: {
            $ifNull: ['$activity.territoryName', { $ifNull: ['$activity.territory', ''] }],
          },
        },
        officerId: { $first: { $ifNull: ['$activity.officerId', ''] } },
        location: { $first: { $ifNull: ['$activity.location', ''] } },
        tmName: { $first: { $ifNull: ['$activity.tmName', ''] } },
        tmEmpCode: { $first: { $ifNull: ['$activity.tmEmpCode', ''] } },
        totalAttempted: { $sum: 1 },
        totalConnected: { $sum: { $cond: ['$__isConnected', 1, 0] } },
        connectedIntakePendingCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$callLog.callStatus', 'Connected'] },
                  { $eq: ['$__isConnected', false] },
                ],
              },
              1,
              0,
            ],
          },
        },
        disconnectedCount: { $sum: { $cond: ['$__disconnected', 1, 0] } },
        incomingNACount: { $sum: { $cond: ['$__incomingNA', 1, 0] } },
        invalidCount: { $sum: { $cond: ['$__isInvalid', 1, 0] } },
        noAnswerCount: { $sum: { $cond: ['$__noAnswer', 1, 0] } },
        identityWrongCount: { $sum: { $cond: ['$__identityWrong', 1, 0] } },
        dontRecallCount: { $sum: { $cond: ['$__dontRecall', 1, 0] } },
        noMissedCount: { $sum: { $cond: ['$__noMissed', 1, 0] } },
        notAFarmerCount: { $sum: { $cond: ['$__notAFarmer', 1, 0] } },
        yesAttendedCount: { $sum: { $cond: ['$__yesAttended', 1, 0] } },
        notPurchasedCount: { $sum: { $cond: ['$__notPurchased', 1, 0] } },
        purchasedCount: { $sum: { $cond: ['$__purchased', 1, 0] } },
        willingMaybeCount: { $sum: { $cond: ['$__willingMaybe', 1, 0] } },
        willingNoCount: { $sum: { $cond: ['$__willingNo', 1, 0] } },
        willingYesCount: { $sum: { $cond: ['$__willingYes', 1, 0] } },
        activityQualitySum: {
          $sum: {
            $cond: [
              { $and: [
                { $gte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 1] },
                { $lte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 5] },
              ] },
              { $ifNull: ['$callLog.activityQuality', 0] },
              0,
            ],
          },
        },
        activityQualityCount: {
          $sum: {
            $cond: [
              { $and: [
                { $gte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 1] },
                { $lte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 5] },
              ] },
              1,
              0,
            ],
          },
        },
        qualityCount1: { $sum: { $cond: [{ $eq: ['$callLog.activityQuality', 1] }, 1, 0] } },
        qualityCount2: { $sum: { $cond: [{ $eq: ['$callLog.activityQuality', 2] }, 1, 0] } },
        qualityCount3: { $sum: { $cond: [{ $eq: ['$callLog.activityQuality', 3] }, 1, 0] } },
        qualityCount4: { $sum: { $cond: [{ $eq: ['$callLog.activityQuality', 4] }, 1, 0] } },
        qualityCount5: { $sum: { $cond: [{ $eq: ['$callLog.activityQuality', 5] }, 1, 0] } },
      },
    },
  );

  const agg = await CallTask.aggregate(pipeline).exec();

  const rows: EmsReportSummaryRow[] = [];
  for (const row of agg) {
    const label = row._id != null ? String(row._id).trim() || '—' : '—';
    const buName = String(row.buName || '').trim();
    const zoneName = String(row.zoneName || '').trim();
    const regionName = String(row.regionName || '').trim();
    const territoryName = String(row.territoryName || '').trim();
    const officerId = String(row.officerId || '').trim();
    const location = String(row.location || '').trim();
    const tmName = String(row.tmName || '').trim();
    const tmEmpCode = String(row.tmEmpCode || '').trim();
    const totalAttempted = Number(row.totalAttempted || 0);
    const totalConnected = Number(row.totalConnected || 0);
    const connectedIntakePendingCount = Number(row.connectedIntakePendingCount || 0);
    const disconnectedCount = Number(row.disconnectedCount || 0);
    const incomingNACount = Number(row.incomingNACount || 0);
    const invalidCount = Number(row.invalidCount || 0);
    const noAnswerCount = Number(row.noAnswerCount || 0);
    const identityWrongCount = Number(row.identityWrongCount || 0);
    const dontRecallCount = Number(row.dontRecallCount || 0);
    const noMissedCount = Number(row.noMissedCount || 0);
    const notAFarmerCount = Number(row.notAFarmerCount || 0);
    const yesAttendedCount = Number(row.yesAttendedCount || 0);
    const notPurchasedCount = Number(row.notPurchasedCount || 0);
    const purchasedCount = Number(row.purchasedCount || 0);
    const willingMaybeCount = Number(row.willingMaybeCount || 0);
    const willingNoCount = Number(row.willingNoCount || 0);
    const willingYesCount = Number(row.willingYesCount || 0);
    const activityQualitySum = Number(row.activityQualitySum || 0);
    const activityQualityCount = Number(row.activityQualityCount || 0);
    const qualityCount1 = Number(row.qualityCount1 || 0);
    const qualityCount2 = Number(row.qualityCount2 || 0);
    const qualityCount3 = Number(row.qualityCount3 || 0);
    const qualityCount4 = Number(row.qualityCount4 || 0);
    const qualityCount5 = Number(row.qualityCount5 || 0);

    const mobileValidityPct =
      totalAttempted > 0 ? Math.round(((totalAttempted - invalidCount) / totalAttempted) * 100) : 0;
    const hygienePct =
      totalConnected > 0
        ? Math.round(((totalConnected - identityWrongCount - notAFarmerCount) / totalConnected) * 100)
        : 0;
    const meetingValidityPct = totalConnected > 0 ? Math.round((yesAttendedCount / totalConnected) * 100) : 0;
    const meetingConversionPct = totalConnected > 0 ? Math.round((purchasedCount / totalConnected) * 100) : 0;
    const purchaseIntentionPct = computePurchaseIntentionPct(willingYesCount, willingNoCount, purchasedCount);
    // Snapshot formula: Total CS Score / Max CS Score. Max CS Score = totalAttempted × 5
    const totalCsScore = activityQualitySum;
    const maxCsScore = totalAttempted * 5;
    const cropSolutionsFocusPct =
      maxCsScore > 0 ? Math.round((totalCsScore / maxCsScore) * 100) : 0;
    // EMS Score = 25% Meeting Conversion + 25% Purchase Intention + 50% Crop Solutions Focus
    const emsScore = Math.round(
      0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
    );
    const yesPlusPurchasedCount = willingYesCount + purchasedCount;
    const relativeRemarks = buildRelativeRemarks(meetingValidityPct, meetingConversionPct, emsScore);

    rows.push({
      groupKey: label,
      groupLabel: label,
      totalAttempted,
      totalConnected,
      connectedIntakePendingCount,
      disconnectedCount,
      incomingNACount,
      invalidCount,
      noAnswerCount,
      identityWrongCount,
      dontRecallCount,
      noMissedCount,
      notAFarmerCount,
      yesAttendedCount,
      notPurchasedCount,
      purchasedCount,
      willingMaybeCount,
      willingNoCount,
      willingYesCount,
      yesPlusPurchasedCount,
      mobileValidityPct,
      hygienePct,
      meetingValidityPct,
      meetingConversionPct,
      purchaseIntentionPct,
      cropSolutionsFocusPct,
      activityQualitySum,
      activityQualityCount,
      qualityCount1,
      qualityCount2,
      qualityCount3,
      qualityCount4,
      qualityCount5,
      totalCsScore,
      maxCsScore,
      emsScore,
      relativeRemarks,
      buName,
      zoneName,
      regionName,
      territoryName,
      officerId,
      location,
      tmName,
      tmEmpCode,
    });
  }

  rows.sort((a, b) => compareEmsReportByHierarchy(a, b, groupBy));
  return rows;
}

/**
 * EMS Report line-level: one row per call with metrics and relative remarks.
 * Date range filters use activity.date (validation calls may complete after the activity).
 */
export async function getEmsReportLineLevel(
  filters: EmsProgressFilters | undefined,
  groupBy: EmsReportGroupBy
): Promise<EmsReportLineRow[]> {
  const groupField = getGroupField(groupBy);

  const activityIds = await getEmsScopedActivityIds(filters);
  if (activityIds.length === 0) return [];

  const tasksList = await CallTask.find(buildEmsCallTaskMatch(activityIds))
    .populate('activityId', 'date officerName tmName territoryName zoneName buName state territory type')
    .populate('farmerId', 'name mobileNumber')
    .sort({ updatedAt: -1 })
    .lean();

  const rows: EmsReportLineRow[] = [];
  for (const t of tasksList as any[]) {
    const log = t.callLog || {};
    const act = t.activityId || {};
    const farmer = t.farmerId || {};
    const groupLabel = act[groupField] != null ? String(act[groupField]).trim() || '—' : '—';

    const isConnected = isConnectedAndProgressed(log);
    const isInvalid = log.callStatus === 'Invalid' || log.callStatus === 'Invalid Number';
    const identityWrong = log.didAttend === 'Identity Wrong' ? 1 : 0;
    const notAFarmer = log.didAttend === 'Not a Farmer' ? 1 : 0;
    const yesAttended = log.didAttend === 'Yes, I attended' ? 1 : 0;
    const purchased = log.hasPurchased === true ? 1 : 0;
    const willingYes = isWillingYes(log) ? 1 : 0;
    const willingNo = isWillingNo(log) ? 1 : 0;

    const totalConnected = isConnected ? 1 : 0;
    const mobileValidityPct = isInvalid ? 0 : 100;
    const hygienePct =
      totalConnected > 0 ? Math.round(((totalConnected - identityWrong - notAFarmer) / totalConnected) * 100) : 0;
    const meetingValidityPct = totalConnected > 0 ? (yesAttended / totalConnected) * 100 : 0;
    const meetingConversionPct = totalConnected > 0 ? (purchased / totalConnected) * 100 : 0;
    const purchaseIntentionPct = computePurchaseIntentionPct(willingYes, willingNo, purchased);
    const q = log.activityQuality != null && log.activityQuality >= 1 && log.activityQuality <= 5 ? Number(log.activityQuality) : null;
    const cropSolutionsFocusPct = totalConnected > 0 && q != null ? Math.round((q / 5) * 100) : 0;
    // EMS Score = 25% Meeting Conversion + 25% Purchase Intention + 50% Crop Solutions Focus
    const emsScore = Math.round(
      0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
    );

    const sentiment = log.sentiment != null ? String(log.sentiment) : 'N/A';
    const relativeRemarks = `${first10Words(log.farmerComments)} + ${sentiment}`;

    rows.push({
      taskId: t._id?.toString() ?? '',
      groupKey: groupLabel,
      groupLabel,
      activityId: act._id?.toString() ?? '',
      activityDate: act.date ? new Date(act.date).toISOString().slice(0, 10) : '',
      farmerName: farmer?.name ?? '',
      farmerMobile: farmer?.mobileNumber ?? '',
      officerName: act.officerName ?? '',
      tmName: act.tmName ?? '',
      territoryName: act.territoryName ?? act.territory ?? '',
      zoneName: act.zoneName ?? '',
      buName: act.buName ?? '',
      state: act.state ?? '',
      totalAttempted: 1,
      connected: (isConnected ? 1 : 0) as 0 | 1,
      invalid: (isInvalid ? 1 : 0) as 0 | 1,
      identityWrong: identityWrong as 0 | 1,
      notAFarmer: notAFarmer as 0 | 1,
      yesAttended: yesAttended as 0 | 1,
      purchased: purchased as 0 | 1,
      willingYes: willingYes as 0 | 1,
      mobileValidityPct,
      hygienePct,
      meetingValidityPct,
      meetingConversionPct,
      purchaseIntentionPct,
      cropSolutionsFocusPct,
      emsScore,
      relativeRemarks,
    });
  }

  rows.sort((a, b) =>
    compareEmsReportByHierarchy(
      { ...a, regionName: a.state },
      { ...b, regionName: b.state },
      groupBy
    )
  );
  return rows;
}

export type EmsTrendBucket = 'daily' | 'weekly' | 'monthly';

export interface EmsTrendRow {
  period: string;
  totalAttempted: number;
  totalConnected: number;
  emsScore: number;
  mobileValidityPct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
}

/**
 * EMS trends: time-series of aggregate metrics by period (daily, weekly, monthly).
 * Date range filters and trend buckets use activity.date.
 */
export async function getEmsReportTrends(
  filters: EmsProgressFilters | undefined,
  bucket: EmsTrendBucket
): Promise<EmsTrendRow[]> {
  const activityCollection = Activity.collection.name;

  const activityIds = await getEmsScopedActivityIds(filters);
  if (activityIds.length === 0) return [];
  const taskMatch = buildEmsCallTaskMatch(activityIds);

  const dateFormat =
    bucket === 'monthly' ? '%Y-%m' : bucket === 'weekly' ? '%G-W%V' : '%Y-%m-%d';

  const pipeline: any[] = [
    { $match: taskMatch },
    {
      $lookup: {
        from: activityCollection,
        localField: 'activityId',
        foreignField: '_id',
        as: 'activity',
      },
    },
    { $unwind: '$activity' },
  ];
  pipeline.push(
    {
      $addFields: {
        __period: { $dateToString: { format: dateFormat, date: '$activity.date' } },
        __isConnected: {
          $and: [
            { $eq: ['$callLog.callStatus', 'Connected'] },
            {
              $or: [
                { $and: [{ $ne: ['$callLog.didAttend', null] }, { $ne: [{ $type: '$callLog.didAttend' }, 'missing'] }] },
                { $eq: ['$callLog.hasPurchased', true] },
                { $eq: ['$callLog.willingToPurchase', true] },
              ],
            },
          ],
        },
        __isInvalid: { $in: ['$callLog.callStatus', ['Invalid', 'Invalid Number']] },
        __identityWrong: { $eq: ['$callLog.didAttend', 'Identity Wrong'] },
        __notAFarmer: { $eq: ['$callLog.didAttend', 'Not a Farmer'] },
        __yesAttended: { $eq: ['$callLog.didAttend', 'Yes, I attended'] },
        __purchased: { $eq: ['$callLog.hasPurchased', true] },
        __willingYes: WILLING_YES_EXPR,
        __willingNo: WILLING_NO_EXPR,
        __hasQualityRating: {
          $and: [
            { $gte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 1] },
            { $lte: [{ $ifNull: ['$callLog.activityQuality', 0] }, 5] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$__period',
        totalAttempted: { $sum: 1 },
        totalConnected: { $sum: { $cond: ['$__isConnected', 1, 0] } },
        invalidCount: { $sum: { $cond: ['$__isInvalid', 1, 0] } },
        identityWrongCount: { $sum: { $cond: ['$__identityWrong', 1, 0] } },
        notAFarmerCount: { $sum: { $cond: ['$__notAFarmer', 1, 0] } },
        yesAttendedCount: { $sum: { $cond: ['$__yesAttended', 1, 0] } },
        purchasedCount: { $sum: { $cond: ['$__purchased', 1, 0] } },
        willingYesCount: { $sum: { $cond: ['$__willingYes', 1, 0] } },
        willingNoCount: { $sum: { $cond: ['$__willingNo', 1, 0] } },
        activityQualitySum: {
          $sum: {
            $cond: [
              { $and: ['$__isConnected', '$__hasQualityRating'] },
              { $ifNull: ['$callLog.activityQuality', 0] },
              0,
            ],
          },
        },
        activityQualityCount: {
          $sum: { $cond: [{ $and: ['$__isConnected', '$__hasQualityRating'] }, 1, 0] },
        },
      },
    },
  );

  const agg = await CallTask.aggregate(pipeline).exec();

  const rows: EmsTrendRow[] = [];
  for (const row of agg) {
    const period = row._id != null ? String(row._id) : '—';
    const totalAttempted = Number(row.totalAttempted || 0);
    const totalConnected = Number(row.totalConnected || 0);
    const invalidCount = Number(row.invalidCount || 0);
    const identityWrongCount = Number(row.identityWrongCount || 0);
    const notAFarmerCount = Number(row.notAFarmerCount || 0);
    const yesAttendedCount = Number(row.yesAttendedCount || 0);
    const purchasedCount = Number(row.purchasedCount || 0);
    const willingYesCount = Number(row.willingYesCount || 0);
    const willingNoCount = Number(row.willingNoCount || 0);
    const activityQualitySum = Number(row.activityQualitySum || 0);

    const mobileValidityPct =
      totalAttempted > 0 ? Math.round(((totalAttempted - invalidCount) / totalAttempted) * 100) : 0;
    const meetingValidityPct = totalConnected > 0 ? Math.round((yesAttendedCount / totalConnected) * 100) : 0;
    const meetingConversionPct = totalConnected > 0 ? Math.round((purchasedCount / totalConnected) * 100) : 0;
    const purchaseIntentionPct = computePurchaseIntentionPct(willingYesCount, willingNoCount, purchasedCount);
    const maxCsScore = totalAttempted * 5;
    const cropSolutionsFocusPct =
      maxCsScore > 0 ? Math.round((activityQualitySum / maxCsScore) * 100) : 0;
    const emsScore = Math.round(
      0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
    );

    rows.push({
      period,
      totalAttempted,
      totalConnected,
      emsScore,
      mobileValidityPct,
      meetingValidityPct,
      meetingConversionPct,
      purchaseIntentionPct,
      cropSolutionsFocusPct,
    });
  }

  rows.sort((a, b) => a.period.localeCompare(b.period));
  return rows;
}
