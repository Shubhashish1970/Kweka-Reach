import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Filter, RefreshCw, Loader2, Users as UsersIcon, CheckCircle, Clock, XCircle, AlertCircle, Phone, MapPin, ChevronUp, ChevronDown } from 'lucide-react';
import { tasksAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import Modal from '../shared/Modal';
import ConfirmationModal from '../shared/ConfirmationModal';
import Button from '../shared/Button';
import StyledSelect from '../shared/StyledSelect';
import { type DateRangePreset, getPresetRange, formatPretty, formatDateIST } from '../../utils/dateRangeUtils';
import { getTaskStatusLabel, TASK_STATUS_LABELS } from '../../utils/taskStatusLabels';
import TaskQueueTable from './TaskQueueTable';

import { useMasterLanguages } from '../../hooks/useMasterLanguages';

const LANGUAGE_FALLBACK_ORDER = ['Unknown'] as const;

const TASK_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const TASK_PAGE_SIZE_DEFAULT = 20;

interface AgentQueueDetailForTL {
  agent: {
    agentId: string;
    agentName: string;
    agentEmail: string;
    employeeId: string;
    languageCapabilities: string[];
  };
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    total: number;
  };
  tasks: Array<{
    taskId: string;
    farmer: { name: string; mobileNumber: string; preferredLanguage: string; location: string };
    activity: { type: string; date: string; officerName: string; territory: string };
    status: string;
    scheduledDate: string;
    createdAt: string;
  }>;
  tasksTotal?: number;
  page?: number;
  limit?: number;
  officerOptions?: string[];
}

interface LanguageQueueDetailForTL {
  language: string;
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    total: number;
  };
  agentOptions?: Array<{ agentId: string; agentName: string }>;
  tasks: Array<{
    taskId: string;
    farmer: { name: string; mobileNumber: string; preferredLanguage: string; location: string };
    activity: { type: string; date: string; officerName: string; territory: string };
    status: string;
    scheduledDate: string;
    createdAt: string;
    assignedAgentName?: string | null;
  }>;
  tasksTotal?: number;
  page?: number;
  limit?: number;
}

const TaskDashboardView: React.FC = () => {
  const toast = useToast();
  const { languages: masterLanguages } = useMasterLanguages();
  const languageOrder = useMemo(
    () => [...masterLanguages, ...LANGUAGE_FALLBACK_ORDER],
    [masterLanguages]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [allocRun, setAllocRun] = useState<any>(null);

  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', bu: '', state: '' });
  const [allocLanguage, setAllocLanguage] = useState<string>('ALL');
  const [allocCount, setAllocCount] = useState<number>(0);
  const [isAllocConfirmOpen, setIsAllocConfirmOpen] = useState(false);
  const [reallocateAgent, setReallocateAgent] = useState<{ agentId: string; name: string; sampledInQueue: number } | null>(null);
  const [isReallocating, setIsReallocating] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentQueueDetailForTL | null>(null);
  const [agentDetailFilters, setAgentDetailFilters] = useState<{ status: string; fda: string }>({ status: '', fda: '' });
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [selectedLanguageQueue, setSelectedLanguageQueue] = useState<string | null>(null);
  const [languageQueueDetail, setLanguageQueueDetail] = useState<LanguageQueueDetailForTL | null>(null);
  const [languageQueueFilters, setLanguageQueueFilters] = useState<{ agentId: string; status: string }>({ agentId: '', status: '' });
  const [isLoadingLanguageQueue, setIsLoadingLanguageQueue] = useState(false);
  const [isLoadingMoreAgent, setIsLoadingMoreAgent] = useState(false);
  const [isLoadingMoreLanguage, setIsLoadingMoreLanguage] = useState(false);
  const [showMainFilters, setShowMainFilters] = useState(false);
  const [showLanguageQueueFilters, setShowLanguageQueueFilters] = useState(false);
  const [showAgentDetailFilters, setShowAgentDetailFilters] = useState(false);
  const [taskPageSize, setTaskPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('teamLead.queueTasks.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && TASK_PAGE_SIZE_OPTIONS.includes(n as any) ? n : TASK_PAGE_SIZE_DEFAULT;
  });
  const loadMoreAgentRef = useRef<HTMLDivElement | null>(null);
  const loadMoreLanguageRef = useRef<HTMLDivElement | null>(null);

  // Date range dropdown (same UX as Sampling Dashboard)
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Custom');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  const syncDraftFromFilters = () => {
    setDraftStart(filters.dateFrom || '');
    setDraftEnd(filters.dateTo || '');
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
  }, [isDatePickerOpen]);

  const loadDashboard = async () => {
    const res: any = await tasksAPI.getDashboard({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      bu: filters.bu || undefined,
      state: filters.state || undefined,
    });
    setData(res?.data || null);
  };

  const loadLatestAllocationStatus = async () => {
    const res: any = await tasksAPI.getLatestAllocationStatus();
    const run = res?.data?.run || null;
    setAllocRun(run);
    return run;
  };

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        await Promise.all([loadDashboard(), loadLatestAllocationStatus()]);
      } catch (e: any) {
        toast.showError(e.message || 'Failed to load task dashboard');
      } finally {
        setIsLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo, filters.bu, filters.state]);

  const isAllocRunning = allocRun?.status === 'running';
  const allocPct = useMemo(() => {
    const processed = Number(allocRun?.processed ?? 0);
    const total = Number(allocRun?.total ?? 0);
    if (!total || total <= 0) return 0;
    const pct = Math.round((processed / total) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [allocRun?.processed, allocRun?.total]);

  // Poll allocation status + refresh dashboard while allocation is running
  useEffect(() => {
    if (!isAllocRunning) return;
    let statusTimer: any = null;
    let refreshTimer: any = null;

    const tickStatus = async () => {
      try {
        const r = await loadLatestAllocationStatus();
        if (r && r.status !== 'running') {
          // final refresh
          await loadDashboard();
        }
      } catch {
        // ignore
      }
    };

    tickStatus();
    statusTimer = setInterval(tickStatus, 2000);
    refreshTimer = setInterval(() => {
      loadDashboard().catch(() => undefined);
    }, 5000);

    return () => {
      if (statusTimer) clearInterval(statusTimer);
      if (refreshTimer) clearInterval(refreshTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllocRunning]);

  const unassignedRows = useMemo(() => {
    const rows = Array.isArray(data?.unassignedByLanguage) ? [...data.unassignedByLanguage] : [];
    const rank = (l: string) => {
      const idx = languageOrder.findIndex((name) => name.toLowerCase() === String(l).toLowerCase());
      return idx === -1 ? 999 : idx;
    };
    rows.sort((a: any, b: any) => {
      const ar = rank(a.language);
      const br = rank(b.language);
      if (ar !== br) return ar - br;
      return String(a.language).localeCompare(String(b.language));
    });
    return rows;
  }, [data, languageOrder]);

  const unassignedTotalByLanguage = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of unassignedRows as any[]) {
      map.set(r.language, Number(r.unassigned || 0));
    }
    return map;
  }, [unassignedRows]);

  const totalUnassigned = useMemo(() => Number(data?.totals?.totalUnassigned || 0), [data]);
  const totals = useMemo(() => data?.totals || {}, [data]);

  const agentRows = useMemo(() => {
    return Array.isArray(data?.agentWorkload) ? [...data.agentWorkload] : [];
  }, [data]);

  type LanguageTableSortKey = 'language' | 'total' | 'unassigned' | 'sampledInQueue' | 'inProgress' | 'completed' | 'notReachable' | 'invalidNumber';
  type AgentTableSortKey = 'agent' | 'employeeId' | 'languages' | 'sampledInQueue' | 'inProgress' | 'completed' | 'notReachable' | 'invalidNumber' | 'totalOpen';

  const [languageTableSort, setLanguageTableSort] = useState<{ key: LanguageTableSortKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('teamLead.languageTable.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
        const key = parsed.key === 'totalOpen' ? 'total' : parsed.key;
        return { key: key as LanguageTableSortKey, dir: parsed.dir };
      }
    } catch {
      // ignore
    }
    return { key: 'total', dir: 'desc' };
  });
  const [agentTableSort, setAgentTableSort] = useState<{ key: AgentTableSortKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('teamLead.agentWorkload.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    } catch {
      // ignore
    }
    return { key: 'agent', dir: 'asc' };
  });

  useEffect(() => {
    localStorage.setItem('teamLead.languageTable.tableSort', JSON.stringify(languageTableSort));
  }, [languageTableSort]);
  useEffect(() => {
    localStorage.setItem('teamLead.agentWorkload.tableSort', JSON.stringify(agentTableSort));
  }, [agentTableSort]);

  const getLanguageSortValue = (r: any, key: LanguageTableSortKey): string | number => {
    switch (key) {
      case 'language':
        return (r.language || '').toLowerCase();
      case 'total':
        return Number(r.total ?? r.totalOpen ?? 0);
      case 'unassigned':
        return Number(r.unassigned ?? 0);
      case 'sampledInQueue':
        return Number(r.sampledInQueue ?? 0);
      case 'inProgress':
        return Number(r.inProgress ?? 0);
      case 'completed':
        return Number(r.completed ?? 0);
      case 'notReachable':
        return Number(r.notReachable ?? 0);
      case 'invalidNumber':
        return Number(r.invalidNumber ?? 0);
      default:
        return '';
    }
  };
  const getAgentSortValue = (a: any, key: AgentTableSortKey): string | number => {
    switch (key) {
      case 'agent':
        return (a.name || '').toLowerCase();
      case 'employeeId':
        return (a.employeeId || '').toLowerCase();
      case 'languages':
        return (Array.isArray(a.languageCapabilities) ? a.languageCapabilities : []).join(',').toLowerCase();
      case 'sampledInQueue':
        return Number(a.sampledInQueue ?? 0);
      case 'inProgress':
        return Number(a.inProgress ?? 0);
      case 'completed':
        return Number(a.completed ?? 0);
      case 'notReachable':
        return Number(a.notReachable ?? 0);
      case 'invalidNumber':
        return Number(a.invalidNumber ?? 0);
      case 'totalOpen':
        return Number(a.totalOpen ?? 0);
      default:
        return '';
    }
  };

  const sortedOpenByLanguage = useMemo(() => {
    const rows = (data?.openByLanguage || []).map((r: any, idx: number) => ({ r, idx }));
    const { key, dir } = languageTableSort;
    rows.sort((x: { r: any; idx: number }, y: { r: any; idx: number }) => {
      const va = getLanguageSortValue(x.r, key);
      const vb = getLanguageSortValue(y.r, key);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) return x.idx - y.idx;
      return dir === 'asc' ? cmp : -cmp;
    });
    return rows.map((x: { r: any }) => x.r);
  }, [data?.openByLanguage, languageTableSort]);

  const sortedAgentRows = useMemo(() => {
    const rows = agentRows.map((a: any, idx: number) => ({ a, idx }));
    const { key, dir } = agentTableSort;
    rows.sort((x: { a: any; idx: number }, y: { a: any; idx: number }) => {
      const va = getAgentSortValue(x.a, key);
      const vb = getAgentSortValue(y.a, key);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) return x.idx - y.idx;
      return dir === 'asc' ? cmp : -cmp;
    });
    return rows.map((x: { a: any }) => x.a);
  }, [agentRows, agentTableSort]);

  const handleLanguageHeaderClick = (key: LanguageTableSortKey) => {
    setLanguageTableSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const handleAgentHeaderClick = (key: AgentTableSortKey) => {
    setAgentTableSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  // Fetch agent queue detail when Team Lead clicks an agent (or a language link)
  useEffect(() => {
    if (!selectedAgentId) {
      setAgentDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoadingDetail(true);
      try {
        const res: any = await tasksAPI.getDashboardAgent(
          selectedAgentId,
          selectedLanguage ?? undefined,
          1,
          taskPageSize,
          {
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            bu: filters.bu || undefined,
            state: filters.state || undefined,
            status: agentDetailFilters.status || undefined,
            fda: agentDetailFilters.fda || undefined,
          }
        );
        if (!cancelled && res?.data) setAgentDetail(res.data);
      } catch (e: any) {
        if (!cancelled) {
          toast.showError(e?.message || 'Failed to load agent queue');
          setSelectedAgentId(null);
          setSelectedLanguage(null);
          setAgentDetail(null);
        }
      } finally {
        if (!cancelled) setIsLoadingDetail(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedAgentId, selectedLanguage, filters.dateFrom, filters.dateTo, filters.bu, filters.state, agentDetailFilters.status, agentDetailFilters.fda, taskPageSize, toast]);

  // Fetch language queue when Team Lead clicks a language in "Tasks by Language (Open)"
  useEffect(() => {
    if (!selectedLanguageQueue) {
      setLanguageQueueDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoadingLanguageQueue(true);
      try {
        const res: any = await tasksAPI.getDashboardByLanguage(
          selectedLanguageQueue,
          {
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            bu: filters.bu || undefined,
            state: filters.state || undefined,
            agentId: languageQueueFilters.agentId || undefined,
            status: languageQueueFilters.status || undefined,
          },
          1,
          taskPageSize
        );
        if (!cancelled && res?.data) setLanguageQueueDetail(res.data);
      } catch (e: any) {
        if (!cancelled) {
          toast.showError(e?.message || 'Failed to load language queue');
          setSelectedLanguageQueue(null);
          setLanguageQueueDetail(null);
        }
      } finally {
        if (!cancelled) setIsLoadingLanguageQueue(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedLanguageQueue, filters.dateFrom, filters.dateTo, filters.bu, filters.state, languageQueueFilters.agentId, languageQueueFilters.status, taskPageSize, toast]);

  useEffect(() => {
    localStorage.setItem('teamLead.queueTasks.pageSize', String(taskPageSize));
  }, [taskPageSize]);

  const loadMoreAgentTasks = React.useCallback(async () => {
    if (!selectedAgentId || !agentDetail || isLoadingMoreAgent) return;
    const total = agentDetail.tasksTotal ?? 0;
    if (agentDetail.tasks.length >= total) return;
    setIsLoadingMoreAgent(true);
    try {
      const res: any = await tasksAPI.getDashboardAgent(
        selectedAgentId,
        selectedLanguage ?? undefined,
        (agentDetail.page ?? 1) + 1,
        taskPageSize,
        {
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          bu: filters.bu || undefined,
          state: filters.state || undefined,
          status: agentDetailFilters.status || undefined,
          fda: agentDetailFilters.fda || undefined,
        }
      );
      if (res?.data?.tasks?.length)
        setAgentDetail((prev) =>
          prev
            ? {
                ...prev,
                tasks: [...(prev.tasks || []), ...res.data.tasks],
                page: res.data.page ?? (prev.page ?? 1) + 1,
              }
            : null
        );
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load more tasks');
    } finally {
      setIsLoadingMoreAgent(false);
    }
  }, [selectedAgentId, agentDetail, selectedLanguage, taskPageSize, filters, agentDetailFilters, isLoadingMoreAgent, toast]);

  const loadMoreLanguageTasks = React.useCallback(async () => {
    if (!languageQueueDetail || isLoadingMoreLanguage) return;
    const total = languageQueueDetail.tasksTotal ?? 0;
    if (languageQueueDetail.tasks.length >= total) return;
    setIsLoadingMoreLanguage(true);
    try {
      const res: any = await tasksAPI.getDashboardByLanguage(
        languageQueueDetail.language,
        {
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          bu: filters.bu || undefined,
          state: filters.state || undefined,
          agentId: languageQueueFilters.agentId || undefined,
          status: languageQueueFilters.status || undefined,
        },
        (languageQueueDetail.page ?? 1) + 1,
        taskPageSize
      );
      if (res?.data?.tasks?.length)
        setLanguageQueueDetail((prev) =>
          prev
            ? {
                ...prev,
                tasks: [...(prev.tasks || []), ...res.data.tasks],
                page: res.data.page ?? (prev.page ?? 1) + 1,
              }
            : null
        );
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load more tasks');
    } finally {
      setIsLoadingMoreLanguage(false);
    }
  }, [languageQueueDetail, taskPageSize, filters, languageQueueFilters, isLoadingMoreLanguage, toast]);

  // Auto load more when scroll to bottom (Agent Queue)
  useEffect(() => {
    const ref = loadMoreAgentRef.current;
    if (!ref || !agentDetail?.tasksTotal || (agentDetail.tasks?.length ?? 0) >= agentDetail.tasksTotal || isLoadingMoreAgent) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && agentDetail?.tasksTotal != null && (agentDetail.tasks?.length ?? 0) < agentDetail.tasksTotal && !isLoadingMoreAgent) {
          loadMoreAgentTasks();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );
    observer.observe(ref);
    return () => observer.disconnect();
  }, [agentDetail?.tasks?.length, agentDetail?.tasksTotal, isLoadingMoreAgent, loadMoreAgentTasks]);

  // Auto load more when scroll to bottom (Language Queue)
  useEffect(() => {
    const ref = loadMoreLanguageRef.current;
    if (!ref || !languageQueueDetail?.tasksTotal || (languageQueueDetail.tasks?.length ?? 0) >= languageQueueDetail.tasksTotal || isLoadingMoreLanguage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && languageQueueDetail?.tasksTotal != null && (languageQueueDetail.tasks?.length ?? 0) < languageQueueDetail.tasksTotal && !isLoadingMoreLanguage) {
          loadMoreLanguageTasks();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );
    observer.observe(ref);
    return () => observer.disconnect();
  }, [languageQueueDetail?.tasks?.length, languageQueueDetail?.tasksTotal, isLoadingMoreLanguage, loadMoreLanguageTasks]);

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { icon: typeof Clock; color: string }> = {
      sampled_in_queue: { icon: Clock, color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      in_progress: { icon: Loader2, color: 'bg-blue-100 text-blue-800 border-blue-200' },
      completed: { icon: CheckCircle, color: 'bg-green-100 text-green-800 border-green-200' },
      not_reachable: { icon: XCircle, color: 'bg-orange-100 text-orange-800 border-orange-200' },
      invalid_number: { icon: AlertCircle, color: 'bg-red-100 text-red-800 border-red-200' },
    };
    const config = statusConfig[status] || statusConfig.sampled_in_queue;
    const Icon = config.icon;
    const label = getTaskStatusLabel(status);
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${config.color}`}>
        <Icon size={12} className={status === 'in_progress' ? 'animate-spin' : ''} />
        {label}
      </span>
    );
  };

  const formatDate = (dateString: string) => formatDateIST(dateString);

  // Preselect the first language with unassigned tasks once data is loaded
  useEffect(() => {
    if (allocLanguage) return;
    // Default to ALL (best of both worlds) if any unassigned exists
    const any = (unassignedRows as any[]).some((r) => Number(r.unassigned || 0) > 0);
    if (any) setAllocLanguage('ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassignedRows]);

  const openAllocateConfirm = () => {
    if (!allocLanguage) {
      toast.showError('Select a language to allocate');
      return;
    }
    const available = allocLanguage === 'ALL' ? totalUnassigned : Number(unassignedTotalByLanguage.get(allocLanguage) || 0);
    if (available <= 0) {
      toast.showError('No unassigned tasks for the selected language');
      return;
    }
    setIsAllocConfirmOpen(true);
  };

  const confirmAllocate = async () => {
    const available = allocLanguage === 'ALL' ? totalUnassigned : Number(unassignedTotalByLanguage.get(allocLanguage) || 0);
    const requested = allocCount && allocCount > 0 ? Math.min(allocCount, available) : available;

    setIsAllocConfirmOpen(false);
    setIsLoading(true);
    try {
      // Optimistic: show allocation progress immediately (0%) so user sees it started.
      setAllocRun({
        _id: 'optimistic',
        status: 'running',
        total: requested,
        processed: 0,
        allocated: 0,
        skipped: 0,
        lastProgressAt: new Date().toISOString(),
      });

      const payload: any = {
        language: allocLanguage,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        bu: filters.bu || undefined,
        state: filters.state || undefined,
      };
      // If count is 0/blank, allocate all (backend interprets missing/0 as all)
      if (allocCount && allocCount > 0) payload.count = requested;

      await tasksAPI.allocate(payload);
      toast.showSuccess(
        allocLanguage === 'ALL'
          ? `Allocated ${requested} task(s) across all languages`
          : `Allocated ${requested} task(s) for ${allocLanguage}`
      );
      await Promise.all([loadDashboard(), loadLatestAllocationStatus()]);
    } catch (e: any) {
      const msg = e?.message || 'Failed to allocate tasks';
      if (typeof msg === 'string' && msg.toLowerCase().includes('timed out')) {
        toast.showSuccess('Allocation is still running. Keeping this screen active and checking status...');
        // keep polling; status effect will refresh
        await loadLatestAllocationStatus().catch(() => undefined);
      } else {
        toast.showError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await loadDashboard();
      toast.showSuccess('Refreshed');
    } catch (e: any) {
      toast.showError(e.message || 'Failed to refresh');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReallocate = async () => {
    if (!reallocateAgent) return;

    setIsReallocating(true);
    try {
      // Optimistic: show allocation progress immediately
      setAllocRun({
        _id: 'optimistic',
        status: 'running',
        total: reallocateAgent.sampledInQueue,
        processed: 0,
        allocated: 0,
        skipped: 0,
        lastProgressAt: new Date().toISOString(),
      });

      const result: any = await tasksAPI.reallocate(reallocateAgent.agentId);
      toast.showSuccess(
        `Reallocated ${result.data?.reallocated || 0} task(s) from ${reallocateAgent.name} to other agents`
      );
      setReallocateAgent(null);
      await Promise.all([loadDashboard(), loadLatestAllocationStatus()]);
    } catch (e: any) {
      const msg = e?.message || 'Failed to reallocate tasks';
      if (typeof msg === 'string' && msg.toLowerCase().includes('timed out')) {
        toast.showSuccess('Reallocation is still running. Keeping this screen active and checking status...');
        await loadLatestAllocationStatus().catch(() => undefined);
      } else {
        toast.showError(msg);
      }
    } finally {
      setIsReallocating(false);
    }
  };

  // Language Queue detail view (when Team Lead clicks a language in "Tasks by Language (Open)")
  if (selectedLanguageQueue) {
    if (!languageQueueDetail && isLoadingLanguageQueue) {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedLanguageQueue(null);
                  setLanguageQueueDetail(null);
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                ← Back to Tasks by Language
              </button>
            </div>
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-slate-400" size={40} />
              <span className="ml-3 text-sm font-bold text-slate-600">Loading queue for {selectedLanguageQueue}…</span>
            </div>
          </div>
        </div>
      );
    }
    if (languageQueueDetail) {
      const d = languageQueueDetail;
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedLanguageQueue(null);
                  setLanguageQueueDetail(null);
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                ← Back to Tasks by Language
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLanguageQueueFilters((p) => !p)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Filter size={16} />
                  {showLanguageQueueFilters ? 'Hide filters' : 'Filters'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLoadingLanguageQueue(true);
                    tasksAPI
                      .getDashboardByLanguage(
                        d.language,
                        {
                          dateFrom: filters.dateFrom || undefined,
                          dateTo: filters.dateTo || undefined,
                          bu: filters.bu || undefined,
                          state: filters.state || undefined,
                          agentId: languageQueueFilters.agentId || undefined,
                          status: languageQueueFilters.status || undefined,
                        },
                        1,
                        taskPageSize
                      )
                      .then((res: any) => res?.data && setLanguageQueueDetail(res.data))
                      .catch(() => toast.showError('Failed to refresh'))
                      .finally(() => setIsLoadingLanguageQueue(false));
                  }}
                  disabled={isLoadingLanguageQueue}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-50"
                >
                  <RefreshCw size={16} className={isLoadingLanguageQueue ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
            </div>
            <h2 className="text-xl font-black text-slate-900">Queue for language: {d.language}</h2>
            <p className="text-sm text-slate-600 mt-1">Statistics and task list for this language only. Use filters below to narrow by date, agent, call status, BU, or State.</p>

            {showLanguageQueueFilters && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
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
                    <Calendar size={16} className="text-slate-400" />
                  </button>
                  {isDatePickerOpen && (
                    <div className="absolute z-50 mt-2 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                      <div className="flex">
                        <div className="w-56 border-r border-slate-200 bg-slate-50 p-2">
                          {(['Custom', 'Today', 'Yesterday', 'This week (Sun - Today)', 'Last 7 days', 'Last week (Sun - Sat)', 'Last 28 days', 'Last 30 days', 'YTD'] as DateRangePreset[]).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setSelectedPreset(p);
                                const { start, end } = getRange(p);
                                setDraftStart(start);
                                setDraftEnd(end);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${selectedPreset === p ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'}`}
                            >
                              {p}
                            </button>
                          ))}
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
                            <button type="button" onClick={() => { setIsDatePickerOpen(false); syncDraftFromFilters(); }} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                            <button type="button" onClick={() => { setFilters((prev) => ({ ...prev, dateFrom: draftStart || '', dateTo: draftEnd || '' })); setIsDatePickerOpen(false); }} className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800">Apply</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Agent</label>
                <StyledSelect
                  value={languageQueueFilters.agentId}
                  onChange={(value) => setLanguageQueueFilters((p) => ({ ...p, agentId: value }))}
                  options={[{ value: '', label: 'All' }, ...(d.agentOptions || []).map((a) => ({ value: a.agentId, label: a.agentName }))]}
                  placeholder="All"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Call Status</label>
                <StyledSelect
                  value={languageQueueFilters.status}
                  onChange={(value) => setLanguageQueueFilters((p) => ({ ...p, status: value }))}
                  options={[{ value: '', label: 'All' }, ...Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
                  placeholder="All"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">BU</label>
                <StyledSelect
                  value={filters.bu}
                  onChange={(value) => setFilters((p) => ({ ...p, bu: value }))}
                  options={[{ value: '', label: 'All' }, ...(data?.filterOptions?.buOptions || []).map((b: string) => ({ value: b, label: b }))]}
                  placeholder="All"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">State</label>
                <StyledSelect
                  value={filters.state}
                  onChange={(value) => setFilters((p) => ({ ...p, state: value }))}
                  options={[{ value: '', label: 'All' }, ...(data?.filterOptions?.stateOptions || []).map((s: string) => ({ value: s, label: s }))]}
                  placeholder="All"
                />
              </div>
            </div>
            )}
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-lg font-black text-slate-900 mb-4">Queue Statistics ({d.language})</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Total</p>
                <p className="text-2xl font-black text-slate-900">{d.statusBreakdown.total}</p>
              </div>
              <div className="bg-yellow-50 rounded-2xl p-4 border border-yellow-200">
                <p className="text-xs font-black text-yellow-600 uppercase tracking-widest mb-1">Sampled - in queue</p>
                <p className="text-2xl font-black text-yellow-800">{d.statusBreakdown.sampled_in_queue}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
                <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">In Progress</p>
                <p className="text-2xl font-black text-blue-800">{d.statusBreakdown.in_progress}</p>
              </div>
              <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-1">Completed</p>
                <p className="text-2xl font-black text-green-800">{d.statusBreakdown.completed}</p>
              </div>
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-200">
                <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-1">Not Reachable</p>
                <p className="text-2xl font-black text-orange-800">{d.statusBreakdown.not_reachable}</p>
              </div>
              <div className="bg-red-50 rounded-2xl p-4 border border-red-200">
                <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-1">Invalid</p>
                <p className="text-2xl font-black text-red-800">{d.statusBreakdown.invalid_number}</p>
              </div>
            </div>
          </div>

          <TaskQueueTable
            tasks={d.tasks || []}
            tasksTotal={d.tasksTotal}
            taskPageSize={taskPageSize}
            pageSizeOptions={TASK_PAGE_SIZE_OPTIONS}
            onPageSizeChange={setTaskPageSize}
            showAssignedColumn
            getStatusBadge={getStatusBadge}
            loadMoreRef={loadMoreLanguageRef}
            isLoadingMore={isLoadingMoreLanguage}
            onLoadMore={loadMoreLanguageTasks}
            tableSortStorageKey="teamLead.queueTasks.tableSort"
          />
        </div>
      );
    }
  }

  // Agent Queue detail view (when Team Lead clicks an agent)
  if (selectedAgentId) {
    if (!agentDetail && isLoadingDetail) {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedAgentId(null);
                  setSelectedLanguage(null);
                  setAgentDetail(null);
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                ← Back to Workload
              </button>
            </div>
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-slate-400" size={40} />
              <span className="ml-3 text-sm font-bold text-slate-600">Loading agent queue…</span>
            </div>
          </div>
        </div>
      );
    }
    if (agentDetail) {
      return (
      <div className="space-y-6">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => {
                setSelectedAgentId(null);
                setSelectedLanguage(null);
                setAgentDetail(null);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ← Back to Workload
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAgentDetailFilters((p) => !p)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Filter size={16} />
                {showAgentDetailFilters ? 'Hide filters' : 'Filters'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedAgentId) return;
                  setIsLoadingDetail(true);
                  tasksAPI
                    .getDashboardAgent(
                      selectedAgentId,
                      selectedLanguage ?? undefined,
                      1,
                      taskPageSize,
                      {
                        dateFrom: filters.dateFrom || undefined,
                        dateTo: filters.dateTo || undefined,
                        bu: filters.bu || undefined,
                        state: filters.state || undefined,
                        status: agentDetailFilters.status || undefined,
                        fda: agentDetailFilters.fda || undefined,
                      }
                    )
                    .then((res: any) => res?.data && setAgentDetail(res.data))
                    .catch(() => toast.showError('Failed to refresh'))
                    .finally(() => setIsLoadingDetail(false));
                }}
                disabled={isLoadingDetail}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-50"
              >
                <RefreshCw size={16} className={isLoadingDetail ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {showAgentDetailFilters && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
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
                  <Calendar size={16} className="text-slate-400" />
                </button>
                {isDatePickerOpen && (
                  <div className="absolute z-50 mt-2 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex">
                      <div className="w-56 border-r border-slate-200 bg-slate-50 p-2">
                        {(['Custom', 'Today', 'Yesterday', 'This week (Sun - Today)', 'Last 7 days', 'Last week (Sun - Sat)', 'Last 28 days', 'Last 30 days', 'YTD'] as DateRangePreset[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setSelectedPreset(p);
                              const { start, end } = getRange(p);
                              setDraftStart(start);
                              setDraftEnd(end);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${selectedPreset === p ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'}`}
                          >
                            {p}
                          </button>
                        ))}
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
                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                          <button type="button" onClick={() => { setIsDatePickerOpen(false); syncDraftFromFilters(); }} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                          <button type="button" onClick={() => { setFilters((prev) => ({ ...prev, dateFrom: draftStart || '', dateTo: draftEnd || '' })); setIsDatePickerOpen(false); }} className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800">Apply</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">State</label>
              <StyledSelect
                value={filters.state}
                onChange={(value) => setFilters((p) => ({ ...p, state: value }))}
                options={[{ value: '', label: 'All' }, ...(data?.filterOptions?.stateOptions || []).map((s: string) => ({ value: s, label: s }))]}
                placeholder="All"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">BU</label>
              <StyledSelect
                value={filters.bu}
                onChange={(value) => setFilters((p) => ({ ...p, bu: value }))}
                options={[{ value: '', label: 'All' }, ...(data?.filterOptions?.buOptions || []).map((b: string) => ({ value: b, label: b }))]}
                placeholder="All"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Status</label>
              <StyledSelect
                value={agentDetailFilters.status}
                onChange={(value) => setAgentDetailFilters((p) => ({ ...p, status: value }))}
                options={[{ value: '', label: 'All' }, ...Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
                placeholder="All"
              />
            </div>
            <div className="min-w-0 md:min-w-[200px]">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">FDA</label>
              <StyledSelect
                value={agentDetailFilters.fda}
                onChange={(value) => setAgentDetailFilters((p) => ({ ...p, fda: value }))}
                options={[{ value: '', label: 'All' }, ...(agentDetail?.officerOptions || []).map((name: string) => ({ value: name, label: name }))]}
                placeholder="All"
                className="min-w-0"
              />
            </div>
          </div>
          )}

          <div className="flex items-start gap-4 mt-8">
            <div className="w-16 h-16 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
              <UsersIcon className="text-slate-400" size={32} />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-black text-slate-900 mb-1">{agentDetail.agent.agentName}</h2>
              <p className="text-sm text-slate-600 mb-2">{agentDetail.agent.agentEmail}</p>
              <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                <span>Employee ID: {agentDetail.agent.employeeId}</span>
                <span>Languages: {(agentDetail.agent.languageCapabilities || []).join(', ')}</span>
                {selectedLanguage && (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-bold text-blue-700">Filtered by: {selectedLanguage}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedLanguage(null)}
                      className="text-blue-600 hover:text-blue-800 underline font-bold"
                    >
                      Show all
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-4">Queue Statistics{selectedLanguage ? ` (${selectedLanguage})` : ''}</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Total</p>
              <p className="text-2xl font-black text-slate-900">{agentDetail.statusBreakdown.total}</p>
            </div>
            <div className="bg-yellow-50 rounded-2xl p-4 border border-yellow-200">
              <p className="text-xs font-black text-yellow-600 uppercase tracking-widest mb-1">Sampled - in queue</p>
              <p className="text-2xl font-black text-yellow-800">{agentDetail.statusBreakdown.sampled_in_queue}</p>
            </div>
            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
              <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">In Progress</p>
              <p className="text-2xl font-black text-blue-800">{agentDetail.statusBreakdown.in_progress}</p>
            </div>
            <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
              <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-1">Completed</p>
              <p className="text-2xl font-black text-green-800">{agentDetail.statusBreakdown.completed}</p>
            </div>
            <div className="bg-orange-50 rounded-2xl p-4 border border-orange-200">
              <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-1">Not Reachable</p>
              <p className="text-2xl font-black text-orange-800">{agentDetail.statusBreakdown.not_reachable}</p>
            </div>
            <div className="bg-red-50 rounded-2xl p-4 border border-red-200">
              <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-1">Invalid</p>
              <p className="text-2xl font-black text-red-800">{agentDetail.statusBreakdown.invalid_number}</p>
            </div>
          </div>
        </div>

        <TaskQueueTable
          tasks={agentDetail.tasks || []}
          tasksTotal={agentDetail.tasksTotal}
          taskPageSize={taskPageSize}
          pageSizeOptions={TASK_PAGE_SIZE_OPTIONS}
          onPageSizeChange={setTaskPageSize}
          showAssignedColumn={false}
          getStatusBadge={getStatusBadge}
          loadMoreRef={loadMoreAgentRef}
          isLoadingMore={isLoadingMoreAgent}
          onLoadMore={loadMoreAgentTasks}
          tableSortStorageKey="teamLead.queueTasks.tableSort"
        />
      </div>
    );
    }
  }

  return (
    <div className="space-y-6">
      <Modal
        isOpen={isAllocConfirmOpen}
        onClose={() => setIsAllocConfirmOpen(false)}
        title="Confirm Allocation"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 font-medium">
            Auto-allocate{' '}
            <span className="font-black">
              {allocCount && allocCount > 0
                ? Math.min(allocCount, allocLanguage === 'ALL' ? totalUnassigned : Number(unassignedTotalByLanguage.get(allocLanguage) || 0))
                : (allocLanguage === 'ALL' ? totalUnassigned : Number(unassignedTotalByLanguage.get(allocLanguage) || 0))}
            </span>{' '}
            unassigned task(s){' '}
            {allocLanguage === 'ALL' ? (
              <span className="font-black">across all languages</span>
            ) : (
              <>
                for <span className="font-black">{allocLanguage}</span>
              </>
            )}{' '}
            to capable agents?
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-700 font-bold">
              Allocation will distribute tasks round-robin across agents who have this language capability and move tasks to{' '}
              <span className="font-black">Sampled-in-queue</span>.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsAllocConfirmOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmAllocate}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black disabled:opacity-50"
              disabled={isLoading}
            >
              Yes
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={reallocateAgent !== null}
        onClose={() => setReallocateAgent(null)}
        onConfirm={handleReallocate}
        title="Reallocate Tasks"
        message={`Reallocate ${reallocateAgent?.sampledInQueue || 0} sampled-in-queue task(s) from ${reallocateAgent?.name || ''} to other agents? Tasks will be redistributed based on farmer language and agent language capabilities using round-robin.`}
        confirmText="Reallocate"
        cancelText="Cancel"
        confirmVariant="primary"
        isLoading={isReallocating}
      />

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Task Dashboard</h2>
            <p className="text-sm text-slate-600">
              Unassigned tasks by language + agent workload (Sampled-in-queue and In-progress)
            </p>
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

        <button
          type="button"
          onClick={() => setShowMainFilters((p) => !p)}
          className="flex items-center gap-2 mt-4 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <Filter size={16} />
          {showMainFilters ? 'Hide filters' : 'Filters'}
        </button>
        {showMainFilters && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
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
                <Calendar size={16} className="text-slate-400" />
              </button>

              {isDatePickerOpen && (
                <div className="absolute z-50 mt-2 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex">
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
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">BU</label>
            <StyledSelect
              value={filters.bu}
              onChange={(value) => setFilters((p) => ({ ...p, bu: value }))}
              options={[
                { value: '', label: 'All' },
                ...(data?.filterOptions?.buOptions || []).map((b: string) => ({ value: b, label: b })),
              ]}
              placeholder="All"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">State</label>
            <StyledSelect
              value={filters.state}
              onChange={(value) => setFilters((p) => ({ ...p, state: value }))}
              options={[
                { value: '', label: 'All' },
                ...(data?.filterOptions?.stateOptions || []).map((s: string) => ({ value: s, label: s })),
              ]}
              placeholder="All"
            />
          </div>
        </div>
        )}

        {/* KPI strip */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Open', value: totals.totalOpen ?? 0 },
            { label: 'Unassigned', value: totals.unassigned ?? 0 },
            { label: 'Sampled-in-queue', value: totals.sampledInQueue ?? 0 },
            { label: 'In-progress', value: totals.inProgress ?? 0 },
          ].map((c: any) => (
            <div key={c.label} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{c.label}</p>
              <p className="text-xl font-black text-slate-900">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Why zeros? Show when all counts are 0 (and not loading) */}
        {!isLoading && (totals.totalOpen ?? 0) === 0 && (totals.unassigned ?? 0) === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-bold mb-1">Why is everything zero?</p>
            <p className="text-amber-800">
              <strong>Task Allocation is scoped to your team.</strong> It shows only <strong>unassigned</strong> tasks and tasks assigned to <strong>agents who report to you</strong> (agents whose Team Lead is you). Admin → Agent Queues shows all agents across the system; this view shows only your team.
            </p>
            <ul className="mt-2 list-disc list-inside text-amber-800 space-y-1">
              <li><strong>No agents under you?</strong> Ask an MIS Admin to assign CC agents to you in <strong>User Management</strong> (set each agent&apos;s Team Lead to your user). Until then, you&apos;ll only see unassigned tasks here—and if all tasks are already allocated to other agents, counts will be zero.</li>
              <li><strong>Date range:</strong> Tasks are filtered by <strong>scheduled date</strong>. Try &quot;Last 30 days&quot; or a range that includes when tasks were created.</li>
              <li><strong>Create tasks:</strong> Use <strong>Sampling Control</strong> to sample activities and create unassigned tasks, then allocate them from this tab.</li>
            </ul>
          </div>
        )}
      </div>

      {/* Tasks by language – full status breakdown so Total adds up */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">Tasks by Language</h3>
          <div className="text-sm font-bold text-slate-600">
            Total Unassigned: <span className="font-black text-slate-900">{data?.totals?.totalUnassigned ?? 0}</span>
            <span className="ml-4 text-slate-500">Total tasks: <span className="font-black text-slate-700">{data?.totals?.total ?? 0}</span></span>
          </div>
        </div>
        <p className="text-sm text-slate-600 mt-1">Full status breakdown so Total = Unassigned + Sampled-in-queue + In-progress + Completed + Not reachable + Invalid. Click a language to view queue and task list.</p>

        {/* Allocation controls */}
        <div className="mt-4 flex flex-col md:flex-row md:items-end gap-3 md:justify-between">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:max-w-3xl">
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Language</label>
              <StyledSelect
                value={allocLanguage}
                onChange={(value) => setAllocLanguage(value)}
                options={[
                  { value: '', label: 'Select language' },
                  { value: 'ALL', label: `All Languages (${totalUnassigned})` },
                  ...unassignedRows
                    .filter((r: any) => Number(r.unassigned || 0) > 0)
                    .map((r: any) => ({
                      value: r.language,
                      label: `${r.language} (${r.unassigned})`,
                    })),
                ]}
                placeholder="Select language"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                Count (optional)
              </label>
              <input
                type="number"
                min={0}
                value={allocCount}
                onChange={(e) => setAllocCount(Number(e.target.value))}
                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                placeholder="0 = All"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={openAllocateConfirm}
                disabled={
                  isLoading ||
                  isAllocRunning ||
                  !allocLanguage ||
                  (allocLanguage === 'ALL'
                    ? totalUnassigned === 0
                    : Number(unassignedTotalByLanguage.get(allocLanguage) || 0) === 0)
                }
                className="w-full px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black disabled:opacity-50"
              >
                Auto-Allocate
              </button>
            </div>
          </div>
        </div>

        {/* Allocation progress */}
        <div className="mt-4">
          {allocRun ? (
            <div className="text-xs text-slate-600">
              <span className="font-black">Latest allocation:</span>{' '}
              <span className="font-bold">
                {allocRun.status === 'running' ? 'Running' : allocRun.status === 'completed' ? 'Completed' : 'Failed'}
              </span>
              {typeof allocRun.processed === 'number' && typeof allocRun.total === 'number' ? (
                <>
                  {' '}
                  • <span className="font-bold">Processed {allocRun.processed}/{allocRun.total}</span>
                </>
              ) : null}
              {typeof allocRun.allocated === 'number' ? (
                <>
                  {' '}
                  • <span className="font-bold">Allocated {allocRun.allocated}</span>
                </>
              ) : null}
              {typeof allocRun.skipped === 'number' && allocRun.skipped > 0 ? (
                <>
                  {' '}
                  • <span className="font-bold text-amber-800">Skipped {allocRun.skipped}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-slate-500">Latest allocation: none</div>
          )}

          {isAllocRunning && (
            <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-green-900">Allocation is running…</div>
                <div className="text-xs font-black text-green-900">{allocPct}%</div>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-green-100 overflow-hidden">
                <div
                  className="h-2 bg-green-700 rounded-full transition-[width] duration-300"
                  style={{ width: `${allocPct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-green-900">
                The dashboard will refresh automatically while allocation runs. Please wait until it completes.
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {(
                  [
                    { key: 'language' as LanguageTableSortKey, label: 'Language' },
                    { key: 'total' as LanguageTableSortKey, label: 'Total' },
                    { key: 'unassigned' as LanguageTableSortKey, label: 'Unassigned' },
                    { key: 'sampledInQueue' as LanguageTableSortKey, label: 'Sampled-in-queue' },
                    { key: 'inProgress' as LanguageTableSortKey, label: 'In-progress' },
                    { key: 'completed' as LanguageTableSortKey, label: 'Completed' },
                    { key: 'notReachable' as LanguageTableSortKey, label: 'Not reachable' },
                    { key: 'invalidNumber' as LanguageTableSortKey, label: 'Invalid' },
                  ] as Array<{ key: LanguageTableSortKey; label: string }>
                ).map((col) => {
                  const isSorted = languageTableSort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none cursor-pointer hover:bg-slate-100"
                      onClick={() => handleLanguageHeaderClick(col.key)}
                      title="Click to sort"
                    >
                      <div className="flex items-center gap-2">
                        <span>{col.label}</span>
                        {isSorted && (languageTableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedOpenByLanguage.map((r: any) => (
                <tr key={r.language}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedLanguageQueue(r.language)}
                      className="font-black text-blue-600 hover:text-blue-800 hover:underline text-left"
                    >
                      {r.language}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.total ?? r.totalOpen ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.unassigned ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.sampledInQueue ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.inProgress ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.completed ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.notReachable ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{r.invalidNumber ?? 0}</td>
                </tr>
              ))}
              {sortedOpenByLanguage.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={8}>
                    No tasks found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent workload – full status so Total adds up */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-lg font-black text-slate-900">Agent Workload</h3>
        <p className="text-sm text-slate-600 mt-1">Total = Sampled-in-queue + In-progress + Completed + Not reachable + Invalid. Click an agent name to view their queue, or click a language to filter.</p>

        <div className="mt-4 overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {(
                  [
                    { key: 'agent' as AgentTableSortKey, label: 'Agent' },
                    { key: 'employeeId' as AgentTableSortKey, label: 'Employee ID' },
                    { key: 'languages' as AgentTableSortKey, label: 'Languages' },
                    { key: 'sampledInQueue' as AgentTableSortKey, label: 'Sampled-in-queue' },
                    { key: 'inProgress' as AgentTableSortKey, label: 'In-progress' },
                    { key: 'completed' as AgentTableSortKey, label: 'Completed' },
                    { key: 'notReachable' as AgentTableSortKey, label: 'Not reachable' },
                    { key: 'invalidNumber' as AgentTableSortKey, label: 'Invalid' },
                    { key: 'totalOpen' as AgentTableSortKey, label: 'Total' },
                  ] as Array<{ key: AgentTableSortKey; label: string }>
                ).map((col) => {
                  const isSorted = agentTableSort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none cursor-pointer hover:bg-slate-100"
                      onClick={() => handleAgentHeaderClick(col.key)}
                      title="Click to sort"
                    >
                      <div className="flex items-center gap-2">
                        <span>{col.label}</span>
                        {isSorted && (agentTableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </div>
                    </th>
                  );
                })}
                <th className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedAgentRows.map((a: any) => (
                <tr key={a.agentId}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAgentId(a.agentId);
                        setSelectedLanguage(null);
                      }}
                      className="text-left group block w-full"
                    >
                      <div className="font-black text-blue-600 group-hover:text-blue-800 group-hover:underline">{a.name}</div>
                      <div className="text-xs text-slate-500 group-hover:text-slate-600">{a.email}</div>
                    </button>
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.employeeId}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700">
                    {(Array.isArray(a.languageCapabilities) ? a.languageCapabilities : []).length ? (
                      (a.languageCapabilities as string[]).map((lang: string, i: number) => (
                        <span key={lang}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAgentId(a.agentId);
                              setSelectedLanguage(lang);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-bold"
                          >
                            {lang}
                          </button>
                        </span>
                      ))
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.sampledInQueue ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.inProgress ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.completed ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.notReachable ?? 0}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{a.invalidNumber ?? 0}</td>
                  <td className="px-4 py-3 font-black text-slate-900">{a.totalOpen ?? 0}</td>
                  <td className="px-4 py-3">
                    {Number(a.sampledInQueue || 0) > 0 ? (
                      <button
                        onClick={() => setReallocateAgent({ agentId: a.agentId, name: a.name, sampledInQueue: a.sampledInQueue })}
                        disabled={isReallocating || isAllocRunning}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reallocate
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!sortedAgentRows.length && (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={10}>
                    No agents found for this Team Lead.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TaskDashboardView;

