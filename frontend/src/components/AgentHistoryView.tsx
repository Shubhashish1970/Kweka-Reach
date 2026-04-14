import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, ArrowDownToLine, Filter, RefreshCw, Search, ChevronRight, Loader2, ChevronUp, User as UserIcon, Activity as ActivityIcon, Phone, PhoneCall, MessageSquare, Package } from 'lucide-react';
import Button from './shared/Button';
import StyledSelect from './shared/StyledSelect';
import { tasksAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { type DateRangePreset, getPresetRange, formatPretty } from '../utils/dateRangeUtils';

type HistoryStatus = '' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number';

type HistoryColumnKey =
  | 'expand'
  | 'farmer'
  | 'outcome'
  | 'outbound'
  | 'activityType'
  | 'territory'
  | 'updated'
  | 'dialer';

const DEFAULT_COL_WIDTHS: Record<HistoryColumnKey, number> = {
  expand: 56,
  farmer: 220,
  outcome: 200,
  outbound: 160,
  activityType: 160,
  territory: 220,
  updated: 140,
  dialer: 132,
};

// Get initials from name for avatar display
const getInitials = (name: string): string => {
  if (!name) return '?';
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const outcomeLabel = (status: string) => {
  if (status === 'completed') return 'Completed Conversation';
  if (status === 'in_progress') return 'In Progress';
  if (status === 'invalid_number') return 'Unsuccessful';
  if (status === 'not_reachable') return 'Unsuccessful';
  return status || 'Unknown';
};

const outboundLabel = (raw: string) => raw || '-';
const safeArr = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);

const formatDateTime = (d: any) => {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const AgentHistoryView: React.FC<{ onOpenTask?: (taskId: string) => void | Promise<void> }> = ({ onOpenTask }) => {
  const toast = useToast();
  // Initialize default date range once to avoid race condition
  const defaultDateRange = getPresetRange('Last 7 days');
  
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('agent.history.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20;
  });
  const [tableSort, setTableSort] = useState<{ key: HistoryColumnKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('agent.history.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    } catch {
      // ignore
    }
    return { key: 'updated', dir: 'desc' };
  });
  const [colWidths, setColWidths] = useState<Record<HistoryColumnKey, number>>(() => {
    const raw = localStorage.getItem('agent.history.colWidths');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return { ...DEFAULT_COL_WIDTHS, ...parsed };
    } catch {
      // ignore
    }
    return { ...DEFAULT_COL_WIDTHS };
  });
  const resizingRef = useRef<{ key: HistoryColumnKey; startX: number; startWidth: number } | null>(null);

  // Initialize filters with default date range to avoid race condition
  const [filters, setFilters] = useState<{
    status: HistoryStatus;
    territory: string;
    activityType: string;
    search: string;
    dateFrom: string;
    dateTo: string;
  }>({
    status: '',
    territory: '',
    activityType: '',
    search: '',
    dateFrom: defaultDateRange.start,
    dateTo: defaultDateRange.end,
  });

  const [filterOptions, setFilterOptions] = useState<{ territoryOptions: string[]; activityTypeOptions: string[] }>({
    territoryOptions: [],
    activityTypeOptions: [],
  });
  const [stats, setStats] = useState<any | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, any>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);

  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Last 7 days');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(defaultDateRange.start);
  const [draftEnd, setDraftEnd] = useState(defaultDateRange.end);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  const syncDraftFromFilters = () => {
    const start = filters.dateFrom || getRange(selectedPreset).start;
    const end = filters.dateTo || getRange(selectedPreset).end;
    setDraftStart(start);
    setDraftEnd(end);
  };

  // Date range is now initialized in state, so this effect is no longer needed
  // Keeping it for backward compatibility in case filters get reset
  useEffect(() => {
    if (filters.dateFrom || filters.dateTo) return;
    const r = getPresetRange('Last 7 days');
    setFilters((p) => {
      if (p.dateFrom || p.dateTo) return p;
      return { ...p, dateFrom: r.start, dateTo: r.end };
    });
    setDraftStart(r.start);
    setDraftEnd(r.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (datePickerRef.current && !datePickerRef.current.contains(t)) setIsDatePickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDatePickerOpen]);

  const load = async (page = 1) => {
    setIsLoading(true);
    try {
      const res: any = await tasksAPI.getOwnHistory({
        status: filters.status || undefined,
        territory: filters.territory || undefined,
        activityType: filters.activityType || undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        limit: pageSize,
      });
      setRows(res?.data?.tasks || []);
      setPagination(res?.data?.pagination || null);
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(1).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.territory, filters.activityType, filters.search, filters.dateFrom, filters.dateTo, pageSize]);

  const page = Number(pagination?.page || 1);
  const pages = Number(pagination?.pages || 1);

  useEffect(() => {
    localStorage.setItem('agent.history.pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem('agent.history.tableSort', JSON.stringify(tableSort));
  }, [tableSort]);

  useEffect(() => {
    localStorage.setItem('agent.history.colWidths', JSON.stringify(colWidths));
  }, [colWidths]);

  const handleResizeStart = (key: HistoryColumnKey, startX: number) => {
    resizingRef.current = { key, startX, startWidth: colWidths[key] };
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = e.clientX - resizingRef.current.startX;
      const next = Math.max(90, resizingRef.current.startWidth + dx);
      setColWidths((p) => ({ ...p, [key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const loadOptions = async () => {
    try {
      const res: any = await tasksAPI.getOwnHistoryOptions({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      if (res?.success && res?.data) {
        setFilterOptions({
          territoryOptions: Array.isArray(res.data.territoryOptions) ? res.data.territoryOptions : [],
          activityTypeOptions: Array.isArray(res.data.activityTypeOptions) ? res.data.activityTypeOptions : [],
        });
      }
    } catch {
      // ignore
    }
  };

  const loadStats = async () => {
    setIsStatsLoading(true);
    try {
      const res: any = await tasksAPI.getOwnHistoryStats({
        status: filters.status || undefined,
        territory: filters.territory || undefined,
        activityType: filters.activityType || undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      if (res?.success && res?.data) setStats(res.data);
    } catch {
      // ignore
    } finally {
      setIsStatsLoading(false);
    }
  };

  useEffect(() => {
    loadOptions().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    loadStats().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.territory, filters.activityType, filters.search, filters.dateFrom, filters.dateTo]);

  const handleDownloadExcel = async () => {
    setIsExporting(true);
    try {
      await tasksAPI.downloadOwnHistoryExport({
        status: filters.status || undefined,
        territory: filters.territory || undefined,
        activityType: filters.activityType || undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit: 5000,
      });
      toast.showSuccess('Excel downloaded');
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to download excel');
    } finally {
      setIsExporting(false);
    }
  };

  const toggleExpand = async (taskId: string) => {
    const next = expandedId === taskId ? null : taskId;
    setExpandedId(next);
    if (!next) return;

    if (detailById[next]) return;
    setDetailLoadingId(next);
    try {
      const res: any = await tasksAPI.getOwnHistoryDetail(next);
      if (res?.success && res?.data?.task) {
        setDetailById((p) => ({ ...p, [next]: res.data.task }));
      }
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load details');
    } finally {
      setDetailLoadingId((curr) => (curr === next ? null : curr));
    }
  };

  const handleOpenInDialer = async (taskId: string) => {
    if (!onOpenTask) return;
    setOpeningTaskId(taskId);
    try {
      await Promise.resolve(onOpenTask(taskId));
    } catch {
      // Parent shows errors
    } finally {
      setOpeningTaskId(null);
    }
  };

  const historyTableColumns: Array<[HistoryColumnKey, string]> = useMemo(() => {
    const base: Array<[HistoryColumnKey, string]> = [
      ['expand', ''],
      ['farmer', 'Farmer'],
      ['outcome', 'Outcome'],
      ['outbound', 'Outbound'],
      ['activityType', 'Activity'],
      ['territory', 'Territory'],
      ['updated', 'Updated'],
    ];
    if (onOpenTask) base.push(['dialer', 'Dialer']);
    return base;
  }, [onOpenTask]);

  const visible = useMemo(() => {
    const data = Array.isArray(rows) ? [...rows] : [];

    const getText = (t: any, key: HistoryColumnKey) => {
      const farmer = t.farmerId || t.farmer || {};
      const activity = t.activityId || t.activity || {};
      if (key === 'farmer') return String(farmer?.name || '');
      if (key === 'outcome') return String(t.status || '');
      if (key === 'outbound') return String(t.callLog?.callStatus || '');
      if (key === 'activityType') return String(activity?.type || '');
      if (key === 'territory') return String(activity?.territoryName || activity?.territory || '');
      if (key === 'updated') return String(t.updatedAt || '');
      if (key === 'dialer') return '';
      return '';
    };

    data.sort((a: any, b: any) => {
      const av = getText(a, tableSort.key);
      const bv = getText(b, tableSort.key);
      const dir = tableSort.dir === 'asc' ? 1 : -1;
      if (tableSort.key === 'updated') {
        const at = new Date(av).getTime() || 0;
        const bt = new Date(bv).getTime() || 0;
        return dir * (at - bt);
      }
      return dir * av.localeCompare(bv);
    });

    return data;
  }, [rows, tableSort.key, tableSort.dir]);

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section - Matching Activity Sampling */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 mb-1">History</h2>
              <p className="text-sm text-slate-600">
                Table: work excluding in-queue. Statistics use the same filters and count by task status (cards sum to Total).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setShowFilters((v) => !v)}>
                <Filter size={16} />
                {showFilters ? 'Hide filters' : 'Filters'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  loadOptions().catch(() => undefined);
                  loadStats().catch(() => undefined);
                  load(page).catch(() => undefined);
                }}
                disabled={isLoading}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mb-4 pb-4 border-b border-slate-100">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Find farmer</label>
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
              <input
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                placeholder="Name or mobile — filters the table as you type"
                className="w-full min-h-12 pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                aria-label="Search history by farmer name or mobile"
              />
            </div>
            {onOpenTask ? (
              <p className="text-[11px] text-slate-500 mt-2 font-medium">
                Use <span className="font-bold text-slate-700">Continue in dialer</span> on a row to open that task in the workspace and submit an updated call.
              </p>
            ) : null}
          </div>

          {/* Filters Section - Matching Activity Sampling */}
          {showFilters && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Activity Type</label>
                  <StyledSelect
                    value={filters.activityType}
                    onChange={(v) => setFilters((p) => ({ ...p, activityType: v }))}
                    options={[
                      { value: '', label: 'All Types' },
                      ...filterOptions.activityTypeOptions.map((t) => ({ value: t, label: t })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Territory</label>
                  <StyledSelect
                    value={filters.territory}
                    onChange={(v) => setFilters((p) => ({ ...p, territory: v }))}
                    options={[
                      { value: '', label: 'All Territories' },
                      ...filterOptions.territoryOptions.map((t) => ({ value: t, label: t })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Status</label>
                  <StyledSelect
                    value={filters.status}
                    onChange={(v) => setFilters((p) => ({ ...p, status: v as any }))}
                    options={[
                      { value: '', label: 'All (except In Queue)' },
                      { value: 'in_progress', label: 'In Progress' },
                      { value: 'completed', label: 'Completed Conversation' },
                      { value: 'not_reachable', label: 'Unsuccessful (not reachable / no answer)' },
                      { value: 'invalid_number', label: 'Invalid number' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
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
                      <div className="absolute z-50 mt-2 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                        <div className="flex">
                          {/* Presets */}
                          <div className="w-56 border-r border-slate-200 bg-slate-50 p-2">
                            {([
                              'Custom',
                              'Today',
                              'Yesterday',
                              'This week (Sun - Today)',
                              'Last 7 days',
                              'Last week (Sun - Sat)',
                              'Last 28 days',
                              'Last 30 days',
                              'YTD',
                            ] as DateRangePreset[]).map((p) => {
                              const isActive = selectedPreset === p;
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => {
                                    setSelectedPreset(p);
                                    const { start, end } = getRange(p);
                                    setDraftStart(start);
                                    setDraftEnd(end);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${
                                    isActive ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'
                                  }`}
                                >
                                  {p}
                                </button>
                              );
                            })}
                          </div>

                          {/* Date inputs */}
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

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
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
                                  setFilters((p) => ({ ...p, dateFrom: draftStart, dateTo: draftEnd }));
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
              </div>
            </div>
          )}
        </div>

        {/* Statistics Dashboard - Matching Activity Sampling */}
        {!isStatsLoading && (stats ? (stats?.total || 0) > 0 : (!isLoading && (pagination?.total || 0) > 0)) && (
          <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="text-lime-600" size={18} />
                <div>
                  <h2 className="text-base font-black text-slate-900">Statistics</h2>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    In queue + in progress + completed + unsuccessful + invalid = Total (same date & filters as below).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={isExporting || isLoading}
                className={`flex items-center justify-center h-10 w-10 rounded-2xl border transition-colors ${
                  isExporting
                    ? 'bg-lime-50 border-lime-200 text-lime-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title="Download Excel (all records matching current filters)"
              >
                <ArrowDownToLine size={18} className={isExporting ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Compact Statistics Grid - Matching Activity Sampling */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-0.5">Total</p>
                <p className="text-xl font-black text-slate-900">{stats?.total ?? pagination?.total ?? 0}</p>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-200">
                <p className="text-xs font-black text-purple-600 uppercase tracking-widest mb-0.5">In Queue</p>
                <p className="text-xl font-black text-purple-800">{stats?.inQueue || 0}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-0.5">Completed</p>
                <p className="text-xl font-black text-green-800">{stats?.completedConversation || 0}</p>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3 border border-yellow-200">
                <p className="text-xs font-black text-yellow-600 uppercase tracking-widest mb-0.5">In Progress</p>
                <p className="text-xl font-black text-yellow-800">{stats?.inProgress || 0}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
                <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-0.5">Unsuccessful</p>
                <p className="text-xl font-black text-blue-800">{stats?.unsuccessful || 0}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-0.5">Invalid</p>
                <p className="text-xl font-black text-red-800">{stats?.invalid || 0}</p>
              </div>
            </div>
          </div>
        )}

        {/* History Table - Matching Activity Sampling */}
        {isLoading ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <Loader2 className="animate-spin mx-auto mb-4 text-lime-600" size={32} />
            <p className="text-sm text-slate-600 font-medium">Loading history...</p>
          </div>
        ) : !pagination || (pagination.total || 0) === 0 ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <p className="text-sm text-slate-600 font-medium">No history found for selected filters</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {historyTableColumns.map(([key, label]) => (
                    <th
                      key={key}
                      className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                      style={{ width: colWidths[key], minWidth: colWidths[key] }}
                      onClick={
                        key === 'expand' || key === 'dialer'
                          ? undefined
                          : () => {
                              setTableSort((p) => {
                                if (p.key === key) return { key, dir: p.dir === 'asc' ? 'desc' : 'asc' };
                                return { key, dir: 'asc' };
                              });
                            }
                      }
                      title={key === 'expand' || key === 'dialer' ? undefined : 'Click to sort'}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate">{label}</span>
                        {key !== 'expand' && key !== 'dialer' && tableSort.key === key && (
                          tableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        )}
                      </div>
                      {key !== 'expand' && key !== 'dialer' && (
                        <div
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleResizeStart(key, e.clientX);
                          }}
                          title="Drag to resize"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((t: any) => {
                  const farmer = t.farmerId || t.farmer || {};
                  const activity = t.activityId || t.activity || {};
                  const outbound = t.callLog?.callStatus || '';
                  const updated = t.updatedAt ? formatPretty(String(t.updatedAt).slice(0, 10)) : '-';
                  const territory = (activity.territoryName || activity.territory || '').toString();
                  const isOpen = expandedId === String(t._id);
                  const detail = detailById[String(t._id)] || null;
                  return (
                    <React.Fragment key={t._id}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm" style={{ width: colWidths.expand, minWidth: colWidths.expand }}>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors"
                            onClick={() => toggleExpand(String(t._id))}
                            title="Expand / collapse"
                          >
                            {isOpen ? (
                              <ChevronUp size={16} className="text-slate-500" />
                            ) : (
                              <ChevronDown size={16} className="text-slate-500" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-sm" style={{ width: colWidths.farmer, minWidth: colWidths.farmer }}>
                          <div className="flex items-center gap-3 min-w-0">
                            {farmer.photoUrl ? (
                              <img
                                src={farmer.photoUrl}
                                alt={farmer.name}
                                className="w-10 h-10 rounded-full object-cover border border-slate-200"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.src = '/images/farmer-default-logo.png';
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shadow-sm border-2 border-white">
                                <span className="text-white font-bold text-sm">{getInitials(farmer.name || '')}</span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-black text-slate-900 truncate">{farmer.name || 'Unknown'}</div>
                              <div className="text-xs text-slate-500 truncate">{farmer.mobileNumber || ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm font-bold text-slate-700" style={{ width: colWidths.outcome, minWidth: colWidths.outcome }}>
                        {t.outcome || outcomeLabel(t.status)}
                      </td>
                        <td className="px-3 py-3 text-sm text-slate-700" style={{ width: colWidths.outbound, minWidth: colWidths.outbound }}>
                        {outboundLabel(outbound)}
                      </td>
                        <td className="px-3 py-3 text-sm text-slate-700" style={{ width: colWidths.activityType, minWidth: colWidths.activityType }}>
                        {activity.type || '-'}
                      </td>
                        <td className="px-3 py-3 text-sm text-slate-700 truncate" title={territory || ''} style={{ width: colWidths.territory, minWidth: colWidths.territory }}>
                        {territory || '-'}
                      </td>
                        <td className="px-3 py-3 text-sm text-slate-700" style={{ width: colWidths.updated, minWidth: colWidths.updated }}>
                        {updated}
                      </td>
                        {onOpenTask ? (
                          <td className="px-2 py-3 align-middle" style={{ width: colWidths.dialer, minWidth: colWidths.dialer }}>
                            <button
                              type="button"
                              onClick={() => handleOpenInDialer(String(t._id))}
                              disabled={openingTaskId === String(t._id)}
                              className="w-full min-h-10 px-2 rounded-xl border border-lime-300 bg-lime-50 text-lime-900 text-[11px] font-black uppercase tracking-wide hover:bg-lime-100 disabled:opacity-60 flex items-center justify-center gap-1.5"
                              title="Open this task in the dialer to place another call and submit an updated response"
                            >
                              {openingTaskId === String(t._id) ? (
                                <Loader2 size={14} className="animate-spin shrink-0" />
                              ) : (
                                <PhoneCall size={14} className="shrink-0" strokeWidth={2.25} />
                              )}
                              <span className="truncate">Continue</span>
                            </button>
                          </td>
                        ) : null}
                      </tr>

                      {isOpen && (
                        <tr className="bg-white">
                          <td colSpan={historyTableColumns.length} className="px-3 pb-3 pt-2">
                            <div className="mx-1 bg-white rounded-xl border border-slate-200 p-3">
                              {detailLoadingId === String(t._id) && (
                                <div className="flex items-center gap-2 text-slate-600 text-xs font-bold">
                                  <Loader2 size={14} className="animate-spin" />
                                  Loading details…
                                </div>
                              )}

                              {!detailLoadingId && !detail && (
                                <div className="text-xs text-slate-600">No additional details available.</div>
                              )}

                              {detail && (
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                                  {/* Main Grid - 4 columns for wide layout */}
                                  <div className="grid grid-cols-4 gap-4">
                                    {/* Farmer Info */}
                                    <div>
                                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                        <UserIcon size={12} className="text-slate-400" />
                                        Farmer
                                      </h4>
                                      <p className="text-xs font-semibold text-slate-900">{detail.farmerId?.name || 'Unknown'}</p>
                                      <p className="text-[10px] text-slate-600">{detail.farmerId?.mobileNumber || ''}</p>
                                      <p className="text-[10px] text-slate-500 mt-0.5">{detail.farmerId?.location || ''}</p>
                                      <p className="text-[10px] text-slate-600">Lang: <span className="font-semibold">{detail.farmerId?.preferredLanguage || '-'}</span></p>
                                    </div>

                                    {/* Activity Info */}
                                    <div>
                                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                        <ActivityIcon size={12} className="text-slate-400" />
                                        Activity
                                      </h4>
                                      <p className="text-xs font-semibold text-slate-900">{detail.activityId?.type || '-'}</p>
                                      <p className="text-[10px] text-slate-600">Officer: <span className="font-semibold">{detail.activityId?.officerName || '-'}</span></p>
                                      <p className="text-[10px] text-slate-600">Territory: <span className="font-semibold">{detail.activityId?.territoryName || detail.activityId?.territory || '-'}</span></p>
                                      <p className="text-[10px] text-slate-600">State: <span className="font-semibold">{detail.activityId?.state || '-'}</span></p>
                                    </div>

                                    {/* Call Info */}
                                    <div>
                                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                        <Phone size={12} className="text-slate-400" />
                                        Call Info
                                      </h4>
                                      <p className="text-[10px] text-slate-600">Status: <span className="text-xs font-semibold text-slate-900">{detail.callLog?.callStatus || '-'}</span></p>
                                      <p className="text-[10px] text-slate-600">Started: <span className="font-semibold">{formatDateTime(detail.callStartedAt) || '-'}</span></p>
                                      <p className="text-[10px] text-slate-600">Duration: <span className="font-semibold">{Number(detail.callLog?.callDurationSeconds || 0)}s</span></p>
                                    </div>

                                    {/* Feedback */}
                                    <div>
                                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                        <MessageSquare size={12} className="text-slate-400" />
                                        Feedback
                                      </h4>
                                      <p className="text-[10px] text-slate-600">Sentiment: <span className="font-semibold">{detail.callLog?.sentiment || 'N/A'}</span></p>
                                      <p className="text-[10px] text-slate-600 line-clamp-2">Comments: <span className="font-medium">{detail.callLog?.farmerComments || '-'}</span></p>
                                    </div>
                                  </div>

                                  {/* Crops & Products - inline if present */}
                                  {((detail.callLog?.cropsDiscussed && detail.callLog.cropsDiscussed.length > 0) || 
                                    (detail.callLog?.productsDiscussed && detail.callLog.productsDiscussed.length > 0)) && (
                                    <div className="mt-2 pt-2 border-t border-slate-200 flex items-center gap-2 flex-wrap">
                                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <Package size={12} className="text-slate-400" />
                                        Details:
                                      </span>
                                      {detail.callLog?.cropsDiscussed?.map((crop, idx) => (
                                        <span key={idx} className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                                          {crop}
                                        </span>
                                      ))}
                                      {detail.callLog?.productsDiscussed?.map((product, idx) => (
                                        <span key={idx} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                                          {product}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination - Matching Activity Sampling */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-sm text-slate-600">
              Page {page} of {pages} • {Number(pagination?.total || 0)} total records
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rows</span>
                <StyledSelect
                  value={String(pageSize)}
                  onChange={(v) => setPageSize(Number(v))}
                  options={[10, 20, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
                  className="min-w-[80px]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => load(page - 1)}
                disabled={page === 1 || isLoading || pages <= 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => load(page + 1)}
                disabled={page >= pages || isLoading || pages <= 1}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default AgentHistoryView;

