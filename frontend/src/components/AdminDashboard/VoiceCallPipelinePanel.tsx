import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  MinusCircle,
  Radio,
  PhoneCall,
  ListOrdered,
  User,
  ChevronRight,
} from 'lucide-react';
import { formatDateTimeIST } from '../../utils/dateRangeUtils';
import { VOICE_DEBUG_FIXES } from '../../utils/voiceDebugCodes';

export type PipelineStepStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'running';

export interface PipelineStep {
  key: string;
  label: string;
  status: PipelineStepStatus;
  message?: string;
  errorCode?: string;
  at?: string;
}

export interface PipelineTrace {
  _id: string;
  traceKind: 'orchestrator_tick' | 'test_call' | 'queue_call';
  overallStatus: 'running' | 'success' | 'failed' | 'blocked';
  failedAtStep?: string;
  failedErrorCode?: string;
  steps: PipelineStep[];
  dialNumberMasked?: string;
  farmerName?: string;
  workflowRunId?: number;
  attemptId?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorDiagnostics {
  scheduled: boolean;
  scheduledIntervalSec: number | null;
  lastTickAt: string | null;
  lastTickError: string | null;
  tickInProgress: boolean;
}

type TraceFilter = 'all' | 'calls' | 'ticks';

function stepIcon(status: PipelineStepStatus, size = 16) {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={size} className="text-emerald-600 shrink-0" />;
    case 'failed':
      return <XCircle size={size} className="text-red-600 shrink-0" />;
    case 'running':
      return <Loader2 size={size} className="text-violet-600 animate-spin shrink-0" />;
    case 'skipped':
      return <MinusCircle size={size} className="text-slate-400 shrink-0" />;
    default:
      return <Circle size={size} className="text-slate-300 shrink-0" />;
  }
}

function traceKindLabel(kind: PipelineTrace['traceKind']) {
  switch (kind) {
    case 'test_call':
      return 'Test call';
    case 'queue_call':
      return 'Queue call';
    default:
      return 'Tick';
  }
}

function statusBadge(status: PipelineTrace['overallStatus']) {
  switch (status) {
    case 'success':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'failed':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'blocked':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    default:
      return 'bg-violet-100 text-violet-800 border-violet-200';
  }
}

function formatTimeIST(value: string | Date | null | undefined): string {
  const full = formatDateTimeIST(value);
  const match = full.match(/,\s*(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : full;
}

function isCallTrace(trace: PipelineTrace) {
  return trace.traceKind === 'queue_call' || trace.traceKind === 'test_call';
}

function farmerRole(trace: PipelineTrace) {
  if (trace.traceKind === 'test_call') return 'test';
  if (trace.traceKind === 'queue_call') return 'dialing';
  return 'next';
}

function resultSummary(trace: PipelineTrace): string {
  const failed = trace.steps.find((s) => s.key === trace.failedAtStep) || trace.steps.find((s) => s.status === 'failed');
  if (failed) {
    const code = failed.errorCode || trace.failedErrorCode;
    const msg = (failed.message || '').replace(/^\[[A-Z]+-\d+\]\s*/, '');
    return [code, msg || failed.label].filter(Boolean).join(' · ');
  }
  const running = [...trace.steps].reverse().find((s) => s.status === 'running');
  if (running) return running.message || running.label;
  if (trace.overallStatus === 'success') {
    return trace.workflowRunId != null ? `Completed · run #${trace.workflowRunId}` : 'Completed';
  }
  return trace.overallStatus;
}

function stepTooltip(step: PipelineStep): string {
  return [step.label, step.errorCode, step.message, step.at ? formatDateTimeIST(step.at) : '']
    .filter(Boolean)
    .join('\n');
}

interface VoiceCallPipelinePanelProps {
  traces: PipelineTrace[];
  orchestrator?: OrchestratorDiagnostics | null;
}

/** Temporary debug UI — relocate to a dedicated ops/diagnostics surface once voice is stable. */
const VoiceCallPipelinePanel: React.FC<VoiceCallPipelinePanelProps> = ({ traces, orchestrator }) => {
  const [filter, setFilter] = useState<TraceFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'calls') return traces.filter(isCallTrace);
    if (filter === 'ticks') return traces.filter((t) => t.traceKind === 'orchestrator_tick');
    return traces;
  }, [traces, filter]);

  const callCount = traces.filter(isCallTrace).length;
  const tickCount = traces.length - callCount;

  const toggleRow = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-amber-300 bg-white overflow-hidden">
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 space-y-1">
        <div className="flex items-center gap-2">
          <ListOrdered className="text-amber-700" size={18} />
          <h4 className="font-bold text-amber-950 text-sm">Call pipeline debug</h4>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
            Temporary
          </span>
        </div>
        <p className="text-xs text-amber-800 pl-7">
          One row per poll or call. Click a row for the full step list. Will move off this page later.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {orchestrator && (
          <div className="text-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="font-bold text-slate-700 flex items-center gap-1">
              <Radio size={12} className={orchestrator.scheduled ? 'text-emerald-600' : 'text-red-500'} />
              Background poller: {orchestrator.scheduled ? 'active' : 'not scheduled'}
              {orchestrator.scheduledIntervalSec ? ` (every ${orchestrator.scheduledIntervalSec}s)` : ''}
            </p>
            {orchestrator.lastTickAt && (
              <p className="text-slate-600">Last poll: {formatDateTimeIST(orchestrator.lastTickAt)}</p>
            )}
            {orchestrator.tickInProgress && (
              <p className="text-violet-700 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Poll in progress…
              </p>
            )}
            {orchestrator.lastTickError && (
              <p className="text-red-700">Poll error: {orchestrator.lastTickError}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['all', `All (${traces.length})`],
              ['calls', `Calls (${callCount})`],
              ['ticks', `Ticks (${tickCount})`],
            ] as Array<[TraceFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                filter === value
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!filtered.length ? (
          <p className="text-sm text-slate-500 text-center py-4">
            {traces.length
              ? 'No traces in this filter.'
              : 'No pipeline traces yet. Run a test call or wait for the orchestrator poll.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[720px]">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="w-6 px-2 py-2" />
                  <th className="text-left font-bold px-2 py-2 whitespace-nowrap">Time (IST)</th>
                  <th className="text-left font-bold px-2 py-2">Kind</th>
                  <th className="text-left font-bold px-2 py-2">Farmer</th>
                  <th className="text-left font-bold px-2 py-2">Status</th>
                  <th className="text-left font-bold px-2 py-2">Pipeline</th>
                  <th className="text-left font-bold px-2 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trace) => {
                  const expanded = expandedId === trace._id;
                  const callRow = isCallTrace(trace);
                  return (
                    <React.Fragment key={trace._id}>
                      <tr
                        onClick={() => toggleRow(trace._id)}
                        className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${
                          callRow ? 'bg-sky-50/40' : 'bg-white'
                        } ${expanded ? 'bg-violet-50/60' : ''}`}
                      >
                        <td className="px-2 py-2 align-middle">
                          <ChevronRight
                            size={14}
                            className={`text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap font-mono text-slate-700" title={formatDateTimeIST(trace.createdAt)}>
                          {formatTimeIST(trace.createdAt)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`font-bold ${callRow ? 'text-sky-800' : 'text-slate-700'}`}>
                            {traceKindLabel(trace.traceKind)}
                          </span>
                          {trace.workflowRunId != null && (
                            <span className="block text-[10px] text-slate-500">run #{trace.workflowRunId}</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {trace.farmerName ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <User size={12} className="text-sky-700 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 truncate">{trace.farmerName}</p>
                                <p className="text-[10px] text-slate-500">{farmerRole(trace)}</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full border font-bold uppercase ${statusBadge(trace.overallStatus)}`}>
                            {trace.overallStatus}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-0.5">
                            {trace.steps.map((step, idx) => (
                              <span key={`${trace._id}-${step.key}-${idx}`} title={stepTooltip(step)}>
                                {stepIcon(step.status, 14)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2 max-w-[240px]">
                          <p className="truncate text-slate-700" title={resultSummary(trace)}>
                            {resultSummary(trace)}
                          </p>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-slate-100 bg-white">
                          <td colSpan={7} className="px-3 py-3">
                            <TraceDetail trace={trace} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const TraceDetail: React.FC<{ trace: PipelineTrace }> = ({ trace }) => (
  <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>{formatDateTimeIST(trace.createdAt)}</span>
      {trace.dialNumberMasked && (
        <span className="flex items-center gap-1">
          <PhoneCall size={11} />
          {trace.dialNumberMasked}
        </span>
      )}
      {trace.taskId && <span className="font-mono">task {trace.taskId.slice(-6)}</span>}
    </div>
    <ol className="space-y-1.5">
      {trace.steps.map((step, idx) => (
        <li key={`${trace._id}-detail-${step.key}-${idx}`} className="flex gap-2 text-sm">
          <div className="mt-0.5">{stepIcon(step.status)}</div>
          <div className="min-w-0">
            <p
              className={`font-medium ${
                step.status === 'failed' ? 'text-red-800' : step.status === 'success' ? 'text-slate-800' : 'text-slate-600'
              }`}
            >
              {step.label}
              {step.errorCode && (
                <span className="ml-2 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                  {step.errorCode}
                </span>
              )}
            </p>
            {step.message && <p className="text-xs text-slate-500 break-words">{step.message}</p>}
            {step.errorCode && VOICE_DEBUG_FIXES[step.errorCode] && (
              <p className="text-xs text-amber-800 mt-0.5">Fix: {VOICE_DEBUG_FIXES[step.errorCode]}</p>
            )}
            {step.at && <p className="text-[10px] text-slate-400">{formatDateTimeIST(step.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
    {trace.failedAtStep && trace.overallStatus !== 'success' && (
      <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-900 space-y-1">
        <p>
          Stopped at:{' '}
          <strong>{trace.steps.find((s) => s.key === trace.failedAtStep)?.label || trace.failedAtStep}</strong>
          {trace.failedErrorCode && <span className="ml-2 font-mono font-bold text-red-800">{trace.failedErrorCode}</span>}
        </p>
        {trace.failedErrorCode && VOICE_DEBUG_FIXES[trace.failedErrorCode] && (
          <p>Fix: {VOICE_DEBUG_FIXES[trace.failedErrorCode]}</p>
        )}
      </div>
    )}
  </div>
);

export default VoiceCallPipelinePanel;
