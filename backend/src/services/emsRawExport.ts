import type { EmsReportGroupBy, EmsReportSummaryRow } from './emsReportService.js';

/** July Automated "Raw" header row A–AT (exact labels for column alignment). */
export const EMS_RAW_HEADERS: string[] = [
  'MDO NAME',
  'Group By: MDO',
  'HeadQuarters',
  'Country',
  'BU',
  'State',
  'Zone',
  'Region',
  'Territory',
  'FDAType',
  'Call Status',
  'Connected',
  'Connected (intake pending)',
  'Disconnected',
  'Incoming not Allowed',
  'Invalid',
  'No Ans',
  'Total calls',
  'Meeting attendance',
  'Maybe',
  'No',
  'Wrong identity',
  'Yes',
  'Hygiene %',
  'Meeting validity',
  'Product usage',
  'Not Used',
  'Used',
  'Meeting conversion (%)',
  'Product Usage Intention',
  'Maybe',
  'No',
  'Yes',
  'Yes + Used',
  'Usage Intention (%)',
  'Crop Solution Rating',
  '1',
  '2',
  '3',
  '4',
  '5',
  '0',
  'Total CS Score',
  'Max CS Score',
  'Crop Solutions Score (%)',
  'EMS Score',
];

export const EMS_RAW_GROUP_LEVELS: { groupBy: EmsReportGroupBy; sheetName: string; fdaType: string }[] = [
  { groupBy: 'fda', sheetName: 'Raw - MDO', fdaType: 'MDO' },
  { groupBy: 'territory', sheetName: 'Raw - Territory', fdaType: 'Territory' },
  { groupBy: 'zone', sheetName: 'Raw - Zone', fdaType: 'Zone' },
  { groupBy: 'region', sheetName: 'Raw - Region', fdaType: 'Region' },
  { groupBy: 'bu', sheetName: 'Raw - BU', fdaType: 'BU' },
  { groupBy: 'tm', sheetName: 'Raw - TM', fdaType: 'TM' },
];

function asFraction(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  // Values already in 0–1 stay as-is; 0–100 scale convert to fraction
  return pct > 1 ? Math.round((pct / 100) * 100) / 100 : Math.round(pct * 100) / 100;
}

function identityCode(row: EmsReportSummaryRow, groupBy: EmsReportGroupBy): string {
  if (groupBy === 'fda') return String(row.officerId || row.groupKey || '').trim();
  if (groupBy === 'tm') return String(row.tmEmpCode || row.groupKey || '').trim();
  return String(row.groupKey || row.groupLabel || '').trim();
}

function nameHeaderForLevel(groupBy: EmsReportGroupBy): string {
  switch (groupBy) {
    case 'fda':
      return 'MDO NAME';
    case 'tm':
      return 'TM NAME';
    case 'territory':
      return 'Territory NAME';
    case 'zone':
      return 'Zone NAME';
    case 'region':
      return 'Region NAME';
    case 'bu':
      return 'BU NAME';
    default:
      return 'MDO NAME';
  }
}

function groupByHeaderForLevel(groupBy: EmsReportGroupBy): string {
  const label = { tm: 'TM', fda: 'MDO', bu: 'BU', zone: 'Zone', region: 'Region', territory: 'Territory' }[groupBy] || groupBy;
  return `Group By: ${label}`;
}

/** Build Raw sheet AOA for one group-by level (header + one row per group). */
export function buildEmsRawSheetAoA(
  rows: EmsReportSummaryRow[],
  groupBy: EmsReportGroupBy,
  fdaType: string
): (string | number)[][] {
  const headers = [...EMS_RAW_HEADERS];
  headers[0] = nameHeaderForLevel(groupBy);
  headers[1] = groupByHeaderForLevel(groupBy);

  const dataRows = rows.map((r) => {
    const q1 = r.qualityCount1 ?? 0;
    const q2 = r.qualityCount2 ?? 0;
    const q3 = r.qualityCount3 ?? 0;
    const q4 = r.qualityCount4 ?? 0;
    const q5 = r.qualityCount5 ?? 0;
    const q0 = r.totalAttempted - (q1 + q2 + q3 + q4 + q5);
    const totalCs = r.totalCsScore ?? r.activityQualitySum ?? 0;
    const maxCs = r.maxCsScore ?? r.totalAttempted * 5;

    return [
      r.groupLabel || '—', // A name
      identityCode(r, groupBy), // B id / group key
      r.location || '', // C HeadQuarters
      'India', // D Country
      r.buName || '', // E BU
      r.regionName || '', // F State (org state ≈ region/state in our model)
      r.zoneName || '', // G Zone
      r.regionName || '', // H Region
      r.territoryName || '', // I Territory
      fdaType, // J FDAType
      '', // K Call Status (section banner)
      r.totalConnected, // L
      r.connectedIntakePendingCount ?? 0, // M
      r.disconnectedCount, // N
      r.incomingNACount, // O
      r.invalidCount, // P
      r.noAnswerCount, // Q
      r.totalAttempted, // R
      '', // S Meeting attendance (section banner)
      0, // T Maybe (attendance) — not captured in agent form
      r.noMissedCount, // U No
      r.identityWrongCount, // V Wrong identity
      r.yesAttendedCount, // W Yes
      r.hygienePct, // X Hygiene % (0–100)
      asFraction(r.meetingValidityPct), // Y Meeting validity (0–1)
      '', // Z Product usage (section banner)
      r.notPurchasedCount, // AA Not Used
      r.purchasedCount, // AB Used
      asFraction(r.meetingConversionPct), // AC
      '', // AD Product Usage Intention (section banner)
      r.willingMaybeCount ?? 0, // AE Maybe (unanswered / not explicit)
      r.willingNoCount, // AF No
      r.willingYesCount, // AG Yes
      r.yesPlusPurchasedCount, // AH Yes + Used
      asFraction(r.purchaseIntentionPct), // AI
      '', // AJ Crop Solution Rating (section banner)
      q1, // AK
      q2, // AL
      q3, // AM
      q4, // AN
      q5, // AO
      q0, // AP
      totalCs, // AQ
      maxCs, // AR
      asFraction(r.cropSolutionsFocusPct), // AS
      asFraction(r.emsScore), // AT
    ];
  });

  return [headers, ...dataRows];
}
