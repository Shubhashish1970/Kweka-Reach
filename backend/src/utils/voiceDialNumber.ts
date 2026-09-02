import logger from '../config/logger.js';
import { toIndianE164 } from '../services/voiceApiClient.js';
import type { IVoiceAgentConfig } from '../models/User.js';

export type VoiceDialResolution = {
  dialNumber: string;
  overridden: boolean;
  originalNumber?: string;
};

export type AgentDialOverride = Pick<IVoiceAgentConfig, 'voiceDialOverrideEnabled' | 'voiceDialOverrideNumber'>;

/**
 * Resolve the phone number to pass to the Voice platform.
 * Per-agent override (Voice Agents admin) replaces farmer mobile when enabled.
 */
export function resolveVoiceDialNumber(
  farmerMobile: string,
  context?: {
    taskId?: string;
    source?: string;
    agentDialOverride?: AgentDialOverride;
  }
): VoiceDialResolution {
  const enabled = context?.agentDialOverride?.voiceDialOverrideEnabled === true;
  const overrideRaw = context?.agentDialOverride?.voiceDialOverrideNumber?.trim();

  if (enabled && overrideRaw) {
    const dialNumber = toIndianE164(overrideRaw);
    logger.warn(
      `Voice dial override active (${context?.source || 'orchestrator'}): ` +
        `task=${context?.taskId || 'n/a'} farmer=${farmerMobile} → dialing ${dialNumber}`
    );
    return {
      dialNumber,
      overridden: true,
      originalNumber: farmerMobile,
    };
  }

  if (enabled && !overrideRaw) {
    logger.warn(
      `Voice dial override enabled but no number set (${context?.source || 'orchestrator'}) — using farmer mobile`
    );
  }

  return { dialNumber: toIndianE164(farmerMobile), overridden: false };
}

export function isAgentDialOverrideActive(config?: AgentDialOverride | null): boolean {
  return (
    config?.voiceDialOverrideEnabled === true &&
    Boolean(config.voiceDialOverrideNumber?.trim())
  );
}
