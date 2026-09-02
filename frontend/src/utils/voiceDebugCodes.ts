/** Mirrors backend VOICE_DEBUG_CATALOG — keep in sync with backend/src/utils/voiceDebugCodes.ts */
export const VOICE_DEBUG_FIXES: Record<string, string> = {
  'VA-001': 'Enable the user in User Management (isActive must be true).',
  'VA-002': 'Click Start (▶) on Voice Agents, or set voiceStatus to running.',
  'VA-003': 'Click Start (▶) or clear pause reason on Voice Agents.',
  'VA-004': 'Set the Dograh API Trigger UUID on the agent in Voice Agents.',
  'VA-005': 'Wait until calling hours, or adjust the agent/platform calling window.',
  'VA-006': 'Wait until tomorrow or raise maxCallsPerDay on the agent/platform.',
  'VA-007': 'Stuck calls auto-release after 1 min with no webhook. Wait one poll cycle or lower stuckCallTimeoutMinutes.',
  'VA-008': 'Wait for the cooldown shown in the trace, or lower minGapBetweenCallsSec.',
  'VA-009': 'Assign sampled tasks to this agent, or check queue filters.',
  'VA-010': 'Add mobileNumber on the farmer record for this task.',
  'VA-011': 'Check VOICE_API_BASE_URL, VOICE_API_KEY, trigger UUID, and Dograh logs.',
  'VA-012': 'Turn on orchestrator in Voice Agents platform settings.',
  'VA-013': 'Internal bug: isActive was not loaded — report to dev team.',
};
