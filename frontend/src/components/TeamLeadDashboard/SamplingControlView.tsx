import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, RefreshCw, Save, Play, RotateCcw, Filter, CheckSquare, Square, ChevronDown, Info } from 'lucide-react';
import { samplingAPI, tasksAPI, usersAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import Modal from '../shared/Modal';
import StyledSelect from '../shared/StyledSelect';
import InfoBanner from '../shared/InfoBanner';
import { type DateRangePreset, getPresetRange, formatPretty } from '../../utils/dateRangeUtils';

type LifecycleStatus = 'active' | 'sampled' | 'inactive' | 'not_eligible';

const ALL_ACTIVITY_TYPES = ['Field Day', 'Group Meeting', 'Demo Visit', 'OFM', 'Other'] as const;

type SamplingRunStatus = 'running' | 'completed' | 'failed';
type LatestRun = {
  _id: string;
  status: SamplingRunStatus;
  matched?: number;
  processed?: number;
  tasksCreatedTotal?: number;
  errorCount?: number;
};

type SortKey =
  | 'type'
  | 'totalActivities'
  | 'active'
  | 'sampled'
  | 'inactive'
  | 'notEligible'
  | 'farmersTotal'
  | 'sampledFarmers'
  | 'tasksCreated'
  | 'unassignedTasks';
type SortDir = 'asc' | 'desc';

const SamplingControlView: React.FC = () => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [latestRun, setLatestRun] = useState<LatestRun | null>(null);
  const [isReactivateConfirmOpen, setIsReactivateConfirmOpen] = useState(false);
  const [deleteTasksOnReactivate, setDeleteTasksOnReactivate] = useState<boolean>(false);
  const [reactivatePreview, setReactivatePreview] = useState<{
    matchingActivityCount: number;
    totalTasks: number;
    tasksWithCalls: number;
    tasksWithoutCalls: number;
  } | null>(null);
  const [reactivatePreviewLoading, setReactivatePreviewLoading] = useState(false);
  const [isRunConfirmOpen, setIsRunConfirmOpen] = useState(false);
  const [runConfirmType, setRunConfirmType] = useState<'first_sample' | 'adhoc' | null>(null);
  const [byTypeSort, setByTypeSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const [eligibleTypes, setEligibleTypes] = useState<string[]>([]);
  const [activityCoolingDays, setActivityCoolingDays] = useState<number>(5);
  const [farmerCoolingDays, setFarmerCoolingDays] = useState<number>(30);
  const [defaultPercentage, setDefaultPercentage] = useState<number>(10);
  const [autoRunEnabled, setAutoRunEnabled] = useState<boolean>(false);
  const [autoRunThreshold, setAutoRunThreshold] = useState<number>(200);
  const [autoRunActivateFrom, setAutoRunActivateFrom] = useState<string>('');
  const [taskDueInDays, setTaskDueInDays] = useState<number>(0);

  const [activityFilters, setActivityFilters] = useState(() => {
    const ytd = getPresetRange('YTD');
    return {
      lifecycleStatus: 'active' as LifecycleStatus,
      dateFrom: ytd.start,
      dateTo: ytd.end,
    };
  });

  /** first_sample = auto date range (or manual for very first run); adhoc = user picks date range */
  const [runType, setRunType] = useState<'first_sample' | 'adhoc'>('first_sample');
  const [firstSampleRange, setFirstSampleRange] = useState<{ dateFrom: string; dateTo: string; matchedCount?: number } | null>(null);
  const [isFirstSampleRun, setIsFirstSampleRun] = useState<boolean>(false);

  // Date range dropdown (same UX as Admin Activity Sampling)
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('YTD');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, activityFilters.dateFrom || undefined, activityFilters.dateTo || undefined);

  /** When Run Sample (auto) is selected and no date range is set, use YTD so KPIs and table show YTD data. */
  const effectiveDateRange = useMemo(() => {
    if (runType === 'first_sample' && (!activityFilters.dateFrom || !activityFilters.dateTo)) {
      return getPresetRange('YTD');
    }
    return {
      start: activityFilters.dateFrom || '',
      end: activityFilters.dateTo || '',
    };
  }, [runType, activityFilters.dateFrom, activityFilters.dateTo]);

  const syncDraftFromFilters = () => {
    setDraftStart(activityFilters.dateFrom || '');
    setDraftEnd(activityFilters.dateTo || '');
  };

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (datePickerRef.current && !datePickerRef.current.contains(target)) {
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDatePickerOpen]);

  const [stats, setStats] = useState<any>(null);

  const [unassignedTasks, setUnassignedTasks] = useState<any[]>([]);
  const [selectedUnassignedTaskIds, setSelectedUnassignedTaskIds] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [bulkAssignAgentId, setBulkAssignAgentId] = useState<string>('');
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

  const totalActivities = Number(stats?.totals?.totalActivities || 0);
  const totalMatchingByLifecycle = useMemo(() => {
    const t = stats?.totals;
    if (!t) return 0;
    switch (activityFilters.lifecycleStatus) {
      case 'active':
        return Number(t.active || 0);
      case 'sampled':
        return Number(t.sampled || 0);
      case 'inactive':
        return Number(t.inactive || 0);
      case 'not_eligible':
        return Number(t.notEligible || 0);
      default:
        return 0;
    }
  }, [stats, activityFilters.lifecycleStatus]);

  const loadConfig = async () => {
    const res: any = await samplingAPI.getConfig();
    const cfg = res?.data?.config;
    setConfig(cfg);

    setEligibleTypes(Array.isArray(cfg?.eligibleActivityTypes) ? cfg.eligibleActivityTypes : []);
    setActivityCoolingDays(Number(cfg?.activityCoolingDays ?? 5));
    setFarmerCoolingDays(Number(cfg?.farmerCoolingDays ?? 30));
    setDefaultPercentage(Number(cfg?.defaultPercentage ?? 10));
    setAutoRunEnabled(!!cfg?.autoRunEnabled);
    setAutoRunThreshold(Number(cfg?.autoRunThreshold ?? 200));
    setAutoRunActivateFrom(cfg?.autoRunActivateFrom ? (typeof cfg.autoRunActivateFrom === 'string' ? cfg.autoRunActivateFrom.split('T')[0] : new Date(cfg.autoRunActivateFrom).toISOString().split('T')[0]) : '');
    setTaskDueInDays(Math.max(0, Math.min(365, Number(cfg?.taskDueInDays ?? 0))));
  };

  const loadStats = async () => {
    const res: any = await samplingAPI.getStats({
      dateFrom: effectiveDateRange.start || undefined,
      dateTo: effectiveDateRange.end || undefined,
    });
    setStats(res?.data || null);
  };

  const loadLatestRunStatus = async () => {
    const res: any = await samplingAPI.getLatestRunStatus();
    const run = (res?.data?.run || null) as LatestRun | null;
    setLatestRun(run);
    return run;
  };

  const loadUnassigned = async () => {
    const res: any = await tasksAPI.getUnassignedTasks({ page: 1, limit: 50 });
    setUnassignedTasks(res?.data?.tasks || []);
    setSelectedUnassignedTaskIds(new Set());
  };

  const loadAgents = async () => {
    const res: any = await usersAPI.getTeamAgents();
    const list = res?.data?.agents || [];
    setAgents(list);
  };

  const handleResetSelections = () => {
    // Clear any checked rows and reset filters back to defaults (YTD, same as page load)
    const ytd = getPresetRange('YTD');
    setSelectedUnassignedTaskIds(new Set());
    setBulkAssignAgentId('');
    setSelectedPreset('YTD');
    setActivityFilters({
      lifecycleStatus: 'active',
      dateFrom: ytd.start,
      dateTo: ytd.end,
    });
    toast.showSuccess('Selections cleared');
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        await Promise.all([loadConfig(), loadStats(), loadUnassigned(), loadAgents(), loadLatestRunStatus()]);
      } catch (e: any) {
        toast.showError(e.message || 'Failed to load sampling control data');
      } finally {
        setIsLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (runType !== 'first_sample') return;
    samplingAPI.getFirstSampleRange().then((r: any) => {
      const d = r?.data;
      setIsFirstSampleRun(d?.isFirstRun === true);
      if (d?.dateFrom && d?.dateTo) {
        const fromStr = typeof d.dateFrom === 'string' ? d.dateFrom.split('T')[0] : d.dateFrom;
        const toStr = typeof d.dateTo === 'string' ? d.dateTo.split('T')[0] : d.dateTo;
        setFirstSampleRange({ dateFrom: fromStr, dateTo: toStr, matchedCount: d?.matchedCount });
      } else {
        setFirstSampleRange(null);
      }
    }).catch(() => { setFirstSampleRange(null); setIsFirstSampleRun(false); });
  }, [runType]);

  const isSamplingRunning = latestRun?.status === 'running';
  const progressPct = useMemo(() => {
    const processed = Number(latestRun?.processed ?? 0);
    const matched = Number(latestRun?.matched ?? 0);
    if (!matched || matched <= 0) return 0;
    const pct = Math.round((processed / matched) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [latestRun?.processed, latestRun?.matched]);

  // Poll latest run status while a run is active
  useEffect(() => {
    let timer: any = null;

    // Always do one refresh if we don't have run info yet
    if (!latestRun) {
      loadLatestRunStatus().catch(() => undefined);
    }

    if (isSamplingRunning) {
      timer = setInterval(() => {
        loadLatestRunStatus().catch(() => undefined);
      }, 2000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSamplingRunning]);

  // Auto-refresh dashboard periodically while sampling is running so users see updates
  useEffect(() => {
    if (!isSamplingRunning) return;
    let statsTimer: any = null;
    let tasksTimer: any = null;
    let stopped = false;

    const safeStatsRefresh = async () => {
      try {
        await loadStats();
      } catch {
        // ignore
      }
    };
    const safeTasksRefresh = async () => {
      try {
        await loadUnassigned();
      } catch {
        // ignore
      }
    };

    // refresh immediately
    safeStatsRefresh();
    safeTasksRefresh();

    statsTimer = setInterval(() => {
      if (!stopped) safeStatsRefresh();
    }, 5000);
    tasksTimer = setInterval(() => {
      if (!stopped) safeTasksRefresh();
    }, 10000);

    return () => {
      stopped = true;
      if (statsTimer) clearInterval(statsTimer);
      if (tasksTimer) clearInterval(tasksTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSamplingRunning, activityFilters.dateFrom, activityFilters.dateTo]);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        await Promise.all([loadStats()]);
      } catch (e: any) {
        toast.showError(e.message || 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFilters.lifecycleStatus, activityFilters.dateFrom, activityFilters.dateTo, runType]);

  // When switching to Run Sample (auto), close the date picker so Lifecycle/Date Range are clearly Ad-hoc only
  useEffect(() => {
    if (runType === 'first_sample') setIsDatePickerOpen(false);
  }, [runType]);

  // Note: Activities selection removed. Sampling runs on ALL activities matching current filters.

  const toggleEligibilityType = (type: string) => {
    const set = new Set(eligibleTypes);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    setEligibleTypes(Array.from(set));
  };

  const handleSaveConfig = async () => {
    setIsLoading(true);
    try {
      const payload: Parameters<typeof samplingAPI.updateConfig>[0] = {
        eligibleActivityTypes: eligibleTypes,
        activityCoolingDays: Math.max(0, Math.min(365, activityCoolingDays)),
        farmerCoolingDays: Math.max(0, Math.min(365, farmerCoolingDays)),
        defaultPercentage: Math.max(1, Math.min(100, defaultPercentage)),
        autoRunEnabled,
        autoRunThreshold: Math.max(1, Math.min(100000, autoRunThreshold)),
        taskDueInDays: Math.max(0, Math.min(365, taskDueInDays)),
      };
      if (autoRunActivateFrom?.trim()) payload.autoRunActivateFrom = autoRunActivateFrom.trim();
      await samplingAPI.updateConfig(payload);
      // Requirement: if a type is not selected, activities of that type should move to Not Eligible.
      await samplingAPI.applyEligibility(eligibleTypes);
      toast.showSuccess('Saved & applied');
      await loadConfig();
      await loadStats();
    } catch (e: any) {
      toast.showError(e.message || 'Failed to save config');
    } finally {
      setIsLoading(false);
    }
  };

  // Note: Save & Apply is the single action (save config + apply eligibility).

  const handleRunSampling = async () => {
    if (runType === 'adhoc' || (runType === 'first_sample' && isFirstSampleRun)) {
      if (!activityFilters.dateFrom || !activityFilters.dateTo) {
        toast.showError(runType === 'first_sample' ? 'Select date range for first sample run' : 'Select date range for ad-hoc run');
        return;
      }
      if (runType === 'adhoc' && totalMatchingByLifecycle === 0) {
        toast.showError('No activities match the current filters');
        return;
      }
    }
    setIsLoading(true);
    try {
      setLatestRun({
        _id: 'optimistic',
        status: 'running',
        matched: totalMatchingByLifecycle,
        processed: 0,
        tasksCreatedTotal: 0,
        errorCount: 0,
      });

      const runDateFrom = runType === 'adhoc' ? activityFilters.dateFrom : (runType === 'first_sample' ? (firstSampleRange?.dateFrom ?? activityFilters.dateFrom) : undefined);
      const runDateTo = runType === 'adhoc' ? activityFilters.dateTo : (runType === 'first_sample' ? (firstSampleRange?.dateTo ?? activityFilters.dateTo) : undefined);
      const res: any = await samplingAPI.runSampling({
        runType,
        lifecycleStatus: activityFilters.lifecycleStatus,
        dateFrom: runDateFrom || undefined,
        dateTo: runDateTo || undefined,
      });
      if (runType === 'first_sample' && res?.data?.dateFrom && res?.data?.dateTo) {
        const fromStr = typeof res.data.dateFrom === 'string' ? res.data.dateFrom.split('T')[0] : res.data.dateFrom;
        const toStr = typeof res.data.dateTo === 'string' ? res.data.dateTo.split('T')[0] : res.data.dateTo;
        setSelectedPreset('Custom');
        setActivityFilters((prev) => ({ ...prev, dateFrom: fromStr, dateTo: toStr }));
      }
      toast.showSuccess(
        `Sampling done. Matched: ${res?.data?.matched ?? 0}, Processed: ${res?.data?.processed ?? 0}, Tasks created: ${res?.data?.tasksCreatedTotal ?? 0}`
      );
      await loadStats();
      await loadUnassigned();
      await loadLatestRunStatus();
    } catch (e: any) {
      // If the request timed out on the client, keep polling status instead of showing a hard error
      const msg = e?.message || 'Failed to run sampling';
      if (typeof msg === 'string' && msg.toLowerCase().includes('timed out')) {
        toast.showSuccess('Sampling is still running. Keeping this screen active and checking status...');
        // Keep loading state; polling will stop when run completes, then refresh
        const waitForCompletion = async () => {
          for (let i = 0; i < 180; i++) { // ~6 minutes max
            const run = await loadLatestRunStatus();
            if (run && run.status !== 'running') {
              if (run.runType === 'first_sample' && run.filters?.dateFrom != null && run.filters?.dateTo != null) {
                const fromStr = typeof run.filters.dateFrom === 'string' ? run.filters.dateFrom.split('T')[0] : new Date(run.filters.dateFrom).toISOString().split('T')[0];
                const toStr = typeof run.filters.dateTo === 'string' ? run.filters.dateTo.split('T')[0] : new Date(run.filters.dateTo).toISOString().split('T')[0];
                setSelectedPreset('Custom');
                setActivityFilters((prev) => ({ ...prev, dateFrom: fromStr, dateTo: toStr }));
              }
              await loadStats();
              await loadUnassigned();
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          toast.showError('Sampling is taking longer than expected. Please refresh and check again.');
        };
        await waitForCompletion();
      } else {
        toast.showError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReactivateSelected = async () => {
    if (totalMatchingByLifecycle === 0) {
      toast.showError('No activities match the current filters');
      return;
    }
    setIsReactivateConfirmOpen(true);
    setReactivatePreview(null);
    setReactivatePreviewLoading(true);
    try {
      const res: any = await samplingAPI.getReactivatePreview({
        fromStatus: activityFilters.lifecycleStatus,
        dateFrom: activityFilters.dateFrom || undefined,
        dateTo: activityFilters.dateTo || undefined,
      });
      if (res?.success && res?.data) {
        setReactivatePreview(res.data);
      }
    } catch {
      setReactivatePreview(null);
    } finally {
      setReactivatePreviewLoading(false);
    }
  };

  const confirmReactivate = async () => {
    setIsReactivateConfirmOpen(false);
    setIsLoading(true);
    try {
      await samplingAPI.reactivate({
        confirm: 'YES',
        fromStatus: activityFilters.lifecycleStatus,
        dateFrom: activityFilters.dateFrom || undefined,
        dateTo: activityFilters.dateTo || undefined,
        deleteExistingTasks: deleteTasksOnReactivate,
        deleteExistingAudit: deleteTasksOnReactivate,
      });
      toast.showSuccess('Reactivated activities');
      await loadStats();
      await loadUnassigned();
      await loadLatestRunStatus();
    } catch (e: any) {
      toast.showError(e.message || 'Failed to reactivate');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await Promise.all([loadConfig(), loadStats(), loadUnassigned()]);
      toast.showSuccess('Refreshed');
    } catch (e: any) {
      toast.showError(e.message || 'Failed to refresh');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedUnassignedCount = selectedUnassignedTaskIds.size;
  const toggleUnassignedSelection = (id: string) => {
    const next = new Set(selectedUnassignedTaskIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUnassignedTaskIds(next);
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignAgentId) {
      toast.showError('Select an agent for assignment');
      return;
    }
    if (selectedUnassignedCount === 0) {
      toast.showError('Select at least one unassigned task');
      return;
    }
    setIsLoading(true);
    try {
      await tasksAPI.bulkReassignTasks(Array.from(selectedUnassignedTaskIds), bulkAssignAgentId);
      toast.showSuccess('Assigned tasks to agent');
      await loadUnassigned();
      setBulkAssignAgentId('');
    } catch (e: any) {
      toast.showError(e.message || 'Failed to assign tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const lifecycleLabel = (s: string) => {
    const map: Record<string, string> = {
      active: 'Active',
      sampled: 'Sampled',
      inactive: 'Inactive',
      not_eligible: 'Not Eligible',
    };
    return map[s] || s;
  };

  const eligibleSummary = useMemo(() => {
    if (!eligibleTypes.length) return 'All types eligible';
    return eligibleTypes.join(', ');
  }, [eligibleTypes]);

  // Stable row order: by default keep a fixed type order so positions never jump on refresh.
  const TYPE_ORDER: string[] = ['Field Day', 'Group Meeting', 'Demo Visit', 'OFM', 'Other'];
  const typeRank = (t: string) => {
    const idx = TYPE_ORDER.indexOf(t);
    return idx === -1 ? 999 : idx;
  };

  const sortedByTypeRows = useMemo(() => {
    const rows: any[] = Array.isArray(stats?.byType) ? [...stats.byType] : [];
    const decorated = rows.map((row, idx) => ({ row, idx }));

    const getNum = (v: any) => (typeof v === 'number' ? v : Number(v || 0));

    const cmp = (a: any, b: any) => {
      // Default: fixed order only (no sorting selected)
      if (!byTypeSort) {
        const ar = typeRank(a.row.type);
        const br = typeRank(b.row.type);
        if (ar !== br) return ar - br;
        return a.idx - b.idx;
      }

      const { key, dir } = byTypeSort;
      let diff = 0;

      if (key === 'type') {
        diff = typeRank(a.row.type) - typeRank(b.row.type);
      } else {
        diff = getNum(a.row[key]) - getNum(b.row[key]);
      }

      if (diff !== 0) return dir === 'asc' ? diff : -diff;

      // Tie-breaker: fixed type order, then original index (stable)
      const ar = typeRank(a.row.type);
      const br = typeRank(b.row.type);
      if (ar !== br) return ar - br;
      return a.idx - b.idx;
    };

    decorated.sort(cmp);
    return decorated.map((d) => d.row);
  }, [stats, byTypeSort]);

  const toggleByTypeSort = (key: SortKey) => {
    setByTypeSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null; // third click resets to fixed default order
    });
  };

  const sortIndicator = (key: SortKey) => {
    if (!byTypeSort || byTypeSort.key !== key) return '';
    return byTypeSort.dir === 'asc' ? ' ▲' : ' ▼';
  };

  const openRunConfirm = () => {
    if (runType === 'adhoc') {
      if (!activityFilters.dateFrom || !activityFilters.dateTo) {
        toast.showError('Select date range for ad-hoc run');
        return;
      }
      if (totalMatchingByLifecycle === 0) {
        toast.showError('No activities match the current filters');
        return;
      }
    }
    if (runType === 'first_sample' && isFirstSampleRun && (!activityFilters.dateFrom || !activityFilters.dateTo)) {
      toast.showError('Select date range for first sample run');
      return;
    }
    setRunConfirmType(runType);
    setIsRunConfirmOpen(true);
  };

  const confirmRunSampling = async () => {
    setIsRunConfirmOpen(false);
    setRunConfirmType(null);
    await handleRunSampling();
  };

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      <Modal
        isOpen={isRunConfirmOpen}
        onClose={() => { setIsRunConfirmOpen(false); setRunConfirmType(null); }}
        title={runConfirmType === 'adhoc' ? 'Confirm Ad-hoc sample' : 'Confirm Run Sample'}
        size="md"
      >
        <div className="space-y-4">
          {runConfirmType === 'first_sample' && (
            <>
              <p className="text-sm font-bold text-slate-800">Run Sample (auto date range)</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm text-slate-800">
                <p><strong>Date range for this run:</strong> {firstSampleRange?.dateFrom && firstSampleRange?.dateTo ? `${formatPretty(firstSampleRange.dateFrom)} – ${formatPretty(firstSampleRange.dateTo)}` : '(determined automatically)'}</p>
                <p><strong>Activities that will be sampled:</strong> {firstSampleRange?.matchedCount != null ? firstSampleRange.matchedCount : '—'}</p>
              </div>
              <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside">
                <li><strong>Activities:</strong> Only <strong>Active</strong> activities that have <strong>never been sampled</strong>.</li>
                <li><strong>Date range:</strong> Chosen automatically — first run: earliest to latest activity date; later runs: last run end date (inclusive) to today.</li>
                <li><strong>Lifecycle:</strong> Fixed by the system; you do not select it.</li>
                <li><strong>Tasks:</strong> Created only for farmers not already sampled for that activity (same farmer is not sampled again).</li>
              </ul>
            </>
          )}
          {runConfirmType === 'adhoc' && (
            <>
              <p className="text-sm font-bold text-slate-800">Run Ad-hoc sample</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm text-slate-800">
                <p><strong>Date range for this run:</strong> {formatPretty(activityFilters.dateFrom)} – {formatPretty(activityFilters.dateTo)}</p>
                <p><strong>Activities that will be sampled:</strong> {totalMatchingByLifecycle}</p>
                <p><strong>Lifecycle:</strong> {activityFilters.lifecycleStatus}</p>
              </div>
              <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside">
                <li><strong>Activities:</strong> All activities in your selected <strong>Lifecycle</strong> and <strong>Date range</strong> (Active, Sampled, Inactive, or Not Eligible). Already-sampled activities are included.</li>
                <li><strong>Date range:</strong> Your selected start and end date.</li>
                <li><strong>Lifecycle:</strong> Your selected lifecycle.</li>
                <li><strong>Tasks:</strong> Created only for farmers not already sampled for that activity (same farmer is not sampled again).</li>
              </ul>
            </>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setIsRunConfirmOpen(false); setRunConfirmType(null); }}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRunSampling}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black"
            >
              Confirm
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isReactivateConfirmOpen}
        onClose={() => setIsReactivateConfirmOpen(false)}
        title="Confirm Reactivation"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 font-medium">
            Reactivate <span className="font-black">{totalMatchingByLifecycle}</span> matching activities to{' '}
            <span className="font-black">Active</span>?
          </p>
          {reactivatePreviewLoading ? (
            <p className="text-xs text-slate-500">Loading task counts…</p>
          ) : reactivatePreview ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm text-slate-700">
              <p className="font-bold text-slate-800">Tasks for these activities</p>
              {reactivatePreview.totalTasks === 0 ? (
                <p>No existing tasks for these activities.</p>
              ) : (
                <p>
                  <span className="font-semibold">{reactivatePreview.totalTasks}</span> total task(s).
                  {reactivatePreview.tasksWithCalls > 0 && (
                    <> <span className="font-semibold">{reactivatePreview.tasksWithCalls}</span> have call(s) made and will <span className="font-bold text-green-700">not</span> be deleted.</>
                  )}
                  {reactivatePreview.tasksWithoutCalls > 0 && (
                    <> <span className="font-semibold">{reactivatePreview.tasksWithoutCalls}</span> have no call and can be deleted if you choose Yes below.</>
                  )}
                </p>
              )}
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-700">Delete tasks</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="deleteTasksOnReactivate"
                  checked={!deleteTasksOnReactivate}
                  onChange={() => setDeleteTasksOnReactivate(false)}
                  className="rounded-full border-slate-300 text-slate-900 focus:ring-lime-400"
                />
                <span className="text-sm font-medium text-slate-800">No</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="deleteTasksOnReactivate"
                  checked={deleteTasksOnReactivate}
                  onChange={() => setDeleteTasksOnReactivate(true)}
                  className="rounded-full border-slate-300 text-slate-900 focus:ring-lime-400"
                />
                <span className="text-sm font-medium text-slate-800">Yes</span>
              </label>
            </div>
            <p className="text-xs text-slate-500">
              {deleteTasksOnReactivate
                ? 'Only tasks with no call made will be deleted. Tasks with calls are always kept. Sampling audit will be removed for these activities.'
                : 'Existing tasks and sampling audit are kept; activities are only set back to Active.'}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsReactivateConfirmOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReactivate}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black disabled:opacity-50"
              disabled={isLoading}
            >
              Yes
            </button>
          </div>
        </div>
      </Modal>

      <InfoBanner title="Sampling Control">
        Configure eligibility and cooling, then run Sampling Run or Adhoc Run to create Unassigned tasks. Task due in (days) sets the scheduled date for new tasks.
      </InfoBanner>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Sampling Control</h2>
            <p className="text-sm text-slate-600">Configure eligibility + cooling, then run sampling (creates Unassigned tasks)</p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold"
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">Activity cooling (days)</label>
                <input
                  type="number"
                  value={activityCoolingDays}
                  onChange={(e) => setActivityCoolingDays(Number(e.target.value))}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">Farmer cooling (days)</label>
                <input
                  type="number"
                  value={farmerCoolingDays}
                  onChange={(e) => setFarmerCoolingDays(Number(e.target.value))}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">Default sampling %</label>
                <input
                  type="number"
                  value={defaultPercentage}
                  onChange={(e) => setDefaultPercentage(Number(e.target.value))}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap" title="Due date for new tasks = today + this many days (0 = today). Applies to Sampling Run and Adhoc Run.">Task due in (days)</label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={taskDueInDays}
                  onChange={(e) => setTaskDueInDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
                <p className="text-[10px] text-slate-500 mt-0.5">0 = today. Used for new tasks when running sampling.</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Eligible activity types</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_ACTIVITY_TYPES.map((t) => {
                  const checked = eligibleTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleEligibilityType(t)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-bold ${
                        checked ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                      {t}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-2">Current: {eligibleSummary}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Automatic later run (cron)</p>
              <p className="text-xs text-slate-600">When the scheduler calls POST /api/sampling/auto-run, it will run a later Run Sample only if enabled, on or after the activate-from date, and when unsampled activities ≥ threshold.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRunEnabled}
                  onChange={(e) => setAutoRunEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span className="text-sm font-bold text-slate-800">Enable auto-run</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Run when unsampled ≥</label>
                  <input
                    type="number"
                    min={1}
                    value={autoRunThreshold}
                    onChange={(e) => setAutoRunThreshold(Number(e.target.value) || 200)}
                    className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Activate from date</label>
                  <input
                    type="date"
                    value={autoRunActivateFrom}
                    onChange={(e) => setAutoRunActivateFrom(e.target.value)}
                    className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400"
                  />
                  <p className="text-xs text-slate-500 mt-1">Leave empty to allow runs immediately when enabled</p>
                </div>
              </div>
              <p className="text-sm text-slate-700 mt-2">
                <strong>Last auto-run:</strong>{' '}
                {config?.lastAutoRunAt ? (
                  <>
                    {new Date(config.lastAutoRunAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    {typeof config.lastAutoRunMatched === 'number' && (
                      <> • Ran <strong>{config.lastAutoRunMatched}</strong> activities</>
                    )}
                    {typeof config.lastAutoRunTasksCreated === 'number' && (
                      <> • <strong>{config.lastAutoRunTasksCreated}</strong> tasks created</>
                    )}
                  </>
                ) : (
                  'Never'
                )}
              </p>
            </div>
          </div>

          <div className="space-y-3 flex items-start">
            <button
              onClick={handleSaveConfig}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black"
            >
              <Save size={16} />
              Save & Apply
            </button>
          </div>
        </div>
      </div>

      {/* Quick Dashboard */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black text-slate-900">Sampling Dashboard</h3>
            <p className="text-sm text-slate-600 break-words">
              Quick view by activity type for the selected date range
              {effectiveDateRange.start && effectiveDateRange.end
                ? ` • ${formatPretty(effectiveDateRange.start)} - ${formatPretty(effectiveDateRange.end)}`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleResetSelections}
              disabled={isLoading || isSamplingRunning}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black disabled:opacity-50"
              title="Reset lifecycle/date range filters"
            >
              <RotateCcw size={16} />
              Reset
            </button>
            <button
              onClick={openRunConfirm}
              disabled={
                isLoading ||
                isSamplingRunning ||
                (runType === 'adhoc' && (!activityFilters.dateFrom || !activityFilters.dateTo))
              }
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black disabled:opacity-50"
            >
              <Play size={16} />
              {runType === 'first_sample' ? (isFirstSampleRun ? 'Run first sample (auto range)' : 'Run Sample') : `Run ad-hoc sampling (${totalMatchingByLifecycle} in range)`}
            </button>
            <button
              onClick={handleReactivateSelected}
              disabled={
                isLoading ||
                isSamplingRunning ||
                totalMatchingByLifecycle === 0 ||
                activityFilters.lifecycleStatus === 'active'
              }
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black disabled:opacity-50"
            >
              <RotateCcw size={16} />
              Reactivate (All {totalMatchingByLifecycle})
            </button>
          </div>
        </div>

        {/* Latest run status + progress */}
        <div className="mt-2">
          {latestRun ? (
            <div className="text-xs text-slate-600">
              <span className="font-black">Latest run:</span>{' '}
              <span className="font-bold">
                {latestRun.status === 'running'
                  ? 'Running'
                  : latestRun.status === 'completed'
                    ? 'Completed'
                    : 'Failed'}
              </span>
              {typeof latestRun.processed === 'number' && typeof latestRun.matched === 'number' ? (
                <>
                  {' '}
                  • <span className="font-bold">Processed {latestRun.processed}/{latestRun.matched}</span>
                </>
              ) : null}
              {typeof latestRun.tasksCreatedTotal === 'number' ? (
                <>
                  {' '}
                  • <span className="font-bold">Tasks {latestRun.tasksCreatedTotal}</span>
                </>
              ) : null}
              {typeof latestRun.errorCount === 'number' && latestRun.errorCount > 0 ? (
                <>
                  {' '}
                  • <span className="font-bold text-red-700">Errors {latestRun.errorCount}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-slate-500">Latest run: none</div>
          )}

          {isSamplingRunning && (
            <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-green-900">Sampling is running…</div>
                <div className="text-xs font-black text-green-900">{progressPct}%</div>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-green-100 overflow-hidden">
                <div
                  className="h-2 bg-green-700 rounded-full transition-[width] duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-green-900">
                The dashboard will refresh automatically while sampling runs. Please wait until it completes.
              </div>
            </div>
          )}
        </div>

        {/* Run type + Filters (Lifecycle & Date Range shown only for Ad-hoc) */}
        <div className={`mt-4 grid grid-cols-1 gap-3 min-w-0 ${runType === 'adhoc' ? 'md:grid-cols-3' : ''}`}>
          <div className="min-w-0">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Run type</label>
            <StyledSelect
              value={runType}
              onChange={(value) => {
                const next = value as 'first_sample' | 'adhoc';
                setRunType(next);
                const ytd = getPresetRange('YTD');
                setSelectedPreset('YTD');
                if (next === 'first_sample') {
                  setActivityFilters((prev) => ({
                    ...prev,
                    lifecycleStatus: 'active',
                    dateFrom: ytd.start,
                    dateTo: ytd.end,
                  }));
                } else {
                  setActivityFilters((prev) => ({
                    ...prev,
                    lifecycleStatus: 'sampled',
                    dateFrom: ytd.start,
                    dateTo: ytd.end,
                  }));
                }
              }}
              options={[
                { value: 'first_sample', label: isFirstSampleRun ? 'First sample (auto date range)' : 'Run Sample (auto date range)' },
                { value: 'adhoc', label: 'Ad-hoc (pick date range)' },
              ]}
              placeholder="Run type"
            />
          </div>
          {runType === 'adhoc' && (
            <>
              <div className="min-w-0">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Lifecycle</label>
                <StyledSelect
                  value={activityFilters.lifecycleStatus}
                  onChange={(value) => setActivityFilters((p) => ({ ...p, lifecycleStatus: value as LifecycleStatus }))}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                    { value: 'not_eligible', label: 'Not Eligible' },
                    { value: 'sampled', label: 'Sampled' },
                  ]}
                  placeholder="Select lifecycle"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
                <div className="relative" ref={datePickerRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDatePickerOpen((prev) => {
                        const next = !prev;
                        if (!prev && next) {
                          syncDraftFromFilters();
                        }
                        return next;
                      });
                    }}
                    className={`
                      w-full min-h-12 px-4 py-3 rounded-xl border bg-white text-left flex items-center justify-between gap-2
                      transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400
                      ${isDatePickerOpen ? 'border-lime-400 ring-2 ring-lime-400/20' : 'border-slate-200 hover:border-lime-300'}
                    `}
                  >
                    <span className="truncate text-sm font-medium text-slate-900">
                      {selectedPreset}
                      {effectiveDateRange.start && effectiveDateRange.end
                        ? ` • ${formatPretty(effectiveDateRange.start)} - ${formatPretty(effectiveDateRange.end)}`
                        : ''}
                    </span>
                    <ChevronDown
                      size={18}
                      className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isDatePickerOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

              {isDatePickerOpen && (
                <div className="absolute z-50 mt-2 right-0 left-0 sm:left-auto w-[45vw] min-w-[280px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    <div className="w-full sm:w-[42%] min-w-0 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50 p-2">
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

                    <div className="flex-1 p-3 min-w-0">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-3">
                        <div className="flex-1">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">
                            Start date
                          </p>
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
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">
                            End date
                          </p>
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

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setIsDatePickerOpen(false);
                            syncDraftFromFilters();
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActivityFilters((prev) => ({
                              ...prev,
                              dateFrom: draftStart || '',
                              dateTo: draftEnd || '',
                            }));
                            setIsDatePickerOpen(false);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800"
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
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: 'Total Activities', value: stats?.totals?.totalActivities ?? 0, description: 'Number of activities in the selected date range and filters.' },
            { label: 'Active', value: stats?.totals?.active ?? 0, description: 'Activities with lifecycle Active (eligible for first-time sampling).' },
            { label: 'Sampled', value: stats?.totals?.sampled ?? 0, description: 'Activities that have been sampled (first-time or ad-hoc).' },
            { label: 'Inactive', value: stats?.totals?.inactive ?? 0, description: 'Inactive (lifecycle): A sampling run processed this activity but selected zero farmers—e.g. everyone in cooling or already sampled. Not the same as “not active” or “ineligible type”.' },
            {
              label: 'Ineligible for sampling',
              value: stats?.totals?.notEligible ?? 0,
              description:
                'Counts activities whose lifecycle is Not eligible (database). That usually appears after you save eligible types and run Apply eligibility. If the eligible-types list is empty, all types are allowed—this number stays 0. If the list is non-empty but this is 0, check the yellow note when Active rows still use excluded types.',
            },
            { label: 'Distinct farmers', value: stats?.totals?.farmersTotal ?? 0, description: 'Distinct farmers (by mobile number) linked to activities in this date range. Top number is globally unique; each table row counts farmers only within that activity type.' },
            { label: 'Farmers Sampled', value: stats?.totals?.sampledFarmers ?? 0, description: 'Distinct farmers who have at least one call task (first-time + ad-hoc).' },
            { label: 'Tasks Created', value: stats?.totals?.tasksCreated ?? 0, description: 'Total call tasks created for these activities.' },
          ].map((card) => (
            <div
              key={card.label}
              ref={kpiTooltipOpen === card.label ? kpiTooltipRef : undefined}
              className="bg-slate-50 rounded-xl p-3 border border-slate-200 relative flex flex-col"
            >
              <div className="flex items-start gap-1.5 min-h-[2.5rem] shrink-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex-1 min-w-0 leading-tight">{card.label}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setKpiTooltipOpen((prev) => (prev === card.label ? null : card.label));
                  }}
                  className="shrink-0 p-0.5 rounded-full border-0 bg-transparent cursor-pointer text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
                  aria-label={card.description}
                  aria-expanded={kpiTooltipOpen === card.label}
                >
                  <Info className="text-slate-500" size={10} />
                </button>
              </div>
              <p className="text-xl font-black text-slate-900">{card.value}</p>
              {kpiTooltipOpen === card.label && (
                <div
                  className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-xs font-medium text-white shadow-lg"
                  role="tooltip"
                  id={`sampling-kpi-${card.label.replace(/\s+/g, '-')}`}
                >
                  <span className="absolute left-5 -top-1.5 h-0 w-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-slate-700" aria-hidden />
                  <span className="block text-slate-100">{card.description}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {stats?.eligibility?.restrictsByEligibleTypes && (stats.eligibility.activeButTypeExcludedFromList ?? 0) > 0 && (
          <div
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="font-bold text-amber-900">Why “Ineligible for sampling” can be 0 in the table</p>
            <p className="mt-1 text-amber-900/90">
              You are restricting eligible types, but{' '}
              <strong>{stats.eligibility.activeButTypeExcludedFromList}</strong> activities in this date range are still{' '}
              <strong>Active</strong> while their type is <strong>not</strong> on the eligible list. Sampling already skips
              them; the table column only counts rows already marked <strong>Not eligible</strong> in the database. Use{' '}
              <strong>Save &amp; apply eligibility</strong> (or your usual apply step) so those activities move to the Not
              eligible lifecycle—then this column and the KPI will match what you expect.
            </p>
          </div>
        )}

        {!stats?.eligibility?.restrictsByEligibleTypes && stats?.totals && (
          <p className="mt-2 text-xs text-slate-500">
            Eligible activity types list is empty → <span className="font-semibold text-slate-600">all types are allowed</span>{' '}
            for sampling. The Ineligible column stays 0 until activities are marked Not eligible (e.g. after apply eligibility with a
            restricted list).
          </p>
        )}

        <div className="mt-5 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-700">By Activity Type</div>
            <div className="text-xs text-slate-500 min-w-0 max-w-3xl">
              <span className="font-semibold text-slate-600">Activities</span> columns = lifecycle counts (total = active + sampled + inactive + ineligible for sampling).{' '}
              <span className="font-semibold text-slate-600">Inactive</span> = run picked no farmers;{' '}
              <span className="font-semibold text-slate-600">Ineligible</span> = lifecycle Not eligible (see note above when types are restricted).{' '}
              <span className="font-semibold text-slate-600">Farmers</span> / <span className="font-semibold text-slate-600">Call tasks</span> = people and outreach tasks—farmer totals need not match activity totals.
            </div>
          </div>
          <div className="overflow-x-auto min-w-0 -mx-px">
            <table className="min-w-[1180px] w-full text-sm">
              <thead className="bg-white">
                <tr className="text-center">
                  <th
                    rowSpan={2}
                    className="px-3 py-3 text-left align-middle border-b border-slate-200 bg-white min-w-[14rem] w-[14rem] sm:min-w-[16rem] sm:w-[16rem] whitespace-nowrap"
                  >
                    <button type="button" className="hover:text-slate-700 text-left" onClick={() => toggleByTypeSort('type')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Activity type{sortIndicator('type')}</span>
                    </button>
                  </th>
                  <th
                    colSpan={5}
                    className="px-2 py-2.5 border-b border-slate-200 border-r border-slate-300 bg-slate-100/90"
                  >
                    <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Activities</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-snug">
                      Total, Active, Sampled, Inactive (0 farmers selected), Ineligible for sampling (type excluded)
                    </div>
                  </th>
                  <th colSpan={2} className="px-2 py-2.5 border-b border-slate-200 border-r border-slate-300 bg-emerald-50/80">
                    <div className="text-xs font-black text-emerald-900 uppercase tracking-widest">Farmers</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-emerald-800/90 normal-case tracking-normal leading-snug">
                      Distinct people (mobile). Row = this type only; top KPI = all types combined.
                    </div>
                  </th>
                  <th colSpan={2} className="px-2 py-2.5 border-b border-slate-200 bg-sky-50/80">
                    <div className="text-xs font-black text-sky-900 uppercase tracking-widest">Call tasks</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-sky-800/90 normal-case tracking-normal leading-snug">
                      Tasks created for calling. Unassigned = no CC agent on the task yet (matches Task Allocation pool; excludes completed / not reachable / invalid number)
                    </div>
                  </th>
                </tr>
                <tr className="text-left align-bottom border-b border-slate-200">
                  <th className="px-3 py-2.5 bg-slate-50/50">
                    <button
                      type="button"
                      className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left"
                      onClick={() => toggleByTypeSort('totalActivities')}
                    >
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Total{sortIndicator('totalActivities')}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-tight">in range</span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-slate-50/50">
                    <button type="button" className="hover:text-slate-700 text-left" onClick={() => toggleByTypeSort('active')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Active{sortIndicator('active')}
                      </span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-slate-50/50">
                    <button type="button" className="hover:text-slate-700 text-left" onClick={() => toggleByTypeSort('sampled')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Sampled{sortIndicator('sampled')}
                      </span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-slate-50/50">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('inactive')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Inactive{sortIndicator('inactive')}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-tight">run, 0 farmers</span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 border-r border-slate-300 bg-slate-50/50">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('notEligible')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Ineligible{sortIndicator('notEligible')}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-tight">for sampling (type)</span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-emerald-50/40">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('farmersTotal')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Distinct{sortIndicator('farmersTotal')}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-tight">by mobile</span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 border-r border-slate-300 bg-emerald-50/40">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('sampledFarmers')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        With tasks{sortIndicator('sampledFarmers')}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 normal-case tracking-normal leading-tight">≥1 call task</span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-sky-50/40">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('tasksCreated')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Created{sortIndicator('tasksCreated')}
                      </span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 bg-sky-50/40">
                    <button type="button" className="hover:text-slate-700 flex flex-col items-start gap-0.5 text-left" onClick={() => toggleByTypeSort('unassignedTasks')}>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-tight">
                        Unassigned{sortIndicator('unassignedTasks')}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                  {sortedByTypeRows.map((row: any) => (
                  <tr key={row.type} className="bg-white">
                    <td className="px-3 py-3 font-black text-slate-900 whitespace-nowrap min-w-[14rem] sm:min-w-[16rem]">{row.type}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-slate-50/30">{row.totalActivities}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-slate-50/30">{row.active}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-slate-50/30">{row.sampled}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-slate-50/30">{row.inactive}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-slate-50/30 border-r border-slate-200">{row.notEligible}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-emerald-50/20">{row.farmersTotal}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-emerald-50/20 border-r border-slate-200">{row.sampledFarmers}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-sky-50/20">{row.tasksCreated}</td>
                    <td className="px-3 py-3 font-bold text-slate-700 bg-sky-50/20">{row.unassignedTasks}</td>
                  </tr>
                ))}
                  {(!sortedByTypeRows || sortedByTypeRows.length === 0) && (
                  <tr>
                    <td className="px-4 py-6 text-slate-600" colSpan={10}>
                      No activities found in this date range.
                    </td>
                  </tr>
                )}
              </tbody>
              {stats?.totals && (
                <tfoot>
                  <tr className="border-t-2 border-slate-400 bg-slate-100 text-slate-900">
                    <td
                      className="px-3 py-3 font-black whitespace-nowrap min-w-[14rem] sm:min-w-[16rem] align-top"
                      title="These totals are the same values as the metric cards above. Distinct farmers is globally unique (not the sum of per-type rows)."
                    >
                      <span className="block text-xs uppercase tracking-widest text-slate-600">Total</span>
                      <span className="mt-0.5 block text-[10px] font-semibold normal-case tracking-normal text-slate-500 leading-snug">
                        Matches KPI cards
                      </span>
                    </td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-slate-200/50">{stats.totals.totalActivities ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-slate-200/50">{stats.totals.active ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-slate-200/50">{stats.totals.sampled ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-slate-200/50">{stats.totals.inactive ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-slate-200/50 border-r border-slate-300">
                      {stats.totals.notEligible ?? 0}
                    </td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-emerald-100/60">{stats.totals.farmersTotal ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-emerald-100/60 border-r border-slate-300">
                      {stats.totals.sampledFarmers ?? 0}
                    </td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-sky-100/60">{stats.totals.tasksCreated ?? 0}</td>
                    <td className="px-3 py-3 font-black text-slate-800 bg-sky-100/60">{stats.totals.unassignedTasks ?? 0}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Keep config reference to avoid unused warning */}
      <div className="hidden">{config ? lifecycleLabel('active') : ''}{totalActivities}</div>
    </div>
  );
};

export default SamplingControlView;

