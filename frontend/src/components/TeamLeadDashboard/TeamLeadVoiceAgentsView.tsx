import React, { useCallback, useEffect, useState } from 'react';
import { Mic, Loader2, RefreshCw, Play, Pause, Square, PhoneCall } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { teamVoiceAPI } from '../../services/api';
import Button from '../shared/Button';
import InfoBanner from '../shared/InfoBanner';

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
  employeeId: string;
  voiceStatus: 'running' | 'paused' | 'stopped';
  runtimeState: RuntimeState;
  queueCounts: { sampled_in_queue: number; in_progress: number; completed_today: number };
  voiceTriggerUuid: string | null;
}

function runtimeLabel(state: RuntimeState): string {
  return state.replace(/_/g, ' ');
}

const TeamLeadVoiceAgentsView: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<VoiceAgentRow[]>([]);
  const [testAgentId, setTestAgentId] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teamVoiceAPI.listAgents();
      setAgents(data.agents || []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load voice agents');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleStatus = async (agentId: string, status: 'running' | 'paused' | 'stopped') => {
    setSaving(true);
    try {
      await teamVoiceAPI.updateStatus(
        agentId,
        status,
        status === 'paused' ? 'Paused by team lead' : undefined
      );
      showSuccess(status === 'running' ? 'Agent started' : status === 'paused' ? 'Agent paused' : 'Agent stopped');
      await loadAgents();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const handleTestTrigger = async () => {
    if (!testAgentId || !testPhone.trim()) return;
    setSaving(true);
    try {
      const result = await teamVoiceAPI.testTrigger(testAgentId, testPhone.trim());
      showSuccess(`Test call triggered (run ${result.workflowRunId})`);
      setTestAgentId(null);
      setTestPhone('');
      await loadAgents();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Test trigger failed');
    } finally {
      setSaving(false);
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
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Mic className="text-violet-600" size={24} />
            Voice Agents
          </h2>
          <p className="text-sm text-slate-500 mt-1">Start, pause, or test your team&apos;s virtual agents</p>
        </div>
        <Button variant="secondary" onClick={loadAgents} className="flex items-center gap-2">
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      <InfoBanner variant="info">
        You can start/stop your virtual agents here. Trigger UUID and global settings are managed by MIS Admin.
      </InfoBanner>

      {agents.length === 0 ? (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-8 text-center text-slate-600">
          No virtual agents assigned to your team.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <div key={agent.agentId} className="bg-white rounded-xl border-2 border-violet-200 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-100 border border-violet-300 flex items-center justify-center">
                  <Mic className="text-violet-600" size={20} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{agent.name}</p>
                  <p className="text-xs text-slate-500">{agent.employeeId}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200 font-bold uppercase">
                  {agent.voiceStatus}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 capitalize">
                  {runtimeLabel(agent.runtimeState)}
                </span>
                {!agent.voiceTriggerUuid && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200">
                    Needs UUID (admin)
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-50 rounded-lg py-1">
                  <p className="font-black text-violet-700">{agent.queueCounts.sampled_in_queue}</p>
                  <p className="text-slate-500">Queued</p>
                </div>
                <div className="bg-slate-50 rounded-lg py-1">
                  <p className="font-black text-amber-700">{agent.queueCounts.in_progress}</p>
                  <p className="text-slate-500">Active</p>
                </div>
                <div className="bg-slate-50 rounded-lg py-1">
                  <p className="font-black text-emerald-700">{agent.queueCounts.completed_today}</p>
                  <p className="text-slate-500">Today</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleStatus(agent.agentId, 'running')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 text-sm font-medium"
                >
                  <Play size={14} /> Start
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleStatus(agent.agentId, 'paused')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 text-sm font-medium"
                >
                  <Pause size={14} /> Pause
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleStatus(agent.agentId, 'stopped')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-sm font-medium"
                >
                  <Square size={14} /> Stop
                </button>
                <button
                  type="button"
                  disabled={saving || !agent.voiceTriggerUuid}
                  onClick={() => setTestAgentId(agent.agentId)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-100 text-violet-800 border border-violet-200 text-sm font-medium ml-auto"
                >
                  <PhoneCall size={14} /> Test
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testAgentId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border-2 border-violet-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-violet-900">Test voice call</h3>
            <input
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full rounded-lg border border-violet-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => { setTestAgentId(null); setTestPhone(''); }}>
                Cancel
              </Button>
              <Button
                onClick={handleTestTrigger}
                disabled={saving || !testPhone.trim()}
                className="bg-violet-600 hover:bg-violet-500 text-white"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : 'Call now'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamLeadVoiceAgentsView;
