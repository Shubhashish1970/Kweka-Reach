import cron from 'node-cron';
import logger from '../config/logger.js';
import { runScheduledFfaSyncIfDue } from '../services/ffaSyncConfigService.js';

/**
 * Setup cron jobs for scheduled tasks.
 * FFA sync schedule is read from MongoDB (Admin → Data Management) each minute.
 */
export const setupCronJobs = (): void => {
  cron.schedule(
    '* * * * *',
    async () => {
      await runScheduledFfaSyncIfDue();
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    }
  );

  logger.info('Cron jobs scheduled: FFA incremental sync (configurable via Admin → Data Management)');
};
