import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown, Filter, RefreshCw, Phone, CheckSquare, Square, Loader2, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import Button from '../shared/Button';
import StyledSelect from '../shared/StyledSelect';
import { tasksAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { type DateRangePreset, getPresetRange, formatPretty } from '../../utils/dateRangeUtils';
import { COMMON_DATE_RANGE_PRESETS, loadJsonStorage, parseBoolean, parseIsoDate, parsePreset, parseString, saveJsonStorage } from '../../utils/filterPersistence';

interface CallbackTask {
  _id: string;
  status: string;
  outcome: string;
  callbackNumber: number;
  isCallback: boolean;
  updatedAt: string;
  callLog?: {
    callStatus?: string;
    callDurationSeconds?: number;
  };
  farmer: {
    _id: string;
    name: string;
    mobileNumber: string;
    preferredLanguage: string;
    location: string;
  };
  activity: {
    _id: string;
    type: string;
    territoryName: string;
  };
  agent: {
    _id: string;
    name: string;
    email: string;
  };
}

interface Agent {
  _id: string;
  name: string;
  email: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const PAGE_SIZE_DEFAULT = 20;

type CallbackTableColumnKey = 'farmer' | 'outcome' | 'outbound' | 'type' | 'agent' | 'date';

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  } catch {
    return dateStr;
  }
};

const CALLBACK_FILTERS_STORAGE_KEY = 'teamLead.callbackRequest.filters';

type SavedCallbackFilters = {
  dateFrom: string;
  dateTo: string;
  outcome: string;
  callType: string;
  agentId: string;
  selectedPreset: DateRangePreset;
  showFilters: boolean;
};

function loadSavedCallbackFilters(): SavedCallbackFilters {
  const fallback = getPresetRange('Last 7 days');
  return loadJsonStorage(
    CALLBACK_FILTERS_STORAGE_KEY,
    () => ({
      dateFrom: fallback.start,
      dateTo: fallback.end,
      outcome: 'all',
      callType: 'all',
      agentId: 'all',
      selectedPreset: 'Last 7 days' as DateRangePreset,
      showFilters: false,
    }),
    (parsed, defaults) => {
      const p = parsed as Record<string, unknown>;
      return {
        dateFrom: parseIsoDate(p.dateFrom, defaults.dateFrom),
        dateTo: parseIsoDate(p.dateTo, defaults.dateTo),
        outcome: parseString(p.outcome, defaults.outcome),
        callType: parseString(p.callType, defaults.callType),
        agentId: parseString(p.agentId, defaults.agentId),
        selectedPreset: parsePreset(p.selectedPreset, defaults.selectedPreset, COMMON_DATE_RANGE_PRESETS),
        showFilters: parseBoolean(p.showFilters, defaults.showFilters),
      };
    }
  );
}

const CallbackRequestView: React.FC = () => {
  const toast = useToast();
  const initialCallbackFilters = useMemo(() => loadSavedCallbackFilters(), []);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [tasks, setTasks] = useState<CallbackTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0, hasMore: false });
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('teamLead.callbackRequest.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && PAGE_SIZE_OPTIONS.includes(n as any) ? n : PAGE_SIZE_DEFAULT;
  });
  const [tableSort, setTableSort] = useState<{ key: CallbackTableColumnKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('teamLead.callbackRequest.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    } catch {
      // ignore
    }
    return { key: 'date', dir: 'desc' };
  });

  const [showFilters, setShowFilters] = useState(() => initialCallbackFilters.showFilters);
  const [filters, setFilters] = useState(() => ({
    dateFrom: initialCallbackFilters.dateFrom,
    dateTo: initialCallbackFilters.dateTo,
    outcome: initialCallbackFilters.outcome,
    callType: initialCallbackFilters.callType,
    agentId: initialCallbackFilters.agentId,
  }));

  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>(() => initialCallbackFilters.selectedPreset);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(() => initialCallbackFilters.dateFrom);
  const [draftEnd, setDraftEnd] = useState(() => initialCallbackFilters.dateTo);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveJsonStorage(CALLBACK_FILTERS_STORAGE_KEY, {
      ...filters,
      selectedPreset,
      showFilters,
    });
  }, [filters, selectedPreset, showFilters]);

  // Close date picker on outside click
  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (datePickerRef.current && !datePickerRef.current.contains(t)) setIsDatePickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDatePickerOpen]);

  // Load one page of tasks (page-based, like Activity Monitoring)
  const fetchPage = useCallback(
    async (page: number) => {
      setIsLoading(true);
      if (page === 1) setSelectedTaskIds(new Set());
      try {
        const res: any = await tasksAPI.getCallbackCandidates({
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          outcome: filters.outcome !== 'all' ? filters.outcome : undefined,
          callType: filters.callType !== 'all' ? filters.callType : undefined,
          agentId: filters.agentId !== 'all' ? filters.agentId : undefined,
          page,
          limit: pageSize,
        });

        if (res.success) {
          setTasks(res.data.tasks || []);
          setAgents(res.data.agents || []);
          const pag = res.data.pagination || { page: 1, total: 0, pages: 0 };
          setPagination({
            page: pag.page,
            total: pag.total,
            pages: pag.pages,
            hasMore: pag.page < pag.pages,
          });
        }
      } catch (e: any) {
        toast.showError(e?.message || 'Failed to load tasks');
      } finally {
        setIsLoading(false);
      }
    },
    [filters, pageSize, toast]
  );

  // Initial load and when filters or pageSize change (go to page 1)
  useEffect(() => {
    if (filters.dateFrom && filters.dateTo) {
      fetchPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pageSize]);

  useEffect(() => {
    localStorage.setItem('teamLead.callbackRequest.pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem('teamLead.callbackRequest.tableSort', JSON.stringify(tableSort));
  }, [tableSort]);

  const getSortValue = (task: CallbackTask, key: CallbackTableColumnKey): string | number => {
    switch (key) {
      case 'farmer':
        return (task.farmer?.name || '').toLowerCase();
      case 'outcome':
        return (task.outcome || '').toLowerCase();
      case 'outbound':
        return (task.callLog?.callStatus || '').toLowerCase();
      case 'type':
        return task.isCallback ? 'callback' : 'original';
      case 'agent':
        return (task.agent?.name || '').toLowerCase();
      case 'date':
        return new Date(task.updatedAt || 0).getTime();
      default:
        return '';
    }
  };

  const sortedTasks = useMemo(() => {
    const { key, dir } = tableSort;
    const mapped = tasks.map((t, idx) => ({ task: t, idx }));
    mapped.sort((a, b) => {
      const va = getSortValue(a.task, key);
      const vb = getSortValue(b.task, key);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) return a.idx - b.idx;
      return dir === 'asc' ? cmp : -cmp;
    });
    return mapped.map((m) => m.task);
  }, [tasks, tableSort]);

  const handleHeaderClick = (key: CallbackTableColumnKey) => {
    setTableSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  };

  // Filter tasks that can be selected (not at max callbacks) — use sorted list for display order
  const selectableTasks = sortedTasks.filter(t => (t.callbackNumber || 0) < 2);

  const handleSelectAll = () => {
    if (selectedTaskIds.size === selectableTasks.length && selectableTasks.length > 0) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(selectableTasks.map(t => t._id)));
    }
  };

  const handleSelectTask = (taskId: string) => {
    const task = tasks.find(t => t._id === taskId);
    if (task && (task.callbackNumber || 0) >= 2) return;

    const newSet = new Set(selectedTaskIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setSelectedTaskIds(newSet);
  };

  const handleCreateCallbacks = async () => {
    if (selectedTaskIds.size === 0) {
      toast.showWarning('Please select at least one task');
      return;
    }

    setIsCreating(true);
    try {
      const res: any = await tasksAPI.createCallbacks(Array.from(selectedTaskIds));
      
      if (res.success) {
        toast.showSuccess(`Created ${res.data.summary.created} callback(s)${res.data.summary.skipped > 0 ? `, ${res.data.summary.skipped} skipped` : ''}`);
        fetchPage(pagination.page); // Reload current page to reflect changes
      }
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to create callbacks');
    } finally {
      setIsCreating(false);
    }
  };

  const syncDraftFromFilters = () => {
    setDraftStart(filters.dateFrom);
    setDraftEnd(filters.dateTo);
  };

  const allSelected = selectableTasks.length > 0 && selectedTaskIds.size === selectableTasks.length;

  return (
    <div className="space-y-6">
      {/* Header Card - match Activity Monitoring card style */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Request Callbacks</h2>
            <p className="text-sm text-slate-600 mt-1">Select completed/unsuccessful calls to schedule callbacks</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter size={16} />
              {showFilters ? 'Hide filters' : 'Filters'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => fetchPage(1)} disabled={isLoading}>
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters – expand when Filter button clicked */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
            <div className="relative" ref={datePickerRef}>
              <button
                type="button"
                onClick={() => {
                  setIsDatePickerOpen(prev => {
                    if (!prev) syncDraftFromFilters();
                    return !prev;
                  });
                }}
                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 flex items-center justify-between"
              >
                <span className="truncate">
                  {selectedPreset}
                  {filters.dateFrom && filters.dateTo ? ` • ${formatPretty(filters.dateFrom)} - ${formatPretty(filters.dateTo)}` : ''}
                </span>
                <ChevronDown size={16} className="text-slate-400" />
              </button>
              {isDatePickerOpen && (
                <div className="absolute z-50 mt-2 w-[500px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex">
                    <div className="w-44 border-r border-slate-200 bg-slate-50 p-2">
                      {(['Custom', 'Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'YTD'] as DateRangePreset[]).map((p) => (
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
                            selectedPreset === p ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 p-4">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex-1">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Start</p>
                          <input
                            type="date"
                            value={draftStart}
                            onChange={(e) => { setSelectedPreset('Custom'); setDraftStart(e.target.value); }}
                            className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">End</p>
                          <input
                            type="date"
                            value={draftEnd}
                            onChange={(e) => { setSelectedPreset('Custom'); setDraftEnd(e.target.value); }}
                            className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                        <Button variant="secondary" size="sm" onClick={() => setIsDatePickerOpen(false)}>Cancel</Button>
                        <button
                          type="button"
                          onClick={() => {
                            setFilters(f => ({ ...f, dateFrom: draftStart, dateTo: draftEnd }));
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
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Outcome</label>
            <StyledSelect
              value={filters.outcome}
              onChange={(value) => setFilters(f => ({ ...f, outcome: value }))}
              options={[
                { value: 'all', label: 'All Outcomes' },
                { value: 'Unsuccessful', label: 'Unsuccessful' },
                { value: 'Completed Conversation', label: 'Completed' },
              ]}
              placeholder="All Outcomes"
            />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Call Type</label>
            <StyledSelect
              value={filters.callType}
              onChange={(value) => setFilters(f => ({ ...f, callType: value }))}
              options={[
                { value: 'all', label: 'All Types' },
                { value: 'original', label: 'Original' },
                { value: 'callback', label: 'Callback' },
              ]}
              placeholder="All Types"
            />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Agent</label>
            <StyledSelect
              value={filters.agentId}
              onChange={(value) => setFilters(f => ({ ...f, agentId: value }))}
              options={[
                { value: 'all', label: 'All Agents' },
                ...agents.map(agent => ({ value: agent._id, label: agent.name })),
              ]}
              placeholder="All Agents"
            />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tasks Table - card style match Activity Monitoring (rounded-3xl) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Action Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSelectAll}
              className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
              disabled={selectableTasks.length === 0}
            >
              {allSelected ? <CheckSquare size={18} className="text-green-600" /> : <Square size={18} className="text-slate-400" />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-sm text-slate-500">
              {selectedTaskIds.size} of {selectableTasks.length} selected
              {pagination.total > 0 && pagination.pages > 1 && (
                <span className="text-slate-400 ml-1">
                  (Page {pagination.page} of {pagination.pages})
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCreateCallbacks}
            disabled={selectedTaskIds.size === 0 || isCreating}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
            Create {selectedTaskIds.size} Callback{selectedTaskIds.size !== 1 ? 's' : ''}
          </button>
        </div>

        {/* Table - no internal scroll; entire page scrolls (match Activity Monitoring) */}
        <div ref={tableContainerRef} className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-3 text-left w-10 text-xs font-black text-slate-500 uppercase tracking-widest"></th>
                {(
                  [
                    { key: 'farmer' as CallbackTableColumnKey, label: 'Farmer' },
                    { key: 'outcome' as CallbackTableColumnKey, label: 'Outcome' },
                    { key: 'outbound' as CallbackTableColumnKey, label: 'Outbound' },
                    { key: 'type' as CallbackTableColumnKey, label: 'Type' },
                    { key: 'agent' as CallbackTableColumnKey, label: 'Agent' },
                    { key: 'date' as CallbackTableColumnKey, label: 'Date' },
                  ] as Array<{ key: CallbackTableColumnKey; label: string }>
                ).map((col) => {
                  const isSorted = tableSort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className="px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none cursor-pointer hover:bg-slate-100"
                      onClick={() => handleHeaderClick(col.key)}
                      title="Click to sort"
                    >
                      <div className="flex items-center gap-2">
                        <span>{col.label}</span>
                        {isSorted ? (
                          tableSort.dir === 'asc' ? (
                            <ChevronUp size={16} className="text-slate-700 shrink-0" aria-hidden />
                          ) : (
                            <ChevronDown size={16} className="text-slate-700 shrink-0" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown size={14} className="text-slate-400 shrink-0 opacity-70" aria-hidden />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 border-b border-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 className="animate-spin mx-auto text-slate-400" size={24} />
                    <p className="text-sm text-slate-500 mt-2">Loading tasks...</p>
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <AlertCircle className="mx-auto text-slate-300" size={32} />
                    <p className="text-sm text-slate-500 mt-2">No tasks found for selected filters</p>
                  </td>
                </tr>
              ) : (
                <>
                  {sortedTasks.map((task) => {
                    const isMaxRetry = (task.callbackNumber || 0) >= 2;
                    const isSelected = selectedTaskIds.has(task._id);

                    return (
                      <tr
                        key={task._id}
                        className={`hover:bg-slate-50 ${isMaxRetry ? 'opacity-50' : ''} ${isSelected ? 'bg-green-50' : ''}`}
                      >
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => handleSelectTask(task._id)}
                            disabled={isMaxRetry}
                            className="disabled:cursor-not-allowed"
                            title={isMaxRetry ? 'Max callbacks reached (2)' : ''}
                          >
                            {isSelected ? (
                              <CheckSquare size={18} className="text-green-600" />
                            ) : (
                              <Square size={18} className={isMaxRetry ? 'text-slate-300' : 'text-slate-400'} />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{task.farmer?.name || 'Unknown'}</p>
                            <p className="text-xs text-slate-500">{task.farmer?.mobileNumber}</p>
                            <p className="text-[10px] text-slate-400">{task.farmer?.location}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${
                            task.outcome === 'Completed Conversation' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {task.outcome === 'Completed Conversation' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                            {task.outcome === 'Completed Conversation' ? 'Completed' : 'Unsuccessful'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {task.callLog?.callStatus || '-'}
                        </td>
                        <td className="px-3 py-3">
                          {task.isCallback ? (
                            <span className="px-2 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-700">
                              Callback #{task.callbackNumber}
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600">
                              Original
                            </span>
                          )}
                          {isMaxRetry && (
                            <span className="ml-1 text-[10px] text-red-500">(Max)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {task.agent?.name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {formatDate(task.updatedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination - separate card, page-based like Activity Monitoring (Previous/Next) */}
      {!isLoading && pagination.total > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-sm text-slate-600">
              Page {pagination.page} of {pagination.pages} • {pagination.total} total tasks
              {selectableTasks.length >= 0 && (
                <span className="text-slate-500 ml-1">• {selectableTasks.length} eligible for callback on this page</span>
              )}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rows</span>
                <StyledSelect
                  value={String(pageSize)}
                  onChange={(v) => setPageSize(Number(v))}
                  options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                  className="min-w-[80px]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchPage(pagination.page - 1)}
                disabled={pagination.page === 1 || isLoading || pagination.pages <= 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchPage(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages || isLoading || pagination.pages <= 1}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallbackRequestView;
