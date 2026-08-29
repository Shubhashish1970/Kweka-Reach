import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calendar, Filter, Loader2, ParkingSquare, RefreshCw } from 'lucide-react';
import { adminAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import Button from '../shared/Button';
import InfoBanner from '../shared/InfoBanner';
import ConfirmationModal from '../shared/ConfirmationModal';
import { type DateRangePreset, getPresetRange, formatPretty } from '../../utils/dateRangeUtils';
import { COMMON_DATE_RANGE_PRESETS, loadJsonStorage, parseIsoDate, parsePreset, parseString, saveJsonStorage } from '../../utils/filterPersistence';

type ActivityParkKey = 'active_not_sampled' | 'active_partial' | 'active_sampled' | 'lifecycle_sampled';
type TaskParkStatus =
  | 'unassigned'
  | 'sampled_in_queue'
  | 'in_progress'
  | 'completed'
  | 'not_reachable'
  | 'invalid_number';

type StockCounts = {
  activities: {
    activeNotSampled: number;
    activePartial: number;
    activeSampled: number;
    lifecycleSampled: number;
    inactive: number;
    notEligible: number;
    superseded: number;
    total: number;
  };
  tasks: {
    unassigned: number;
    sampledInQueue: number;
    inProgress: number;
    completed: number;
    notReachable: number;
    invalidNumber: number;
    cancelled: number;
    total: number;
  };
};

const STORAGE_KEY = 'admin.stockParking.filters';

type SavedFilters = {
  dateFrom: string;
  dateTo: string;
  bu: string;
  state: string;
  selectedPreset: DateRangePreset;
};

function loadSaved(): SavedFilters {
  const fallback = getPresetRange('Last 30 days');
  return loadJsonStorage(
    STORAGE_KEY,
    () => ({
      dateFrom: fallback.start,
      dateTo: fallback.end,
      bu: '',
      state: '',
      selectedPreset: 'Last 30 days' as DateRangePreset,
    }),
    (parsed, defaults) => {
      const p = parsed as Record<string, unknown>;
      return {
        dateFrom: parseIsoDate(p.dateFrom, defaults.dateFrom),
        dateTo: parseIsoDate(p.dateTo, defaults.dateTo),
        bu: parseString(p.bu, defaults.bu),
        state: parseString(p.state, defaults.state),
        selectedPreset: parsePreset(p.selectedPreset, defaults.selectedPreset, COMMON_DATE_RANGE_PRESETS),
      };
    }
  );
}

const ACTIVITY_PARK_ROWS: Array<{
  key: ActivityParkKey;
  label: string;
  hint: string;
  countKey: keyof StockCounts['activities'];
  parkable: boolean;
}> = [
  {
    key: 'active_not_sampled',
    label: 'Active · Not sampled',
    hint: 'Loaded and ready — will be sampled on next run',
    countKey: 'activeNotSampled',
    parkable: true,
  },
  {
    key: 'active_partial',
    label: 'Active · Partial',
    hint: 'Sampling run recorded but no farmers selected',
    countKey: 'activePartial',
    parkable: true,
  },
  {
    key: 'active_sampled',
    label: 'Active · Sampled',
    hint: 'Still marked active but already has sampled farmers',
    countKey: 'activeSampled',
    parkable: true,
  },
  {
    key: 'lifecycle_sampled',
    label: 'Lifecycle · Sampled',
    hint: 'Past sampling; park to stop ad-hoc re-sampling',
    countKey: 'lifecycleSampled',
    parkable: true,
  },
];

const ACTIVITY_READONLY_ROWS: Array<{
  label: string;
  hint: string;
  countKey: keyof StockCounts['activities'];
}> = [
  { label: 'Inactive', hint: 'Already parked', countKey: 'inactive' },
  { label: 'Not eligible', hint: 'Excluded by eligibility rules', countKey: 'notEligible' },
  { label: 'Superseded', hint: 'Closed by prior supersede action', countKey: 'superseded' },
];

const TASK_PARK_ROWS: Array<{
  key: TaskParkStatus;
  label: string;
  countKey: keyof StockCounts['tasks'];
  warn?: boolean;
}> = [
  { key: 'unassigned', label: 'Unassigned', countKey: 'unassigned' },
  { key: 'sampled_in_queue', label: 'Sampled-in-queue', countKey: 'sampledInQueue' },
  { key: 'in_progress', label: 'In progress', countKey: 'inProgress', warn: true },
  { key: 'completed', label: 'Completed', countKey: 'completed', warn: true },
  { key: 'not_reachable', label: 'Not reachable', countKey: 'notReachable' },
  { key: 'invalid_number', label: 'Invalid number', countKey: 'invalidNumber' },
];

const StockParkingView: React.FC = () => {
  const toast = useToast();
  const initial = useMemo(() => loadSaved(), []);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [bu, setBu] = useState(initial.bu);
  const [state, setState] = useState(initial.state);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>(initial.selectedPreset);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(initial.dateFrom);
  const [draftEnd, setDraftEnd] = useState(initial.dateTo);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const [showFilters, setShowFilters] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [counts, setCounts] = useState<StockCounts | null>(null);

  const [selectedActivityKeys, setSelectedActivityKeys] = useState<Set<ActivityParkKey>>(new Set());
  const [selectedTaskStatuses, setSelectedTaskStatuses] = useState<Set<TaskParkStatus>>(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewLines, setPreviewLines] = useState<string>('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isParking, setIsParking] = useState(false);

  useEffect(() => {
    saveJsonStorage(STORAGE_KEY, { dateFrom, dateTo, bu, state, selectedPreset });
  }, [dateFrom, dateTo, bu, state, selectedPreset]);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDatePickerOpen]);

  const loadCounts = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      toast.showError('Select a date range first');
      return;
    }
    setIsLoading(true);
    try {
      const res: any = await adminAPI.getStockParkingCounts({
        dateFrom,
        dateTo,
        bu: bu || undefined,
        state: state || undefined,
      });
      setCounts(res?.data || null);
      setSelectedActivityKeys(new Set());
      setSelectedTaskStatuses(new Set());
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load stock counts');
      setCounts(null);
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo, bu, state, toast]);

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, bu, state]);

  const toggleActivity = (key: ActivityParkKey) => {
    setSelectedActivityKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTask = (key: TaskParkStatus) => {
    setSelectedTaskStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasSelection = selectedActivityKeys.size > 0 || selectedTaskStatuses.size > 0;

  const openPreview = async () => {
    if (!hasSelection) {
      toast.showError('Tick at least one activity cohort or task status');
      return;
    }
    setIsPreviewing(true);
    try {
      const res: any = await adminAPI.previewStockParking({
        dateFrom,
        dateTo,
        bu: bu || undefined,
        state: state || undefined,
        activityKeys: Array.from(selectedActivityKeys),
        taskStatuses: Array.from(selectedTaskStatuses),
      });
      const data = res?.data;
      const act = Number(data?.activitiesToInactivate || 0);
      const tasks = Number(data?.tasksToCancel || 0);
      if (act === 0 && tasks === 0) {
        toast.showError('Nothing to park for the current selection');
        return;
      }
      const warnStatuses = Array.from(selectedTaskStatuses).filter((s) =>
        ['in_progress', 'completed'].includes(s)
      );
      const warn =
        warnStatuses.length > 0
          ? `\n\nWarning: includes ${warnStatuses.join(', ')} — this cannot be undone from this screen.`
          : '';
      setPreviewLines(
        `This will move ${act} activit${act === 1 ? 'y' : 'ies'} → Inactive and cancel ${tasks} task(s) for ${formatPretty(dateFrom)} – ${formatPretty(dateTo)}.${warn}`
      );
      setConfirmOpen(true);
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to preview parking');
    } finally {
      setIsPreviewing(false);
    }
  };

  const applyPark = async () => {
    setIsParking(true);
    try {
      const res: any = await adminAPI.applyStockParking({
        dateFrom,
        dateTo,
        bu: bu || undefined,
        state: state || undefined,
        activityKeys: Array.from(selectedActivityKeys),
        taskStatuses: Array.from(selectedTaskStatuses),
      });
      const data = res?.data;
      toast.showSuccess(
        res?.message ||
          `Parked ${data?.activitiesInactivated ?? 0} activities; cancelled ${data?.tasksCancelled ?? 0} tasks`
      );
      setConfirmOpen(false);
      await loadCounts();
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to park stock');
    } finally {
      setIsParking(false);
    }
  };

  const applyPreset = (p: DateRangePreset) => {
    const r = getPresetRange(p, dateFrom, dateTo);
    setSelectedPreset(p);
    setDraftStart(r.start);
    setDraftEnd(r.end);
    if (p !== 'Custom') {
      setDateFrom(r.start);
      setDateTo(r.end);
      setIsDatePickerOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <InfoBanner title="Stock / Lifecycle Parking">
        Review activity and task counts for a date range, tick the cohorts you want to close, then park.
        Selected activities move to <strong>Inactive</strong> (excluded from future sampling). Selected tasks
        move to <strong>Cancelled</strong>.
      </InfoBanner>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ParkingSquare className="text-slate-700" size={22} />
          <h2 className="text-lg font-black text-slate-900">Stock / Lifecycle Parking</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={16} />
            {showFilters ? 'Hide filters' : 'Filters'}
          </Button>
          <Button variant="secondary" size="sm" onClick={loadCounts} disabled={isLoading}>
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={openPreview}
            disabled={!hasSelection || isPreviewing || isLoading}
          >
            {isPreviewing ? <Loader2 size={16} className="animate-spin" /> : null}
            Park selected
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative" ref={datePickerRef}>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                Date range (required)
              </label>
              <button
                type="button"
                onClick={() => {
                  setDraftStart(dateFrom);
                  setDraftEnd(dateTo);
                  setIsDatePickerOpen((o) => !o);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                <Calendar size={16} className="text-slate-500" />
                <span>
                  {selectedPreset}
                  {dateFrom && dateTo ? ` · ${formatPretty(dateFrom)} – ${formatPretty(dateTo)}` : ''}
                </span>
              </button>
              {isDatePickerOpen && (
                <div className="absolute z-20 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2">
                  {(COMMON_DATE_RANGE_PRESETS as DateRangePreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={`block w-full text-left px-2 py-1.5 text-sm rounded-lg ${
                        selectedPreset === p ? 'bg-lime-50 text-lime-800 font-bold' : 'hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 pt-2 space-y-2">
                    <input
                      type="date"
                      value={draftStart}
                      onChange={(e) => {
                        setDraftStart(e.target.value);
                        setSelectedPreset('Custom');
                      }}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={draftEnd}
                      onChange={(e) => {
                        setDraftEnd(e.target.value);
                        setSelectedPreset('Custom');
                      }}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        if (!draftStart || !draftEnd) return;
                        setDateFrom(draftStart);
                        setDateTo(draftEnd);
                        setSelectedPreset('Custom');
                        setIsDatePickerOpen(false);
                      }}
                    >
                      Apply custom
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">BU (optional)</label>
              <input
                value={bu}
                onChange={(e) => setBu(e.target.value)}
                placeholder="All BUs"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                State (optional)
              </label>
              <input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="All states"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {isLoading && !counts ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Loading counts…
        </div>
      ) : counts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900">Activities</h3>
              <span className="text-xs font-bold text-slate-500">Total {counts.activities.total}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {ACTIVITY_PARK_ROWS.map((row) => {
                const count = Number(counts.activities[row.countKey] || 0);
                const checked = selectedActivityKeys.has(row.key);
                return (
                  <label
                    key={row.key}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 ${
                      count === 0 ? 'opacity-60' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={count === 0}
                      onChange={() => toggleActivity(row.key)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800 text-sm">{row.label}</span>
                        <span className="font-black text-slate-900 tabular-nums">{count}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{row.hint}</p>
                      {checked && (
                        <p className="text-xs text-amber-700 mt-1 font-semibold">Will move → Inactive</p>
                      )}
                    </div>
                  </label>
                );
              })}
              {ACTIVITY_READONLY_ROWS.map((row) => (
                <div key={row.label} className="flex items-start gap-3 px-4 py-3 bg-slate-50/60">
                  <div className="w-4 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-600 text-sm">{row.label}</span>
                      <span className="font-black text-slate-700 tabular-nums">
                        {Number(counts.activities[row.countKey] || 0)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{row.hint} · view only</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900">Tasks</h3>
              <span className="text-xs font-bold text-slate-500">Total {counts.tasks.total}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {TASK_PARK_ROWS.map((row) => {
                const count = Number(counts.tasks[row.countKey] || 0);
                const checked = selectedTaskStatuses.has(row.key);
                return (
                  <label
                    key={row.key}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 ${
                      count === 0 ? 'opacity-60' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={count === 0}
                      onChange={() => toggleTask(row.key)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800 text-sm flex items-center gap-1">
                          {row.label}
                          {row.warn && <AlertTriangle size={12} className="text-amber-500" />}
                        </span>
                        <span className="font-black text-slate-900 tabular-nums">{count}</span>
                      </div>
                      {checked && (
                        <p className="text-xs text-amber-700 mt-1 font-semibold">Will move → Cancelled</p>
                      )}
                    </div>
                  </label>
                );
              })}
              <div className="flex items-start gap-3 px-4 py-3 bg-slate-50/60">
                <div className="w-4 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-600 text-sm">Cancelled</span>
                    <span className="font-black text-slate-700 tabular-nums">{counts.tasks.cancelled}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Already cancelled · view only</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 text-sm">No counts loaded. Set a date range and refresh.</div>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isParking && setConfirmOpen(false)}
        onConfirm={applyPark}
        title="Confirm stock parking"
        message={previewLines}
        confirmText="Park now"
        confirmVariant="danger"
        isLoading={isParking}
      />
    </div>
  );
};

export default StockParkingView;
