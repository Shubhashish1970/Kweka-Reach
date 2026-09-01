import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import { adminAPI } from '../../services/api';
import { Loader2, Filter, RefreshCw, Users as UsersIcon, Mic, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react';
import Button from '../shared/Button';
import StyledSelect from '../shared/StyledSelect';
import InfoBanner from '../shared/InfoBanner';
import { getTaskStatusLabel } from '../../utils/taskStatusLabels';
import TaskQueueTable from '../TeamLeadDashboard/TaskQueueTable';
import { type DateRangePreset, getPresetRange, formatPretty } from '../../utils/dateRangeUtils';
import { COMMON_DATE_RANGE_PRESETS, loadJsonStorage, parseBoolean, parseIsoDate, parsePreset, parseString, saveJsonStorage } from '../../utils/filterPersistence';

const AGENT_QUEUE_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

interface AgentQueueSummary {
  agentId: string;
  agentName: string;
  agentEmail: string;
  employeeId: string;
  agentKind?: 'human' | 'virtual';
  languageCapabilities: string[];
  statusBreakdown: {
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    total: number;
  };
}

interface AgentQueueDetail {
  agent: {
    agentId: string;
    agentName: string;
    agentEmail: string;
    employeeId: string;
    agentKind?: 'human' | 'virtual';
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
    farmer: {
      name: string;
      mobileNumber: string;
      preferredLanguage: string;
      location: string;
    };
    activity: {
      type: string;
      date: string;
      officerName: string;
      territory: string;
    };
    status: 'sampled_in_queue' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number';
    scheduledDate: string;
    createdAt: string;
  }>;
  tasksTotal?: number;
  officerOptions?: string[];
  territoryOptions?: string[];
}

const AGENT_QUEUE_FILTERS_KEY = 'admin.agentQueue.filters';

type SavedAgentQueueFilters = {
  showOnlyActive: boolean;
  showDetailFilters: boolean;
  detailFilters: {
    dateFrom: string;
    dateTo: string;
    status: string;
    language: string;
    territory: string;
  };
  detailDatePreset: DateRangePreset;
};

function loadSavedAgentQueueFilters(): SavedAgentQueueFilters {
  const fallback = getPresetRange('Last 7 days');
  return loadJsonStorage(
    AGENT_QUEUE_FILTERS_KEY,
    () => ({
      showOnlyActive: true,
      showDetailFilters: false,
      detailFilters: {
        dateFrom: fallback.start,
        dateTo: fallback.end,
        status: '',
        language: '',
        territory: '',
      },
      detailDatePreset: 'Last 7 days' as DateRangePreset,
    }),
    (parsed, defaults) => {
      const p = parsed as Record<string, unknown>;
      const detail = (p.detailFilters as Record<string, unknown>) || {};
      return {
        showOnlyActive: parseBoolean(p.showOnlyActive, defaults.showOnlyActive),
        showDetailFilters: parseBoolean(p.showDetailFilters, defaults.showDetailFilters),
        detailFilters: {
          dateFrom: parseIsoDate(detail.dateFrom, defaults.detailFilters.dateFrom),
          dateTo: parseIsoDate(detail.dateTo, defaults.detailFilters.dateTo),
          status: parseString(detail.status, defaults.detailFilters.status),
          language: parseString(detail.language, defaults.detailFilters.language),
          territory: parseString(detail.territory, defaults.detailFilters.territory),
        },
        detailDatePreset: parsePreset(p.detailDatePreset, defaults.detailDatePreset, COMMON_DATE_RANGE_PRESETS),
      };
    }
  );
}

function isVoiceAgent(agentKind?: 'human' | 'virtual'): boolean {
  return agentKind === 'virtual';
}

const AgentQueueView: React.FC = () => {
  const { showError, showSuccess } = useToast();
  const initialAgentQueueFilters = useMemo(() => loadSavedAgentQueueFilters(), []);
  const [queues, setQueues] = useState<AgentQueueSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentQueueDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyActive, setShowOnlyActive] = useState(() => initialAgentQueueFilters.showOnlyActive);
  const [showDetailFilters, setShowDetailFilters] = useState(() => initialAgentQueueFilters.showDetailFilters);

  const [detailFilters, setDetailFilters] = useState(() => initialAgentQueueFilters.detailFilters);
  const [detailDatePreset, setDetailDatePreset] = useState<DateRangePreset>(() => initialAgentQueueFilters.detailDatePreset);
  const [isDetailDateOpen, setIsDetailDateOpen] = useState(false);
  const [draftDateStart, setDraftDateStart] = useState(() => initialAgentQueueFilters.detailFilters.dateFrom);
  const [draftDateEnd, setDraftDateEnd] = useState(() => initialAgentQueueFilters.detailFilters.dateTo);
  const detailDateRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveJsonStorage(AGENT_QUEUE_FILTERS_KEY, {
      showOnlyActive,
      showDetailFilters,
      detailFilters,
      detailDatePreset,
    });
  }, [showOnlyActive, showDetailFilters, detailFilters, detailDatePreset]);

  useEffect(() => {
    if (!isDetailDateOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (detailDateRef.current && !detailDateRef.current.contains(e.target as Node)) setIsDetailDateOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isDetailDateOpen]);

  const fetchQueues = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await adminAPI.getAgentQueues({
        isActive: showOnlyActive,
      }) as any;

      if (response.success && response.data) {
        setQueues(response.data || []);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load agent queues';
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgentDetail = async (
    agentId: string,
    applyFilters = true,
    overrideFilters?: Partial<typeof detailFilters>
  ) => {
    setIsLoadingDetail(true);
    try {
      const filters = overrideFilters ? { ...detailFilters, ...overrideFilters } : detailFilters;
      const params = applyFilters
        ? {
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            status: filters.status || undefined,
            language: filters.language || undefined,
            territory: filters.territory || undefined,
            page: 1,
            limit: 100,
          }
        : undefined;
      const response = (await adminAPI.getAgentQueue(agentId, params)) as any;

      if (response.success && response.data) {
        setAgentDetail(response.data);
        setSelectedAgentId(agentId);
      }
    } catch (err: any) {
      showError(err.message || 'Failed to load agent queue details');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    fetchQueues();
  }, [showOnlyActive]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      sampled_in_queue: { icon: Clock, color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      in_progress: { icon: Loader2, color: 'bg-blue-100 text-blue-800 border-blue-200' },
      completed: { icon: CheckCircle, color: 'bg-green-100 text-green-800 border-green-200' },
      not_reachable: { icon: XCircle, color: 'bg-orange-100 text-orange-800 border-orange-200' },
      invalid_number: { icon: AlertCircle, color: 'bg-red-100 text-red-800 border-red-200' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.sampled_in_queue;
    const Icon = config.icon;
    const label = getTaskStatusLabel(status);

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${config.color}`}>
        <Icon size={12} className={status === 'in_progress' ? 'animate-spin' : ''} />
        {label}
      </span>
    );
  };

  // If agent detail is selected, show detail view
  if (agentDetail && selectedAgentId) {
    const detailIsVoiceAgent = isVoiceAgent(agentDetail.agent.agentKind);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div
          className={`rounded-3xl p-6 border shadow-sm ${
            detailIsVoiceAgent
              ? 'bg-violet-50 border-violet-300 border-2'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => { setAgentDetail(null); setSelectedAgentId(null); }}>
                ← Back to Queues
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDetailFilters(!showDetailFilters)}
              >
                <Filter size={16} />
                {showDetailFilters ? 'Hide filters' : 'Filters'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchAgentDetail(selectedAgentId, true)}
                disabled={isLoadingDetail}
              >
                <RefreshCw size={16} className={isLoadingDetail ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div
              className={`w-16 h-16 rounded-full border-2 flex items-center justify-center ${
                detailIsVoiceAgent
                  ? 'bg-violet-100 border-violet-300'
                  : 'bg-slate-100 border-slate-200'
              }`}
            >
              {detailIsVoiceAgent ? (
                <Mic className="text-violet-600" size={32} />
              ) : (
                <UsersIcon className="text-slate-400" size={32} />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl font-black text-slate-900">{agentDetail.agent.agentName}</h2>
                {detailIsVoiceAgent && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-200 text-violet-900 border border-violet-300">
                    Voice Agent
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 mb-2">{agentDetail.agent.agentEmail}</p>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>Employee ID: {agentDetail.agent.employeeId}</span>
                <span>Languages: {agentDetail.agent.languageCapabilities.join(', ')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-4">Queue Statistics</h3>
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

        {/* Filters – expand when Filter button clicked */}
        {showDetailFilters && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-3">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date Range</label>
              <div className="relative" ref={detailDateRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsDetailDateOpen((p) => !p);
                    if (!isDetailDateOpen) {
                      setDraftDateStart(detailFilters.dateFrom);
                      setDraftDateEnd(detailFilters.dateTo);
                    }
                  }}
                  className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 flex items-center justify-between"
                >
                  <span className="truncate">
                    {detailDatePreset}
                    {detailFilters.dateFrom && detailFilters.dateTo ? ` • ${formatPretty(detailFilters.dateFrom)} - ${formatPretty(detailFilters.dateTo)}` : ''}
                  </span>
                  <ChevronDown size={16} className="text-slate-400" />
                </button>
                {isDetailDateOpen && (
                  <div className="absolute z-50 mt-2 w-[500px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex">
                      <div className="w-44 border-r border-slate-200 bg-slate-50 p-2">
                        {(['Custom', 'Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'YTD'] as DateRangePreset[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setDetailDatePreset(p);
                              const { start, end } = getPresetRange(p, detailFilters.dateFrom || undefined, detailFilters.dateTo || undefined);
                              setDraftDateStart(start);
                              setDraftDateEnd(end);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${detailDatePreset === p ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <div className="flex-1 p-4">
                        <div className="flex gap-3 mb-4">
                          <div className="flex-1">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Start</p>
                            <input
                              type="date"
                              value={draftDateStart}
                              onChange={(e) => { setDetailDatePreset('Custom' as DateRangePreset); setDraftDateStart(e.target.value); }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400"
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">End</p>
                            <input
                              type="date"
                              value={draftDateEnd}
                              onChange={(e) => { setDetailDatePreset('Custom' as DateRangePreset); setDraftDateEnd(e.target.value); }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                          <Button variant="secondary" size="sm" onClick={() => setIsDetailDateOpen(false)}>Cancel</Button>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailFilters((f) => ({ ...f, dateFrom: draftDateStart, dateTo: draftDateEnd }));
                              setIsDetailDateOpen(false);
                              fetchAgentDetail(selectedAgentId, true, { dateFrom: draftDateStart, dateTo: draftDateEnd });
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
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Agent</label>
              <StyledSelect
                value={selectedAgentId}
                onChange={(value) => {
                  setSelectedAgentId(value);
                  fetchAgentDetail(value, true);
                }}
                options={queues.map((q) => ({ value: q.agentId, label: q.agentName }))}
                placeholder="Select agent"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Status</label>
              <StyledSelect
                value={detailFilters.status}
                onChange={(value) => {
                  setDetailFilters((f) => ({ ...f, status: value }));
                  fetchAgentDetail(selectedAgentId, true, { status: value });
                }}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'sampled_in_queue', label: 'Sampled - in queue' },
                  { value: 'in_progress', label: 'In progress' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'not_reachable', label: 'Not reachable' },
                  { value: 'invalid_number', label: 'Invalid' },
                ]}
                placeholder="All Statuses"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Language</label>
              <StyledSelect
                value={detailFilters.language}
                onChange={(value) => {
                  setDetailFilters((f) => ({ ...f, language: value }));
                  fetchAgentDetail(selectedAgentId, true, { language: value });
                }}
                options={[
                  { value: '', label: 'All Languages' },
                  ...(agentDetail?.agent?.languageCapabilities || []).map((lang) => ({ value: lang, label: lang })),
                ]}
                placeholder="All Languages"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Territory</label>
              <StyledSelect
                value={detailFilters.territory}
                onChange={(value) => {
                  setDetailFilters((f) => ({ ...f, territory: value }));
                  fetchAgentDetail(selectedAgentId, true, { territory: value });
                }}
                options={[
                  { value: '', label: 'All Territories' },
                  ...((agentDetail as any)?.territoryOptions || []).map((t: string) => ({ value: t, label: t })),
                ]}
                placeholder="All Territories"
              />
            </div>
          </div>
        </div>
        )}

        {/* Tasks List - same table UX as Team Lead Task Queue (primary columns, expandable secondary) */}
        <TaskQueueTable
          tasks={agentDetail.tasks}
          tasksTotal={(agentDetail as any).tasksTotal ?? agentDetail.tasks.length}
          taskPageSize={agentDetail.tasks.length}
          pageSizeOptions={AGENT_QUEUE_PAGE_SIZE_OPTIONS}
          onPageSizeChange={() => {}}
          showAssignedColumn={false}
          getStatusBadge={getStatusBadge}
          tableSortStorageKey="admin.agentQueue.tableSort"
        />
      </div>
    );
  }

  // Default view: List of all agent queues
  return (
    <div className="space-y-6">
      <InfoBanner>
        Monitor task queues and workload by agent. Click an agent to see their tasks and status breakdown.
        Voice agents are shown with a violet card.
      </InfoBanner>

      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
            <h2 className="text-xl font-black text-slate-900 mb-1">Agent Queues</h2>
            <p className="text-sm text-slate-600">Monitor task queues for all agents</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyActive}
                onChange={(e) => setShowOnlyActive(e.target.checked)}
                className="w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              />
              <span className="text-sm font-medium text-slate-700">Active Only</span>
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchQueues}
              disabled={isLoading}
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Queues List */}
      {isLoading ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <Loader2 className="animate-spin mx-auto mb-4 text-green-700" size={32} />
          <p className="text-sm text-slate-600 font-medium">Loading agent queues...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <AlertCircle className="mx-auto mb-4 text-red-500" size={32} />
          <p className="text-sm text-red-600 font-medium mb-4">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchQueues}>
            Try Again
          </Button>
        </div>
      ) : queues.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
          <p className="text-sm text-slate-600 font-medium">No agent queues found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {queues.map((queue) => {
            const voiceAgent = isVoiceAgent(queue.agentKind);

            return (
            <div
              key={queue.agentId}
              className={`rounded-3xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                voiceAgent
                  ? 'bg-violet-50 border-2 border-violet-300 hover:border-violet-400'
                  : 'bg-white border border-slate-200'
              }`}
              onClick={() => fetchAgentDetail(queue.agentId)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {voiceAgent ? (
                      <Mic size={18} className="text-violet-600" />
                    ) : (
                      <UsersIcon size={18} className="text-green-700" />
                    )}
                    <h3 className="text-base font-black text-slate-900">{queue.agentName}</h3>
                    {voiceAgent && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-200 text-violet-900 border border-violet-300">
                        Voice Agent
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mb-1">{queue.agentEmail}</p>
                  <p className="text-xs text-slate-500">ID: {queue.employeeId}</p>
                </div>
                <ChevronRight size={20} className="text-slate-400" />
              </div>

              <div className="mb-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                  Languages
                </p>
                <div className="flex flex-wrap gap-1">
                  {queue.languageCapabilities.map((lang, idx) => (
                    <span
                      key={idx}
                      className={`px-2 py-1 rounded-lg text-xs font-medium border ${
                        voiceAgent
                          ? 'bg-violet-100 text-violet-800 border-violet-200'
                          : 'bg-green-50 text-green-700 border-green-200'
                      }`}
                    >
                      {lang}
                    </span>
                  ))}
                </div>
              </div>

              <div className={`border-t pt-4 ${voiceAgent ? 'border-violet-200' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-black text-slate-900">Total Tasks</span>
                  <span className={`text-xl font-black ${voiceAgent ? 'text-violet-700' : 'text-green-700'}`}>
                    {queue.statusBreakdown.total}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Sampled - in queue</span>
                    <span className="font-bold text-yellow-700">{queue.statusBreakdown.sampled_in_queue}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">In Progress</span>
                    <span className="font-bold text-blue-700">{queue.statusBreakdown.in_progress}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Completed</span>
                    <span className="font-bold text-green-700">{queue.statusBreakdown.completed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Not Reachable</span>
                    <span className="font-bold text-orange-700">{queue.statusBreakdown.not_reachable}</span>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentQueueView;
