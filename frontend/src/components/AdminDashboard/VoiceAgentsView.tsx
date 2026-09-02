import React, { useCallback, useEffect, useState } from 'react';
import {
  Mic, Loader2, RefreshCw, Save, Settings2, Play, Pause, Square,
  Clock, AlertCircle, CheckCircle2, Copy, ChevronRight, PhoneCall,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { voiceAdminAPI } from '../../services/api';
import Button from '../shared/Button';
import InfoBanner from '../shared/InfoBanner';
import { formatDateTimeIST } from '../../utils/dateRangeUtils';
import VoiceCallPipelinePanel from './VoiceCallPipelinePanel';

type RuntimeState =
  | 'idle'
  | 'calling'
  | 'paused'
  | 'stopped'
  | 'outside_hours'
  | 'daily_cap_reached'
  | 'not_configured';

interface VoiceAgentRow {
  agentId: string;
  name: string;
  email: string;
  employeeId: string;
  languageCapabilities: string[];
  isActive: boolean;
  voiceStatus: 'running' | 'paused' | 'stopped';
  voiceTriggerUuid: string | null;
  runtimeState: RuntimeState;
  queueCounts: { sampled_in_queue: number; due_now?: number; in_progress: number; completed_today: number };
  consecutiveApiFailures: number;
  lastTriggerAt: string | null;
  lastWebhookAt: string | null;
  voiceDialOverrideEnabled?: boolean;
}

interface PlatformSettings {
  orchestratorEnabled: boolean;
  pollIntervalSec: number;
  defaultTimezone: string;
  defaultCallingDaysOfWeek: number[];
  defaultCallingStartTime: string;
  defaultCallingEndTime: string;
  defaultMinGapBetweenCallsSec: number;
  defaultMaxCallsPerDay: number;
  defaultMaxConcurrentCalls: number;
  stuckCallTimeoutMinutes: number;
  autoPauseAfterConsecutiveFailures: number;
  useTestEndpoint: boolean;
}

interface SecretsStatus {
  apiBaseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  webhookKeyConfigured: boolean;
  envFallbackTriggerUuid: boolean;
  webhookUrl: string | null;
}

function runtimeBadge(state: RuntimeState): { label: string; className: string } {
  switch (state) {
    case 'idle':
      return { label: 'Ready', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'calling':
      return { label: 'On call', className: 'bg-violet-200 text-violet-900 border-violet-300' };
    case 'paused':
      return { label: 'Paused', className: 'bg-amber-100 text-amber-800 border-amber-200' };
    case 'stopped':
      return { label: 'Stopped', className: 'bg-slate-200 text-slate-700 border-slate-300' };
    case 'outside_hours':
      return { label: 'Outside hours', className: 'bg-sky-100 text-sky-800 border-sky-200' };
    case 'daily_cap_reached':
      return { label: 'Daily cap', className: 'bg-orange-100 text-orange-800 border-orange-200' };
    case 'not_configured':
      return { label: 'Not configured', className: 'bg-red-100 text-red-800 border-red-200' };
    default:
      return { label: state, className: 'bg-slate-100 text-slate-700' };
  }
}

const VoiceAgentsView: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [agents, setAgents] = useState<VoiceAgentRow[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<any>(null);
  const [agentForm, setAgentForm] = useState<Record<string, unknown>>({});
  const [showTestModal, setShowTestModal] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingTrigger, setTestingTrigger] = useState(false);

  const loadList = useCallback(async () => {
    const [settingsRes, agentsRes] = await Promise.all([
      voiceAdminAPI.getSettings(),
      voiceAdminAPI.listAgents(),
    ]);
    setSettings(settingsRes.settings);
    setSecrets(settingsRes.secrets);
    setAgents(agentsRes.agents || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadList();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load voice agents');
    } finally {
      setLoading(false);
    }
  }, [loadList, showError]);

  const loadAgentDetail = useCallback(async (agentId: string) => {
    try {
      const detail = await voiceAdminAPI.getAgent(agentId);
      setAgentDetail(detail);
      setAgentForm({
        voiceTriggerUuid: detail.voiceAgentConfig?.voiceTriggerUuid || '',
        voiceStatus: detail.voiceAgentConfig?.voiceStatus || 'paused',
        inheritGlobalCallingWindow: detail.voiceAgentConfig?.inheritGlobalCallingWindow !== false,
        inheritGlobalLimits: detail.voiceAgentConfig?.inheritGlobalLimits !== false,
        callingTimezone: detail.voiceAgentConfig?.callingTimezone || '',
        callingStartTime: detail.voiceAgentConfig?.callingStartTime || '',
        callingEndTime: detail.voiceAgentConfig?.callingEndTime || '',
        maxCallsPerDay: detail.voiceAgentConfig?.maxCallsPerDay ?? '',
        minGapBetweenCallsSec: detail.voiceAgentConfig?.minGapBetweenCallsSec ?? '',
        pauseReason: detail.voiceAgentConfig?.pauseReason || '',
        triggerRouteType: detail.voiceAgentConfig?.triggerRouteType || 'api_trigger',
        voiceDialOverrideEnabled: detail.voiceAgentConfig?.voiceDialOverrideEnabled === true,
        voiceDialOverrideNumber: detail.voiceAgentConfig?.voiceDialOverrideNumber || '',
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load agent');
    }
  }, [showError]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentDetail(null);
      return;
    }
    loadAgentDetail(selectedAgentId);
    const interval = setInterval(() => {
      loadAgentDetail(selectedAgentId);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedAgentId, loadAgentDetail]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSavePlatform = async () => {
    if (!settings) return;
    setSavingPlatform(true);
    try {
      const res = await voiceAdminAPI.updateSettings(settings);
      setSettings(res.settings);
      setSecrets(res.secrets);
      showSuccess('Platform settings saved');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSavingPlatform(false);
    }
  };

  const handleAgentStatus = async (status: 'running' | 'paused' | 'stopped') => {
    if (!selectedAgentId) return;
    setSavingAgent(true);
    try {
      await voiceAdminAPI.updateAgent(selectedAgentId, {
        voiceStatus: status,
        pauseReason: status === 'paused' ? 'Paused from Voice Agents admin' : undefined,
      });
      await loadList();
      await loadAgentDetail(selectedAgentId);
      showSuccess(status === 'running' ? 'Agent started' : status === 'paused' ? 'Agent paused' : 'Agent stopped');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to update agent status');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!selectedAgentId) return;
    setSavingAgent(true);
    try {
      await voiceAdminAPI.updateAgent(selectedAgentId, {
        voiceTriggerUuid: String(agentForm.voiceTriggerUuid || '').trim() || null,
        voiceStatus: agentForm.voiceStatus,
        inheritGlobalCallingWindow: Boolean(agentForm.inheritGlobalCallingWindow),
        inheritGlobalLimits: Boolean(agentForm.inheritGlobalLimits),
        callingTimezone: agentForm.callingTimezone || null,
        callingStartTime: agentForm.callingStartTime || null,
        callingEndTime: agentForm.callingEndTime || null,
        maxCallsPerDay: agentForm.maxCallsPerDay === '' ? null : Number(agentForm.maxCallsPerDay),
        minGapBetweenCallsSec:
          agentForm.minGapBetweenCallsSec === '' ? null : Number(agentForm.minGapBetweenCallsSec),
        triggerRouteType: agentForm.triggerRouteType || 'api_trigger',
        voiceDialOverrideEnabled: Boolean(agentForm.voiceDialOverrideEnabled),
        voiceDialOverrideNumber: agentForm.voiceDialOverrideEnabled
          ? String(agentForm.voiceDialOverrideNumber || '').trim() || null
          : null,
      });
      await loadList();
      await loadAgentDetail(selectedAgentId);
      showSuccess('Agent configuration saved');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save agent');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleTestTrigger = async () => {
    if (!selectedAgentId || !testPhone.trim()) return;
    setTestingTrigger(true);
    try {
      const result = await voiceAdminAPI.testTrigger(selectedAgentId, testPhone.trim());
      showSuccess(`Test call triggered (run ${result.workflowRunId})`);
      setShowTestModal(false);
      setTestPhone('');
      await loadList();
      await loadAgentDetail(selectedAgentId);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Test trigger failed');
    } finally {
      setTestingTrigger(false);
    }
  };

  const copyWebhookUrl = () => {
    if (secrets?.webhookUrl) {
      navigator.clipboard.writeText(secrets.webhookUrl);
      showSuccess('Webhook URL copied');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-violet-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Mic className="text-violet-600" size={28} />
            Voice Agents
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Global orchestrator settings and per-agent voice configuration
          </p>
        </div>
        <Button variant="secondary" onClick={loadAll} className="flex items-center gap-2">
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      <InfoBanner variant="info">
        Voice agents use the violet theme in Agent Queues and the virtual agent workspace. Set each agent&apos;s API Trigger UUID here — not on Languages master.
      </InfoBanner>

      {/* Platform settings */}
      {settings && (
        <div className="bg-white rounded-2xl border-2 border-violet-200 shadow-sm overflow-hidden">
          <div className="bg-violet-50 border-b border-violet-200 px-6 py-4 flex items-center gap-2">
            <Settings2 className="text-violet-600" size={20} />
            <h3 className="font-bold text-violet-900">Global platform settings</h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={settings.orchestratorEnabled}
                onChange={(e) => setSettings({ ...settings, orchestratorEnabled: e.target.checked })}
                className="rounded border-violet-300 text-violet-600 focus:ring-violet-400"
              />
              Orchestrator enabled
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Poll interval (sec)</span>
              <input
                type="number"
                min={15}
                max={600}
                value={settings.pollIntervalSec}
                onChange={(e) => setSettings({ ...settings, pollIntervalSec: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Default timezone</span>
              <input
                type="text"
                value={settings.defaultTimezone}
                onChange={(e) => setSettings({ ...settings, defaultTimezone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Calling start</span>
              <input
                type="time"
                value={settings.defaultCallingStartTime}
                onChange={(e) => setSettings({ ...settings, defaultCallingStartTime: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Calling end</span>
              <input
                type="time"
                value={settings.defaultCallingEndTime}
                onChange={(e) => setSettings({ ...settings, defaultCallingEndTime: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Max calls / day</span>
              <input
                type="number"
                min={0}
                value={settings.defaultMaxCallsPerDay}
                onChange={(e) => setSettings({ ...settings, defaultMaxCallsPerDay: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Min gap between calls (sec)</span>
              <input
                type="number"
                min={0}
                value={settings.defaultMinGapBetweenCallsSec}
                onChange={(e) =>
                  setSettings({ ...settings, defaultMinGapBetweenCallsSec: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={settings.useTestEndpoint}
                onChange={(e) => setSettings({ ...settings, useTestEndpoint: e.target.checked })}
                className="rounded border-violet-300 text-violet-600 focus:ring-violet-400"
              />
              Use test endpoint
            </label>
          </div>
          {secrets && (
            <div className="px-6 pb-4 flex flex-wrap gap-3 text-xs">
              <span className={`px-2 py-1 rounded-full border ${secrets.apiBaseUrlConfigured && secrets.apiKeyConfigured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                API {secrets.apiBaseUrlConfigured && secrets.apiKeyConfigured ? 'configured' : 'missing'}
              </span>
              <span className={`px-2 py-1 rounded-full border ${secrets.webhookKeyConfigured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                Webhook key {secrets.webhookKeyConfigured ? 'set' : 'missing'}
              </span>
              {secrets.webhookUrl && (
                <button
                  type="button"
                  onClick={copyWebhookUrl}
                  className="flex items-center gap-1 px-2 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                >
                  <Copy size={12} />
                  Copy webhook URL
                </button>
              )}
            </div>
          )}
          <div className="px-6 pb-6">
            <Button onClick={handleSavePlatform} disabled={savingPlatform} className="bg-violet-600 hover:bg-violet-500 text-white">
              {savingPlatform ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save platform settings
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent list */}
        <div className="space-y-3">
          <h3 className="font-bold text-slate-800">Virtual agents ({agents.length})</h3>
          {agents.length === 0 ? (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-6 text-center text-slate-600">
              No virtual agents found. Create a CC agent with kind &quot;Virtual&quot; in User Management.
            </div>
          ) : (
            agents.map((agent) => {
              const badge = runtimeBadge(agent.runtimeState);
              const selected = selectedAgentId === agent.agentId;
              return (
                <button
                  key={agent.agentId}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.agentId)}
                  className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                    selected
                      ? 'bg-violet-50 border-violet-400 shadow-md'
                      : 'bg-white border-violet-200 hover:border-violet-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-100 border border-violet-300 flex items-center justify-center">
                        <Mic className="text-violet-600" size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.employeeId} · {agent.email}</p>
                      </div>
                    </div>
                    <ChevronRight className={`text-violet-400 shrink-0 ${selected ? 'rotate-90' : ''}`} size={18} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-100 text-violet-800 border border-violet-200">
                      {agent.voiceStatus}
                    </span>
                    {!agent.voiceTriggerUuid && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-800 border border-red-200">
                        No UUID
                      </span>
                    )}
                    {agent.voiceDialOverrideEnabled && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-200">
                        Safe dial
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-slate-50 rounded-lg py-1">
                      <p className="font-black text-violet-700">{agent.queueCounts.sampled_in_queue}</p>
                      <p className="text-slate-500">Queued</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg py-1">
                      <p className={`font-black ${(agent.queueCounts.due_now ?? agent.queueCounts.sampled_in_queue) === 0 && agent.queueCounts.sampled_in_queue > 0 ? 'text-red-700' : 'text-indigo-700'}`}>
                        {agent.queueCounts.due_now ?? agent.queueCounts.sampled_in_queue}
                      </p>
                      <p className="text-slate-500">Due now</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg py-1">
                      <p className="font-black text-amber-700">{agent.queueCounts.in_progress}</p>
                      <p className="text-slate-500">In progress</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg py-1">
                      <p className="font-black text-emerald-700">{agent.queueCounts.completed_today}</p>
                      <p className="text-slate-500">Done today</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Agent detail */}
        <div className="bg-white rounded-2xl border-2 border-violet-200 shadow-sm min-h-[320px]">
          {!selectedAgentId || !agentDetail ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-slate-500">
              <Mic className="text-violet-300 mb-3" size={40} />
              <p>Select a virtual agent to configure</p>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-violet-900">{agentDetail.agent?.name}</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={savingAgent}
                    onClick={() => handleAgentStatus('running')}
                    className="p-2 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200"
                    title="Start"
                  >
                    <Play size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={savingAgent}
                    onClick={() => handleAgentStatus('paused')}
                    className="p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200"
                    title="Pause"
                  >
                    <Pause size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={savingAgent}
                    onClick={() => handleAgentStatus('stopped')}
                    className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    title="Stop"
                  >
                    <Square size={16} />
                  </button>
                </div>
              </div>

              {agentDetail.runtimeState && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-violet-500" />
                  <span className="font-medium">Runtime:</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${runtimeBadge(agentDetail.runtimeState).className}`}>
                    {runtimeBadge(agentDetail.runtimeState).label}
                  </span>
                  {agentDetail.callsToday != null && (
                    <span className="text-slate-500">· {agentDetail.callsToday} calls today</span>
                  )}
                </div>
              )}

              <label className="block text-sm">
                <span className="font-medium text-slate-700">API Trigger UUID</span>
                <input
                  type="text"
                  value={String(agentForm.voiceTriggerUuid || '')}
                  onChange={(e) => setAgentForm({ ...agentForm, voiceTriggerUuid: e.target.value })}
                  placeholder="Dograh API trigger UUID for this agent"
                  className="mt-1 w-full rounded-lg border border-violet-200 px-3 py-2 text-sm font-mono focus:ring-violet-400 focus:border-violet-400"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Trigger route</span>
                <select
                  value={String(agentForm.triggerRouteType || 'api_trigger')}
                  onChange={(e) => setAgentForm({ ...agentForm, triggerRouteType: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-violet-200 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
                >
                  <option value="api_trigger">API trigger (test / production)</option>
                  <option value="workflow">Workflow UUID path</option>
                </select>
              </label>

              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                <p className="text-sm font-bold text-sky-900">Safe dial override (dev / UAT)</p>
                <p className="text-xs text-sky-800">
                  When enabled, the orchestrator dials your team number instead of the farmer mobile. Farmer context in the call script stays unchanged.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(agentForm.voiceDialOverrideEnabled)}
                    onChange={(e) =>
                      setAgentForm({ ...agentForm, voiceDialOverrideEnabled: e.target.checked })
                    }
                    className="rounded border-sky-300 text-sky-600"
                  />
                  Override dial number (do not call farmers)
                </label>
                {agentForm.voiceDialOverrideEnabled && (
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Team safe number</span>
                    <input
                      type="tel"
                      value={String(agentForm.voiceDialOverrideNumber || '')}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, voiceDialOverrideNumber: e.target.value })
                      }
                      placeholder="10-digit mobile for dev testing"
                      className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:ring-sky-400 focus:border-sky-400"
                    />
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(agentForm.inheritGlobalCallingWindow)}
                  onChange={(e) => setAgentForm({ ...agentForm, inheritGlobalCallingWindow: e.target.checked })}
                  className="rounded border-violet-300 text-violet-600"
                />
                Inherit global calling window
              </label>

              {!agentForm.inheritGlobalCallingWindow && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="font-medium">Start</span>
                    <input
                      type="time"
                      value={String(agentForm.callingStartTime || '')}
                      onChange={(e) => setAgentForm({ ...agentForm, callingStartTime: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium">End</span>
                    <input
                      type="time"
                      value={String(agentForm.callingEndTime || '')}
                      onChange={(e) => setAgentForm({ ...agentForm, callingEndTime: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(agentForm.inheritGlobalLimits)}
                  onChange={(e) => setAgentForm({ ...agentForm, inheritGlobalLimits: e.target.checked })}
                  className="rounded border-violet-300 text-violet-600"
                />
                Inherit global limits
              </label>

              {agentDetail.lastTriggerError && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>Last error: {agentDetail.voiceAgentConfig?.lastTriggerError}</span>
                </div>
              )}

              {(agentDetail.voiceAgentConfig?.lastTriggerAt || agentDetail.voiceAgentConfig?.lastWebhookAt) && (
                <div className="text-xs text-slate-500 space-y-1">
                  {agentDetail.voiceAgentConfig?.lastTriggerAt && (
                    <p>Last trigger: {formatDateTimeIST(agentDetail.voiceAgentConfig.lastTriggerAt)}</p>
                  )}
                  {agentDetail.voiceAgentConfig?.lastWebhookAt && (
                    <p className="flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-emerald-500" />
                      Last webhook: {formatDateTimeIST(agentDetail.voiceAgentConfig.lastWebhookAt)}
                    </p>
                  )}
                </div>
              )}

              <Button onClick={handleSaveAgent} disabled={savingAgent} className="bg-violet-600 hover:bg-violet-500 text-white w-full">
                {savingAgent ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save agent configuration
              </Button>

              <Button
                variant="secondary"
                onClick={() => setShowTestModal(true)}
                disabled={!agentForm.voiceTriggerUuid}
                className="w-full flex items-center justify-center gap-2 border-violet-200 text-violet-800 hover:bg-violet-50"
              >
                <PhoneCall size={16} />
                Test trigger call
              </Button>

              {/* TEMP: pipeline debug panel — remove from Voice Agents once a dedicated diagnostics view exists */}
              <VoiceCallPipelinePanel
                traces={agentDetail.pipelineTraces || []}
                orchestrator={agentDetail.orchestratorDiagnostics}
              />
            </div>
          )}
        </div>
      </div>

      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border-2 border-violet-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-violet-900 flex items-center gap-2">
              <PhoneCall size={18} />
              Test voice trigger
            </h3>
            <p className="text-sm text-slate-600">
              Places a test outbound call via Dograh using this agent&apos;s API Trigger UUID. Use your own mobile number.
            </p>
            <input
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full rounded-lg border border-violet-200 px-3 py-2 text-sm focus:ring-violet-400 focus:border-violet-400"
            />
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowTestModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleTestTrigger}
                disabled={testingTrigger || !testPhone.trim()}
                className="bg-violet-600 hover:bg-violet-500 text-white"
              >
                {testingTrigger ? <Loader2 className="animate-spin" size={16} /> : 'Call now'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceAgentsView;
