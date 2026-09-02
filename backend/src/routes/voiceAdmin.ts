import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import {
  getVoicePlatformSettingsResponse,
  updateVoicePlatformSettings,
  listVoiceAgents,
  getVoiceAgentDetail,
  updateVoiceAgentConfig,
  testVoiceAgentTrigger,
  getVoiceMetricsSummary,
} from '../services/voiceAgentAdminService.js';

const router = express.Router();

router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getVoicePlatformSettingsResponse();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/metrics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const metrics = await getVoiceMetricsSummary();
    res.json({ success: true, data: metrics });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/settings',
  [
    body('orchestratorEnabled').optional().isBoolean(),
    body('pollIntervalSec').optional().isInt({ min: 15, max: 600 }),
    body('defaultTimezone').optional().isString(),
    body('defaultCallingDaysOfWeek').optional().isArray(),
    body('defaultCallingStartTime').optional().matches(/^\d{2}:\d{2}$/),
    body('defaultCallingEndTime').optional().matches(/^\d{2}:\d{2}$/),
    body('defaultMinGapBetweenCallsSec').optional().isInt({ min: 0, max: 3600 }),
    body('defaultMaxCallsPerDay').optional().isInt({ min: 0, max: 5000 }),
    body('defaultMaxConcurrentCalls').optional().isInt({ min: 1, max: 5 }),
    body('stuckCallTimeoutMinutes').optional().isInt({ min: 1, max: 120 }),
    body('autoPauseAfterConsecutiveFailures').optional().isInt({ min: 1, max: 50 }),
    body('useTestEndpoint').optional().isBoolean(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }
      const data = await updateVoicePlatformSettings(
        req.body,
        req.user?._id?.toString(),
        req.user?.email
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/agents', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = await listVoiceAgents();
    res.json({ success: true, data: { agents } });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/agents/:agentId',
  [param('agentId').isMongoId()],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }
      const detail = await getVoiceAgentDetail(req.params.agentId);
      if (!detail) {
        return res.status(404).json({ success: false, error: { message: 'Virtual agent not found' } });
      }
      res.json({ success: true, data: detail });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/agents/:agentId',
  [
    param('agentId').isMongoId(),
    body('voiceTriggerUuid').optional({ nullable: true }).isString(),
    body('triggerRouteType').optional().isIn(['api_trigger', 'workflow']),
    body('telephonyConfigurationId').optional({ nullable: true }).isInt(),
    body('contextAgentName').optional({ nullable: true }).isString(),
    body('voiceStatus').optional().isIn(['running', 'paused', 'stopped']),
    body('inheritGlobalCallingWindow').optional().isBoolean(),
    body('callingTimezone').optional({ nullable: true }).isString(),
    body('callingDaysOfWeek').optional().isArray(),
    body('callingStartTime').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
    body('callingEndTime').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
    body('inheritGlobalLimits').optional().isBoolean(),
    body('maxConcurrentCalls').optional({ nullable: true }).isInt({ min: 1, max: 5 }),
    body('minGapBetweenCallsSec').optional({ nullable: true }).isInt({ min: 0, max: 3600 }),
    body('maxCallsPerDay').optional({ nullable: true }).isInt({ min: 0, max: 5000 }),
    body('pauseReason').optional({ nullable: true }).isString(),
    body('voiceDialOverrideEnabled').optional().isBoolean(),
    body('voiceDialOverrideNumber').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }
      const data = await updateVoiceAgentConfig(req.params.agentId, req.body, {
        userId: req.user?._id?.toString(),
        userEmail: req.user?.email,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/agents/:agentId/test-trigger',
  [
    param('agentId').isMongoId(),
    body('phoneNumber').trim().notEmpty().withMessage('phoneNumber is required'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', errors: errors.array() },
        });
      }
      const data = await testVoiceAgentTrigger(req.params.agentId, req.body.phoneNumber, {
        userId: req.user?._id?.toString(),
        userEmail: req.user?.email,
      });
      res.json({ success: true, data, message: 'Test call triggered' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
