import express, { Request, Response, NextFunction } from 'express';
import { param, validationResult } from 'express-validator';
import logger from '../config/logger.js';
import { authenticate } from '../middleware/auth.js';
import { requireVoiceWebhookKey } from '../middleware/voiceWebhookAuth.js';
import { voiceWebhookRateLimit } from '../middleware/voiceWebhookRateLimit.js';
import { handleVoiceWebhook, getVoiceTaskContext } from '../services/voiceAgentService.js';
import {
  getOrCreateVoicePlatformSettings,
  getVoiceSecretsStatus,
  deriveAgentRuntimeState,
  getAgentQueueCounts,
  resolveEffectiveCallingWindow,
  resolveEffectiveLimits,
  countVirtualAgentsWithDialOverride,
} from '../services/voiceAgentAdminService.js';
import { isAgentDialOverrideActive } from '../utils/voiceDialNumber.js';
import { User } from '../models/User.js';

const router = express.Router();

// @route   POST /api/voice/webhook
// @desc    Receive call outcome from Calling agent (Dograh webhook node)
// @access  Voice webhook API key
router.post(
  '/webhook',
  voiceWebhookRateLimit,
  requireVoiceWebhookKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await handleVoiceWebhook(body);

      res.json({
        success: true,
        duplicate: result.duplicate,
        staleAttempt: result.staleAttempt || false,
        message: result.duplicate ? 'Webhook already processed' : 'Call interaction recorded',
        data: { taskId: result.taskId },
      });
    } catch (error) {
      logger.error('Voice webhook error:', error);
      next(error);
    }
  }
);

// @route   GET /api/voice/tasks/:taskId/context
// @desc    Pre-call context for Dograh Pre-Call Data Fetch (optional)
// @access  Voice webhook API key
router.get(
  '/tasks/:taskId/context',
  requireVoiceWebhookKey,
  [param('taskId').isMongoId()],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }

      const context = await getVoiceTaskContext(req.params.taskId);
      if (!context) {
        return res.status(404).json({ success: false, error: { message: 'Task context not found' } });
      }

      res.json({ success: true, data: { initial_context: context } });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/voice/status
// @desc    Voice integration config status (no secrets)
router.get('/status', async (_req: Request, res: Response) => {
  const platform = await getOrCreateVoicePlatformSettings();
  const secrets = getVoiceSecretsStatus();
  const agentsWithDialOverride = await countVirtualAgentsWithDialOverride();

  res.json({
    success: true,
    data: {
      orchestratorEnabled: platform.orchestratorEnabled || process.env.VOICE_ORCHESTRATOR_ENABLED === 'true',
      pollIntervalSec: platform.pollIntervalSec,
      apiConfigured: secrets.apiBaseUrlConfigured && secrets.apiKeyConfigured,
      webhookConfigured: secrets.webhookKeyConfigured,
      useTestEndpoint: platform.useTestEndpoint,
      defaultTriggerUuid: secrets.envFallbackTriggerUuid ? 'set' : 'unset',
      webhookUrl: secrets.webhookUrl,
      preCallContextUrl: secrets.webhookUrl
        ? `${secrets.webhookUrl.replace(/\/webhook$/, '')}/tasks/{taskId}/context`
        : null,
      agentsWithDialOverride,
      dialOverrideActive: agentsWithDialOverride > 0,
    },
  });
});

// @route   GET /api/voice/agent-status
// @desc    Read-only voice runtime status for logged-in virtual agent
router.get('/agent-status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }

    const agent = await User.findById(userId).select('role agentKind isActive voiceAgentConfig name');
    if (!agent || agent.role !== 'cc_agent' || agent.agentKind !== 'virtual') {
      return res.status(403).json({ success: false, error: { message: 'Not a virtual agent' } });
    }

    const platform = await getOrCreateVoicePlatformSettings();
    const runtimeState = await deriveAgentRuntimeState(agent, platform);
    const queueCounts = await getAgentQueueCounts(userId);
    const effectiveCallingWindow = resolveEffectiveCallingWindow(agent, platform);
    const effectiveLimits = resolveEffectiveLimits(agent, platform);

    res.json({
      success: true,
      data: {
        voiceStatus: agent.voiceAgentConfig?.voiceStatus || 'paused',
        runtimeState,
        queueCounts,
        effectiveCallingWindow,
        effectiveLimits,
        voiceTriggerConfigured: Boolean(agent.voiceAgentConfig?.voiceTriggerUuid?.trim()),
        dialOverrideActive: isAgentDialOverrideActive(agent.voiceAgentConfig),
        lastTriggerAt: agent.voiceAgentConfig?.lastTriggerAt || null,
        lastWebhookAt: agent.voiceAgentConfig?.lastWebhookAt || null,
        lastTriggerError: agent.voiceAgentConfig?.lastTriggerError || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
