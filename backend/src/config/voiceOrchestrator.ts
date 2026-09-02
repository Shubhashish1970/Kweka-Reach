import cron from 'node-cron';
import logger from '../config/logger.js';
import { processVirtualAgentQueueOnce } from '../services/voiceAgentService.js';
import { getOrCreateVoicePlatformSettings } from '../services/voiceAgentAdminService.js';

let tickInProgress = false;
let scheduledTask: cron.ScheduledTask | null = null;

function buildCronExpr(intervalSec: number): string {
  const sec = Math.max(15, intervalSec);
  if (sec >= 60) {
    const mins = Math.max(1, Math.floor(sec / 60));
    return `*/${mins} * * * *`;
  }
  return `*/${sec} * * * * *`;
}

async function runTick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    await processVirtualAgentQueueOnce();
  } catch (error) {
    logger.error('Voice orchestrator tick failed:', error);
  } finally {
    tickInProgress = false;
  }
}

/**
 * Poll virtual agent queues and trigger Calling agent outbound API.
 * Reads poll interval from VoicePlatformSettings (DB) with env fallback.
 * Scheduling policy: Reach owns all callbacks — do not use Dograh Campaigns for Reach tasks.
 */
export const setupVoiceOrchestrator = async (): Promise<void> => {
  const platform = await getOrCreateVoicePlatformSettings();
  const envEnabled = process.env.VOICE_ORCHESTRATOR_ENABLED === 'true';

  if (!platform.orchestratorEnabled && !envEnabled) {
    logger.info('Voice orchestrator disabled (enable in Voice Agents admin or VOICE_ORCHESTRATOR_ENABLED=true)');
    return;
  }

  const intervalSec = Math.max(
    15,
    platform.pollIntervalSec || Number(process.env.VOICE_ORCHESTRATOR_INTERVAL_SEC || 30)
  );
  const cronExpr = buildCronExpr(intervalSec);

  scheduledTask = cron.schedule(cronExpr, runTick, { scheduled: true, timezone: 'Asia/Kolkata' });

  logger.info(`Voice orchestrator scheduled (every ${intervalSec}s, DB settings)`);
};

export const stopVoiceOrchestrator = (): void => {
  scheduledTask?.stop();
  scheduledTask = null;
};
