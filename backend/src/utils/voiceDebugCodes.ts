import { DerivedVoiceRuntimeState } from '../services/voiceAgentAdminService.js';

export type VoiceDebugCode =
  | 'VA-001'
  | 'VA-002'
  | 'VA-003'
  | 'VA-004'
  | 'VA-005'
  | 'VA-006'
  | 'VA-007'
  | 'VA-008'
  | 'VA-009'
  | 'VA-010'
  | 'VA-011'
  | 'VA-012'
  | 'VA-013';

export interface VoiceDebugInfo {
  code: VoiceDebugCode;
  message: string;
  fix: string;
}

export const VOICE_DEBUG_CATALOG: Record<VoiceDebugCode, Omit<VoiceDebugInfo, 'code'>> = {
  'VA-001': {
    message: 'Agent user account is inactive',
    fix: 'Enable the user in User Management (isActive must be true).',
  },
  'VA-002': {
    message: 'Agent voice status is stopped',
    fix: 'Click Start (▶) on Voice Agents, or set voiceStatus to running.',
  },
  'VA-003': {
    message: 'Agent is paused',
    fix: 'Click Start (▶) or clear pause reason on Voice Agents.',
  },
  'VA-004': {
    message: 'No API Trigger UUID configured',
    fix: 'Set the Dograh API Trigger UUID on the agent in Voice Agents.',
  },
  'VA-005': {
    message: 'Outside configured calling window',
    fix: 'Wait until calling hours, or adjust the agent/platform calling window.',
  },
  'VA-006': {
    message: 'Daily call cap reached',
    fix: 'Wait until tomorrow or raise maxCallsPerDay on the agent/platform.',
  },
  'VA-007': {
    message: 'Agent already has a call in progress',
    fix: 'Stuck calls auto-release after 1 min with no webhook. Wait one poll cycle or lower stuckCallTimeoutMinutes.',
  },
  'VA-008': {
    message: 'Minimum gap between calls not satisfied',
    fix: 'Wait for the cooldown shown in the trace, or lower minGapBetweenCallsSec.',
  },
  'VA-009': {
    message: 'No task available in queue',
    fix: 'Assign sampled tasks to this agent, or check queue filters.',
  },
  'VA-010': {
    message: 'Queued farmer has no mobile number',
    fix: 'Add mobileNumber on the farmer record for this task.',
  },
  'VA-011': {
    message: 'Dograh outbound API call failed',
    fix: 'Check VOICE_API_BASE_URL, VOICE_API_KEY, trigger UUID, and Dograh logs.',
  },
  'VA-012': {
    message: 'Platform orchestrator is disabled',
    fix: 'Turn on orchestrator in Voice Agents platform settings.',
  },
  'VA-013': {
    message: 'Agent isActive flag missing on loaded document',
    fix: 'Internal: ensure orchestrator selects isActive when loading agents.',
  },
};

export function voiceDebugInfo(code: VoiceDebugCode, detail?: string): VoiceDebugInfo {
  const entry = VOICE_DEBUG_CATALOG[code];
  return {
    code,
    message: detail ? `${entry.message} — ${detail}` : entry.message,
    fix: entry.fix,
  };
}

export function formatVoiceDebugLine(info: VoiceDebugInfo): string {
  return `[${info.code}] ${info.message}`;
}

export function explainRuntimeBlock(
  agent: { isActive?: boolean; voiceAgentConfig?: { voiceStatus?: string } | null },
  runtimeState: DerivedVoiceRuntimeState
): VoiceDebugInfo {
  const voiceStatus = agent.voiceAgentConfig?.voiceStatus || 'paused';

  switch (runtimeState) {
    case 'stopped':
      if (agent.isActive === false) {
        return voiceDebugInfo('VA-001');
      }
      if (agent.isActive === undefined) {
        return voiceDebugInfo('VA-013', `voiceStatus=${voiceStatus}`);
      }
      if (voiceStatus === 'stopped') {
        return voiceDebugInfo('VA-002');
      }
      return voiceDebugInfo('VA-002', `voiceStatus=${voiceStatus}`);
    case 'paused':
      return voiceDebugInfo('VA-003');
    case 'not_configured':
      return voiceDebugInfo('VA-004');
    case 'outside_hours':
      return voiceDebugInfo('VA-005');
    case 'daily_cap_reached':
      return voiceDebugInfo('VA-006');
    case 'calling':
      return voiceDebugInfo('VA-007');
    default:
      return voiceDebugInfo('VA-003', `state=${runtimeState}`);
  }
}
