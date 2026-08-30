import type { EmsReportSummaryRow } from '../services/api';

export type PerformanceLevel = 'bu' | 'zone' | 'region' | 'territory' | 'mdo';

export type PerformanceMetrics = {
  totalAttempted: number;
  totalConnected: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  emsScore: number;
  relativeRemarks: string;
};

export type PerformanceTreeNode = {
  id: string;
  level: PerformanceLevel;
  label: string;
  groupKey?: string;
  metrics: PerformanceMetrics;
  children: PerformanceTreeNode[];
};

const LEVEL_LABELS: Record<PerformanceLevel, string> = {
  bu: 'BU',
  zone: 'Zone',
  region: 'Region',
  territory: 'Territory',
  mdo: 'MDO',
};

export function performanceLevelLabel(level: PerformanceLevel): string {
  return LEVEL_LABELS[level];
}

function normHierarchyLabel(value?: string | null): string {
  const trimmed = (value ?? '').trim();
  return trimmed || '—';
}

function compareHierarchyLabels(a: string, b: string): number {
  const av = a === '—' ? '\uffff' : a;
  const bv = b === '—' ? '\uffff' : b;
  return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
}

function relativeRemarksForAggregates(
  emsScore: number,
  meetingValidityPct: number,
  meetingConversionPct: number
): string {
  if (emsScore >= 80) return 'Good performance across parameters';
  if (meetingValidityPct >= 70 && meetingConversionPct < 50) return 'Good meeting validity, but poor conversion';
  if (meetingValidityPct >= 50 && meetingValidityPct < 70 && meetingConversionPct < 50) {
    return 'Moderate meeting validity and poor conversion';
  }
  if (emsScore >= 50 && emsScore < 70) return 'Moderate score across parameters';
  if (emsScore < 50) return 'Need to be reviewed';
  if (meetingValidityPct < 50 && meetingConversionPct < 50) return 'Low meeting validity & conversion';
  return 'Moderate performance, need improvement in meeting conversion';
}

export function aggregateEmsSummaryRows(rows: EmsReportSummaryRow[]): PerformanceMetrics {
  if (!rows.length) {
    return {
      totalAttempted: 0,
      totalConnected: 0,
      meetingValidityPct: 0,
      meetingConversionPct: 0,
      purchaseIntentionPct: 0,
      cropSolutionsFocusPct: 0,
      emsScore: 0,
      relativeRemarks: '—',
    };
  }

  let totalAttempted = 0;
  let totalConnected = 0;
  let invalidCount = 0;
  let identityWrongCount = 0;
  let notAFarmerCount = 0;
  let yesAttendedCount = 0;
  let purchasedCount = 0;
  let willingNoCount = 0;
  let yesPlusPurchasedCount = 0;
  let activityQualitySum = 0;

  for (const r of rows) {
    totalAttempted += r.totalAttempted;
    totalConnected += r.totalConnected;
    invalidCount += r.invalidCount;
    identityWrongCount += r.identityWrongCount ?? 0;
    notAFarmerCount += r.notAFarmerCount;
    yesAttendedCount += r.yesAttendedCount;
    purchasedCount += r.purchasedCount;
    willingNoCount += r.willingNoCount ?? 0;
    yesPlusPurchasedCount += r.yesPlusPurchasedCount ?? r.willingYesCount + r.purchasedCount;
    activityQualitySum += r.activityQualitySum ?? 0;
  }

  const meetingValidityPct = totalConnected > 0 ? Math.round((yesAttendedCount / totalConnected) * 100) : 0;
  const meetingConversionPct = totalConnected > 0 ? Math.round((purchasedCount / totalConnected) * 100) : 0;
  const purchaseIntentionDenominator = yesPlusPurchasedCount + willingNoCount;
  const purchaseIntentionPct =
    purchaseIntentionDenominator > 0
      ? Math.round((yesPlusPurchasedCount / purchaseIntentionDenominator) * 100)
      : 0;
  const cropSolutionsFocusPct =
    totalAttempted > 0 ? Math.round((activityQualitySum / (totalAttempted * 5)) * 100) : 0;
  const emsScore = Math.round(
    0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
  );

  return {
    totalAttempted,
    totalConnected,
    meetingValidityPct,
    meetingConversionPct,
    purchaseIntentionPct,
    cropSolutionsFocusPct,
    emsScore,
    relativeRemarks: relativeRemarksForAggregates(emsScore, meetingValidityPct, meetingConversionPct),
  };
}

function metricsFromRow(row: EmsReportSummaryRow): PerformanceMetrics {
  return {
    totalAttempted: row.totalAttempted,
    totalConnected: row.totalConnected,
    meetingValidityPct: row.meetingValidityPct,
    meetingConversionPct: row.meetingConversionPct,
    purchaseIntentionPct: row.purchaseIntentionPct,
    cropSolutionsFocusPct: row.cropSolutionsFocusPct,
    emsScore: row.emsScore,
    relativeRemarks: row.relativeRemarks || '—',
  };
}

function groupRows(rows: EmsReportSummaryRow[], getter: (row: EmsReportSummaryRow) => string): Map<string, EmsReportSummaryRow[]> {
  const map = new Map<string, EmsReportSummaryRow[]>();
  for (const row of rows) {
    const key = getter(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

function sortEntries<T>(entries: [string, T][]): [string, T][] {
  return [...entries].sort(([a], [b]) => compareHierarchyLabels(a, b));
}

function sortNodes(nodes: PerformanceTreeNode[]): PerformanceTreeNode[] {
  return [...nodes]
    .sort((a, b) => compareHierarchyLabels(a.label, b.label))
    .map((node) => ({ ...node, children: sortNodes(node.children) }));
}

function buildMdoNodes(parentId: string, rows: EmsReportSummaryRow[]): PerformanceTreeNode[] {
  return sortNodes(
    rows.map((row) => ({
      id: `${parentId}|mdo:${row.groupKey}`,
      level: 'mdo' as const,
      label: row.groupLabel || row.groupKey || '—',
      groupKey: row.groupKey,
      metrics: metricsFromRow(row),
      children: [],
    }))
  );
}

/** Build BU → Zone → Region → Territory → MDO explorer tree from MDO-level summary rows. */
export function buildPerformanceHierarchy(rows: EmsReportSummaryRow[]): PerformanceTreeNode[] {
  const buNodes: PerformanceTreeNode[] = [];

  for (const [buLabel, buRows] of sortEntries([...groupRows(rows, (r) => normHierarchyLabel(r.buName))])) {
    const buId = `bu:${buLabel}`;
    const zoneNodes: PerformanceTreeNode[] = [];

    for (const [zoneLabel, zoneRows] of sortEntries([...groupRows(buRows, (r) => normHierarchyLabel(r.zoneName))])) {
      const zoneId = `${buId}|zone:${zoneLabel}`;
      const regionNodes: PerformanceTreeNode[] = [];

      for (const [regionLabel, regionRows] of sortEntries([...groupRows(zoneRows, (r) => normHierarchyLabel(r.regionName))])) {
        const regionId = `${zoneId}|region:${regionLabel}`;
        const territoryNodes: PerformanceTreeNode[] = [];

        for (const [territoryLabel, territoryRows] of sortEntries([
          ...groupRows(regionRows, (r) => normHierarchyLabel(r.territoryName)),
        ])) {
          const territoryId = `${regionId}|territory:${territoryLabel}`;
          territoryNodes.push({
            id: territoryId,
            level: 'territory',
            label: territoryLabel,
            metrics: aggregateEmsSummaryRows(territoryRows),
            children: buildMdoNodes(territoryId, territoryRows),
          });
        }

        regionNodes.push({
          id: regionId,
          level: 'region',
          label: regionLabel,
          metrics: aggregateEmsSummaryRows(regionRows),
          children: territoryNodes,
        });
      }

      zoneNodes.push({
        id: zoneId,
        level: 'zone',
        label: zoneLabel,
        metrics: aggregateEmsSummaryRows(zoneRows),
        children: regionNodes,
      });
    }

    buNodes.push({
      id: buId,
      level: 'bu',
      label: buLabel,
      metrics: aggregateEmsSummaryRows(buRows),
      children: zoneNodes,
    });
  }

  return sortNodes(buNodes);
}

export function collectPerformanceNodeIds(nodes: PerformanceTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: PerformanceTreeNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.children.length) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

export function collectBuNodeIds(nodes: PerformanceTreeNode[]): string[] {
  return nodes.filter((n) => n.level === 'bu').map((n) => n.id);
}

export function filterPerformanceTree(nodes: PerformanceTreeNode[], query: string): PerformanceTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const prune = (node: PerformanceTreeNode): PerformanceTreeNode | null => {
    const selfMatch = node.label.toLowerCase().includes(q);
    const childMatches = node.children.map(prune).filter((child): child is PerformanceTreeNode => child != null);
    if (selfMatch) return node;
    if (childMatches.length) return { ...node, children: childMatches };
    return null;
  };

  return nodes.map(prune).filter((node): node is PerformanceTreeNode => node != null);
}

export type FlatPerformanceRow = {
  node: PerformanceTreeNode;
  depth: number;
};

export function flattenVisiblePerformanceTree(
  nodes: PerformanceTreeNode[],
  expanded: Set<string>,
  depth = 0
): FlatPerformanceRow[] {
  const rows: FlatPerformanceRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children.length > 0 && expanded.has(node.id)) {
      rows.push(...flattenVisiblePerformanceTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
}
