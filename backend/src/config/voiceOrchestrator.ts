import logger from '../config/logger.js';
import { processVirtualAgentQueueOnce } from '../services/voiceAgentService.js';
import {
  countLiveVirtualAgents,
  getOrCreateVoicePlatformSettings,
} from '../services/voiceAgentAdminService.js';

let tickInProgress = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt: Date | null = null;
let lastTickError: string | null = null;
let scheduledIntervalSec: number | null = null;
let idleReason: 'disabled' | 'no_live_agents' | null = null;

async function runTick(source: 'interval' | 'manual' | 'startup' = 'interval'): Promise<void> {
  if (tickInProgress) {
    logger.debug(`Voice orchestrator tick skipped (${source}): previous tick in progress`);
    return;
  }
  tickInProgress = true;
  try {
    await processVirtualAgentQueueOnce();
    lastTickAt = new Date();
    lastTickError = null;
  } catch (error) {
    lastTickError = error instanceof Error ? error.message : String(error);
    logger.error(`Voice orchestrator tick failed (${source}):`, error);
  } finally {
    tickInProgress = false;
  }
}

export function getVoiceOrchestratorDiagnostics() {
  return {
    scheduled: intervalHandle != null,
    scheduledIntervalSec,
    lastTickAt: lastTickAt?.toISOString() || null,
    lastTickError,
    tickInProgress,
    idleReason,
  };
}

/**
 * Poll virtual agent queues and trigger Calling agent outbound API.
 * Uses setInterval (not node-cron) for sub-minute polling — more reliable on Cloud Run.
 * Also expose POST /api/voice/orchestrator-tick for Cloud Scheduler (see FFA pattern).
 */
export const setupVoiceOrchestrator = async (): Promise<void> => {
  const platform = await getOrCreateVoicePlatformSettings();
  const envEnabled = process.env.VOICE_ORCHESTRATOR_ENABLED === 'true';

  if (!platform.orchestratorEnabled && !envEnabled) {
    logger.info('Voice orchestrator disabled (enable in Voice Agents admin or VOICE_ORCHESTRATOR_ENABLED=true)');
    stopVoiceOrchestrator();
    idleReason = 'disabled';
    return;
  }

  const liveAgents = await countLiveVirtualAgents();
  if (liveAgents === 0) {
    logger.info('Voice orchestrator idle — no running virtual agents; polling stopped');
    stopVoiceOrchestrator();
    idleReason = 'no_live_agents';
    return;
  }

  const intervalSec = Math.max(
    15,
    platform.pollIntervalSec || Number(process.env.VOICE_ORCHESTRATOR_INTERVAL_SEC || 30)
  );

  stopVoiceOrchestrator();
  idleReason = null;
  intervalHandle = setInterval(() => {
    void runTick('interval');
  }, intervalSec * 1000);
  scheduledIntervalSec = intervalSec;

  logger.info(`Voice orchestrator scheduled via setInterval (every ${intervalSec}s, ${liveAgents} live agent(s))`);

  // Run once immediately so admin does not wait for the first interval after deploy / settings save.
  void runTick('startup');
};

export const stopVoiceOrchestrator = (): void => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  scheduledIntervalSec = null;
};

/** Re-read platform settings and reschedule (e.g. after admin toggles orchestrator in UI). */
export async function restartVoiceOrchestrator(): Promise<void> {
  stopVoiceOrchestrator();
  await setupVoiceOrchestrator();
}

/** Manual / HTTP / Cloud Scheduler trigger. */
export async function runVoiceOrchestratorTick(): Promise<void> {
  await runTick('manual');
}
