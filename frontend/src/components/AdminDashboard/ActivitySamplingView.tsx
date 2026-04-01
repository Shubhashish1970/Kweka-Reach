import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useToast } from '../../context/ToastContext';
import { adminAPI, ffaAPI } from '../../services/api';
import { Loader2, Filter, RefreshCw, ChevronDown, ChevronUp, CheckCircle, XCircle, AlertCircle, Calendar, MapPin, Users as UsersIcon, Activity as ActivityIcon, Phone, User as UserIcon, CheckCircle2, Download, BarChart3, ArrowDownToLine, UserCheck, Package, BarChart, Trash2 } from 'lucide-react';
import Button from '../shared/Button';
import ConfirmationModal from '../shared/ConfirmationModal';
import StyledSelect from '../shared/StyledSelect';
import ExcelUploadFlow from '../shared/ExcelUploadFlow';
import { FFA_ACTIVITY_MAP_FIELDS, FFA_FARMER_MAP_FIELDS } from '../../constants/excelUploadFields';
import InfoBanner from '../shared/InfoBanner';
import { getTaskStatusLabel } from '../../utils/taskStatusLabels';
import { type DateRangePreset, getPresetRange, formatPretty } from '../../utils/dateRangeUtils';

interface ActivitySamplingStatus {
  activity: {
    _id: string;
    type: string;
    date: string;
    officerName: string;
    officerId?: string;
    tmName?: string;
    location: string;
    territory: string;
    farmerIds: string[];
    crops?: string[];
    products?: string[];
  };
  samplingStatus: 'sampled' | 'not_sampled' | 'partial';
  samplingAudit?: {
    samplingPercentage: number;
    totalFarmers: number;
    sampledCount: number;
    createdAt: string;
  };
  tasksCount: number;
  assignedAgents: Array<{
    agentId: string;
    agentName: string;
    agentEmail: string;
    tasksCount: number;
  }>;
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
  };
  farmers?: Array<{
    farmerId: string;
    name: string;
    mobileNumber: string;
    preferredLanguage: string;
    location: string;
    photoUrl?: string;
    isSampled: boolean;
    taskId?: string;
    assignedAgentId?: string;
    assignedAgentName?: string;
    taskStatus?: string;
  }>;
}

type ActivityTableColumnKey =
  | 'expand'
  | 'type'
  | 'samplingStatus'
  | 'date'
  | 'territory'
  | 'bu'
  | 'officer'
  | 'farmersTotal'
  | 'farmersSampled'
  | 'tasksTotal'
  | 'inQueue'
  | 'inProgress'
  | 'completed';

const DEFAULT_ACTIVITY_TABLE_WIDTHS: Record<ActivityTableColumnKey, number> = {
  expand: 56,
  type: 180,
  samplingStatus: 140,
  date: 130,
  territory: 240,
  bu: 170,
  officer: 220,
  farmersTotal: 130,
  farmersSampled: 150,
  tasksTotal: 110,
  inQueue: 110,
  inProgress: 120,
  completed: 110,
};

const ActivitySamplingView: React.FC = () => {
  const { showError, showSuccess } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [activities, setActivities] = useState<ActivitySamplingStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsData, setStatsData] = useState<any | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('admin.activitySampling.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 50;
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });
  const [isIncrementalSyncing, setIsIncrementalSyncing] = useState(false);
  const [isFullSyncing, setIsFullSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    running: boolean;
    activitiesSynced: number;
    totalActivities: number;
    farmersSynced: number;
    errorCount: number;
    syncType: 'full' | 'incremental' | null;
    message: string;
    lastResult?: {
      activitiesSynced: number;
      farmersSynced: number;
      errors: string[];
      syncType: 'full' | 'incremental';
      skipped?: boolean;
      skipReason?: string;
    };
  } | null>(null);
  const syncProgressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncAt: string | null; totalActivities: number; totalFarmers: number } | null>(null);
  const [dataSource, setDataSource] = useState<'api' | 'excel'>(() => {
    const v = localStorage.getItem('admin.activitySampling.dataSource');
    return v === 'excel' ? 'excel' : 'api';
  });
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    running: boolean;
    activitiesProcessed: number;
    totalActivities: number;
    farmersProcessed: number;
    totalFarmers: number;
    totalQualifiedActivities?: number;
    totalQualifiedFarmers?: number;
    loadedQualifiedActivities?: number;
    loadedQualifiedFarmers?: number;
    errorCount: number;
    message: string;
  } | null>(null);
  const [importReport, setImportReport] = useState<any | null>(null);
  const [dataBatches, setDataBatches] = useState<
    Array<{
      batchId: string;
      activityCount: number;
      lastSyncedAt: string | null;
      source: 'excel' | 'sync' | 'unknown';
      canDelete: boolean;
      blockReason?: string;
    }>
  >([]);
  const [dataBatchesLoading, setDataBatchesLoading] = useState(false);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<{ key: ActivityTableColumnKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('admin.activitySampling.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    } catch {
      // ignore
    }
    return { key: 'date', dir: 'desc' };
  });
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<ActivityTableColumnKey, number>>(() => {
    const raw = localStorage.getItem('admin.activitySampling.tableColumnWidths');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return { ...DEFAULT_ACTIVITY_TABLE_WIDTHS, ...parsed };
    } catch {
      // ignore
    }
    return { ...DEFAULT_ACTIVITY_TABLE_WIDTHS };
  });
  const resizingRef = useRef<{ key: ActivityTableColumnKey; startX: number; startWidth: number } | null>(null);
  const [filters, setFilters] = useState(() => {
    const r = getPresetRange('Last 7 days');
    return {
      activityType: '',
      territory: '',
      zone: '',
      bu: '',
      samplingStatus: '' as 'sampled' | 'not_sampled' | 'partial' | '',
      dateFrom: r.start,
      dateTo: r.end,
    };
  });

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Last 7 days');
  const [draftStart, setDraftStart] = useState(() => getPresetRange('Last 7 days').start);
  const [draftEnd, setDraftEnd] = useState(() => getPresetRange('Last 7 days').end);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const syncDraftFromFilters = () => {
    const start = filters.dateFrom || getRange(selectedPreset).start;
    const end = filters.dateTo || getRange(selectedPreset).end;
    setDraftStart(start);
    setDraftEnd(end);
  };

  const [filterOptions, setFilterOptions] = useState<{ territoryOptions: string[]; zoneOptions: string[]; buOptions: string[] }>({
    territoryOptions: [],
    zoneOptions: [],
    buOptions: [],
  });

  const fetchFilterOptions = async () => {
    try {
      const res: any = await adminAPI.getActivitiesSamplingFilterOptions({
        activityType: filters.activityType || undefined,
        territory: filters.territory || undefined,
        zone: filters.zone || undefined,
        bu: filters.bu || undefined,
        samplingStatus: filters.samplingStatus || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      if (res?.success && res?.data) {
        setFilterOptions({
          territoryOptions: Array.isArray(res.data.territoryOptions) ? res.data.territoryOptions : [],
          zoneOptions: Array.isArray(res.data.zoneOptions) ? res.data.zoneOptions : [],
          buOptions: Array.isArray(res.data.buOptions) ? res.data.buOptions : [],
        });
      }
    } catch {
      // ignore; don't block UI
    }
  };

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (datePickerRef.current && !datePickerRef.current.contains(target)) {
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isDatePickerOpen]);

  useEffect(() => {
    fetchFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.activityType,
    filters.territory,
    filters.zone,
    filters.bu,
    filters.samplingStatus,
    filters.dateFrom,
    filters.dateTo,
  ]);

  const fetchFilterFingerprint = () =>
    `${filters.activityType}|${filters.territory}|${filters.zone}|${filters.bu}|${filters.samplingStatus}|${filters.dateFrom}|${filters.dateTo}`;
  const fetchFilterFingerprintRef = useRef<string>('');

  const fetchActivities = async (page: number = 1, forceRefresh = false) => {
    const fingerprint = fetchFilterFingerprint();
    fetchFilterFingerprintRef.current = fingerprint;
    setIsLoading(true);
    setError(null);
    try {
      const response = await adminAPI.getActivitiesWithSampling({
        ...filters,
        samplingStatus: filters.samplingStatus || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        limit: pageSize,
        ...(forceRefresh && { _refresh: Date.now() }),
      }) as any;

      if (fetchFilterFingerprintRef.current !== fingerprint) return;

      if (response.success && response.data) {
        const activitiesData = response.data.activities || [];
        if (activitiesData.length > 0) {
          console.log('Activities received:', activitiesData.length);
        }
        setActivities(activitiesData);
        setPagination(response.data.pagination || { page: 1, limit: pageSize, total: 0, pages: 1 });
      }
    } catch (err: any) {
      if (fetchFilterFingerprintRef.current !== fingerprint) return;
      const errorMsg = err.message || 'Failed to load activities';
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    const fingerprint = fetchFilterFingerprint();
    fetchFilterFingerprintRef.current = fingerprint;
    setIsStatsLoading(true);
    try {
      const res: any = await adminAPI.getActivitiesSamplingStats({
        ...filters,
        samplingStatus: filters.samplingStatus || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      if (fetchFilterFingerprintRef.current !== fingerprint) return;
      if (res?.success && res?.data) {
        setStatsData(res.data);
      }
    } catch (err) {
      if (fetchFilterFingerprintRef.current !== fingerprint) return;
      console.error('Failed to fetch activity sampling stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities(1);
    fetchSyncStatus();
    fetchStats();
    fetchDataBatches();
  }, [filters.activityType, filters.territory, filters.zone, filters.bu, filters.samplingStatus, filters.dateFrom, filters.dateTo, pageSize]);

  useEffect(() => {
    localStorage.setItem('admin.activitySampling.dataSource', dataSource);
  }, [dataSource]);

  useEffect(() => {
    localStorage.setItem('admin.activitySampling.pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem('admin.activitySampling.tableSort', JSON.stringify(tableSort));
  }, [tableSort]);

  useEffect(() => {
    localStorage.setItem('admin.activitySampling.tableColumnWidths', JSON.stringify(tableColumnWidths));
  }, [tableColumnWidths]);

  useEffect(() => {
    return () => {
      if (syncProgressPollRef.current) {
        clearInterval(syncProgressPollRef.current);
        syncProgressPollRef.current = null;
      }
    };
  }, []);

  const fetchSyncStatus = async () => {
    try {
      const response = await ffaAPI.getFFASyncStatus() as any;
      if (response.success && response.data) {
        setSyncStatus(response.data);
      }
    } catch (err) {
      // Silently fail - sync status is not critical
      console.error('Failed to fetch sync status:', err);
    }
  };

  const fetchDataBatches = async () => {
    setDataBatchesLoading(true);
    try {
      const res = (await ffaAPI.getDataBatches()) as any;
      if (res?.success && Array.isArray(res?.data?.batches)) {
        setDataBatches(res.data.batches);
      }
    } catch (err) {
      console.error('Failed to fetch data batches:', err);
    } finally {
      setDataBatchesLoading(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      fetchActivities(pagination.page, true),
      fetchStats(),
      fetchSyncStatus(),
      fetchFilterOptions(),
      fetchDataBatches(),
    ]);
  };

  const handleSyncFFA = async (fullSync: boolean = false) => {
    if (dataSource !== 'api') {
      showError('Data source is Excel. Switch to API to use Sync options.');
      return;
    }
    if (fullSync) {
      setIsFullSyncing(true);
    } else {
      setIsIncrementalSyncing(true);
    }
    setSyncProgress({ running: true, activitiesSynced: 0, totalActivities: 0, farmersSynced: 0, errorCount: 0, syncType: fullSync ? 'full' : 'incremental', message: 'Starting sync...' });

    try {
      const response = (await ffaAPI.syncFFAData(fullSync)) as any;
      if (!response?.success) {
        showError(response?.message || 'FFA sync failed to start');
        setSyncProgress(null);
        if (fullSync) setIsFullSyncing(false);
        else setIsIncrementalSyncing(false);
        return;
      }
      if (!response.started) {
        // Legacy path: server returned result inline
        const d = response.data || {};
        showSuccess(`FFA sync completed: ${d.activitiesSynced ?? 0} activities, ${d.farmersSynced ?? 0} farmers synced`);
        setSyncProgress(null);
        await fetchActivities(pagination.page);
        await fetchSyncStatus();
        await fetchDataBatches();
        if (fullSync) setIsFullSyncing(false);
        else setIsIncrementalSyncing(false);
        return;
      }

      const poll = async () => {
        try {
          const pr = (await ffaAPI.getFFASyncProgress()) as any;
          const data = pr?.data ?? pr;
          setSyncProgress({
            running: data.running ?? false,
            activitiesSynced: data.activitiesSynced ?? 0,
            totalActivities: data.totalActivities ?? 0,
            farmersSynced: data.farmersSynced ?? 0,
            errorCount: data.errorCount ?? 0,
            syncType: data.syncType ?? null,
            message: data.message ?? '',
            lastResult: data.lastResult,
          });
          if (!data.running) {
            if (syncProgressPollRef.current) {
              clearInterval(syncProgressPollRef.current);
              syncProgressPollRef.current = null;
            }
            const result = data.lastResult;
            if (result?.skipped) {
              showSuccess(result.skipReason || 'Sync skipped');
            } else if (result) {
              showSuccess(`FFA sync completed (${result.syncType}): ${result.activitiesSynced} activities, ${result.farmersSynced} farmers synced${(result.errors?.length ?? 0) > 0 ? `, ${result.errors.length} errors` : ''}`);
            }
            await fetchActivities(pagination.page);
            await fetchSyncStatus();
            await fetchDataBatches();
            if (fullSync) setIsFullSyncing(false);
            else setIsIncrementalSyncing(false);
          }
        } catch (e) {
          console.error('FFA sync progress poll error:', e);
        }
      };

      syncProgressPollRef.current = setInterval(poll, 1500);
      await poll();
    } catch (err: any) {
      showError(err?.message || 'Failed to sync FFA data');
      setSyncProgress(null);
      if (fullSync) setIsFullSyncing(false);
      else setIsIncrementalSyncing(false);
    }
  };

  const confirmDeleteDataBatch = async () => {
    if (!batchDeleteConfirm) return;
    setDeletingBatchId(batchDeleteConfirm);
    try {
      const res = (await ffaAPI.deleteDataBatch(batchDeleteConfirm)) as any;
      showSuccess(
        res?.message
          ? `${res.message} Removed ${res?.data?.deletedActivities ?? 0} activities, ${res?.data?.deletedFarmers ?? 0} farmers.`
          : 'Batch deleted.'
      );
      // Clear prior Excel import summary/progress since the underlying batch data may be gone now.
      setImportProgress(null);
      setImportReport(null);
      setBatchDeleteConfirm(null);
      await fetchDataBatches();
      await fetchActivities(pagination.page);
      await fetchStats();
      await fetchSyncStatus();
    } catch (err: any) {
      showError(err?.message || 'Failed to delete batch');
    } finally {
      setDeletingBatchId(null);
    }
  };

  const handleDownloadActivitiesExport = async () => {
    setIsExporting(true);
    try {
      await adminAPI.downloadActivitiesSamplingExport({
        ...filters,
        samplingStatus: filters.samplingStatus || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      showSuccess('Excel downloaded');
    } catch (err: any) {
      showError(err?.message || 'Failed to download excel');
    } finally {
      setIsExporting(false);
    }
  };

  const getSamplingStatusBadge = (status: 'sampled' | 'not_sampled' | 'partial') => {
    const config = {
      sampled: { icon: CheckCircle, color: 'bg-green-100 text-green-800 border-green-200', label: 'Full' },
      not_sampled: { icon: XCircle, color: 'bg-slate-100 text-slate-800 border-slate-200', label: 'Not Sampled' },
      partial: { icon: AlertCircle, color: 'bg-orange-100 text-orange-800 border-orange-200', label: 'Partial (no farmers selected)' },
    };
    const { icon: Icon, color, label } = config[status];
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${color}`}>
        <Icon size={14} />
        {label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const toggleExpand = (activityId: string) => {
    setExpandedActivity(expandedActivity === activityId ? null : activityId);
  };

  const getSortValue = (item: ActivitySamplingStatus, key: ActivityTableColumnKey): string | number => {
    const a: any = item.activity as any;
    switch (key) {
      case 'expand':
        return 0;
      case 'type':
        return (item.activity.type || '').toLowerCase();
      case 'samplingStatus':
        return item.samplingStatus;
      case 'date':
        return new Date(item.activity.date).getTime() || 0;
      case 'territory':
        return ((a.territoryName || item.activity.territory || '') as string).toLowerCase();
      case 'bu':
        return ((a.buName || '') as string).toLowerCase();
      case 'officer':
        return (item.activity.officerName || '').toLowerCase();
      case 'farmersTotal':
        return item.activity.farmerIds?.length || 0;
      case 'farmersSampled':
        return item.samplingAudit?.sampledCount || 0;
      case 'tasksTotal': {
        const b = item.statusBreakdown;
        if (b) {
          return (b.sampled_in_queue || 0) + (b.in_progress || 0) + (b.completed || 0) + (b.not_reachable || 0) + (b.invalid_number || 0);
        }
        return item.tasksCount || 0;
      }
      case 'inQueue':
        return item.statusBreakdown?.sampled_in_queue || 0;
      case 'inProgress':
        return item.statusBreakdown?.in_progress || 0;
      case 'completed':
        return item.statusBreakdown?.completed || 0;
      default:
        return '';
    }
  };

  const sortedActivities = useMemo(() => {
    const { key, dir } = tableSort;
    const mapped = activities.map((item, idx) => ({ item, idx }));
    mapped.sort((x, y) => {
      const ax = getSortValue(x.item, key);
      const ay = getSortValue(y.item, key);
      let cmp = 0;
      if (typeof ax === 'number' && typeof ay === 'number') {
        cmp = ax - ay;
      } else {
        cmp = String(ax).localeCompare(String(ay));
      }
      if (cmp === 0) return x.idx - y.idx; // stable
      return dir === 'asc' ? cmp : -cmp;
    });
    return mapped.map((m) => m.item);
  }, [activities, tableSort]);

  const handleHeaderClick = (key: ActivityTableColumnKey) => {
    setTableSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  };

  const startResize = (e: React.MouseEvent, key: ActivityTableColumnKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = tableColumnWidths[key] ?? DEFAULT_ACTIVITY_TABLE_WIDTHS[key];
    resizingRef.current = { key, startX: e.clientX, startWidth };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = ev.clientX - resizingRef.current.startX;
      const next = Math.max(80, resizingRef.current.startWidth + dx);
      setTableColumnWidths((prev) => ({ ...prev, [resizingRef.current!.key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const calculateStatistics = () => {
    const stats = {
      totalActivities: activities.length,
      activitiesWithSampling: 0,
      activitiesFullySampled: 0,
      activitiesPartiallySampled: 0,
      activitiesNotSampled: 0,
      totalFarmers: 0,
      farmersSampled: 0,
      totalTasks: 0,
      tasksSampledInQueue: 0,
      tasksInProgress: 0,
      tasksCompleted: 0,
      tasksNotReachable: 0,
      tasksInvalidNumber: 0,
      tasksUnassigned: 0,
      activitiesWithSamplingAdhoc: 0,
      farmersSampledAdhoc: 0,
      tasksAdhoc: 0,
      tasksWithMismatch: 0,
    };

    activities.forEach((item) => {
      // Count activities by sampling status
      if (item.samplingStatus === 'sampled') {
        stats.activitiesWithSampling++;
        stats.activitiesFullySampled++;
      } else if (item.samplingStatus === 'partial') {
        stats.activitiesWithSampling++;
        stats.activitiesPartiallySampled++;
      } else if (item.samplingStatus === 'not_sampled') {
        stats.activitiesNotSampled++;
      }

      // Count farmers
      const totalFarmersInActivity = item.activity.farmerIds?.length || 0;
      stats.totalFarmers += totalFarmersInActivity;
      
      if (item.samplingAudit) {
        stats.farmersSampled += item.samplingAudit.sampledCount;
      }

      // Count tasks by status from breakdown (this is the accurate count)
      // Each task must have a status, so statusBreakdown sum = actual task count
      if (item.statusBreakdown) {
        const statusSum = 
          (item.statusBreakdown.sampled_in_queue || 0) +
          (item.statusBreakdown.in_progress || 0) +
          (item.statusBreakdown.completed || 0) +
          (item.statusBreakdown.not_reachable || 0) +
          (item.statusBreakdown.invalid_number || 0);
        
        stats.totalTasks += statusSum;
        stats.tasksSampledInQueue += item.statusBreakdown.sampled_in_queue || 0;
        stats.tasksInProgress += item.statusBreakdown.in_progress || 0;
        stats.tasksCompleted += item.statusBreakdown.completed || 0;
        stats.tasksNotReachable += item.statusBreakdown.not_reachable || 0;
        stats.tasksInvalidNumber += item.statusBreakdown.invalid_number || 0;
        stats.tasksUnassigned += item.statusBreakdown.unassigned || 0;

        // Validate: tasksCount should equal statusBreakdown sum
        if (item.tasksCount && item.tasksCount !== statusSum) {
          stats.tasksWithMismatch++;
          console.warn(`Activity ${item.activity._id}: tasksCount (${item.tasksCount}) != statusBreakdown sum (${statusSum})`);
        }
      } else if (item.tasksCount) {
        // Fallback: if no statusBreakdown, use tasksCount
        stats.totalTasks += item.tasksCount;
      }
    });

    return stats;
  };

  const statistics = statsData || calculateStatistics();

  return (
    <div className="space-y-6 min-w-0">
      <InfoBanner>
        Activity statistics and sampling status for the selected date range and filters. Export matches current filters.
      </InfoBanner>

      {/* Header with Filters */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-slate-900 mb-1">Activity Monitoring</h2>
            <p className="text-sm text-slate-600">Monitor FFA activities and their status</p>
            {syncStatus && (
              <p className="text-xs text-slate-500 mt-1">
                Last sync: {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : 'Never'} • 
                {syncStatus.totalActivities} activities • {syncStatus.totalFarmers} farmers
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {/* iPhone-style toggle */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data Source</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black ${dataSource === 'api' ? 'text-slate-900' : 'text-slate-400'}`}>API</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dataSource === 'excel'}
                  onClick={() => setDataSource((p) => (p === 'api' ? 'excel' : 'api'))}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                    dataSource === 'excel' ? 'bg-green-700 border-green-700' : 'bg-slate-200 border-slate-300'
                  }`}
                  title="Toggle data source"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      dataSource === 'excel' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-xs font-black ${dataSource === 'excel' ? 'text-slate-900' : 'text-slate-400'}`}>Excel</span>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter size={16} />
              {showFilters ? 'Hide filters' : 'Filters'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading || isStatsLoading}
            >
              <RefreshCw size={16} className={isLoading || isStatsLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSyncFFA(false)}
              disabled={dataSource !== 'api' || isIncrementalSyncing || isFullSyncing}
              title="Incremental sync: Only syncs new activities since last sync"
            >
              <Download size={16} className={isIncrementalSyncing ? 'animate-spin' : ''} />
              {isIncrementalSyncing ? 'Syncing...' : 'Sync FFA'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleSyncFFA(true)}
              disabled={dataSource !== 'api' || isIncrementalSyncing || isFullSyncing}
              title="Full sync: Syncs all activities (takes longer)"
            >
              <Download size={16} className={isFullSyncing ? 'animate-spin' : ''} />
              {isFullSyncing ? 'Full Syncing...' : 'Full Sync'}
            </Button>
          </div>
        </div>

        {syncProgress && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
              {syncProgress.running ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-widest">
                      FFA Sync in progress ({syncProgress.syncType ?? 'incremental'})
                    </span>
                    <span className="text-sm font-medium text-slate-600">
                      {syncProgress.activitiesSynced} / {syncProgress.totalActivities} activities • {syncProgress.farmersSynced} farmers
                      {syncProgress.errorCount > 0 && ` • ${syncProgress.errorCount} errors`}
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-green-600 transition-all duration-300 rounded-full"
                      style={{
                        width: syncProgress.totalActivities > 0
                          ? `${Math.min(100, (100 * syncProgress.activitiesSynced) / syncProgress.totalActivities)}%`
                          : '0%',
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">{syncProgress.message}</p>
                </>
              ) : syncProgress.lastResult ? (
                <>
                  <div className="font-black text-slate-900 mb-1">Sync Summary</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Activities synced</div>
                      <div className="text-lg font-black text-slate-900">{syncProgress.lastResult.activitiesSynced ?? 0}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Farmers synced</div>
                      <div className="text-lg font-black text-slate-900">{syncProgress.lastResult.farmersSynced ?? 0}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Errors</div>
                      <div className="text-lg font-black text-slate-900">{(syncProgress.lastResult.errors?.length ?? 0)}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</div>
                      <div className="text-sm font-bold text-slate-800">{syncProgress.lastResult.syncType ?? '—'}</div>
                      {syncProgress.lastResult.skipped && syncProgress.lastResult.skipReason && (
                        <div className="text-xs text-slate-600 mt-1">{syncProgress.lastResult.skipReason}</div>
                      )}
                    </div>
                  </div>
                  {(syncProgress.lastResult.errors?.length ?? 0) > 0 && (
                    <div className="mt-3 text-xs text-slate-700">
                      <div className="font-black text-slate-900 mb-1">Errors (first 20)</div>
                      <div className="max-h-32 overflow-auto rounded-xl border border-slate-200 bg-white p-2">
                        {(syncProgress.lastResult.errors ?? []).slice(0, 20).map((e: string, idx: number) => (
                          <div key={idx} className="py-0.5 text-red-700">{e}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setSyncProgress(null)}>
                    Dismiss
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* Filters – expand when Filter button clicked */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Activity Type</label>
                <StyledSelect
                  value={filters.activityType}
                  onChange={(v) => setFilters({ ...filters, activityType: v })}
                  options={[
                    { value: '', label: 'All Types' },
                    { value: 'Field Day', label: 'Field Day' },
                    { value: 'Group Meeting', label: 'Group Meeting' },
                    { value: 'Demo Visit', label: 'Demo Visit' },
                    { value: 'OFM', label: 'OFM' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Territory</label>
                <StyledSelect
                  value={filters.territory}
                  onChange={(v) => setFilters({ ...filters, territory: v })}
                  options={[
                    { value: '', label: 'All Territories' },
                    ...filterOptions.territoryOptions.map((t) => ({ value: t, label: t })),
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Zone</label>
                <StyledSelect
                  value={filters.zone}
                  onChange={(v) => setFilters({ ...filters, zone: v })}
                  options={[
                    { value: '', label: 'All Zones' },
                    ...filterOptions.zoneOptions.map((z) => ({ value: z, label: z })),
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">BU</label>
                <StyledSelect
                  value={filters.bu}
                  onChange={(v) => setFilters({ ...filters, bu: v })}
                  options={[
                    { value: '', label: 'All BUs' },
                    ...filterOptions.buOptions.map((b) => ({ value: b, label: b })),
                  ]}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Sampling Status</label>
                <StyledSelect
                  value={filters.samplingStatus}
                  onChange={(v) => setFilters({ ...filters, samplingStatus: v as any })}
                  options={[
                    { value: '', label: 'All Statuses' },
                    { value: 'sampled', label: 'Full (farmers selected)' },
                    { value: 'not_sampled', label: 'Not Sampled' },
                    { value: 'partial', label: 'Partial (no farmers selected)' },
                  ]}
                />
              </div>
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
                    <div className="absolute z-50 mt-2 right-0 left-auto w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                      <div className="flex flex-col sm:flex-row">
                        <div className="w-full sm:w-56 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50 p-2 shrink-0">
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
                        <div className="flex-1 p-4">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="flex-1">
                              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Start date</p>
                              <input
                                type="date"
                                value={draftStart}
                                onChange={(e) => { setSelectedPreset('Custom'); setDraftStart(e.target.value); }}
                                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                              />
                            </div>
                            <div className="flex-1">
                              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">End date</p>
                              <input
                                type="date"
                                value={draftEnd}
                                onChange={(e) => { setSelectedPreset('Custom'); setDraftEnd(e.target.value); }}
                                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => { setIsDatePickerOpen(false); syncDraftFromFilters(); }}
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
            </div>
          </div>
        )}

        {dataSource === 'excel' && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
                Upload Excel (2 sheets: Activities + Farmers)
              </label>
              <p className="text-xs text-slate-500">
                Excel must include sheet names exactly: <span className="font-bold">Activities</span> and{' '}
                <span className="font-bold">Farmers</span>. Date format:{' '}
                <span className="font-bold">DD/MM/YYYY</span> or <span className="font-bold">YYYY-MM-DD</span>.
              </p>
              <ExcelUploadFlow
                mode="dual-sheet-ffa"
                entityLabel="Activities & Farmers"
                infoTitle="How to import FFA Activities & Farmers via Excel"
                infoBullets={[
                  'Download the template and fill the Activities and Farmers sheets.',
                  'Upload the workbook and map columns if your headers differ from the template.',
                  'Preview rows, then confirm to import into Activity Monitoring.',
                ]}
                template={{
                  label: 'Download template',
                  onDownload: async () => {
                    await ffaAPI.downloadExcelTemplate();
                  },
                }}
                submitLabel="Upload & Import"
                disabled={isImportingExcel}
                activityFields={FFA_ACTIVITY_MAP_FIELDS}
                farmerFields={FFA_FARMER_MAP_FIELDS}
                onImportFile={async (outFile) => {
                  setIsImportingExcel(true);
                  setImportProgress(null);
                  setImportReport(null);
                  try {
                    // Start async job (202) and poll progress until completion.
                    const start = await ffaAPI.importExcel(outFile);
                    showSuccess((start as any)?.message || 'Excel import started');

                    const startTs = Date.now();
                    const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes
                    while (Date.now() - startTs < MAX_WAIT_MS) {
                      // eslint-disable-next-line no-await-in-loop
                      await new Promise((r) => setTimeout(r, 1500));
                      // eslint-disable-next-line no-await-in-loop
                      const pr = (await ffaAPI.getImportExcelProgress()) as any;
                      const progress = pr?.data ?? pr;
                      if (progress) {
                        setImportProgress({
                          running: !!progress.running,
                          activitiesProcessed: Number(progress.activitiesProcessed || 0),
                          totalActivities: Number(progress.totalActivities || 0),
                          farmersProcessed: Number(progress.farmersProcessed || 0),
                          totalFarmers: Number(progress.totalFarmers || 0),
                          totalQualifiedActivities: progress.totalQualifiedActivities == null ? undefined : Number(progress.totalQualifiedActivities || 0),
                          totalQualifiedFarmers: progress.totalQualifiedFarmers == null ? undefined : Number(progress.totalQualifiedFarmers || 0),
                          loadedQualifiedActivities: progress.loadedQualifiedActivities == null ? undefined : Number(progress.loadedQualifiedActivities || 0),
                          loadedQualifiedFarmers: progress.loadedQualifiedFarmers == null ? undefined : Number(progress.loadedQualifiedFarmers || 0),
                          errorCount: Number(progress.errorCount || 0),
                          message: String(progress.message || ''),
                        });
                      }
                      if (!progress?.running && progress?.lastResult) {
                        setImportProgress(null);
                        setImportReport(progress.lastResult);
                        if ((progress.lastResult?.errorsCount ?? 0) > 0) {
                          showError(`Imported with ${progress.lastResult.errorsCount} errors`);
                        } else {
                          showSuccess('Excel imported successfully');
                        }
                        // Refresh UI
                        // eslint-disable-next-line no-await-in-loop
                        await fetchActivities(1);
                        // eslint-disable-next-line no-await-in-loop
                        await fetchSyncStatus();
                        // eslint-disable-next-line no-await-in-loop
                        await fetchDataBatches();
                        return {
                          ok: true,
                          message: progress.message || 'Excel import completed.',
                          data: progress.lastResult,
                        };
                      }
                    }

                    showError('Excel import is still running. Please refresh and check Import Summary in a moment.');
                    return { ok: false, message: 'Excel import still running.' };
                  } catch (err: any) {
                    showError(err?.message || 'Failed to import Excel');
                    setImportProgress(null);
                    return { ok: false, message: err?.message || 'Failed to import Excel' };
                  } finally {
                    setIsImportingExcel(false);
                  }
                }}
              />

              {importProgress?.running && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-700">Importing Excel…</span>
                    <span className="text-sm font-bold text-slate-600">
                      {Number((importProgress as any).loadedQualifiedActivities ?? importProgress.activitiesProcessed ?? 0)}/
                      {Number((importProgress as any).totalQualifiedActivities ?? importProgress.totalActivities ?? 0)} activities •{' '}
                      {Number((importProgress as any).loadedQualifiedFarmers ?? importProgress.farmersProcessed ?? 0)}/
                      {Number((importProgress as any).totalQualifiedFarmers ?? importProgress.totalFarmers ?? 0)} farmers
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-lime-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                      style={{
                        width: `${(() => {
                          const aRatio = importProgress.totalActivities
                            ? importProgress.activitiesProcessed / importProgress.totalActivities
                            : 0;
                          const fRatio = importProgress.totalFarmers
                            ? importProgress.farmersProcessed / importProgress.totalFarmers
                            : 0;

                          // Unified semantics: percent = (loaded qualified entities) / (total qualified entities)
                          const loadedA = Number((importProgress as any).loadedQualifiedActivities ?? importProgress.activitiesProcessed ?? 0);
                          const loadedF = Number((importProgress as any).loadedQualifiedFarmers ?? importProgress.farmersProcessed ?? 0);
                          const totalA = Number((importProgress as any).totalQualifiedActivities ?? importProgress.totalActivities ?? 0);
                          const totalF = Number((importProgress as any).totalQualifiedFarmers ?? importProgress.totalFarmers ?? 0);
                          const denom = Math.max(0, totalA + totalF);
                          const numer = Math.max(0, loadedA + loadedF);
                          const pct = denom > 0 ? (numer / denom) * 100 : 0;
                          return Math.round(Math.max(0, Math.min(100, pct)));
                        })()}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {importProgress.message || 'Working…'}
                    {importProgress.errorCount > 0 ? ` • ${importProgress.errorCount} errors so far` : ''}
                  </p>
                </div>
              )}

              {importReport && (
                <div className="mt-4 text-sm text-slate-700">
                  <div className="font-black text-slate-900 mb-1">Import Summary</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Activities upserted</div>
                      <div className="text-lg font-black text-slate-900">{importReport.activitiesUpserted ?? 0}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Farmers upserted</div>
                      <div className="text-lg font-black text-slate-900">{importReport.farmersUpserted ?? 0}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Links updated</div>
                      <div className="text-lg font-black text-slate-900">{importReport.linksUpdated ?? 0}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Errors</div>
                      <div className="text-lg font-black text-slate-900">{importReport.errorsCount ?? 0}</div>
                    </div>
                  </div>

                  {Array.isArray(importReport.errors) && importReport.errors.length > 0 && (
                    <div className="mt-3 text-xs text-slate-700">
                      <div className="font-black text-slate-900 mb-1">Errors (first {importReport.errors.length})</div>
                      <div className="max-h-40 overflow-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="text-left px-3 py-2 font-black uppercase tracking-widest text-slate-400">Sheet</th>
                              <th className="text-left px-3 py-2 font-black uppercase tracking-widest text-slate-400">Row</th>
                              <th className="text-left px-3 py-2 font-black uppercase tracking-widest text-slate-400">Message</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {importReport.errors.map((e: any, idx: number) => (
                              <tr key={idx}>
                                <td className="px-3 py-2">{e.sheet}</td>
                                <td className="px-3 py-2">{e.row}</td>
                                <td className="px-3 py-2">{e.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent ingest batches (Excel + API sync) — delete allowed until sampling/tasks exist for that batch */}
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <label className="block text-xs font-black text-amber-900 uppercase tracking-widest">Recent ingest batches</label>
                <p className="text-xs text-amber-800/90 mt-0.5">
                  Each Excel import or FFA sync run tags activities with a batch ID. You can remove a whole batch only if sampling has not created audits or call tasks for those activities yet.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => fetchDataBatches()} disabled={dataBatchesLoading}>
                {dataBatchesLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Refresh
              </Button>
            </div>
            {dataBatchesLoading && dataBatches.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-amber-900">
                <Loader2 size={16} className="animate-spin" /> Loading batches…
              </div>
            ) : dataBatches.length === 0 ? (
              <p className="text-sm text-amber-900/80">No batches yet (import Excel or run an API sync). Older activities may not have a batch ID.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-amber-200/80 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-amber-100/60 text-left text-[10px] font-black uppercase tracking-widest text-amber-900">
                    <tr>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Activities</th>
                      <th className="px-3 py-2">Last synced</th>
                      <th className="px-3 py-2">Batch ID</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {dataBatches.map((b) => (
                      <tr key={b.batchId} className="text-slate-800">
                        <td className="px-3 py-2 font-medium capitalize">{b.source}</td>
                        <td className="px-3 py-2">{b.activityCount}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {b.lastSyncedAt ? new Date(b.lastSyncedAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600 max-w-[200px] truncate" title={b.batchId}>
                          {b.batchId}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {b.canDelete ? (
                            <button
                              type="button"
                              onClick={() => setBatchDeleteConfirm(b.batchId)}
                              disabled={!!deletingBatchId}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-red-700 hover:bg-red-50 border border-red-200 disabled:opacity-50"
                              title="Delete this batch"
                            >
                              {deletingBatchId === b.batchId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              Delete batch
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 text-left inline-block max-w-[220px]" title={b.blockReason}>
                              Not available{b.blockReason ? `: ${b.blockReason}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Statistics Dashboard */}
      {!isStatsLoading && (statsData ? (statistics?.totalActivities || 0) > 0 : (!isLoading && activities.length > 0)) && (
        <div className="bg-white rounded-3xl p-4 mb-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="text-green-700" size={18} />
              <h2 className="text-base font-black text-slate-900">Activity Statistics</h2>
            </div>
            <button
              type="button"
              onClick={handleDownloadActivitiesExport}
              disabled={isLoading || isExporting}
              className={`flex items-center justify-center h-10 w-10 rounded-2xl border transition-colors ${
                isExporting
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-white border-slate-200 text-green-700 hover:bg-slate-50'
              }`}
              title="Download Excel (matches current filters)"
            >
              <ArrowDownToLine size={18} className={isExporting ? 'animate-spin' : ''} />
            </button>
          </div>
          
          {/* Compact Statistics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {/* Activities + Total Farmers */}
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Activities & Farmers</p>
              <p className="text-xl font-black text-slate-900">{statistics.totalActivities}</p>
              <p className="text-xs text-slate-500 mt-0.5 text-left">activities</p>
              <p className="text-xl font-black text-slate-900 mt-1">{statistics.totalFarmers}</p>
              <p className="text-xs text-slate-500 mt-0.5 text-left">unique farmers (by mobile)</p>
            </div>
            {/* With Sampling + Farmers Sampled */}
            <div className="bg-green-50 rounded-xl p-3 border border-green-200 min-w-0 overflow-visible">
              <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Sampled</p>
              <p className="text-xl font-black text-green-800 text-left mt-0.5">{statistics.activitiesWithSampling}</p>
              <p className="text-xs text-green-600 text-left break-words leading-tight" title="Full = farmers selected as per norms; Partial = no farmers selected">
                activity sampled ({statistics.activitiesFullySampled} full, {statistics.activitiesPartiallySampled} partial)
              </p>
              <p className="text-xl font-black text-green-800 text-left mt-1">{statistics.farmersSampled}</p>
              <p className="text-xs text-green-600 text-left break-words leading-tight">
                farmers sampled{statistics.totalFarmerLinks > 0 ? ` (${Math.round((statistics.farmersSampled / statistics.totalFarmerLinks) * 100)}% of farmer-links)` : ''}
              </p>
              {((statistics.activitiesWithSamplingAdhoc ?? 0) > 0 || (statistics.farmersSampledAdhoc ?? 0) > 0) && (
                <p className="text-xs text-green-600/80 mt-0.5 text-left break-words leading-tight">
                  ({statistics.activitiesWithSamplingAdhoc ?? 0} activities, {statistics.farmersSampledAdhoc ?? 0} farmers adhoc)
                </p>
              )}
            </div>
            {/* Total Tasks: number only + Sampling Run / Adhoc breakup */}
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Total Tasks</p>
              <p className="text-xl font-black text-slate-900">{statistics.totalTasks}</p>
              {(statistics.totalTasks > 0) && (
                <p className="text-xs text-slate-500 mt-1 text-left break-words leading-tight">
                  Sampling run: {(statistics.totalTasks ?? 0) - (statistics.tasksAdhoc ?? 0)}, Adhoc: {statistics.tasksAdhoc ?? 0}
                </p>
              )}
              {(statistics.callbackTasks || 0) > 0 && (
                <p className="text-xs text-purple-600 font-bold mt-0.5 text-left break-words leading-tight">
                  incl. {statistics.callbackTasks} callback{statistics.callbackTasks !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Other</p>
              <p className="text-xl font-black text-amber-800">
                {(statistics.tasksUnassigned ?? 0) + (statistics.tasksNotReachable ?? 0) + (statistics.tasksInvalidNumber ?? 0)}
              </p>
              <p className="text-xs text-amber-600 mt-1 text-left break-words leading-tight">
                (unassigned / not reachable / invalid)
              </p>
            </div>
            <div className="bg-yellow-50 rounded-xl p-3 border border-yellow-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-yellow-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">In Queue</p>
              <p className="text-xl font-black text-yellow-800">{statistics.tasksSampledInQueue}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">In Progress</p>
              <p className="text-xl font-black text-blue-800">{statistics.tasksInProgress}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 border border-green-200 min-w-0 overflow-visible text-left">
              <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Completed</p>
              <p className="text-xl font-black text-green-800">{statistics.tasksCompleted}</p>
            </div>
          </div>
        </div>
      )}

      {/* Activities List */}
      {isLoading ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <Loader2 className="animate-spin mx-auto mb-4 text-green-700" size={32} />
          <p className="text-sm text-slate-600 font-medium">Loading activities...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <AlertCircle className="mx-auto mb-4 text-red-500" size={32} />
          <p className="text-sm text-red-600 font-medium mb-4">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => fetchActivities(pagination.page)}>
            Try Again
          </Button>
        </div>
      ) : activities.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <p className="text-sm text-slate-600 font-medium">No activities found</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {(
                      [
                        { key: 'expand', label: '' },
                        { key: 'type', label: 'Type' },
                        { key: 'samplingStatus', label: 'Sampling' },
                        { key: 'date', label: 'Date' },
                        { key: 'territory', label: 'Territory' },
                        { key: 'bu', label: 'BU' },
                        { key: 'officer', label: 'Officer' },
                        { key: 'farmersTotal', label: 'Total Farmers' },
                        { key: 'farmersSampled', label: 'Farmers Sampled' },
                        { key: 'tasksTotal', label: 'Tasks' },
                        { key: 'inQueue', label: 'In Queue' },
                        { key: 'inProgress', label: 'In Progress' },
                        { key: 'completed', label: 'Completed' },
                      ] as Array<{ key: ActivityTableColumnKey; label: string }>
                    ).map((col) => {
                      const isSorted = tableSort.key === col.key;
                      const width = tableColumnWidths[col.key] ?? DEFAULT_ACTIVITY_TABLE_WIDTHS[col.key];
              return (
                        <th
                          key={col.key}
                          className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                          style={{ width, minWidth: width }}
                          onClick={col.key === 'expand' ? undefined : () => handleHeaderClick(col.key)}
                          title="Click to sort"
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate">{col.label}</span>
                            {col.key !== 'expand' && isSorted && (tableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                          </div>
                          <div
                            className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                            onMouseDown={(e) => startResize(e, col.key)}
                            title="Drag to resize"
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedActivities.map((item) => {
                    const isExpanded = expandedActivity === item.activity._id;
                    const a: any = item.activity as any;
                    const territory = String((a.territoryName || item.activity.territory || '') ?? '').trim();
                    const bu = String(a.buName ?? '').trim();
                    const totalFarmers = item.activity.farmerIds?.length || 0;
                    const farmersSampled = item.samplingAudit?.sampledCount ?? null;
                    const tasksTotal = Number(getSortValue(item, 'tasksTotal') || 0);
                    const inQueue = item.statusBreakdown?.sampled_in_queue || 0;
                    const inProgress = item.statusBreakdown?.in_progress || 0;
                    const completed = item.statusBreakdown?.completed || 0;

                    return (
                      <React.Fragment key={item.activity._id}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50">
                          <td
                            className="px-3 py-3 text-sm"
                            style={{
                              width: tableColumnWidths.expand ?? DEFAULT_ACTIVITY_TABLE_WIDTHS.expand,
                              minWidth: tableColumnWidths.expand ?? DEFAULT_ACTIVITY_TABLE_WIDTHS.expand,
                            }}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors"
                              onClick={() => toggleExpand(item.activity._id)}
                              title="Expand / collapse"
                            >
                              {isExpanded ? (
                                <ChevronUp size={16} className="text-slate-500" />
                              ) : (
                                <ChevronDown size={16} className="text-slate-500" />
                              )}
                            </button>
                          </td>
                          <td
                            className="px-3 py-3 text-sm"
                            style={{
                              width: tableColumnWidths.type ?? DEFAULT_ACTIVITY_TABLE_WIDTHS.type,
                              minWidth: tableColumnWidths.type ?? DEFAULT_ACTIVITY_TABLE_WIDTHS.type,
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ActivityIcon size={16} className="text-green-700 flex-shrink-0" />
                              <span className="font-black text-slate-900 truncate">{item.activity.type}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm">{getSamplingStatusBadge(item.samplingStatus)}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{formatDate(item.activity.date)}</td>
                          <td className="px-3 py-3 text-sm text-slate-700 truncate" title={territory || ''}>{territory || '-'}</td>
                          <td className="px-3 py-3 text-sm text-slate-700 truncate" title={bu || ''}>{bu || '-'}</td>
                          <td className="px-3 py-3 text-sm text-slate-700 truncate" title={item.activity.officerName || ''}>{item.activity.officerName || '-'}</td>
                          <td className="px-3 py-3 text-sm font-bold text-slate-900">{totalFarmers}</td>
                          <td className="px-3 py-3 text-sm font-bold text-slate-900">
                            {farmersSampled === null ? '-' : (
                              <span title={item.samplingAudit ? `${item.samplingAudit.samplingPercentage}%` : ''}>{farmersSampled}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-slate-900">{tasksTotal}</td>
                          <td className="px-3 py-3 text-sm font-bold text-yellow-800">{inQueue}</td>
                          <td className="px-3 py-3 text-sm font-bold text-blue-800">{inProgress}</td>
                          <td className="px-3 py-3 text-sm font-bold text-green-800">{completed}</td>
                        </tr>

                  {isExpanded && (
                          <tr className="bg-white">
                            <td colSpan={13} className="px-3 pb-3 pt-2">
                              <div className="space-y-2">
                        {/* Activity Summary Information */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border border-slate-200">
                          {/* Date (When) */}
                          <div className="flex items-start gap-2">
                            <Calendar size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">When</p>
                              <p className="text-xs font-bold text-slate-900">
                                {item.activity.date ? new Date(item.activity.date).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric'
                                }) : 'N/A'}
                              </p>
                            </div>
                          </div>

                          {/* Location */}
                          <div className="flex items-start gap-2">
                            <MapPin size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">Location</p>
                              <p className="text-xs font-bold text-slate-900 truncate" title={item.activity.location || item.activity.territory || 'N/A'}>
                                {item.activity.location || item.activity.territory || 'N/A'}
                              </p>
                              {(item.activity.territoryName || item.activity.zoneName || item.activity.buName) && (
                                <p className="text-[10px] text-slate-600 mt-0.5">
                                  {[item.activity.territoryName, item.activity.zoneName, item.activity.buName].filter(Boolean).join(' • ')}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Number of Farmers */}
                          <div className="flex items-start gap-2">
                            <UsersIcon size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">Number of Farmers</p>
                              <p className="text-xs font-bold text-slate-900">
                                {item.activity.farmerIds?.length || item.samplingAudit?.totalFarmers || 0}
                              </p>
                              {item.samplingAudit && (
                                <p className="text-[10px] text-slate-600 mt-0.5">
                                  {item.samplingAudit.sampledCount} sampled
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Products */}
                          <div className="flex items-start gap-2">
                            <ActivityIcon size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">Products</p>
                              {item.activity.products && item.activity.products.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {item.activity.products.slice(0, 2).map((product, idx) => (
                                    <span key={idx} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium border border-blue-200 truncate max-w-full">
                                      {product}
                                    </span>
                                  ))}
                                  {item.activity.products.length > 2 && (
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                                      +{item.activity.products.length - 2} more
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">No products</p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* FDA & TM Details */}
                        <div>
                          <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                            <UserIcon size={14} className="text-slate-500" />
                            FDA & TM Details
                          </h4>
                          <div className="flex flex-wrap gap-4 p-2 bg-slate-50 rounded-lg border border-slate-200">
                            <div>
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">FDA</p>
                              <p className="text-xs font-bold text-slate-900">
                                {item.activity.officerName || '-'}
                                {item.activity.officerId && (
                                  <span className="text-[10px] font-normal text-slate-600 ml-1">({item.activity.officerId})</span>
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 font-medium mb-0.5">TM</p>
                              <p className="text-xs font-bold text-slate-900">
                                {item.activity.tmName || '-'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Assigned Agents */}
                        {item.assignedAgents.length > 0 && (
                          <div>
                            <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                              <UserCheck size={14} className="text-slate-500" />
                              Assigned Agents
                            </h4>
                            <div className="space-y-1.5">
                              {item.assignedAgents.map((agent) => (
                                <div
                                  key={agent.agentId}
                                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200"
                                >
                                  <div>
                                    <p className="text-xs font-medium text-slate-900">{agent.agentName}</p>
                                    <p className="text-[10px] text-slate-600">{agent.agentEmail}</p>
                                  </div>
                                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                                    {agent.tasksCount} task{agent.tasksCount !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Sampling Audit Details */}
                        {item.samplingAudit && (
                          <div>
                            <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                              <BarChart size={14} className="text-slate-500" />
                              Sampling Details
                            </h4>
                            <div className="flex items-center gap-4 p-2 bg-slate-50 rounded-lg border border-slate-200">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500">Sampling %:</span>
                                <span className="text-xs font-bold text-slate-900">{item.samplingAudit.samplingPercentage}%</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500">Total:</span>
                                <span className="text-xs font-bold text-slate-900">{item.samplingAudit.totalFarmers}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500">Sampled:</span>
                                <span className="text-xs font-bold text-slate-900">{item.samplingAudit.sampledCount}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Crops and Products - Full List */}
                        <div>
                          <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                            <Package size={14} className="text-slate-500" />
                            Activity Details
                          </h4>
                          <div className="space-y-1.5">
                            {item.activity.crops && item.activity.crops.length > 0 ? (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Crops:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {item.activity.crops.map((crop, idx) => (
                                    <span key={idx} className="px-2 py-0.5 bg-green-50 text-green-700 rounded-lg text-[10px] font-medium border border-green-200">
                                      {crop}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Crops:</p>
                                <p className="text-xs text-slate-400">No crops</p>
                              </div>
                            )}
                            {item.activity.products && item.activity.products.length > 0 ? (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Products:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {item.activity.products.map((product, idx) => (
                                    <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-medium border border-blue-200">
                                      {product}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Products:</p>
                                <p className="text-xs text-slate-400">No products</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Farmers List */}
                        {item.farmers && item.farmers.length > 0 ? (
                          <div>
                            <h4 className="text-xs font-black text-slate-700 mb-1.5 flex items-center gap-1.5">
                              <UsersIcon size={14} className="text-slate-500" />
                              Farmers List ({item.farmers.length} of {item.activity.farmerIds?.length || 0})
                              <span className="ml-2 text-[10px] font-normal text-slate-500">
                                ({item.farmers.filter(f => f.isSampled).length} sampled, {item.farmers.filter(f => !f.isSampled).length} not sampled)
                              </span>
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 max-h-80 overflow-y-auto">
                              {item.farmers.map((farmer) => (
                                <div
                                  key={farmer.farmerId}
                                  className={`p-2 rounded-lg border transition-all ${
                                    farmer.isSampled
                                      ? 'bg-green-50 border-green-200'
                                      : 'bg-slate-50 border-slate-200'
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    {/* Farmer Avatar */}
                                    <div className="flex-shrink-0">
                                      {farmer.photoUrl ? (
                                        <img
                                          src={farmer.photoUrl}
                                          alt={farmer.name}
                                          className="w-8 h-8 rounded-full object-cover border border-slate-200"
                                          onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            target.src = '/images/farmer-default-logo.png';
                                          }}
                                        />
                                      ) : (
                                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                                          farmer.isSampled
                                            ? 'bg-green-100 border-green-300'
                                            : 'bg-slate-100 border-slate-300'
                                        }`}>
                                          <UserIcon size={14} className={farmer.isSampled ? 'text-green-700' : 'text-slate-400'} />
                                        </div>
                                      )}
                                    </div>

                                    {/* Farmer Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        <p className="text-xs font-black text-slate-900 truncate">{farmer.name}</p>
                                        {farmer.isSampled ? (
                                          <CheckCircle2 size={12} className="text-green-600 flex-shrink-0" />
                                        ) : (
                                          <XCircle size={12} className="text-slate-400 flex-shrink-0" />
                                        )}
                                      </div>
                                      <div className="space-y-0.5 text-[10px] text-slate-600">
                                        <div className="flex items-center gap-1">
                                          <Phone size={10} />
                                          <span className="font-medium truncate">{farmer.mobileNumber}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <MapPin size={10} />
                                          <span className="truncate">{farmer.location}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className="font-medium">Lang:</span>
                                          <span className="truncate">{farmer.preferredLanguage}</span>
                                        </div>
                                      </div>

                                      {/* Sampling Status Badge */}
                                      {farmer.isSampled && farmer.taskStatus && (
                                        <div className="mt-1.5 pt-1.5 border-t border-green-200">
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] text-green-700 font-medium">Agent:</span>
                                            <span className="text-[10px] font-bold text-green-800 truncate ml-1">{farmer.assignedAgentName || 'Unknown'}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-green-700 font-medium">Status:</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                              farmer.taskStatus === 'sampled_in_queue' ? 'bg-yellow-100 text-yellow-700' :
                                              farmer.taskStatus === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                              farmer.taskStatus === 'completed' ? 'bg-green-100 text-green-700' :
                                              farmer.taskStatus === 'not_reachable' ? 'bg-red-100 text-red-700' :
                                              farmer.taskStatus === 'invalid_number' ? 'bg-red-100 text-red-700' :
                                              'bg-gray-100 text-gray-700'
                                            }`}>
                                              {farmer.taskStatus ? getTaskStatusLabel(farmer.taskStatus) : 'Unknown'}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          // Show message if no farmers or farmers array missing
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
                              <div className="flex-1">
                                <p className="text-sm text-amber-700 font-medium">
                                  {item.activity.farmerIds && item.activity.farmerIds.length > 0
                                    ? `This activity has ${item.activity.farmerIds.length} farmers, but farmer details are not available.`
                                    : 'No farmers are associated with this activity.'}
                                </p>
                                {item.activity.farmerIds && item.activity.farmerIds.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    <p className="text-xs text-amber-600">
                                      Farmers may need to be synced from FFA or farmer documents may not exist in the database.
                                    </p>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handleSyncFFA(false)}
                                      disabled={isIncrementalSyncing || isFullSyncing}
                                      className="mt-2"
                                    >
                                      <Download size={14} className={isIncrementalSyncing ? 'animate-spin' : ''} />
                                      {isIncrementalSyncing ? 'Syncing...' : 'Sync FFA Data'}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
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
          </div>
 

          {/* Pagination */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <p className="text-sm text-slate-600">
                Page {pagination.page} of {pagination.pages} • {pagination.total} total activities
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
                  onClick={() => fetchActivities(pagination.page - 1)}
                  disabled={pagination.page === 1 || isLoading || pagination.pages <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fetchActivities(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages || isLoading || pagination.pages <= 1}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmationModal
        isOpen={!!batchDeleteConfirm}
        onClose={() => setBatchDeleteConfirm(null)}
        onConfirm={confirmDeleteDataBatch}
        title="Delete ingest batch"
        message={
          batchDeleteConfirm
            ? `This permanently removes all activities in this batch and farmers only referenced by them. Blocked if sampling audits or call tasks exist for those activities. Batch: ${batchDeleteConfirm}`
            : ''
        }
        confirmText="Delete batch"
        confirmVariant="danger"
        isLoading={!!deletingBatchId}
      />
    </div>
  );
};

export default ActivitySamplingView;
