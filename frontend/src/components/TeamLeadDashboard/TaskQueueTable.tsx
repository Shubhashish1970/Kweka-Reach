import React, { useMemo, useState, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronUp, Loader2, MapPin, Phone, Package, MessageSquare, Users as UsersIcon } from 'lucide-react';
import StyledSelect from '../shared/StyledSelect';

export type TaskQueueTableTask = {
  taskId: string;
  farmer: { name?: string; mobileNumber?: string; preferredLanguage?: string; location?: string };
  activity: {
    type?: string;
    date?: string;
    officerName?: string;
    territory?: string;
    crops?: string[];
    products?: string[];
  };
  status: string;
  scheduledDate: string;
  createdAt?: string;
  assignedAgentName?: string | null;
  /** Set when task is completed (outcome label e.g. Completed Conversation, Unsuccessful) */
  outcome?: string | null;
  /** Set when task is completed (from call log) */
  sentiment?: string | null;
};

type TaskTableColumnKey =
  | 'expand'
  | 'farmerName'
  | 'status'
  | 'scheduledDate'
  | 'activity'
  | 'territory'
  | 'officer'
  | 'language'
  | 'assignedAgent';

const DEFAULT_WIDTHS: Record<TaskTableColumnKey, number> = {
  expand: 48,
  farmerName: 180,
  status: 140,
  scheduledDate: 120,
  activity: 100,
  territory: 140,
  officer: 160,
  language: 100,
  assignedAgent: 140,
};

function getSortValue(task: TaskQueueTableTask, key: TaskTableColumnKey): string | number {
  switch (key) {
    case 'expand':
      return 0;
    case 'farmerName':
      return (task.farmer?.name || '').toLowerCase();
    case 'status':
      return (task.status || '').toLowerCase();
    case 'scheduledDate':
      return new Date(task.scheduledDate || 0).getTime();
    case 'activity':
      return (task.activity?.type || '').toLowerCase();
    case 'territory':
      return (task.activity?.territory || '').toLowerCase();
    case 'officer':
      return (task.activity?.officerName || '').toLowerCase();
    case 'language':
      return (task.farmer?.preferredLanguage || '').toLowerCase();
    case 'assignedAgent':
      return (task.assignedAgentName || '').toLowerCase();
    default:
      return '';
  }
}

import { formatDateIST } from '../../utils/dateRangeUtils';

function formatDate(dateString: string): string {
  return formatDateIST(dateString);
}

export interface TaskQueueTableProps {
  tasks: TaskQueueTableTask[];
  tasksTotal?: number;
  taskPageSize: number;
  pageSizeOptions: readonly number[];
  onPageSizeChange: (size: number) => void;
  showAssignedColumn?: boolean;
  getStatusBadge: (status: string) => React.ReactNode;
  loadMoreRef?: React.RefObject<HTMLDivElement | null>;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Optional table title override; default uses "Tasks (X of Y)" */
  title?: React.ReactNode;
  /** If set, sort state is persisted to localStorage under this key (e.g. admin.agentQueue.tableSort) */
  tableSortStorageKey?: string;
}

const TaskQueueTable: React.FC<TaskQueueTableProps> = ({
  tasks,
  tasksTotal,
  taskPageSize,
  pageSizeOptions,
  onPageSizeChange,
  showAssignedColumn = false,
  getStatusBadge,
  loadMoreRef,
  isLoadingMore = false,
  onLoadMore,
  title,
  tableSortStorageKey,
}) => {
  const [tableSort, setTableSort] = useState<{ key: TaskTableColumnKey; dir: 'asc' | 'desc' }>(() => {
    if (tableSortStorageKey) {
      const raw = localStorage.getItem(tableSortStorageKey);
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
      } catch {
        // ignore
      }
    }
    return { key: 'scheduledDate', dir: 'asc' };
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (tableSortStorageKey) {
      localStorage.setItem(tableSortStorageKey, JSON.stringify(tableSort));
    }
  }, [tableSort, tableSortStorageKey]);

  const sortedTasks = useMemo(() => {
    const { key, dir } = tableSort;
    const mapped = tasks.map((t, idx) => ({ task: t, idx }));
    mapped.sort((a, b) => {
      const va = getSortValue(a.task, key);
      const vb = getSortValue(b.task, key);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) {
        const ca = new Date(a.task.createdAt || 0).getTime();
        const cb = new Date(b.task.createdAt || 0).getTime();
        if (ca !== cb) return dir === 'asc' ? ca - cb : cb - ca;
        return String(a.task.taskId).localeCompare(String(b.task.taskId));
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    return mapped.map((m) => m.task);
  }, [tasks, tableSort]);

  const handleHeaderClick = (key: TaskTableColumnKey) => {
    setTableSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  };

  const toggleExpand = (taskId: string) => {
    setExpandedTaskId((curr) => (curr === taskId ? null : taskId));
  };

  const columns: Array<{ key: TaskTableColumnKey; label: string }> = [
    { key: 'expand', label: '' },
    { key: 'farmerName', label: 'Farmer' },
    { key: 'status', label: 'Status' },
    { key: 'scheduledDate', label: 'Scheduled' },
    { key: 'activity', label: 'Activity' },
    { key: 'territory', label: 'Territory' },
    { key: 'officer', label: 'Officer' },
    { key: 'language', label: 'Language' },
  ];
  if (showAssignedColumn) columns.push({ key: 'assignedAgent', label: 'Assigned' });

  const colCount = columns.length;

  return (
    <>
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-4">
          {title ?? (
            <>Tasks ({tasksTotal != null ? `${tasks.length} of ${tasksTotal}` : tasks?.length ?? 0})</>
          )}
        </h3>
        {!sortedTasks.length ? (
          <div className="text-center py-12">
            <p className="text-sm text-slate-600 font-medium">No tasks in queue.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {columns.map((col) => {
                    const isSorted = tableSort.key === col.key;
                    const w = DEFAULT_WIDTHS[col.key];
                    return (
                      <th
                        key={col.key}
                        className="relative px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none"
                        style={{ width: w, minWidth: w }}
                        onClick={col.key === 'expand' ? undefined : () => handleHeaderClick(col.key)}
                        title={col.key === 'expand' ? '' : 'Click to sort'}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate">{col.label}</span>
                          {col.key !== 'expand' && isSorted &&
                            (tableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => {
                  const isExpanded = expandedTaskId === task.taskId;
                  return (
                    <React.Fragment key={task.taskId}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td
                          className="px-3 py-3 text-sm"
                          style={{ width: DEFAULT_WIDTHS.expand, minWidth: DEFAULT_WIDTHS.expand }}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors"
                            onClick={() => toggleExpand(task.taskId)}
                            title="Expand / collapse"
                          >
                            {isExpanded ? (
                              <ChevronUp size={16} className="text-slate-500" />
                            ) : (
                              <ChevronDown size={16} className="text-slate-500" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-sm font-bold text-slate-900 truncate" title={task.farmer?.name || ''}>
                          {task.farmer?.name ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-sm">{getStatusBadge(task.status)}</td>
                        <td className="px-3 py-3 text-sm text-slate-700">{formatDate(task.scheduledDate)}</td>
                        <td className="px-3 py-3 text-sm text-slate-700 truncate" title={task.activity?.type || ''}>
                          {task.activity?.type ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-700 truncate" title={task.activity?.territory || ''}>
                          {task.activity?.territory ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-700 truncate" title={task.activity?.officerName || ''}>
                          {task.activity?.officerName ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-700">{task.farmer?.preferredLanguage ?? '—'}</td>
                        {showAssignedColumn && (
                          <td className="px-3 py-3 text-sm text-slate-600 truncate" title={task.assignedAgentName || ''}>
                            {task.assignedAgentName ?? '—'}
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-white">
                          <td colSpan={colCount} className="px-3 pb-3 pt-2 align-top">
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border border-slate-200">
                                <div className="flex items-start gap-2">
                                  <Calendar size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-medium mb-0.5">Scheduled</p>
                                    <p className="text-xs font-bold text-slate-900">{formatDate(task.scheduledDate)}</p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <MapPin size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[10px] text-slate-500 font-medium mb-0.5">Location</p>
                                    <p className="text-xs font-bold text-slate-900 truncate" title={task.farmer?.location || ''}>
                                      {task.farmer?.location ?? '—'}
                                    </p>
                                    {task.activity?.territory && (
                                      <p className="text-[10px] text-slate-600 mt-0.5">{task.activity.territory}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <Phone size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-medium mb-0.5">Phone</p>
                                    <p className="text-xs font-bold text-slate-900">{task.farmer?.mobileNumber ?? '—'}</p>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <UsersIcon size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-medium mb-0.5">Language</p>
                                    <p className="text-xs font-bold text-slate-900">{task.farmer?.preferredLanguage ?? '—'}</p>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                                  <Package size={14} className="text-slate-500" />
                                  Activity details – Crop & Product
                                </h4>
                                <div className="flex flex-wrap gap-3 p-2 bg-slate-50 rounded-lg border border-slate-200">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-slate-500 font-medium mb-1">Crops</p>
                                    {(task.activity as any)?.crops?.length ? (
                                      <div className="flex flex-wrap gap-1">
                                        {((task.activity as any).crops as string[]).map((c, i) => (
                                          <span key={i} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded text-[10px] font-medium border border-emerald-200">
                                            {c}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-500">—</p>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-slate-500 font-medium mb-1">Products</p>
                                    {(task.activity as any)?.products?.length ? (
                                      <div className="flex flex-wrap gap-1">
                                        {((task.activity as any).products as string[]).map((p, i) => (
                                          <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded text-[10px] font-medium border border-blue-200">
                                            {p}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-500">—</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {task.status === 'completed' && (
                                <div>
                                  <h4 className="text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
                                    <MessageSquare size={14} className="text-slate-500" />
                                    Update (call outcome)
                                  </h4>
                                  <div className="flex flex-wrap gap-4 p-2 bg-slate-50 rounded-lg border border-slate-200">
                                    <div>
                                      <p className="text-[10px] text-slate-500 font-medium mb-0.5">Status</p>
                                      <p className="text-xs font-bold text-slate-900">{(task as any).outcome ?? '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] text-slate-500 font-medium mb-0.5">Sentiment</p>
                                      <p className="text-xs font-bold text-slate-900">{(task as any).sentiment ?? '—'}</p>
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

          {/* Load more */}
          {tasksTotal != null && tasks.length < tasksTotal && (
            <div ref={loadMoreRef} className="py-4 text-center">
              {isLoadingMore ? (
                <div className="flex items-center justify-center gap-2 text-slate-500">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Loading more…</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="text-sm text-green-700 hover:text-green-800 font-medium"
                >
                  Load more ({tasks.length} of {tasksTotal} shown)
                </button>
              )}
            </div>
          )}
          {tasksTotal != null && tasks.length >= tasksTotal && tasks.length > 0 && (
            <p className="mt-4 pt-4 border-t border-slate-100 text-center text-sm text-slate-400">
              All {tasksTotal} tasks loaded
            </p>
          )}
        </>
      )}
      </div>

      {/* Pagination - separate card to match Activity Monitoring */}
      {tasksTotal != null && tasksTotal > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mt-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-sm text-slate-600">Showing {tasks.length} of {tasksTotal} tasks</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rows</span>
              <StyledSelect
                value={String(taskPageSize)}
                onChange={(v) => onPageSizeChange(Number(v))}
                options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
                className="min-w-[80px]"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TaskQueueTable;
