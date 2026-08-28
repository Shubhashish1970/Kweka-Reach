import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { tasksAPI, usersAPI } from '../services/api';
import { Loader2, Search, Filter, RefreshCw, User as UserIcon, MapPin, Calendar, Phone, CheckCircle, Clock, XCircle, AlertCircle, Download, ArrowUpDown, CheckSquare, Square, BarChart3, AlertTriangle, ChevronDown, ChevronUp, ArrowDownToLine } from 'lucide-react';
import Button from './shared/Button';
import StyledSelect from './shared/StyledSelect';
import TaskDetail from './TaskDetail';
import ReassignModal from './ReassignModal';
import BulkCancelModal from './shared/BulkCancelModal';
import InfoBanner from './shared/InfoBanner';
import { getTaskStatusLabel, TaskStatus } from '../utils/taskStatusLabels';
import { type DateRangePreset, getPresetRange, formatPretty, formatDateIST } from '../utils/dateRangeUtils';

interface Task {
  _id: string;
  status: TaskStatus;
  scheduledDate: string;
  farmerId: {
    name: string;
    mobileNumber: string;
    location: string;
    preferredLanguage: string;
    photoUrl?: string;
  };
  activityId: {
    activityId?: string;
    type: string;
    date: string;
    officerName: string;
    location: string;
    territory: string;
    territoryName?: string;
    zoneName?: string;
    buName?: string;
    state?: string;
    tmName?: string;
  };
  assignedAgentId: {
    name: string;
    email: string;
    employeeId: string;
  };
  callLog?: any;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

type TaskTableColumnKey =
  | 'expand'
  | 'select'
  | 'farmer'
  | 'status'
  | 'scheduled'
  | 'agent'
  | 'territory'
  | 'activity'
  | 'officer'
  | 'language';

const DEFAULT_TASK_TABLE_WIDTHS: Record<TaskTableColumnKey, number> = {
  expand: 56,
  select: 56,
  farmer: 260,
  status: 170,
  scheduled: 170,
  agent: 180,
  territory: 200,
  activity: 160,
  officer: 200,
  language: 140,
};

const TaskList: React.FC = () => {
  const { user, activeRole } = useAuth();
  const toast = useToast();
  
  // Use activeRole for permission checks, fallback to user.role
  const currentRole = activeRole || user?.role;
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<TaskTableColumnKey, number>>(() => {
    const raw = localStorage.getItem('admin.taskManagement.tableColumnWidths');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return { ...DEFAULT_TASK_TABLE_WIDTHS, ...parsed };
    } catch {
      // ignore
    }
    return { ...DEFAULT_TASK_TABLE_WIDTHS };
  });
  const resizingRef = useRef<{ key: TaskTableColumnKey; startX: number; startWidth: number } | null>(null);
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('admin.taskManagement.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20;
  });
  const [statsData, setStatsData] = useState<any | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Last 7 days');
  const [draftStart, setDraftStart] = useState(''); // YYYY-MM-DD
  const [draftEnd, setDraftEnd] = useState(''); // YYYY-MM-DD
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [filters, setFilters] = useState({
    status: '',
    agentId: '',
    territory: '',
    zone: '',
    bu: '',
    search: '',
    dateFrom: '',
    dateTo: '',
  });
  const [agents, setAgents] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<
    'scheduledDate' | 'status' | 'farmerName' | 'agentName' | 'territory' | 'activityType' | 'officerName' | 'language'
  >(() => {
    const raw = localStorage.getItem('admin.taskManagement.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.sortBy && parsed?.sortOrder) return parsed.sortBy;
    } catch {
      // ignore
    }
    return 'scheduledDate';
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const raw = localStorage.getItem('admin.taskManagement.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.sortOrder === 'asc' || parsed?.sortOrder === 'desc') return parsed.sortOrder;
    } catch {
      // ignore
    }
    return 'asc';
  });
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [showBulkReassignModal, setShowBulkReassignModal] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [showBulkCancelModal, setShowBulkCancelModal] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  // Export dropdown removed (Excel download moved to stats header)

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  const syncDraftFromFilters = () => {
    const range = getRange(selectedPreset);
    const start = filters.dateFrom || range.start;
    const end = filters.dateTo || range.end;
    setDraftStart(start);
    setDraftEnd(end);
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
    localStorage.setItem('admin.taskManagement.pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem('admin.taskManagement.tableSort', JSON.stringify({ sortBy, sortOrder }));
  }, [sortBy, sortOrder]);

  useEffect(() => {
    localStorage.setItem('admin.taskManagement.tableColumnWidths', JSON.stringify(tableColumnWidths));
  }, [tableColumnWidths]);

  const startResize = (e: React.MouseEvent, key: TaskTableColumnKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = tableColumnWidths[key] ?? DEFAULT_TASK_TABLE_WIDTHS[key];
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

  // Fetch agents
  useEffect(() => {
    const loadAgents = async () => {
      try {
        const response = await usersAPI.getUsers({ role: 'cc_agent', isActive: true }) as any;
        if (response.success && response.data?.users) {
          setAgents(response.data.users);
        }
      } catch (err) {
        console.error('Error fetching agents:', err);
      }
    };
    loadAgents();
  }, []);

  // Fetch tasks
  useEffect(() => {
    if (!user) return;

    const loadTasks = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let response;
        if (currentRole === 'team_lead') {
          response = await tasksAPI.getTeamTasks({
            status: filters.status || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            page: currentPage,
            limit: pageSize,
          });
        } else {
          response = await tasksAPI.getPendingTasks({
            agentId: filters.agentId || undefined,
            territory: filters.territory || undefined,
            zone: filters.zone || undefined,
            bu: filters.bu || undefined,
            search: filters.search || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            page: currentPage,
            limit: pageSize,
          });
        }

        if (response.success && response.data) {
          setTasks(response.data.tasks || []);
          setPagination(response.data.pagination || null);
        } else {
          const errorMsg = response.error?.message || 'Failed to load tasks';
          setError(errorMsg);
          toast.showError(errorMsg);
        }
      } catch (err: any) {
        const errorMessage = err.message || err.response?.data?.error?.message || 'Failed to load tasks';
        setError(errorMessage);
        toast.showError(errorMessage);
        console.error('Error fetching tasks:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTasks();
  }, [user, filters.status, filters.agentId, filters.territory, filters.zone, filters.bu, filters.search, filters.dateFrom, filters.dateTo, currentPage, pageSize]);

  const handleRefresh = () => {
    if (user) {
      const loadTasks = async () => {
        setIsLoading(true);
        setError(null);
        try {
          let response;
          if (currentRole === 'team_lead') {
            response = await tasksAPI.getTeamTasks({
              status: filters.status || undefined,
              dateFrom: filters.dateFrom || undefined,
              dateTo: filters.dateTo || undefined,
              page: currentPage,
              limit: pageSize,
            });
          } else {
            response = await tasksAPI.getPendingTasks({
              agentId: filters.agentId || undefined,
              territory: filters.territory || undefined,
              zone: filters.zone || undefined,
              bu: filters.bu || undefined,
              search: filters.search || undefined,
              dateFrom: filters.dateFrom || undefined,
              dateTo: filters.dateTo || undefined,
              page: currentPage,
              limit: pageSize,
            });
          }

          if (response.success && response.data) {
            setTasks(response.data.tasks || []);
            setPagination(response.data.pagination || null);
          }
        } catch (err: any) {
          const errorMessage = err.message || 'Failed to load tasks';
          setError(errorMessage);
          toast.showError(errorMessage);
        } finally {
          setIsLoading(false);
        }
      };
      loadTasks();
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      sampled_in_queue: { icon: Clock, color: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: getTaskStatusLabel('sampled_in_queue') },
      in_progress: { icon: Loader2, color: 'bg-blue-100 text-blue-800 border-blue-200', label: getTaskStatusLabel('in_progress') },
      completed: { icon: CheckCircle, color: 'bg-green-100 text-green-800 border-green-200', label: getTaskStatusLabel('completed') },
      not_reachable: { icon: XCircle, color: 'bg-orange-100 text-orange-800 border-orange-200', label: getTaskStatusLabel('not_reachable') },
      invalid_number: { icon: AlertCircle, color: 'bg-red-100 text-red-800 border-red-200', label: getTaskStatusLabel('invalid_number') },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.sampled_in_queue;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${config.color}`}>
        <Icon size={14} />
        {config.label}
      </span>
    );
  };

  const formatDate = (dateString: string) => formatDateIST(dateString);

  const toggleExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const fetchStats = async () => {
    if (!user) return;
    if (currentRole === 'team_lead') return;
    setIsStatsLoading(true);
    try {
      const res: any = await tasksAPI.getPendingTasksStats({
        agentId: filters.agentId || undefined,
        territory: filters.territory || undefined,
        zone: filters.zone || undefined,
        bu: filters.bu || undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      if (res?.success && res?.data) setStatsData(res.data);
    } catch (err) {
      console.error('Failed to fetch task stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filters.status, filters.agentId, filters.territory, filters.zone, filters.bu, filters.search, filters.dateFrom, filters.dateTo]);

  const [filterOptions, setFilterOptions] = useState<{ territoryOptions: string[]; zoneOptions: string[]; buOptions: string[] }>({
    territoryOptions: [],
    zoneOptions: [],
    buOptions: [],
  });

  const fetchFilterOptions = async () => {
    if (!user || currentRole === 'team_lead') return;
    try {
      const res: any = await tasksAPI.getPendingTasksFilterOptions({
        agentId: filters.agentId || undefined,
        territory: filters.territory || undefined,
        zone: filters.zone || undefined,
        bu: filters.bu || undefined,
        search: filters.search || undefined,
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
    fetchFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filters.agentId, filters.territory, filters.zone, filters.bu, filters.search, filters.dateFrom, filters.dateTo]);

  const handleDownloadExcel = async () => {
    if (!user || currentRole === 'team_lead') return;
    setIsExporting(true);
    try {
      await tasksAPI.downloadPendingTasksExport({
        agentId: filters.agentId || undefined,
        territory: filters.territory || undefined,
        zone: filters.zone || undefined,
        bu: filters.bu || undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        exportAll: true,
        limit: 5000,
      });
      toast.showSuccess('Excel downloaded');
    } catch (err: any) {
      toast.showError(err?.message || 'Failed to download excel');
    } finally {
      setIsExporting(false);
    }
  };

  // Search is now applied server-side so pagination/export/stats can stay consistent.
  const filteredTasks = tasks;

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortBy) {
      case 'scheduledDate':
        aValue = new Date(a.scheduledDate).getTime();
        bValue = new Date(b.scheduledDate).getTime();
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      case 'farmerName':
        aValue = a.farmerId.name.toLowerCase();
        bValue = b.farmerId.name.toLowerCase();
        break;
      case 'agentName':
        aValue = a.assignedAgentId.name.toLowerCase();
        bValue = b.assignedAgentId.name.toLowerCase();
        break;
      case 'territory': {
        const at: any = a.activityId as any;
        const bt: any = b.activityId as any;
        aValue = String((at?.territoryName || at?.territory || '')).toLowerCase();
        bValue = String((bt?.territoryName || bt?.territory || '')).toLowerCase();
        break;
      }
      case 'activityType':
        aValue = a.activityId.type.toLowerCase();
        bValue = b.activityId.type.toLowerCase();
        break;
      case 'officerName':
        aValue = a.activityId.officerName.toLowerCase();
        bValue = b.activityId.officerName.toLowerCase();
        break;
      case 'language':
        aValue = a.farmerId.preferredLanguage.toLowerCase();
        bValue = b.farmerId.preferredLanguage.toLowerCase();
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const calculateStatistics = () => {
    const stats = {
      total: filteredTasks.length,
      unassigned: 0,
      sampled_in_queue: 0,
      in_progress: 0,
      completed: 0,
      not_reachable: 0,
      invalid_number: 0,
      overdue: 0,
      dueToday: 0,
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    filteredTasks.forEach(task => {
      stats[task.status as keyof typeof stats]++;
      const scheduledDate = new Date(task.scheduledDate);
      if (scheduledDate < today && (task.status === 'sampled_in_queue' || task.status === 'in_progress')) {
        stats.overdue++;
      } else if (scheduledDate >= today && scheduledDate < tomorrow) {
        stats.dueToday++;
      }
    });

    return stats;
  };

  const statistics = statsData || calculateStatistics();

  const getTaskPriority = (task: Task) => {
    const scheduledDate = new Date(task.scheduledDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (scheduledDate < today && (task.status === 'sampled_in_queue' || task.status === 'in_progress')) {
      return { level: 'overdue', color: 'bg-red-100 text-red-800 border-red-300', icon: AlertTriangle, label: 'Overdue' };
    } else if (scheduledDate >= today && scheduledDate < new Date(today.getTime() + 24 * 60 * 60 * 1000)) {
      return { level: 'due-today', color: 'bg-orange-100 text-orange-800 border-orange-300', icon: Clock, label: 'Due Today' };
    }
    return { level: 'on-time', color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle, label: 'On Time' };
  };

  // statistics computed after calculateStatistics (statsData preferred)

  const toggleTaskSelection = (taskId: string) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId);
    } else {
      newSelected.add(taskId);
    }
    setSelectedTasks(newSelected);
    setShowBulkActions(newSelected.size > 0);
  };

  const toggleSelectAll = () => {
    if (selectedTasks.size === sortedTasks.length) {
      setSelectedTasks(new Set());
      setShowBulkActions(false);
    } else {
      setSelectedTasks(new Set(sortedTasks.map(t => t._id)));
      setShowBulkActions(true);
    }
  };

  const handleBulkReassign = async (agentId: string) => {
    setIsBulkProcessing(true);
    try {
      const response = await tasksAPI.bulkReassignTasks(Array.from(selectedTasks), agentId) as any;
      if (response.success) {
        setSelectedTasks(new Set());
        setShowBulkActions(false);
        setShowBulkReassignModal(false);
        handleRefresh();
        if (response.data.failed > 0) {
          toast.showWarning(`Reassigned ${response.data.successful} task(s), ${response.data.failed} failed`);
        } else {
          toast.showSuccess(`Successfully reassigned ${response.data.successful} task(s)`);
        }
      }
    } catch (err: any) {
      toast.showError(err.message || 'Failed to reassign tasks');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkStatusUpdate = async (status: string, notes?: string) => {
    setIsBulkProcessing(true);
    try {
      const response = await tasksAPI.bulkUpdateStatus(Array.from(selectedTasks), status, notes) as any;
      if (response.success) {
        setSelectedTasks(new Set());
        setShowBulkActions(false);
        setShowBulkStatusModal(false);
        handleRefresh();
        if (response.data.failed > 0) {
          toast.showWarning(`Updated status for ${response.data.successful} task(s), ${response.data.failed} failed`);
        } else {
          toast.showSuccess(`Successfully updated status for ${response.data.successful} task(s)`);
        }
      }
    } catch (err: any) {
      toast.showError(err.message || 'Failed to update task status');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleExportCSV = () => {
    toast.showWarning('CSV export is disabled. Use Excel download.');
  };

  const handleExportPDF = () => {
    toast.showWarning('PDF export is disabled. Use Excel download.');
  };

  const handleExportExcel = () => {
    handleDownloadExcel();
  };

  // Export dropdown removed

  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        onBack={() => setSelectedTask(null)}
        onTaskUpdated={() => {
          setSelectedTask(null);
          handleRefresh();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f1] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-black text-slate-900 mb-1">Task Management</h1>
              <p className="text-sm text-slate-600">
                {user?.role === 'team_lead' ? 'View and manage your team tasks' : 'View and manage all tasks in queue'}
              </p>
            </div>
            <div className="flex items-center gap-3">
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
                disabled={isLoading}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
          </div>

          <InfoBanner>
            Statistics and export reflect current filters (status, agent, date range, search).
          </InfoBanner>

          {/* Filters – expand when Filter button clicked */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Status</label>
              <StyledSelect
                value={filters.status}
                onChange={(value) => setFilters({ ...filters, status: value })}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'sampled_in_queue', label: 'Sampled - in queue' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'not_reachable', label: 'Not Reachable' },
                  { value: 'invalid_number', label: 'Invalid Number' },
                ]}
                    placeholder="All Statuses"
                  />
                </div>
                {user?.role !== 'team_lead' && (
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Agent</label>
                <StyledSelect
                  value={filters.agentId}
                  onChange={(value) => setFilters({ ...filters, agentId: value })}
                  options={[
                    { value: '', label: 'All Agents' },
                    ...agents.map((agent) => ({
                      value: agent._id,
                      label: `${agent.name} (${agent.email})`,
                    })),
                  ]}
                      placeholder="All Agents"
                    />
                  </div>
                )}
                {user?.role !== 'team_lead' && (
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Territory</label>
                <StyledSelect
                  value={filters.territory}
                  onChange={(value) => setFilters({ ...filters, territory: value })}
                  options={[
                    { value: '', label: 'All Territories' },
                    ...filterOptions.territoryOptions.map((t) => ({ value: t, label: t })),
                  ]}
                      placeholder="All Territories"
                    />
                  </div>
                )}
                {user?.role !== 'team_lead' && (
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Zone</label>
                <StyledSelect
                  value={filters.zone}
                  onChange={(value) => setFilters({ ...filters, zone: value })}
                  options={[
                    { value: '', label: 'All Zones' },
                    ...filterOptions.zoneOptions.map((z) => ({ value: z, label: z })),
                  ]}
                  placeholder="All Zones"
                />
              </div>
            )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {user?.role !== 'team_lead' && (
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">BU</label>
                <StyledSelect
                  value={filters.bu}
                  onChange={(value) => setFilters({ ...filters, bu: value })}
                  options={[
                    { value: '', label: 'All BUs' },
                    ...filterOptions.buOptions.map((b) => ({ value: b, label: b })),
                  ]}
                      placeholder="All BUs"
                    />
                  </div>
                )}
                <div className="md:col-span-2">
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
                  title="Choose date range"
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
                                const { start, end } = getRange(p);
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
                        <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
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
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Search</label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={filters.search}
                      onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                      placeholder="Search by farmer name, mobile, agent, or location..."
                      className="w-full min-h-12 pl-12 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Statistics Dashboard */}
        {!isStatsLoading && (statsData ? (statistics?.total || 0) > 0 : (!isLoading && filteredTasks.length > 0)) && (
          <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="text-green-700" size={20} />
                <h2 className="text-lg font-black text-slate-900">Task Statistics</h2>
              </div>
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={isLoading || isExporting}
                className={`flex items-center justify-center h-10 w-10 rounded-2xl border transition-colors ${
                  isExporting
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-white border-slate-200 text-green-700 hover:bg-slate-50'
                }`}
                title="Download Excel (matches current filters and page)"
              >
                <ArrowDownToLine size={18} className={isExporting ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Total Tasks</p>
                <p className="text-2xl font-black text-slate-900">{statistics.total}</p>
              </div>
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
                <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Other</p>
                <p className="text-2xl font-black text-amber-800">
                  {(statistics.unassigned ?? 0) + (statistics.not_reachable ?? 0) + (statistics.invalid_number ?? 0)}
                </p>
                <p className="text-xs text-amber-600 mt-1 text-left break-words leading-tight">
                  (unassigned / not reachable / invalid)
                </p>
              </div>
              <div className="bg-yellow-50 rounded-2xl p-4 border border-yellow-200">
                <p className="text-xs font-black text-yellow-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Sampled In Queue</p>
                <p className="text-2xl font-black text-yellow-800">{statistics.sampled_in_queue}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
                <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">In Progress</p>
                <p className="text-2xl font-black text-blue-800">{statistics.in_progress}</p>
              </div>
              <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Completed</p>
                <p className="text-2xl font-black text-green-800">{statistics.completed}</p>
              </div>
              <div className="bg-red-50 rounded-2xl p-4 border border-red-200">
                <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Overdue</p>
                <p className="text-2xl font-black text-red-800">{statistics.overdue}</p>
              </div>
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-200">
                <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-0.5 h-[2.5rem] flex items-end leading-tight line-clamp-2 overflow-hidden">Due Today</p>
                <p className="text-2xl font-black text-orange-800">{statistics.dueToday}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tasks List */}
        {isLoading ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <Loader2 className="animate-spin mx-auto mb-4 text-green-700" size={32} />
            <p className="text-sm text-slate-600 font-medium">Loading tasks...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <AlertCircle className="mx-auto mb-4 text-red-500" size={32} />
            <p className="text-sm text-red-600 font-medium">{error}</p>
            <Button variant="secondary" size="sm" onClick={handleRefresh} className="mt-4">
              Try Again
            </Button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <p className="text-sm text-slate-600 font-medium">No tasks found</p>
          </div>
        ) : (
          <>
            {/* Bulk Actions Toolbar */}
            {showBulkActions && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-green-900">
                    {selectedTasks.size} task{selectedTasks.size !== 1 ? 's' : ''} selected
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowBulkReassignModal(true)}
                    disabled={isBulkProcessing}
                  >
                    Reassign Selected
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowBulkStatusModal(true)}
                    disabled={isBulkProcessing}
                  >
                    Update Status
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setShowBulkCancelModal(true)}
                    disabled={isBulkProcessing}
                  >
                    Cancel Selected
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedTasks(new Set());
                    setShowBulkActions(false);
                  }}
                >
                  Clear Selection
                </Button>
              </div>
            )}

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th
                        className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                        style={{ width: tableColumnWidths.expand, minWidth: tableColumnWidths.expand }}
                      >
                        <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => startResize(e, 'expand')} />
                      </th>
                      <th
                        className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                        style={{ width: tableColumnWidths.select, minWidth: tableColumnWidths.select }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTasks.size === sortedTasks.length && sortedTasks.length > 0}
                          onChange={toggleSelectAll}
                          className="w-5 h-5 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                          title="Select all on this page"
                        />
                        <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => startResize(e, 'select')} />
                      </th>
                      {(
                        [
                          { key: 'farmer', label: 'Farmer', sortKey: 'farmerName' },
                          { key: 'status', label: 'Status', sortKey: 'status' },
                          { key: 'scheduled', label: 'Scheduled', sortKey: 'scheduledDate' },
                          { key: 'agent', label: 'Agent', sortKey: 'agentName' },
                          { key: 'territory', label: 'Territory', sortKey: 'territory' },
                          { key: 'activity', label: 'Activity', sortKey: 'activityType' },
                          { key: 'officer', label: 'Officer', sortKey: 'officerName' },
                          { key: 'language', label: 'Language', sortKey: 'language' },
                        ] as Array<{ key: TaskTableColumnKey; label: string; sortKey: any }>
                      ).map((c) => (
                        <th
                          key={c.key}
                          className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                          style={{ width: tableColumnWidths[c.key], minWidth: tableColumnWidths[c.key] }}
                          onClick={() => {
                            const nextKey = c.sortKey as any;
                            if (sortBy === nextKey) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            else {
                              setSortBy(nextKey);
                              setSortOrder('asc');
                            }
                          }}
                          title="Click to sort"
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate block">{c.label}</span>
                            {sortBy === c.sortKey && (sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                          </div>
                          <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => startResize(e, c.key)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTasks.map((task) => {
                      const isExpanded = expandedTaskIds.has(task._id);
                      const priority = getTaskPriority(task);
                      const PriorityIcon = priority.icon;
                      const territory = (task.activityId as any)?.territoryName || task.activityId.territory || '';
                      return (
                        <React.Fragment key={task._id}>
                          <tr className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-3" style={{ width: tableColumnWidths.expand, minWidth: tableColumnWidths.expand }}>
                              <button
                                type="button"
                                onClick={() => toggleExpand(task._id)}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100"
                                title="Expand / collapse"
                              >
                                {isExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                              </button>
                            </td>
                            <td className="px-3 py-3" style={{ width: tableColumnWidths.select, minWidth: tableColumnWidths.select }} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedTasks.has(task._id)}
                                onChange={() => toggleTaskSelection(task._id)}
                                className="w-5 h-5 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                              />
                            </td>
                            <td className="px-3 py-3 text-sm" style={{ width: tableColumnWidths.farmer, minWidth: tableColumnWidths.farmer }}>
                              <button type="button" className="text-left w-full" onClick={() => setSelectedTask(task)}>
                                <div className="flex items-center gap-3 min-w-0">
                                  {task.farmerId.photoUrl ? (
                                    <img
                                      src={task.farmerId.photoUrl}
                                      alt={task.farmerId.name}
                                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.src = '/images/farmer-default-logo.png';
                                      }}
                                    />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                                      <UserIcon className="text-slate-400" size={18} />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-black text-slate-900 truncate">{task.farmerId.name}</div>
                                    <div className="text-xs text-slate-500 truncate">{task.farmerId.mobileNumber}</div>
                                  </div>
                                </div>
                              </button>
                            </td>
                            <td className="px-3 py-3 text-sm" style={{ width: tableColumnWidths.status, minWidth: tableColumnWidths.status }}>{getStatusBadge(task.status)}</td>
                            <td className="px-3 py-3 text-sm text-slate-700" style={{ width: tableColumnWidths.scheduled, minWidth: tableColumnWidths.scheduled }}>
                              <div className="font-bold">{formatDate(task.scheduledDate)}</div>
                              <span className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${priority.color}`}>
                                <PriorityIcon size={12} />
                                {priority.label}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-sm text-slate-700 truncate" style={{ width: tableColumnWidths.agent, minWidth: tableColumnWidths.agent }} title={task.assignedAgentId?.name || ''}>
                              {task.assignedAgentId?.name || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-slate-700 truncate" style={{ width: tableColumnWidths.territory, minWidth: tableColumnWidths.territory }} title={territory}>{territory || '-'}</td>
                            <td className="px-3 py-3 text-sm text-slate-700 truncate" style={{ width: tableColumnWidths.activity, minWidth: tableColumnWidths.activity }} title={task.activityId.type}>{task.activityId.type}</td>
                            <td className="px-3 py-3 text-sm text-slate-700 truncate" style={{ width: tableColumnWidths.officer, minWidth: tableColumnWidths.officer }} title={task.activityId.officerName}>{task.activityId.officerName}</td>
                            <td className="px-3 py-3 text-sm text-slate-700 truncate" style={{ width: tableColumnWidths.language, minWidth: tableColumnWidths.language }} title={task.farmerId.preferredLanguage}>{task.farmerId.preferredLanguage}</td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-white">
                              <td colSpan={10} className="px-6 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700">
                                  <div className="flex items-center gap-2">
                                    <Phone size={14} className="text-slate-400" />
                                    <span className="font-medium">{task.farmerId.mobileNumber}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <MapPin size={14} className="text-slate-400" />
                                    <span className="truncate">{task.farmerId.location}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Calendar size={14} className="text-slate-400" />
                                    <span>Activity Date: {formatDate(task.activityId.date)}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <UserIcon size={14} className="text-slate-400" />
                                    <span>Agent Email: {task.assignedAgentId?.email || '-'}</span>
                                  </div>
                                </div>
                                <div className="mt-3">
                                  <Button variant="secondary" size="sm" onClick={() => setSelectedTask(task)}>
                                    Open Task
                                  </Button>
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
            {pagination && (
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    Page {pagination.page} of {pagination.pages} • {pagination.total} total tasks
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rows</span>
                      <StyledSelect
                        value={String(pageSize)}
                        onChange={(value) => {
                          setCurrentPage(1);
                          setPageSize(Number(value));
                        }}
                        options={[10, 20, 50, 100].map((n) => ({
                          value: String(n),
                          label: String(n),
                        }))}
                        className="w-20"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1 || isLoading || pagination.pages <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage >= pagination.pages || isLoading || pagination.pages <= 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Bulk Reassign Modal */}
            {showBulkReassignModal && (
              <ReassignModal
                isOpen={showBulkReassignModal}
                onClose={() => setShowBulkReassignModal(false)}
                task={null as any}
                onReassigned={handleBulkReassign}
                isBulkMode={true}
                selectedTaskIds={Array.from(selectedTasks)}
              />
            )}

            {/* Bulk Status Update Modal */}
            {showBulkStatusModal && (
              <BulkStatusModal
                isOpen={showBulkStatusModal}
                onClose={() => setShowBulkStatusModal(false)}
                onUpdate={handleBulkStatusUpdate}
                selectedCount={selectedTasks.size}
                isProcessing={isBulkProcessing}
              />
            )}

            <BulkCancelModal
              isOpen={showBulkCancelModal}
              onClose={() => setShowBulkCancelModal(false)}
              taskIds={Array.from(selectedTasks)}
              onCancelled={({ cancelled, supersededActivities }) => {
                setSelectedTasks(new Set());
                setShowBulkActions(false);
                setShowBulkCancelModal(false);
                handleRefresh();
                toast.showSuccess(
                  `Cancelled ${cancelled} task(s)${supersededActivities ? `; superseded ${supersededActivities} activit${supersededActivities === 1 ? 'y' : 'ies'}` : ''}`
                );
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};

// Bulk Status Modal Component
interface BulkStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (status: string, notes?: string) => void;
  selectedCount: number;
  isProcessing: boolean;
}

const BulkStatusModal: React.FC<BulkStatusModalProps> = ({ isOpen, onClose, onUpdate, selectedCount, isProcessing }) => {
  const [status, setStatus] = useState<string>('sampled_in_queue');
  const [notes, setNotes] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    onUpdate(status, notes || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-3xl p-6 max-w-md w-full mx-4 border border-slate-200 shadow-xl">
        <h2 className="text-xl font-black text-slate-900 mb-4">Update Status for {selectedCount} Task(s)</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              New Status
            </label>
            <StyledSelect
              value={status}
              onChange={(value) => setStatus(value)}
              options={[
                { value: 'sampled_in_queue', label: 'Sampled - in queue' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' },
                { value: 'not_reachable', label: 'Not Reachable' },
                { value: 'invalid_number', label: 'Invalid Number' },
              ]}
              placeholder="Select status"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              placeholder="Add notes about this status change..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={isProcessing}>
            {isProcessing ? 'Updating...' : 'Update Status'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TaskList;
