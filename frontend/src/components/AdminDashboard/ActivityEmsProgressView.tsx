import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  kpiAPI,
  reportsAPI,
  type EmsProgressFilters,
  type EmsReportGroupBy,
  type EmsReportSummaryRow,
  type EmsReportLineRow,
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
  Cell,
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
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import Button from '../shared/Button';
import StyledSelect from '../shared/StyledSelect';
import { type DateRangePreset, getPresetRange, formatPretty, toISODateLocal } from '../../utils/dateRangeUtils';
import { COMMON_DATE_RANGE_PRESETS, loadJsonStorage, parseBoolean, parseIsoDate, parsePreset, parseString, saveJsonStorage } from '../../utils/filterPersistence';
import {
  buildPerformanceHierarchy,
  collectBuNodeIds,
  collectPerformanceNodeIds,
  filterPerformanceTree,
  flattenVisiblePerformanceTree,
  performanceLevelLabel,
} from '../../utils/emsPerformanceHierarchy';

/** Totals row derived from EMS summary rows (same formulas as backend) */
export type EmsTotals = {
  totalAttempted: number;
  totalConnected: number;
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
  { value: 'fda', label: 'By MDO' },
  { value: 'territory', label: 'By Territory' },
  { value: 'region', label: 'By Region' },
  { value: 'zone', label: 'By Zone' },
  { value: 'bu', label: 'By BU' },
  { value: 'tm', label: 'By TM' },
];

const GROUP_BY_OPTIONS: { value: EmsReportGroupBy; label: string }[] = [
  { value: 'tm', label: 'TM' },
  { value: 'fda', label: 'MDO' },
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

const EMS_PROGRESS_FILTERS_KEY = 'admin.emsProgress.filters';
type FilterDimensionKey = keyof Pick<EmsProgressFilters, 'state' | 'territory' | 'zone' | 'bu' | 'activityType'> | 'region';
const FILTER_DIMENSION_VALUES: FilterDimensionKey[] = ['state', 'territory', 'zone', 'bu', 'activityType', 'region'];
const EMS_GROUP_BY_VALUES: EmsReportGroupBy[] = ['fda', 'territory', 'region', 'zone', 'bu', 'tm'];

type SavedEmsProgressFilters = {
  dateFrom: string;
  dateTo: string;
  state: string;
  territory: string;
  zone: string;
  bu: string;
  activityType: string;
  selectedPreset: DateRangePreset;
  showFilters: boolean;
  filterDimension: FilterDimensionKey;
  groupBy: EmsReportGroupBy;
};

function loadSavedEmsProgressFilters(): SavedEmsProgressFilters {
  const defaultRange = getDefaultDateRange();
  return loadJsonStorage(
    EMS_PROGRESS_FILTERS_KEY,
    () => ({
      ...defaultRange,
      state: '',
      territory: '',
      zone: '',
      bu: '',
      activityType: '',
      selectedPreset: 'Last 30 days' as DateRangePreset,
      showFilters: false,
      filterDimension: 'state' as FilterDimensionKey,
      groupBy: 'fda' as EmsReportGroupBy,
    }),
    (parsed, defaults) => {
      const p = parsed as Record<string, unknown>;
      return {
        dateFrom: parseIsoDate(p.dateFrom, defaults.dateFrom),
        dateTo: parseIsoDate(p.dateTo, defaults.dateTo),
        state: parseString(p.state, defaults.state),
        territory: parseString(p.territory, defaults.territory),
        zone: parseString(p.zone, defaults.zone),
        bu: parseString(p.bu, defaults.bu),
        activityType: parseString(p.activityType, defaults.activityType),
        selectedPreset: parsePreset(p.selectedPreset, defaults.selectedPreset, COMMON_DATE_RANGE_PRESETS),
        showFilters: parseBoolean(p.showFilters, defaults.showFilters),
        filterDimension: (FILTER_DIMENSION_VALUES as readonly string[]).includes(p.filterDimension as string)
          ? (p.filterDimension as FilterDimensionKey)
          : defaults.filterDimension,
        groupBy: (EMS_GROUP_BY_VALUES as readonly string[]).includes(p.groupBy as string)
          ? (p.groupBy as EmsReportGroupBy)
          : defaults.groupBy,
      };
    }
  );
}

function computeEmsTotals(rows: EmsReportSummaryRow[]): EmsTotals | null {
  if (!rows.length) return null;
  let totalAttempted = 0, totalConnected = 0, connectedIntakePendingCount = 0, disconnectedCount = 0, incomingNACount = 0, invalidCount = 0, noAnswerCount = 0;
  let identityWrongCount = 0, dontRecallCount = 0, noMissedCount = 0, notAFarmerCount = 0, yesAttendedCount = 0;
  let notPurchasedCount = 0, purchasedCount = 0, willingMaybeCount = 0, willingNoCount = 0, willingYesCount = 0, yesPlusPurchasedCount = 0;
  let activityQualitySum = 0, activityQualityCount = 0;
  for (const r of rows) {
    totalAttempted += r.totalAttempted;
    totalConnected += r.totalConnected;
    connectedIntakePendingCount += r.connectedIntakePendingCount ?? 0;
    invalidCount += r.invalidCount;
    identityWrongCount += r.identityWrongCount ?? 0;
    activityQualitySum += r.activityQualitySum ?? 0;
    activityQualityCount += r.activityQualityCount ?? 0;
    notAFarmerCount += r.notAFarmerCount;
    yesAttendedCount += r.yesAttendedCount;
    purchasedCount += r.purchasedCount;
    willingYesCount += r.willingYesCount;
    disconnectedCount += r.disconnectedCount ?? 0;
    incomingNACount += r.incomingNACount ?? 0;
    noAnswerCount += r.noAnswerCount ?? 0;
    dontRecallCount += r.dontRecallCount ?? 0;
    noMissedCount += r.noMissedCount ?? 0;
    notPurchasedCount += r.notPurchasedCount ?? 0;
    willingMaybeCount += r.willingMaybeCount ?? 0;
    willingNoCount += r.willingNoCount ?? 0;
    yesPlusPurchasedCount += r.yesPlusPurchasedCount ?? r.willingYesCount + r.purchasedCount;
  }
  const mobileValidityPct = totalAttempted > 0 ? Math.round(((totalAttempted - invalidCount) / totalAttempted) * 100) : 0;
  const hygienePct = totalConnected > 0 ? Math.round(((totalConnected - identityWrongCount - notAFarmerCount) / totalConnected) * 100) : 0;
  const meetingValidityPct = totalConnected > 0 ? Math.round((yesAttendedCount / totalConnected) * 100) : 0;
  const meetingConversionPct = totalConnected > 0 ? Math.round((purchasedCount / totalConnected) * 100) : 0;
  const purchaseIntentionDenominator = yesPlusPurchasedCount + willingNoCount;
  const purchaseIntentionPct =
    purchaseIntentionDenominator > 0
      ? Math.round((yesPlusPurchasedCount / purchaseIntentionDenominator) * 100)
      : 0;
  // Snapshot formula: Total CS Score / Max CS Score. Max CS Score = totalAttempted × 5
  const cropSolutionsFocusPct =
    totalAttempted > 0 ? Math.round((activityQualitySum / (totalAttempted * 5)) * 100) : 0;
  // EMS Score = 25% Meeting Conversion + 25% Purchase Intention + 50% Crop Solutions Focus (Meeting Validity & Hygiene not included)
  const emsScore = Math.round(
    0.25 * meetingConversionPct + 0.25 * purchaseIntentionPct + 0.5 * cropSolutionsFocusPct
  );
  const validIdentity = totalConnected - identityWrongCount - notAFarmerCount;
  return {
    totalAttempted, totalConnected, connectedIntakePendingCount, disconnectedCount, incomingNACount, invalidCount, noAnswerCount,
    identityWrongCount, dontRecallCount, noMissedCount, notAFarmerCount, yesAttendedCount,
    notPurchasedCount, purchasedCount, willingMaybeCount, willingNoCount, willingYesCount, yesPlusPurchasedCount,
    mobileValidityPct, hygienePct, meetingValidityPct, meetingConversionPct, purchaseIntentionPct, cropSolutionsFocusPct, emsScore, validIdentity,
  };
}

const ActivityEmsProgressView: React.FC = () => {
  const { showError, showSuccess } = useToast();
  const initialEmsFilters = useMemo(() => loadSavedEmsProgressFilters(), []);
  const [emsDetailRows, setEmsDetailRows] = useState<EmsReportSummaryRow[]>([]);
  const [emsMdoRows, setEmsMdoRows] = useState<EmsReportSummaryRow[]>([]);
  const [groupBy, setGroupBy] = useState<EmsReportGroupBy>(() => initialEmsFilters.groupBy);
  const [isLoadingEmsDetail, setIsLoadingEmsDetail] = useState(false);
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
  const [showFilters, setShowFilters] = useState(() => initialEmsFilters.showFilters);
  const [filters, setFilters] = useState<EmsProgressFilters>(() => ({
    dateFrom: initialEmsFilters.dateFrom,
    dateTo: initialEmsFilters.dateTo,
    state: initialEmsFilters.state,
    territory: initialEmsFilters.territory,
    zone: initialEmsFilters.zone,
    bu: initialEmsFilters.bu,
    activityType: initialEmsFilters.activityType,
  }));
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>(() => initialEmsFilters.selectedPreset);
  const [draftStart, setDraftStart] = useState(() => initialEmsFilters.dateFrom);
  const [draftEnd, setDraftEnd] = useState(() => initialEmsFilters.dateTo);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [drillDownGroupKey, setDrillDownGroupKey] = useState<string | null>(null);
  const [drillDownLabel, setDrillDownLabel] = useState<string>('');
  const [lineRows, setLineRows] = useState<EmsReportLineRow[]>([]);
  const [isLoadingLine, setIsLoadingLine] = useState(false);
  const [tableFilterText, setTableFilterText] = useState<string>('');
  const [expandedPerformanceNodes, setExpandedPerformanceNodes] = useState<Set<string>>(() => new Set());
  const [filterDimension, setFilterDimension] = useState<FilterDimensionKey>(() => initialEmsFilters.filterDimension);
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

  const performanceHierarchy = useMemo(
    () => buildPerformanceHierarchy(emsMdoRows),
    [emsMdoRows]
  );

  const filteredPerformanceHierarchy = useMemo(
    () => filterPerformanceTree(performanceHierarchy, tableFilterText),
    [performanceHierarchy, tableFilterText]
  );

  const visiblePerformanceRows = useMemo(
    () => flattenVisiblePerformanceTree(filteredPerformanceHierarchy, expandedPerformanceNodes),
    [filteredPerformanceHierarchy, expandedPerformanceNodes]
  );

  useEffect(() => {
    if (!performanceHierarchy.length) return;
    setExpandedPerformanceNodes((prev) => {
      if (prev.size > 0) return prev;
      return new Set(collectBuNodeIds(performanceHierarchy));
    });
  }, [performanceHierarchy]);

  useEffect(() => {
    if (!tableFilterText.trim()) return;
    setExpandedPerformanceNodes(new Set(collectPerformanceNodeIds(filteredPerformanceHierarchy)));
  }, [tableFilterText, filteredPerformanceHierarchy]);

  const togglePerformanceNode = (nodeId: string) => {
    setExpandedPerformanceNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const expandAllPerformanceNodes = () => {
    setExpandedPerformanceNodes(new Set(collectPerformanceNodeIds(filteredPerformanceHierarchy)));
  };

  const collapseAllPerformanceNodes = () => {
    setExpandedPerformanceNodes(new Set());
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

  useEffect(() => {
    saveJsonStorage(EMS_PROGRESS_FILTERS_KEY, {
      ...filters,
      selectedPreset,
      showFilters,
      filterDimension,
      groupBy,
    });
  }, [filters, selectedPreset, showFilters, filterDimension, groupBy]);

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
      const detailPromise = reportsAPI.getEmsReport(groupBy, 'summary', filters);
      const mdoPromise = groupBy === 'fda' ? detailPromise : reportsAPI.getEmsReport('fda', 'summary', filters);
      const [detailRes, mdoRes] = await Promise.all([detailPromise, mdoPromise]);
      if (detailRes.success && detailRes.data) setEmsDetailRows(detailRes.data as EmsReportSummaryRow[]);
      else setEmsDetailRows([]);
      if (mdoRes.success && mdoRes.data) setEmsMdoRows(mdoRes.data as EmsReportSummaryRow[]);
      else setEmsMdoRows([]);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load EMS detail');
      setEmsDetailRows([]);
      setEmsMdoRows([]);
    } finally {
      setIsLoadingEmsDetail(false);
    }
  }, [groupBy, filters, showError]);

  const fetchLineLevel = useCallback(async (groupKey: string, forGroupBy: EmsReportGroupBy = groupBy) => {
    setIsLoadingLine(true);
    try {
      const res = await reportsAPI.getEmsReport(forGroupBy, 'line', filters);
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

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => {
    fetchEmsDetail();
  }, [fetchEmsDetail]);

  useEffect(() => {
    if (drillDownGroupKey != null) {
      fetchLineLevel(drillDownGroupKey, 'fda');
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
              <p className="text-sm text-slate-600">Visual EMS metrics and drill-down by group</p>
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
              onClick={() => { fetchEmsDetail(); fetchOptions(); }}
              disabled={isLoadingEmsDetail}
            >
              {isLoadingEmsDetail ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
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
                                if (p !== 'Custom') {
                                  setFilters((prev) => ({ ...prev, dateFrom: start, dateTo: end }));
                                  setIsDatePickerOpen(false);
                                }
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
              { label: 'Purchase Intention (%)', value: totals.purchaseIntentionPct, formula: 'Out of farmers who answered commercial conversion (Purchased, Willing Yes, or Willing No), how many either bought or said they are willing to buy?', icon: Target },
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
            <p className="text-xs text-slate-500 mt-1">
              <strong>Connected (intake captured)</strong> is the same denominator as Hygiene / Meeting cards.{' '}
              <strong>Connected (intake pending)</strong> is still a valid number (line was connected) but the form was not completed yet.
            </p>
          </div>
          <div className="p-6">
            {(() => {
              const outcomeRows = [
                { label: 'Connected (intake captured)', count: totals.totalConnected, key: 'Connected' },
                {
                  label: 'Connected (intake pending)',
                  count: totals.connectedIntakePendingCount,
                  key: 'ConnectedPending',
                },
                { label: 'Disconnected', count: totals.disconnectedCount, key: 'Disconnected' },
                { label: 'No Answer', count: totals.noAnswerCount, key: 'NoAnswer' },
                { label: 'Incoming N/A', count: totals.incomingNACount, key: 'IncomingNA' },
                { label: 'Invalid', count: totals.invalidCount, key: 'Invalid', isInvalid: true },
              ];
              const outcomeColors: Record<string, string> = {
                Connected: '#cbd5e1',
                ConnectedPending: '#fbbf24',
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
                                      ConnectedPending: totals.connectedIntakePendingCount,
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
                                  <Bar dataKey="Connected" stackId="a" name="Connected (intake captured)" fill={outcomeColors.Connected} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="Connected" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#0f172a" />
                                  </Bar>
                                  <Bar dataKey="ConnectedPending" stackId="a" name="Connected (intake pending)" fill={outcomeColors.ConnectedPending} radius={[0, 0, 0, 0]} isAnimationActive>
                                    <LabelList dataKey="ConnectedPending" position="center" formatter={(v: number) => (v >= 1 ? v : '')} fontSize={10} fill="#0f172a" />
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

      {/* Performance Table – hierarchy explorer (BU → Zone → Region → Territory → MDO) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle className="text-slate-600 shrink-0" size={20} />
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-900">Performance Table (Hierarchy Explorer)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Sorted BU → Zone → Region → Territory → MDO. Expand levels to compare % at each level.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Filter by name..."
              value={tableFilterText}
              onChange={(e) => setTableFilterText(e.target.value)}
              className="min-w-[180px] px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
            />
            <Button variant="secondary" size="sm" onClick={expandAllPerformanceNodes}>
              Expand all
            </Button>
            <Button variant="secondary" size="sm" onClick={collapseAllPerformanceNodes}>
              Collapse all
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoadingEmsDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-slate-500" size={28} />
            </div>
          ) : visiblePerformanceRows.length === 0 ? (
            <p className="text-center py-12 text-slate-500 text-sm">No EMS detail for current filters. Apply filters and ensure completed calls exist.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-slate-600 font-medium">
                  <th className="px-4 py-3 min-w-[260px]">Name</th>
                  <th className="px-4 py-3 text-right">Total Calls</th>
                  <th className="px-4 py-3 text-right">Connected</th>
                  <th className="px-4 py-3 text-right">Meeting Validity %</th>
                  <th className="px-4 py-3 text-right">Meeting Conversion %</th>
                  <th className="px-4 py-3 text-right">Purchase Intention %</th>
                  <th className="px-4 py-3 text-right">Crop Solutions Focus %</th>
                  <th className="px-4 py-3 text-right">EMS Score</th>
                  <th className="px-4 py-3 max-w-[200px]">Relative remarks</th>
                </tr>
              </thead>
              <tbody>
                {visiblePerformanceRows.map(({ node, depth }) => {
                  const hasChildren = node.children.length > 0;
                  const isExpanded = expandedPerformanceNodes.has(node.id);
                  const metrics = node.metrics;
                  const isMdo = node.level === 'mdo';
                  const rowClass = isMdo
                    ? 'border-b border-slate-100 hover:bg-slate-50 cursor-pointer'
                    : hasChildren
                      ? 'border-b border-slate-100 hover:bg-slate-50 cursor-pointer bg-slate-50/40'
                      : 'border-b border-slate-100';

                  const handleRowClick = () => {
                    if (isMdo && node.groupKey) {
                      setDrillDownGroupKey(node.groupKey);
                      setDrillDownLabel(node.label);
                      return;
                    }
                    if (hasChildren) togglePerformanceNode(node.id);
                  };

                  return (
                    <tr key={node.id} className={rowClass} onClick={handleRowClick}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 18}px` }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className="p-0.5 rounded hover:bg-slate-200 text-slate-500 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePerformanceNode(node.id);
                              }}
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" aria-hidden />
                          )}
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-600">
                              {performanceLevelLabel(node.level)}
                            </span>
                            <span className="truncate">{node.label}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.totalAttempted}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.totalConnected}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.meetingValidityPct}%</td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.meetingConversionPct}%</td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.purchaseIntentionPct}%</td>
                      <td className="px-4 py-3 text-right text-slate-700">{metrics.cropSolutionsFocusPct}%</td>
                      <td className="px-4 py-3 text-right">
                        <span className={metrics.emsScore >= 70 ? 'text-green-800 font-bold' : metrics.emsScore >= 50 ? 'text-amber-800 font-bold' : 'text-slate-700'}>
                          {metrics.emsScore}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs max-w-[200px] truncate" title={metrics.relativeRemarks}>
                        {metrics.relativeRemarks || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        For a detailed activity list with the same filters, use the <strong>Activity Monitoring</strong> tab. Use <strong>EMS report</strong> to export by MDO, Territory, Region, Zone, BU, or TM. Click an <strong>MDO</strong> row to drill down to call-level details.
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
                      <th className="px-3 py-2">Officer (MDO)</th>
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
