import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  kpiAPI,
  reportsAPI,
  type EmsProgressFilters,
  type EmsReportGroupBy,
  type EmsReportSummaryRow,
  type EmsReportLineRow,
  type EmsTrendRow,
  type EmsTrendBucket,
} from '../../services/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  LabelList,
  PieChart,
  Pie,
} from 'recharts';
import {
  BarChart3,
  Filter,
  RefreshCw,
  Download,
  Activity as ActivityIcon,
  Loader2,
  TrendingUp,
  Phone,
  MessageCircle,
  ShoppingCart,
  FileBarChart,
  Calendar,
  Smartphone,
  UserCheck,
  Users,
  Target,
  X,
  Info,
  Award,
} from 'lucide-react';
import Button from '../shared/Button';
import StyledSelect from '../shared/StyledSelect';
import { type DateRangePreset, getPresetRange, formatPretty, toISODateLocal } from '../../utils/dateRangeUtils';

/** Totals row derived from EMS summary rows (same formulas as backend) */
export type EmsTotals = {
  totalAttempted: number;
  totalConnected: number;
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
  willingYesCount: number;
  yesPlusPurchasedCount: number;
  mobileValidityPct: number;
  hygienePct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  emsScore: number;
  validIdentity: number;
};

const EMS_REPORT_GROUP_BY_OPTIONS: { value: EmsReportGroupBy; label: string }[] = [
  { value: 'fda', label: 'By FDA' },
  { value: 'territory', label: 'By Territory' },
  { value: 'region', label: 'By Region' },
  { value: 'zone', label: 'By Zone' },
  { value: 'bu', label: 'By BU' },
  { value: 'tm', label: 'By TM' },
];

const TREND_BUCKET_OPTIONS: { value: EmsTrendBucket; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const GROUP_BY_OPTIONS: { value: EmsReportGroupBy; label: string }[] = [
  { value: 'tm', label: 'TM' },
  { value: 'fda', label: 'FDA' },
  { value: 'territory', label: 'Territory' },
  { value: 'zone', label: 'Zone' },
  { value: 'region', label: 'Region' },
  { value: 'bu', label: 'BU' },
];

function getDefaultDateRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  return { dateFrom: toISODateLocal(start), dateTo: toISODateLocal(today) };
}

function computeEmsTotals(rows: EmsReportSummaryRow[]): EmsTotals | null {
  if (!rows.length) return null;
  const r0 = rows[0];
  const hasCounts = 'disconnectedCount' in r0 && (r0 as EmsReportSummaryRow).disconnectedCount != null;
  let totalAttempted = 0, totalConnected = 0, disconnectedCount = 0, incomingNACount = 0, invalidCount = 0, noAnswerCount = 0;
  let identityWrongCount = 0, dontRecallCount = 0, noMissedCount = 0, notAFarmerCount = 0, yesAttendedCount = 0;
  let notPurchasedCount = 0, purchasedCount = 0, willingMaybeCount = 0, willingNoCount = 0, willingYesCount = 0, yesPlusPurchasedCount = 0;
  let activityQualitySum = 0, activityQualityCount = 0;
  for (const r of rows) {
    totalAttempted += r.totalAttempted;
    totalConnected += r.totalConnected;
    invalidCount += r.invalidCount;
    identityWrongCount += (r as EmsReportSummaryRow & { identityWrongCount?: number }).identityWrongCount ?? 0;
    activityQualitySum += (r as EmsReportSummaryRow & { activityQualitySum?: number }).activityQualitySum ?? 0;
    activityQualityCount += (r as EmsReportSummaryRow & { activityQualityCount?: number }).activityQualityCount ?? 0;
    notAFarmerCount += r.notAFarmerCount;
    yesAttendedCount += r.yesAttendedCount;
    purchasedCount += r.purchasedCount;
    willingYesCount += r.willingYesCount;
    if (hasCounts) {
      disconnectedCount += (r as EmsReportSummaryRow).disconnectedCount ?? 0;
      incomingNACount += (r as EmsReportSummaryRow).incomingNACount ?? 0;
      noAnswerCount += (r as EmsReportSummaryRow).noAnswerCount ?? 0;
      dontRecallCount += (r as EmsReportSummaryRow).dontRecallCount ?? 0;
      noMissedCount += (r as EmsReportSummaryRow).noMissedCount ?? 0;
      notPurchasedCount += (r as EmsReportSummaryRow).notPurchasedCount ?? 0;
      willingMaybeCount += (r as EmsReportSummaryRow).willingMaybeCount ?? 0;
      willingNoCount += (r as EmsReportSummaryRow).willingNoCount ?? 0;
      yesPlusPurchasedCount += (r as EmsReportSummaryRow).yesPlusPurchasedCount ?? 0;
    }
  }
  if (!hasCounts) yesPlusPurchasedCount = willingYesCount + purchasedCount;
  const mobileValidityPct = totalAttempted > 0 ? Math.round(((totalAttempted - invalidCount) / totalAttempted) * 100) : 0;
  const hygienePct = totalConnected > 0 ? Math.round(((totalConnected - identityWrongCount - notAFarmerCount) / totalConnected) * 100) : 0;
  const meetingValidityPct = totalConnected > 0 ? Math.round((yesAttendedCount / totalConnected) * 100) : 0;
  const meetingConversionPct = totalConnected > 0 ? Math.round((purchasedCount / totalConnected) * 100) : 0;
  const purchaseIntentionPct = totalConnected > 0 ? Math.round(((willingYesCount + purchasedCount) / totalConnected) * 100) : 0;
  // Snapshot formula: Total CS Score / Max CS Score. Max CS Score = totalAttempted × 5
  const cropSolutionsFocusPct =
    totalAttempted > 0 ? Math.round((activityQualitySum / (totalAttempted * 5)) * 100) : 0;
  // EMS Score = 25% Meeting Conversion + 25% Purchase Intention + 50% Crop Solutions Focus (Meeting Validity & Hygiene not included)
  const emsScore = Math.round(
    0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
  );
  const validIdentity = totalConnected - identityWrongCount - notAFarmerCount;
  return {
    totalAttempted, totalConnected, disconnectedCount, incomingNACount, invalidCount, noAnswerCount,
    identityWrongCount, dontRecallCount, noMissedCount, notAFarmerCount, yesAttendedCount,
    notPurchasedCount, purchasedCount, willingMaybeCount, willingNoCount, willingYesCount, yesPlusPurchasedCount,
    mobileValidityPct, hygienePct, meetingValidityPct, meetingConversionPct, purchaseIntentionPct, cropSolutionsFocusPct, emsScore, validIdentity,
  };
}

const ActivityEmsProgressView: React.FC = () => {
  const { showError, showSuccess } = useToast();
  const [emsDetailRows, setEmsDetailRows] = useState<EmsReportSummaryRow[]>([]);
  const [emsTrends, setEmsTrends] = useState<EmsTrendRow[]>([]);
  const [trendBucket, setTrendBucket] = useState<EmsTrendBucket>('weekly');
  const [groupBy, setGroupBy] = useState<EmsReportGroupBy>('fda');
  const [isLoadingEmsDetail, setIsLoadingEmsDetail] = useState(false);
  const [isLoadingEmsTrends, setIsLoadingEmsTrends] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    stateOptions: string[];
    territoryOptions: string[];
    zoneOptions: string[];
    buOptions: string[];
    activityTypeOptions: string[];
  }>({ stateOptions: [], territoryOptions: [], zoneOptions: [], buOptions: [], activityTypeOptions: [] });
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingTaskDetails, setIsExportingTaskDetails] = useState(false);
  const [showEmsReportModal, setShowEmsReportModal] = useState(false);
  const [emsReportGroupBy, setEmsReportGroupBy] = useState<EmsReportGroupBy>('fda');
  const [emsReportLevel, setEmsReportLevel] = useState<'summary' | 'line'>('summary');
  const [showFilters, setShowFilters] = useState(false);
  const defaultRange = getDefaultDateRange();
  const [filters, setFilters] = useState<EmsProgressFilters>({
    dateFrom: defaultRange.dateFrom,
    dateTo: defaultRange.dateTo,
    state: '',
    territory: '',
    zone: '',
    bu: '',
    activityType: '',
  });
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Last 30 days');
  const [draftStart, setDraftStart] = useState(defaultRange.dateFrom);
  const [draftEnd, setDraftEnd] = useState(defaultRange.dateTo);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [drillDownGroupKey, setDrillDownGroupKey] = useState<string | null>(null);
  const [drillDownLabel, setDrillDownLabel] = useState<string>('');
  const [lineRows, setLineRows] = useState<EmsReportLineRow[]>([]);
  const [isLoadingLine, setIsLoadingLine] = useState(false);
  const [tableSortKey, setTableSortKey] = useState<string>('');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('asc');
  const [tableFilterText, setTableFilterText] = useState<string>('');
  type FilterDimensionKey = keyof Pick<EmsProgressFilters, 'state' | 'territory' | 'zone' | 'bu' | 'activityType'>;
  const [filterDimension, setFilterDimension] = useState<FilterDimensionKey | 'region'>('state');
  const [kpiTooltipOpen, setKpiTooltipOpen] = useState<string | null>(null);
  const kpiTooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (kpiTooltipOpen != null && kpiTooltipRef.current && !kpiTooltipRef.current.contains(e.target as Node)) {
        setKpiTooltipOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [kpiTooltipOpen]);

  const totals = useMemo(() => computeEmsTotals(emsDetailRows), [emsDetailRows]);

  const tableRows = useMemo(() => {
    let rows = emsDetailRows;
    if (tableFilterText.trim()) {
      const q = tableFilterText.trim().toLowerCase();
      rows = rows.filter((r) => (r.groupLabel || r.groupKey).toLowerCase().includes(q));
    }
    if (tableSortKey) {
      rows = [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[tableSortKey] as number | string;
        const bv = (b as Record<string, unknown>)[tableSortKey] as number | string;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return tableSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [emsDetailRows, tableFilterText, tableSortKey, tableSortDir]);

  const toggleSort = (key: string) => {
    if (tableSortKey === key) setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setTableSortKey(key);
      setTableSortDir('asc');
    }
  };

  const syncDraftFromFilters = useCallback(() => {
    const start = filters.dateFrom || getPresetRange(selectedPreset, filters.dateFrom, filters.dateTo).start;
    const end = filters.dateTo || getPresetRange(selectedPreset, filters.dateFrom, filters.dateTo).end;
    setDraftStart(start);
    setDraftEnd(end);
  }, [filters.dateFrom, filters.dateTo, selectedPreset]);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (datePickerRef.current && !datePickerRef.current.contains(target)) {
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isDatePickerOpen]);

  const fetchOptions = useCallback(async () => {
    setIsLoadingOptions(true);
    try {
      const res = await kpiAPI.getEmsFilterOptions(filters);
      if (res.success && res.data) {
        setFilterOptions({
          stateOptions: res.data.stateOptions || [],
          territoryOptions: res.data.territoryOptions || [],
          zoneOptions: res.data.zoneOptions || [],
          buOptions: res.data.buOptions || [],
          activityTypeOptions: res.data.activityTypeOptions || [],
        });
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load filter options');
    } finally {
      setIsLoadingOptions(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.state, filters.territory, filters.zone, filters.bu, filters.activityType, showError]);

  const fetchEmsDetail = useCallback(async () => {
    setIsLoadingEmsDetail(true);
    try {
      const res = await reportsAPI.getEmsReport(groupBy, 'summary', filters);
      if (res.success && res.data) setEmsDetailRows(res.data as EmsReportSummaryRow[]);
      else setEmsDetailRows([]);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load EMS detail');
      setEmsDetailRows([]);
    } finally {
      setIsLoadingEmsDetail(false);
    }
  }, [groupBy, filters, showError]);

  const fetchLineLevel = useCallback(async (groupKey: string) => {
    setIsLoadingLine(true);
    try {
      const res = await reportsAPI.getEmsReport(groupBy, 'line', filters);
      if (res.success && res.data) {
        const lines = (res.data as EmsReportLineRow[]).filter((r) => r.groupKey === groupKey);
        setLineRows(lines);
      } else setLineRows([]);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load call details');
      setLineRows([]);
    } finally {
      setIsLoadingLine(false);
    }
  }, [groupBy, filters, showError]);

  const fetchEmsTrends = useCallback(async () => {
    setIsLoadingEmsTrends(true);
    try {
      const res = await reportsAPI.getEmsTrends(trendBucket, filters);
      if (res.success && res.data) setEmsTrends(res.data);
      else setEmsTrends([]);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load trends');
      setEmsTrends([]);
    } finally {
      setIsLoadingEmsTrends(false);
    }
  }, [trendBucket, filters, showError]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => {
    fetchEmsDetail();
  }, [fetchEmsDetail]);

  useEffect(() => {
    fetchEmsTrends();
  }, [fetchEmsTrends]);

  useEffect(() => {
    if (drillDownGroupKey != null) {
      setDrillDownLabel(drillDownGroupKey);
      fetchLineLevel(drillDownGroupKey);
    } else {
      setLineRows([]);
    }
  }, [drillDownGroupKey, fetchLineLevel]);

  const handleEmsReportDownload = async () => {
    setIsExporting(true);
    try {
      await reportsAPI.downloadEmsReportExport(emsReportGroupBy, emsReportLevel, filters);
      showSuccess('EMS report downloaded');
      setShowEmsReportModal(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportTaskDetails = async () => {
    setIsExportingTaskDetails(true);
    try {
      await reportsAPI.downloadTaskDetailsExport(filters);
      showSuccess('Task details Excel downloaded');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExportingTaskDetails(false);
    }
  };

  const applyFilter = (key: keyof EmsProgressFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || '' }));
  };

  const DIMENSION_OPTIONS: { value: FilterDimensionKey | 'region'; label: string }[] = [
    { value: 'state', label: 'State' },
    { value: 'bu', label: 'BU' },
    { value: 'region', label: 'Region' },
    { value: 'zone', label: 'Zone' },
    { value: 'territory', label: 'Territory' },
    { value: 'activityType', label: 'Activity Type' },
  ];

  const stateOptions = [{ value: '', label: 'All States' }, ...filterOptions.stateOptions.map((s) => ({ value: s, label: s }))];
  const territoryOptions = [{ value: '', label: 'All Territories' }, ...filterOptions.territoryOptions.map((t) => ({ value: t, label: t }))];
  const zoneOptions = [{ value: '', label: 'All Zones' }, ...filterOptions.zoneOptions.map((z) => ({ value: z, label: z }))];
  const buOptions = [{ value: '', label: 'All BUs' }, ...filterOptions.buOptions.map((b) => ({ value: b, label: b }))];
  const activityTypeOptions = [{ value: '', label: 'All Types' }, ...filterOptions.activityTypeOptions.map((t) => ({ value: t, label: t }))];

  const valueOptionsForDimension =
    filterDimension === 'state' || filterDimension === 'region' ? stateOptions
    : filterDimension === 'territory' ? territoryOptions
    : filterDimension === 'zone' ? zoneOptions
    : filterDimension === 'bu' ? buOptions
    : activityTypeOptions;
  const filterValue = filterDimension === 'region' ? (filters.state || '') : (filters[filterDimension] || '');

  const handleFilterDimensionChange = (dim: string) => {
    setFilterDimension(dim as FilterDimensionKey | 'region');
    setFilters((prev) => ({ ...prev, state: '', territory: '', zone: '', bu: '', activityType: '' }));
  };

  const handleFilterValueChange = (value: string) => {
    const key: FilterDimensionKey = filterDimension === 'region' ? 'state' : filterDimension;
    applyFilter(key, value);
  };

  return (
    <div className="space-y-6">
      {/* Header - aligned with Activity Monitoring layout and controls */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center shrink-0">
              <BarChart3 className="text-slate-600" size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-slate-900 mb-1">Activity EMS Dashboard</h2>
              <p className="text-sm text-slate-600">Visual EMS metrics, drill-down by group, and trends (Totals)</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter size={16} />
              {showFilters ? 'Hide filters' : 'Filters'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { fetchEmsDetail(); fetchEmsTrends(); fetchOptions(); }}
              disabled={isLoadingEmsDetail || isLoadingEmsTrends}
            >
              {isLoadingEmsDetail || isLoadingEmsTrends ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowEmsReportModal(true)}
              disabled={isExporting}
            >
              {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              EMS report
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportTaskDetails} disabled={isExportingTaskDetails}>
              {isExportingTaskDetails ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Export Task Details
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Date Range</label>
              <div className="relative" ref={datePickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsDatePickerOpen((prev) => {
                      const next = !prev;
                      if (!prev && next) syncDraftFromFilters();
                      return next;
                    });
                  }}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 flex items-center justify-between"
                >
                  <span className="truncate">
                    {selectedPreset}
                    {filters.dateFrom && filters.dateTo ? ` • ${formatPretty(filters.dateFrom)} - ${formatPretty(filters.dateTo)}` : ''}
                  </span>
                  <span className="text-slate-400 font-black">▾</span>
                </button>

                {isDatePickerOpen && (
                  <div className="absolute z-50 mt-2 left-0 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex flex-col sm:flex-row">
                      <div className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50 p-2 shrink-0">
                        {(['Custom', 'Today', 'Yesterday', 'This week (Sun - Today)', 'Last 7 days', 'Last week (Sun - Sat)', 'Last 28 days', 'Last 30 days', 'YTD'] as DateRangePreset[]).map((p) => {
                          const isActive = selectedPreset === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setSelectedPreset(p);
                                const { start, end } = getPresetRange(p, filters.dateFrom, filters.dateTo);
                                setDraftStart(start);
                                setDraftEnd(end);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${isActive ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'}`}
                            >
                              {p}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="flex-1">
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Start date</p>
                            <input
                              type="date"
                              value={draftStart}
                              onChange={(e) => {
                                setSelectedPreset('Custom');
                                setDraftStart(e.target.value);
                              }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">End date</p>
                            <input
                              type="date"
                              value={draftEnd}
                              onChange={(e) => {
                                setSelectedPreset('Custom');
                                setDraftEnd(e.target.value);
                              }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              setIsDatePickerOpen(false);
                              syncDraftFromFilters();
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFilters((prev) => ({ ...prev, dateFrom: draftStart || '', dateTo: draftEnd || '' }));
                              setIsDatePickerOpen(false);
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Filter by</label>
              <StyledSelect
                value={filterDimension}
                onChange={handleFilterDimensionChange}
                options={DIMENSION_OPTIONS}
                placeholder="Filter by"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Value</label>
              <StyledSelect
                value={filterValue}
                onChange={handleFilterValueChange}
                options={valueOptionsForDimension}
                placeholder={filterDimension === 'state' || filterDimension === 'region' ? 'All States' : filterDimension === 'territory' ? 'All Territories' : filterDimension === 'zone' ? 'All Zones' : filterDimension === 'bu' ? 'All BUs' : 'All Types'}
              />
            </div>
          </div>
        </div>
      )}

      {/* Executive KPI Scorecards (Totals) - aligned with Activity Monitoring Statistics */}
      <div className="bg-white rounded-3xl p-4 mb-0 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="text-slate-600" size={18} />
          <h3 className="text-base font-black text-slate-900">EMS Totals</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {isLoadingEmsDetail ? (
            <div className="col-span-full flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-slate-500" size={32} />
            </div>
          ) : totals ? (
            <>
              {[
              { label: 'Mobile No. Validity (%)', value: totals.mobileValidityPct, formula: 'Out of all calls we tried, what % were to valid mobile numbers?', icon: Smartphone },
              { label: 'Hygiene (%)', value: totals.hygienePct, formula: '(Connected − Identity Wrong − Not Farmer) / Connected', icon: UserCheck },
              { label: 'Meeting Validity (%)', value: totals.meetingValidityPct, formula: 'Out of all farmers we successfully spoke to, how many actually attended the meeting or demo?', icon: Users },
              { label: 'Meeting Conversion (%)', value: totals.meetingConversionPct, formula: 'Out of all farmers we successfully spoke to, how many actually bought the product?', icon: ShoppingCart },
              { label: 'Purchase Intention (%)', value: totals.purchaseIntentionPct, formula: 'Out of all farmers we successfully spoke to, how many either bought or said they are willing to buy?', icon: Target },
              { label: 'Crop Solutions Focus (%)', value: totals.cropSolutionsFocusPct, formula: 'How close were we to delivering a perfect crop solution experience, as judged by farmers (1–5 stars)?', icon: Award },
              { label: 'EMS Score (Totals)', value: totals.emsScore, formula: '25% × Meeting Conversion % + 25% × Purchase Intention % + 50% × Crop Solutions Focus %. Meeting Validity and Hygiene are displayed but not included in EMS Score.', icon: FileBarChart },
            ].map(({ label, value, formula, icon: Icon }) => {
              const isGood = value >= 70;
              const isModerate = value >= 50 && value < 70;
              const cardBg = isGood ? 'bg-green-50 border-green-200' : isModerate ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';
              const labelColor = isGood ? 'text-green-600' : isModerate ? 'text-yellow-600' : 'text-red-600';
              const valueColor = isGood ? 'text-green-800' : isModerate ? 'text-yellow-800' : 'text-red-800';
              const detailColor = isGood ? 'text-green-600' : isModerate ? 'text-yellow-600' : 'text-red-600';
              const iconBg = isGood ? 'bg-green-100 border-green-200' : isModerate ? 'bg-yellow-100 border-yellow-200' : 'bg-red-100 border-red-200';
              const iconColor = isGood ? 'text-green-700' : isModerate ? 'text-yellow-700' : 'text-red-700';
              return (
                <div
                  key={label}
                  ref={kpiTooltipOpen === label ? kpiTooltipRef : undefined}
                  className={`rounded-xl border p-3 flex items-stretch gap-2 hover:shadow-md transition-shadow text-left min-h-[80px] relative ${cardBg}`}
                >
                  <div className={`w-7 h-7 rounded-lg border shrink-0 flex items-center justify-center self-start ${iconBg}`}>
                    <Icon className={iconColor} size={14} />
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
                    <div className="h-[2.5rem] flex items-start gap-1.5 shrink-0">
                      <p className={`text-[11px] font-black uppercase tracking-widest leading-tight line-clamp-2 break-words flex-1 min-w-0 ${labelColor}`}>
                        {label}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setKpiTooltipOpen((prev) => (prev === label ? null : label));
                        }}
                        className="shrink-0 p-0.5 rounded-full border-0 bg-transparent cursor-pointer text-inherit hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 mt-0.5"
                        aria-label={`Formula: ${formula}`}
                        aria-expanded={kpiTooltipOpen === label}
                      >
                        <Info className={detailColor} size={10} />
                      </button>
                    </div>
                    <p className={`text-xl font-black leading-none mt-1 ${valueColor}`}>{label.includes('EMS Score') ? value : `${value}%`}</p>
                  </div>
                  {kpiTooltipOpen === label && (
                    <div
                      className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-xs font-medium text-white shadow-lg"
                      role="tooltip"
                      id={`kpi-formula-${label.replace(/\s+/g, '-')}`}
                    >
                      <span className="absolute left-5 -top-1.5 h-0 w-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-slate-700" aria-hidden />
                      <span className="block text-slate-100">{formula}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
          ) : (
            <div className="col-span-full text-center py-8 text-slate-500">No EMS data. Adjust filters or refresh.</div>
          )}
        </div>
      </div>

      {/* Group By - below EMS Totals, right-aligned, standard dropdown */}
      <div className="flex items-center justify-end gap-2">
        <label className="text-xs font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Group By</label>
        <StyledSelect
          value={groupBy}
          onChange={(v) => setGroupBy(v as EmsReportGroupBy)}
          options={GROUP_BY_OPTIONS}
          placeholder="Group by"
          className="min-w-[200px]"
        />
      </div>

      {/* Quadrants 1 & 2: Mobile + Hygiene side by side (50% each); row 2: Meeting Validity below Mobile (respects filters) */}
      {totals && (
        <div className="grid grid-cols-2 gap-4 w-full">
        {/* Mobile No. Validity – 1st quadrant */}
        {totals.totalAttempted > 0 && (
        <div className="w-full min-w-0 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-black text-slate-900">Mobile No. Validity – Breakdown</h3>
            <p className="text-xs text-slate-500 mt-1">
              Formula: Mobile No. Validity = (Total Attempted − Invalid) ÷ Total Attempted × 100 ={' '}
              <span className="font-semibold text-slate-700">
                ({totals.totalAttempted} − {totals.invalidCount}) ÷ {totals.totalAttempted} × 100 = {totals.mobileValidityPct}%
              </span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Only <strong className="text-red-600">Invalid</strong> (Invalid / Invalid Number) reduces validity; Connected, Disconnected, No Answer, and Incoming N/A count as valid numbers.
            </p>
          </div>
          <div className="p-6">
            {(() => {
              const outcomeRows = [
                { label: 'Connected', count: totals.totalConnected, key: 'Connected' },
                { label: 'Disconnected', count: totals.disconnectedCount, key: 'Disconnected' },
                { label: 'No Answer', count: totals.noAnswerCount, key: 'NoAnswer' },
                { label: 'Incoming N/A', count: totals.incomingNACount, key: 'IncomingNA' },
                { label: 'Invalid', count: totals.invalidCount, key: 'Invalid', isInvalid: true },
              ];
              const outcomeColors: Record<string, string> = {
                Connected: '#cbd5e1',
                Disconnected: '#94a3b8',
                NoAnswer: '#64748b',
                IncomingNA: '#475569',
                Invalid: '#ef4444',
              };
              return (
                <>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">By call outcome</p>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[7rem]">Call status</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-14">Count</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-20">%</th>
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[120px]">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100 align-middle">
                          <td className="py-1.5 px-2 text-slate-700 font-medium">Total Attempted</td>
                          <td colSpan={3} className="py-1.5 px-2 align-middle">
                            <div className="w-full" style={{ height: 36 }}>
                              <ResponsiveContainer width="100%" height={36}>
                                <BarChart
                                  data={[
                                    {
                                      name: 'Total Attempted',
                                      Connected: totals.totalConnected,
                                      Disconnected: totals.disconnectedCount,
                                      NoAnswer: totals.noAnswerCount,
                                      IncomingNA: totals.incomingNACount,
                                      Invalid: totals.invalidCount,
                                    },
                                  ]}
                                  layout="vertical"
                                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                                  barSize={20}
                                  barCategoryGap={4}
                                >
                                  <XAxis type="number" domain={[0, totals.totalAttempted]} hide />
                                  <YAxis type="category" dataKey="name" width={0} tick={false} />
                                  <Tooltip
                                    formatter={(value: number, name: string) => [value, name]}
                                    contentStyle={{ fontSize: 12 }}
                                    labelFormatter={() => 'Total Attempted'}
                                  />
                                  <Bar dataKey="Connected" stackId="a" name="Connected" fill={outcomeColors.Connected} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="Connected" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#0f172a" />
                                  </Bar>
                                  <Bar dataKey="Disconnected" stackId="a" name="Disconnected" fill={outcomeColors.Disconnected} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="Disconnected" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="NoAnswer" stackId="a" name="No Answer" fill={outcomeColors.NoAnswer} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="NoAnswer" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="IncomingNA" stackId="a" name="Incoming N/A" fill={outcomeColors.IncomingNA} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="IncomingNA" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="Invalid" stackId="a" name="Invalid (reduces validity)" fill={outcomeColors.Invalid} radius={[0, 4, 4, 0]} isAnimationActive>
                                    <LabelList dataKey="Invalid" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </td>
                        </tr>
                        {outcomeRows.map((row) => {
                          const pct = totals.totalAttempted > 0 ? (row.count / totals.totalAttempted) * 100 : 0;
                          const pctRounded = Math.round(pct);
                          const barColor = outcomeColors[row.key];
                          return (
                            <tr
                              key={row.label}
                              className={`border-b border-slate-100 ${(row as { isInvalid?: boolean }).isInvalid ? 'bg-red-50 font-medium text-red-800' : 'text-slate-700'}`}
                            >
                              <td className="py-1.5 px-2">{(row as { isInvalid?: boolean }).isInvalid ? 'Invalid' : row.label}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{row.count}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{pctRounded}%</td>
                              <td className="py-1.5 px-2">
                                <div className="h-5 min-w-[80px] max-w-[180px] rounded-md bg-slate-100 border border-slate-200 overflow-hidden">
                                  <div
                                    className="h-full rounded-md min-w-0"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        )}

        {/* Hygiene – 2nd quadrant */}
        {totals.totalConnected > 0 && (
        <div className="w-full min-w-0 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-black text-slate-900">Hygiene – Breakdown</h3>
            <p className="text-xs text-slate-500 mt-1">
              Formula: Hygiene = (Connected − Identity Wrong − Not a Farmer) ÷ Connected × 100 ={' '}
              <span className="font-semibold text-slate-700">
                ({totals.totalConnected} − {totals.identityWrongCount} − {totals.notAFarmerCount}) ÷ {totals.totalConnected} × 100 = {totals.hygienePct}%
              </span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Only <strong className="text-red-600">Identity Wrong</strong> and <strong className="text-red-600">Not a Farmer</strong> reduce hygiene; Yes attended, No missed, and Don&apos;t recall count as valid identity.
            </p>
          </div>
          <div className="p-6">
            {(() => {
              const statusRows = [
                { label: 'Yes, I attended', count: totals.yesAttendedCount, key: 'YesAttended' },
                { label: 'No, I missed', count: totals.noMissedCount, key: 'NoMissed' },
                { label: "Don't recall", count: totals.dontRecallCount, key: 'DontRecall' },
                { label: 'Identity Wrong', count: totals.identityWrongCount, key: 'IdentityWrong', reducesHygiene: true },
                { label: 'Not a Farmer', count: totals.notAFarmerCount, key: 'NotAFarmer', reducesHygiene: true },
              ];
              const statusColors: Record<string, string> = {
                YesAttended: '#cbd5e1',
                NoMissed: '#94a3b8',
                DontRecall: '#64748b',
                IdentityWrong: '#ef4444',
                NotAFarmer: '#ef4444',
              };
              return (
                <>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">By status (did attend)</p>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[7rem]">Status</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-14">Count</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-20">%</th>
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[120px]">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100 align-middle">
                          <td className="py-1.5 px-2 text-slate-700 font-medium">Total Connected</td>
                          <td colSpan={3} className="py-1.5 px-2 align-middle">
                            <div className="w-full" style={{ height: 36 }}>
                              <ResponsiveContainer width="100%" height={36}>
                                <BarChart
                                  data={[
                                    {
                                      name: 'Total Connected',
                                      YesAttended: totals.yesAttendedCount,
                                      NoMissed: totals.noMissedCount,
                                      DontRecall: totals.dontRecallCount,
                                      IdentityWrong: totals.identityWrongCount,
                                      NotAFarmer: totals.notAFarmerCount,
                                    },
                                  ]}
                                  layout="vertical"
                                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                                  barSize={20}
                                  barCategoryGap={4}
                                >
                                  <XAxis type="number" domain={[0, totals.totalConnected]} hide />
                                  <YAxis type="category" dataKey="name" width={0} tick={false} />
                                  <Tooltip
                                    formatter={(value: number, name: string) => [value, name]}
                                    contentStyle={{ fontSize: 12 }}
                                    labelFormatter={() => 'Total Connected'}
                                  />
                                  <Bar dataKey="YesAttended" stackId="b" name="Yes, I attended" fill={statusColors.YesAttended} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="YesAttended" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#0f172a" />
                                  </Bar>
                                  <Bar dataKey="NoMissed" stackId="b" name="No, I missed" fill={statusColors.NoMissed} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="NoMissed" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="DontRecall" stackId="b" name="Don't recall" fill={statusColors.DontRecall} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="DontRecall" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="IdentityWrong" stackId="b" name="Identity Wrong" fill={statusColors.IdentityWrong} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="IdentityWrong" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                  <Bar dataKey="NotAFarmer" stackId="b" name="Not a Farmer" fill={statusColors.NotAFarmer} radius={[0, 4, 4, 0]} isAnimationActive>
                                    <LabelList dataKey="NotAFarmer" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </td>
                        </tr>
                        {statusRows.map((row) => {
                          const pct = totals.totalConnected > 0 ? (row.count / totals.totalConnected) * 100 : 0;
                          const pctRounded = Math.round(pct);
                          const barColor = statusColors[row.key];
                          const reducesHygiene = (row as { reducesHygiene?: boolean }).reducesHygiene;
                          return (
                            <tr
                              key={row.label}
                              className={`border-b border-slate-100 ${reducesHygiene ? 'bg-red-50 font-medium text-red-800' : 'text-slate-700'}`}
                            >
                              <td className="py-1.5 px-2">{row.label}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{row.count}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{pctRounded}%</td>
                              <td className="py-1.5 px-2">
                                <div className="h-5 min-w-[80px] max-w-[180px] rounded-md bg-slate-100 border border-slate-200 overflow-hidden">
                                  <div
                                    className="h-full rounded-md min-w-0"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        )}

        {/* Meeting Validity – Breakdown: below Mobile (row 2, col 1), donut + table, respects filters */}
        {totals.totalConnected > 0 && (
        <div className="w-full min-w-0 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-black text-slate-900">Meeting Validity – Breakdown</h3>
            <p className="text-xs text-slate-500 mt-1">
              Formula: Meeting Validity = (Yes attended ÷ Connected) × 100 ={' '}
              <span className="font-semibold text-slate-700">
                {totals.yesAttendedCount} ÷ {totals.totalConnected} × 100 = {totals.meetingValidityPct}%
              </span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Only <strong className="text-green-600">Yes, I attended</strong> counts toward Meeting Validity; No missed, Don&apos;t recall, Identity Wrong, and Not a Farmer lower the %.
            </p>
          </div>
          <div className="p-6">
            {(() => {
              const statusRows = [
                { label: 'Yes, I attended', count: totals.yesAttendedCount, key: 'YesAttended', countsForValidity: true },
                { label: 'No, I missed', count: totals.noMissedCount, key: 'NoMissed' },
                { label: "Don't recall", count: totals.dontRecallCount, key: 'DontRecall' },
                { label: 'Identity Wrong', count: totals.identityWrongCount, key: 'IdentityWrong' },
                { label: 'Not a Farmer', count: totals.notAFarmerCount, key: 'NotAFarmer' },
              ];
              const statusColors: Record<string, string> = {
                YesAttended: '#22c55e',
                NoMissed: '#94a3b8',
                DontRecall: '#64748b',
                IdentityWrong: '#475569',
                NotAFarmer: '#ef4444',
              };
              const donutData = statusRows.map((r) => ({ name: r.label, value: r.count, key: r.key }));
              return (
                <>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">By status (did attend)</p>
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="relative w-full sm:w-[260px] h-[260px] shrink-0 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart margin={{ top: 28, right: 28, bottom: 28, left: 28 }}>
                          <Pie
                            data={donutData.filter((d) => d.value > 0)}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={52}
                            outerRadius={78}
                            paddingAngle={1}
                            stroke="white"
                            strokeWidth={1}
                            label={({ name, percent, x, y }) => {
                              if (percent < 0.03) return null;
                              const cx = 130;
                              const cy = 130;
                              const dx = x - cx;
                              const dy = y - cy;
                              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                              const push = 22;
                              const outX = cx + (dx / dist) * (dist + push);
                              const outY = cy + (dy / dist) * (dist + push);
                              return (
                                <text x={outX} y={outY} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#334155">
                                  {name}: {(percent * 100).toFixed(0)}%
                                </text>
                              );
                            }}
                            labelLine={{ strokeWidth: 1, stroke: '#94a3b8' }}
                          >
                            {donutData.filter((d) => d.value > 0).map((d) => (
                              <Cell key={d.key} fill={statusColors[d.key]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [value, name]}
                            contentStyle={{ fontSize: 11, padding: '6px 8px' }}
                            itemStyle={{ fontSize: 11 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-2xl font-black text-slate-700">{totals.meetingValidityPct}%</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto flex-1 min-w-0">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[7rem]">Status</th>
                            <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-14">Count</th>
                            <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-20">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statusRows.map((row) => {
                            const pct = totals.totalConnected > 0 ? (row.count / totals.totalConnected) * 100 : 0;
                            const pctRounded = Math.round(pct);
                            const countsForValidity = (row as { countsForValidity?: boolean }).countsForValidity;
                            return (
                              <tr
                                key={row.label}
                                className={`border-b border-slate-100 ${countsForValidity ? 'bg-green-50 font-medium text-green-800' : 'text-slate-700'}`}
                              >
                                <td className="py-1.5 px-2">{row.label}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums">{row.count}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums">{pctRounded}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        )}

        {/* Meeting Conversion – Breakdown: row 2, col 2 (same template as Mobile No. Validity) */}
        {totals.totalConnected > 0 && (
        <div className="w-full min-w-0 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-black text-slate-900">Meeting Conversion – Breakdown</h3>
            <p className="text-xs text-slate-500 mt-1">
              Formula: Meeting Conversion = (Purchased ÷ Connected) × 100 ={' '}
              <span className="font-semibold text-slate-700">
                {totals.purchasedCount} ÷ {totals.totalConnected} × 100 = {totals.meetingConversionPct}%
              </span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Only <strong className="text-green-600">Purchased</strong> (hasPurchased = Yes) counts toward Meeting Conversion; <strong className="text-slate-600">Not Purchased</strong> (No) does not.
            </p>
          </div>
          <div className="p-6">
            {(() => {
              const notPurchased = totals.notPurchasedCount ?? totals.totalConnected - totals.purchasedCount;
              const statusRows = [
                { label: 'Purchased', count: totals.purchasedCount, key: 'Purchased' },
                { label: 'Not Purchased', count: notPurchased, key: 'NotPurchased' },
              ];
              const statusColors: Record<string, string> = {
                Purchased: '#22c55e',
                NotPurchased: '#94a3b8',
              };
              return (
                <>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">By purchase status</p>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[7rem]">Status</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-14">Count</th>
                          <th className="text-right py-1.5 px-2 font-semibold text-slate-700 w-20">%</th>
                          <th className="text-left py-1.5 px-2 font-semibold text-slate-700 min-w-[120px]">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100 align-middle">
                          <td className="py-1.5 px-2 text-slate-700 font-medium">Connected</td>
                          <td colSpan={3} className="py-1.5 px-2 align-middle">
                            <div className="w-full" style={{ height: 36 }}>
                              <ResponsiveContainer width="100%" height={36}>
                                <BarChart
                                  data={[
                                    {
                                      name: 'Connected',
                                      Purchased: totals.purchasedCount,
                                      NotPurchased: notPurchased,
                                    },
                                  ]}
                                  layout="vertical"
                                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                                  barSize={20}
                                  barCategoryGap={4}
                                >
                                  <XAxis type="number" domain={[0, totals.totalConnected]} hide />
                                  <YAxis type="category" dataKey="name" width={0} tick={false} />
                                  <Tooltip
                                    formatter={(value: number, name: string) => [value, name]}
                                    contentStyle={{ fontSize: 12 }}
                                    labelFormatter={() => 'Connected'}
                                  />
                                  <Bar dataKey="Purchased" stackId="a" name="Purchased" fill={statusColors.Purchased} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="Purchased" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#0f172a" />
                                  </Bar>
                                  <Bar dataKey="NotPurchased" stackId="a" name="Not Purchased" fill={statusColors.NotPurchased} radius={[0, 4, 4, 0]} isAnimationActive>
                                    <LabelList dataKey="NotPurchased" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#fff" />
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </td>
                        </tr>
                        {statusRows.map((row) => {
                          const pct = totals.totalConnected > 0 ? (row.count / totals.totalConnected) * 100 : 0;
                          const pctRounded = Math.round(pct);
                          const barColor = statusColors[row.key];
                          return (
                            <tr
                              key={row.label}
                              className={`border-b border-slate-100 ${row.key === 'Purchased' ? 'bg-green-50 font-medium text-green-800' : 'text-slate-700'}`}
                            >
                              <td className="py-1.5 px-2">{row.label}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{row.count}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums">{pctRounded}%</td>
                              <td className="py-1.5 px-2">
                                <div className="h-5 min-w-[80px] max-w-[180px] rounded-md bg-slate-100 border border-slate-200 overflow-hidden">
                                  <div
                                    className="h-full rounded-md min-w-0"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        )}
        </div>
      )}

      {/* Conversion & Intent: bar chart + scatter */}
      {emsDetailRows.length > 0 && totals && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-black text-slate-900">Conversion & Intent</h3>
          </div>
          <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Per group: Purchased, Willing Yes, Yes+Purchased, Purchase Intention %</p>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={emsDetailRows.map((r) => ({
                  name: (r.groupLabel || r.groupKey).slice(0, 14),
                  purchased: r.purchasedCount,
                  willingYes: r.willingYesCount,
                  yesPlusPurchased: (r as EmsReportSummaryRow).yesPlusPurchasedCount ?? r.willingYesCount + r.purchasedCount,
                  purchaseIntentionPct: r.purchaseIntentionPct,
                }))} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="purchased" name="Purchased" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="willingYes" name="Willing Yes" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="yesPlusPurchased" name="Yes+Purchased" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="purchaseIntentionPct" name="Purchase Intention %" stroke="#eab308" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Meeting Validity % vs Meeting Conversion % (bubble = Connected); ref = Totals</p>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" dataKey="meetingValidityPct" name="Meeting Validity %" domain={[0, 100]} />
                  <YAxis type="number" dataKey="meetingConversionPct" name="Meeting Conversion %" domain={[0, 100]} />
                  <ZAxis type="number" dataKey="totalConnected" range={[80, 400]} name="Connected" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <ReferenceLine x={totals.meetingValidityPct} stroke="#64748b" strokeDasharray="4 4" label="Totals MV" />
                  <ReferenceLine y={totals.meetingConversionPct} stroke="#64748b" strokeDasharray="4 4" label="Totals MC" />
                  <Scatter name="Groups" data={emsDetailRows.map((r) => ({
                    meetingValidityPct: r.meetingValidityPct,
                    meetingConversionPct: r.meetingConversionPct,
                    totalConnected: r.totalConnected,
                    name: r.groupLabel || r.groupKey,
                    emsScore: r.emsScore,
                  }))} fill="#22c55e">
                    {emsDetailRows.map((r, i) => (
                      <Cell key={i} fill={r.emsScore >= 70 ? '#22c55e' : r.emsScore >= 50 ? '#f59e0b' : '#ef4444'} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Trends View (Totals): Daily / Weekly / Monthly – EMS Score, Meeting Validity %, Meeting Conversion %, Purchase Intention % */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-slate-600" size={20} />
            <h3 className="text-lg font-black text-slate-900">Trends (Totals)</h3>
          </div>
          <div className="flex items-center gap-2">
            {TREND_BUCKET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTrendBucket(opt.value)}
                className={`px-3 py-1.5 rounded-xl text-sm font-bold transition-colors border ${
                  trendBucket === opt.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-6">
          {isLoadingEmsTrends ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-slate-500" size={28} />
            </div>
          ) : emsTrends.length === 0 ? (
            <p className="text-center py-8 text-slate-500 text-sm">No trend data for current filters. Complete some calls in the date range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={emsTrends} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => (value != null ? `${value}%` : '')} />
                <Legend />
                <Line type="monotone" dataKey="emsScore" name="EMS Score" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="meetingValidityPct" name="Meeting Validity %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="meetingConversionPct" name="Meeting Conversion %" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="purchaseIntentionPct" name="Purchase Intention %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="cropSolutionsFocusPct" name="Crop Solutions Focus %" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Performance Table (Group vs Totals) – sortable, filterable, row click = drill down */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <MessageCircle className="text-slate-600" size={20} />
            <h3 className="text-lg font-black text-slate-900">Performance Table (Group vs Totals)</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by group name..."
              value={tableFilterText}
              onChange={(e) => setTableFilterText(e.target.value)}
              className="min-w-[180px] px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoadingEmsDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-slate-500" size={28} />
            </div>
          ) : tableRows.length === 0 ? (
            <p className="text-center py-12 text-slate-500 text-sm">No EMS detail for current filters. Apply filters and ensure completed calls exist.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-slate-600 font-medium">
                  <th className="px-4 py-3 cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('groupLabel')}>Group Name {tableSortKey === 'groupLabel' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('totalAttempted')}>Total Calls {tableSortKey === 'totalAttempted' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('totalConnected')}>Connected {tableSortKey === 'totalConnected' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('meetingValidityPct')}>Meeting Validity % {tableSortKey === 'meetingValidityPct' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('meetingConversionPct')}>Meeting Conversion % {tableSortKey === 'meetingConversionPct' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('purchaseIntentionPct')}>Purchase Intention % {tableSortKey === 'purchaseIntentionPct' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('cropSolutionsFocusPct')}>Crop Solutions Focus % {tableSortKey === 'cropSolutionsFocusPct' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => toggleSort('emsScore')}>EMS Score {tableSortKey === 'emsScore' && (tableSortDir === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-4 py-3 max-w-[200px]">Relative remarks</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr
                    key={row.groupKey}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => { setDrillDownGroupKey(row.groupKey); setDrillDownLabel(row.groupLabel || row.groupKey); }}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{row.groupLabel || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.totalAttempted}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.totalConnected}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.meetingValidityPct}%</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.meetingConversionPct}%</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.purchaseIntentionPct}%</td>
                    <td className="px-4 py-3 text-right text-slate-700">{(row as EmsReportSummaryRow & { cropSolutionsFocusPct?: number }).cropSolutionsFocusPct ?? 0}%</td>
                    <td className="px-4 py-3 text-right">
                      <span className={row.emsScore >= 70 ? 'text-green-800 font-bold' : row.emsScore >= 50 ? 'text-amber-800 font-bold' : 'text-slate-700'}>
                        {row.emsScore}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs max-w-[200px] truncate" title={row.relativeRemarks}>{row.relativeRemarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        For a detailed activity list with the same filters, use the <strong>Activity Monitoring</strong> tab. Use <strong>EMS report</strong> to export by FDA, Territory, Region, Zone, BU, or TM. Click a row in the Performance Table to drill down to call-level details.
      </p>

      {/* Drill-down: Call-Level View modal */}
      {drillDownGroupKey != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDrillDownGroupKey(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-[95vw] w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
              <h3 className="text-lg font-black text-slate-900">Call-level view: {drillDownLabel}</h3>
              <button type="button" onClick={() => setDrillDownGroupKey(null)} className="p-2 rounded-lg hover:bg-slate-200 text-slate-600" aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-4">
              {isLoadingLine ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-slate-500" size={28} />
                </div>
              ) : lineRows.length === 0 ? (
                <p className="text-center py-8 text-slate-500 text-sm">No call-level data for this group.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-slate-600 font-medium">
                      <th className="px-3 py-2">Farmer Name</th>
                      <th className="px-3 py-2">Farmer Mobile</th>
                      <th className="px-3 py-2">Officer (FDA)</th>
                      <th className="px-3 py-2">TM</th>
                      <th className="px-3 py-2">Territory</th>
                      <th className="px-3 py-2 text-center">Connected</th>
                      <th className="px-3 py-2 text-right">Mobile Validity %</th>
                      <th className="px-3 py-2 text-right">Hygiene %</th>
                      <th className="px-3 py-2 text-right">Meeting Validity %</th>
                      <th className="px-3 py-2 text-right">Meeting Conversion %</th>
                      <th className="px-3 py-2 text-right">Purchase Intention %</th>
                      <th className="px-3 py-2 text-right">Crop Solutions Focus %</th>
                      <th className="px-3 py-2 text-right">EMS Score</th>
                      <th className="px-3 py-2 max-w-[180px]">Relative Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineRows.map((r) => (
                      <tr key={r.taskId} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{r.farmerName || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.farmerMobile || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.officerName || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.tmName || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.territoryName || '—'}</td>
                        <td className="px-3 py-2 text-center">{r.connected}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{r.mobileValidityPct}%</td>
                        <td className="px-3 py-2 text-right text-slate-700">{r.hygienePct}%</td>
                        <td className="px-3 py-2 text-right text-slate-700">{Math.round(r.meetingValidityPct)}%</td>
                        <td className="px-3 py-2 text-right text-slate-700">{Math.round(r.meetingConversionPct)}%</td>
                        <td className="px-3 py-2 text-right text-slate-700">{Math.round(r.purchaseIntentionPct)}%</td>
                        <td className="px-3 py-2 text-right text-slate-700">{Math.round(r.cropSolutionsFocusPct ?? 0)}%</td>
                        <td className="px-3 py-2 text-right">
                          <span className={r.emsScore >= 70 ? 'text-green-800 font-bold' : r.emsScore >= 50 ? 'text-amber-800 font-bold' : 'text-slate-700'}>{r.emsScore}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-600 text-xs max-w-[180px] truncate" title={r.relativeRemarks}>{r.relativeRemarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EMS Report download modal */}
      {showEmsReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowEmsReportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-4">Download EMS report</h3>
            <p className="text-sm text-slate-500 mb-4">Choose how to group the report. Current date range and filters will be applied.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Group by</label>
                <StyledSelect
                  value={emsReportGroupBy}
                  onChange={(v) => setEmsReportGroupBy(v as EmsReportGroupBy)}
                  options={EMS_REPORT_GROUP_BY_OPTIONS}
                  placeholder="Select"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Report level</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="emsLevel"
                      checked={emsReportLevel === 'summary'}
                      onChange={() => setEmsReportLevel('summary')}
                      className="text-lime-600 focus:ring-lime-500"
                    />
                    <span className="text-sm text-slate-700">Summary (one row per group)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="emsLevel"
                      checked={emsReportLevel === 'line'}
                      onChange={() => setEmsReportLevel('line')}
                      className="text-lime-600 focus:ring-lime-500"
                    />
                    <span className="text-sm text-slate-700">Line level (one row per call)</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
              <Button variant="secondary" size="sm" onClick={() => setShowEmsReportModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleEmsReportDownload} disabled={isExporting} className="flex items-center gap-2">
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Download
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityEmsProgressView;
