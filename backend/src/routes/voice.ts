import express, { Request, Response, NextFunction } from 'express';
import logger from '../config/logger.js';
import { requireVoiceWebhookKey } from '../middleware/voiceWebhookAuth.js';
import { handleVoiceWebhook } from '../services/voiceAgentService.js';

const router = express.Router();

// @route   POST /api/voice/webhook
// @desc    Receive call outcome from Calling agent (Dograh webhook node)
// @access  Voice webhook API key
router.post('/webhook', requireVoiceWebhookKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const result = await handleVoiceWebhook(body);

    res.json({
      success: true,
      duplicate: result.duplicate,
      message: result.duplicate ? 'Webhook already processed' : 'Call interaction recorded',
      data: { taskId: result.taskId },
    });
  } catch (error) {
    logger.error('Voice webhook error:', error);
    next(error);
  }
});

// @route   GET /api/voice/status
// @desc    Voice integration config status (no secrets)
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      orchestratorEnabled: process.env.VOICE_ORCHESTRATOR_ENABLED === 'true',
      apiConfigured: Boolean(process.env.VOICE_API_BASE_URL && process.env.VOICE_API_KEY),
      webhookConfigured: Boolean(process.env.VOICE_WEBHOOK_API_KEY),
      useTestEndpoint: process.env.VOICE_USE_TEST_ENDPOINT !== 'false',
      defaultTriggerUuid: process.env.VOICE_TRIGGER_UUID ? 'set' : 'unset',
    },
  });
});

export default router;
