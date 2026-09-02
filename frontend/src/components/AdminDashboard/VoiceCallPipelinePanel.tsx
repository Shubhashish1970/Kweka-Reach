import React from 'react';
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

function stepIcon(status: PipelineStepStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
    case 'failed':
      return <XCircle size={16} className="text-red-600 shrink-0" />;
    case 'running':
      return <Loader2 size={16} className="text-violet-600 animate-spin shrink-0" />;
    case 'skipped':
      return <MinusCircle size={16} className="text-slate-400 shrink-0" />;
    default:
      return <Circle size={16} className="text-slate-300 shrink-0" />;
  }
}

function traceKindLabel(kind: PipelineTrace['traceKind']) {
  switch (kind) {
    case 'test_call':
      return 'Test call';
    case 'queue_call':
      return 'Queue call';
    default:
      return 'Orchestrator tick';
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

interface VoiceCallPipelinePanelProps {
  traces: PipelineTrace[];
  orchestrator?: OrchestratorDiagnostics | null;
}

/** Temporary debug UI — relocate to a dedicated ops/diagnostics surface once voice is stable. */
const VoiceCallPipelinePanel: React.FC<VoiceCallPipelinePanelProps> = ({ traces, orchestrator }) => {
  const latest = traces[0];

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
          Step-by-step trace for orchestrator and test calls. Will move off this page later.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {orchestrator && (
          <div className="text-xs rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
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

        {!latest ? (
          <p className="text-sm text-slate-500 text-center py-4">
            No pipeline traces yet. Run a test call or wait for the orchestrator poll.
          </p>
        ) : (
          <div className="space-y-3">
            {traces.slice(0, 8).map((trace) => (
              <div key={trace._id} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs">
                  <span className="font-bold text-slate-800">{traceKindLabel(trace.traceKind)}</span>
                  <span className={`px-2 py-0.5 rounded-full border font-bold uppercase ${statusBadge(trace.overallStatus)}`}>
                    {trace.overallStatus}
                  </span>
                  <span className="text-slate-500">{formatDateTimeIST(trace.createdAt)}</span>
                  {trace.workflowRunId != null && (
                    <span className="text-slate-500">run #{trace.workflowRunId}</span>
                  )}
                </div>

                {trace.farmerName && (
                  <div className="px-3 py-2 bg-sky-50 border-b border-sky-100 flex items-center gap-2 text-sm">
                    <User size={14} className="text-sky-700 shrink-0" />
                    <span className="font-bold text-sky-950">{trace.farmerName}</span>
                    <span className="text-xs text-sky-700">
                      {trace.traceKind === 'test_call'
                        ? '· manual test (not from queue)'
                        : trace.traceKind === 'queue_call'
                          ? '· dialing from queue'
                          : '· next in queue'}
                    </span>
                    {trace.dialNumberMasked && (
                      <span className="ml-auto flex items-center gap-1 text-xs text-slate-600">
                        <PhoneCall size={11} />
                        {trace.dialNumberMasked}
                      </span>
                    )}
                  </div>
                )}

                {!trace.farmerName && trace.dialNumberMasked && (
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-1 text-xs text-slate-600">
                    <PhoneCall size={11} />
                    {trace.dialNumberMasked}
                  </div>
                )}

                <ol className="px-3 py-2 space-y-2">
                  {trace.steps.map((step, idx) => (
                    <li key={`${trace._id}-${step.key}-${idx}`} className="flex gap-2 text-sm">
                      <div className="mt-0.5">{stepIcon(step.status)}</div>
                      <div className="min-w-0">
                        <p
                          className={`font-medium ${
                            step.status === 'failed'
                              ? 'text-red-800'
                              : step.status === 'success'
                                ? 'text-slate-800'
                                : 'text-slate-600'
                          }`}
                        >
                          {step.label}
                          {step.errorCode && (
                            <span className="ml-2 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                              {step.errorCode}
                            </span>
                          )}
                        </p>
                        {step.message && (
                          <p className="text-xs text-slate-500 break-words">{step.message}</p>
                        )}
                        {step.errorCode && VOICE_DEBUG_FIXES[step.errorCode] && (
                          <p className="text-xs text-amber-800 mt-0.5">
                            Fix: {VOICE_DEBUG_FIXES[step.errorCode]}
                          </p>
                        )}
                        {step.at && (
                          <p className="text-[10px] text-slate-400">{formatDateTimeIST(step.at)}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                {trace.failedAtStep && trace.overallStatus !== 'success' && (
                  <div className="px-3 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-900 space-y-1">
                    <p>
                      Stopped at:{' '}
                      <strong>
                        {trace.steps.find((s) => s.key === trace.failedAtStep)?.label || trace.failedAtStep}
                      </strong>
                      {trace.failedErrorCode && (
                        <span className="ml-2 font-mono font-bold text-red-800">{trace.failedErrorCode}</span>
                      )}
                    </p>
                    {trace.failedErrorCode && VOICE_DEBUG_FIXES[trace.failedErrorCode] && (
                      <p>Fix: {VOICE_DEBUG_FIXES[trace.failedErrorCode]}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceCallPipelinePanel;
