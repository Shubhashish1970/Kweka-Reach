import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  listVoiceAgents,
  getVoiceAgentDetail,
  updateVoiceAgentStatusForTeamLead,
  testVoiceAgentTrigger,
  getVirtualAgentForTeamLead,
} from '../services/voiceAgentAdminService.js';

const router = express.Router();

router.use(authenticate);
router.use(requireRole('team_lead'));

router.get('/agents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamLeadId = req.user?._id?.toString();
    if (!teamLeadId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }
    const agents = await listVoiceAgents({ teamLeadId });
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
      const teamLeadId = req.user?._id?.toString();
      if (!teamLeadId) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
      const owned = await getVirtualAgentForTeamLead(req.params.agentId, teamLeadId);
      if (!owned) {
        return res.status(404).json({ success: false, error: { message: 'Virtual agent not found' } });
      }
      const detail = await getVoiceAgentDetail(req.params.agentId);
      res.json({ success: true, data: detail });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/agents/:agentId/status',
  [
    param('agentId').isMongoId(),
    body('voiceStatus').isIn(['running', 'paused', 'stopped']),
    body('pauseReason').optional({ nullable: true }).isString(),
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
      const teamLeadId = req.user?._id?.toString();
      if (!teamLeadId) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
      const data = await updateVoiceAgentStatusForTeamLead(
        req.params.agentId,
        teamLeadId,
        {
          voiceStatus: req.body.voiceStatus,
          pauseReason: req.body.pauseReason,
        },
        { userId: teamLeadId, userEmail: req.user?.email }
      );
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
      const teamLeadId = req.user?._id?.toString();
      if (!teamLeadId) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
      const owned = await getVirtualAgentForTeamLead(req.params.agentId, teamLeadId);
      if (!owned) {
        return res.status(404).json({ success: false, error: { message: 'Virtual agent not found' } });
      }
      const data = await testVoiceAgentTrigger(req.params.agentId, req.body.phoneNumber, {
        userId: teamLeadId,
        userEmail: req.user?.email,
      });
      res.json({ success: true, data, message: 'Test call triggered' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
