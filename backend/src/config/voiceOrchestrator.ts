import cron from 'node-cron';
import logger from '../config/logger.js';
import { processVirtualAgentQueueOnce } from '../services/voiceAgentService.js';

let tickInProgress = false;

/**
 * Poll virtual agent queues and trigger Calling agent outbound API.
 * Enable with VOICE_ORCHESTRATOR_ENABLED=true
 */
export const setupVoiceOrchestrator = (): void => {
  if (process.env.VOICE_ORCHESTRATOR_ENABLED !== 'true') {
    logger.info('Voice orchestrator disabled (set VOICE_ORCHESTRATOR_ENABLED=true to enable)');
    return;
  }

  const intervalSec = Math.max(15, Number(process.env.VOICE_ORCHESTRATOR_INTERVAL_SEC || 30));
  const cronExpr = intervalSec >= 60 ? `*/${Math.floor(intervalSec / 60)} * * * *` : `*/${intervalSec} * * * * *`;

  cron.schedule(
    cronExpr,
    async () => {
      if (tickInProgress) return;
      tickInProgress = true;
      try {
        await processVirtualAgentQueueOnce();
      } catch (error) {
        logger.error('Voice orchestrator tick failed:', error);
      } finally {
        tickInProgress = false;
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info(`Voice orchestrator scheduled (every ${intervalSec}s)`);
};
