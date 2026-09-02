import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult, query } from 'express-validator';
import { User, UserRole, AgentKind } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';
import { assertActiveMasterLanguages } from '../utils/masterLanguageValidation.js';
import {
  resolveDefaultResetPassword,
  resolveVirtualAgentDefaultPassword,
} from '../config/userPasswordDefaults.js';
import { ensureVirtualAgentVoiceConfig, DEFAULT_VOICE_AGENT_CONFIG } from '../services/voiceAgentAdminService.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// @route   GET /api/users
// @desc    Get all users (with filters)
// @access  Private (MIS Admin only)
router.get(
  '/',
  requirePermission('users.view'),
  [
    query('role').optional().isIn(['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head']),
    query('isActive').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
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

      const { role, isActive, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const filter: any = {};
      if (role) filter.role = role;
      if (isActive !== undefined) filter.isActive = isActive === 'true';

      const users = await User.find(filter)
        .select('-password')
        .populate('teamLeadId', 'name email employeeId')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 });

      const total = await User.countDocuments(filter);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (MIS Admin or own profile)
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id;
      const currentUser = req.user!;

      // Users can view their own profile, or MIS Admin can view any
      if (userId !== currentUser._id.toString() && currentUser.role !== 'mis_admin') {
        const error: AppError = new Error('Insufficient permissions');
        error.statusCode = 403;
        throw error;
      }

      const user = await User.findById(userId).select('-password').populate('teamLeadId', 'name email employeeId');

      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   GET /api/users/team/agents
// @desc    Get active CC agents for the current Team Lead
// @access  Private (Team Lead, MIS Admin)
router.get(
  '/team/agents',
  requirePermission('tasks.view.team'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = req.user!;

      // For team_lead: only own agents. For mis_admin: allow optional teamLeadId filter (future-proof).
      const teamLeadIdParam = req.query.teamLeadId as string | undefined;
      const teamLeadId =
        currentUser.role === 'mis_admin' && teamLeadIdParam ? teamLeadIdParam : currentUser._id.toString();

      const agents = await User.find({
        role: 'cc_agent',
        isActive: true,
        teamLeadId: teamLeadId,
      })
        .select('name email employeeId languageCapabilities isActive')
        .sort({ name: 1 })
        .lean();

      res.json({
        success: true,
        data: { agents },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/users
// @desc    Create new user
// @access  Private (MIS Admin only)
router.post(
  '/',
  requirePermission('users.create'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password')
      .optional({ values: 'falsy' })
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('role').isIn(['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head']).withMessage('Invalid role'),
    body('roles').optional().isArray().withMessage('Roles must be an array'),
    body('roles.*').optional().isIn(['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head']).withMessage('Invalid role in roles array'),
    body('employeeId').trim().notEmpty().withMessage('Employee ID is required'),
    body('languageCapabilities').optional().isArray(),
    body('assignedTerritories').optional().isArray(),
    body('teamLeadId').optional().isMongoId().withMessage('Invalid team lead ID'),
    body('agentKind').optional().isIn(['human', 'virtual']).withMessage('Invalid agent kind'),
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

      const { name, email, password, role, roles, employeeId, languageCapabilities = [], assignedTerritories = [], teamLeadId, agentKind } = req.body;

      const normalizedLanguageCapabilities = await assertActiveMasterLanguages(
        languageCapabilities,
        'Language capability'
      );

      const resolvedAgentKind: AgentKind =
        role === 'cc_agent' && agentKind === 'virtual' ? 'virtual' : 'human';

      let plainPassword = typeof password === 'string' ? password.trim() : '';
      if (!plainPassword) {
        if (resolvedAgentKind === 'virtual') {
          const defaultPwd = resolveVirtualAgentDefaultPassword();
          if (!defaultPwd) {
            return res.status(503).json({
              success: false,
              error: {
                message:
                  'Virtual agent default password is not configured. Set USER_VIRTUAL_AGENT_DEFAULT_PASSWORD (at least 8 characters) on the server.',
              },
            });
          }
          plainPassword = defaultPwd;
        } else {
          return res.status(400).json({
            success: false,
            error: { message: 'Password is required' },
          });
        }
      }

      // Check if email already exists
      const existingUser = await User.findOne({ $or: [{ email }, { employeeId }] });
      if (existingUser) {
        const error: AppError = new Error('User with this email or employee ID already exists');
        error.statusCode = 400;
        throw error;
      }

      // Validate teamLeadId if provided (only for cc_agent role)
      if (teamLeadId && role === 'cc_agent') {
        const teamLead = await User.findById(teamLeadId);
        if (!teamLead || teamLead.role !== 'team_lead') {
          const error: AppError = new Error('Invalid team lead');
          error.statusCode = 400;
          throw error;
        }
      }

      // Hash password
      const hashedPassword = await hashPassword(plainPassword);

      // Ensure roles array contains at least the primary role
      let userRoles = roles && roles.length > 0 ? roles : [role];
      if (!userRoles.includes(role)) {
        userRoles = [role, ...userRoles];
      }

      // Create user
      const user = await User.create({
        name,
        email,
        password: hashedPassword,
        role,
        roles: userRoles,
        employeeId,
        languageCapabilities: normalizedLanguageCapabilities,
        assignedTerritories,
        teamLeadId: teamLeadId || undefined,
        agentKind: resolvedAgentKind,
        ...(resolvedAgentKind === 'virtual' ? { voiceAgentConfig: DEFAULT_VOICE_AGENT_CONFIG() } : {}),
      });

      if (resolvedAgentKind === 'virtual') {
        await ensureVirtualAgentVoiceConfig(user._id.toString());
      }

      logger.info(`User created: ${user.email} (${user.role}) by ${req.user?.email}`);

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            roles: user.roles,
            employeeId: user.employeeId,
            languageCapabilities: user.languageCapabilities,
            assignedTerritories: user.assignedTerritories,
            teamLeadId: user.teamLeadId,
            agentKind: user.agentKind || 'human',
            isActive: user.isActive,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (MIS Admin only)
router.put(
  '/:id',
  requirePermission('users.edit'),
  [
    body('name').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('role').optional().isIn(['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head']),
    body('roles').optional().isArray().withMessage('Roles must be an array'),
    body('roles.*').optional().isIn(['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head']).withMessage('Invalid role'),
    body('languageCapabilities').optional().isArray(),
    body('assignedTerritories').optional().isArray(),
    body('teamLeadId').optional().isMongoId(),
    body('isActive').optional().isBoolean(),
    body('agentKind').optional().isIn(['human', 'virtual']).withMessage('Invalid agent kind'),
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

      const userId = req.params.id;
      const updateData: any = {};

      if (req.body.name) updateData.name = req.body.name;
      if (req.body.email) updateData.email = req.body.email;
      if (req.body.role) updateData.role = req.body.role;
      if (req.body.roles) {
        // Ensure the primary role is always in the roles array
        let userRoles = req.body.roles;
        const primaryRole = req.body.role || (await User.findById(userId))?.role;
        if (primaryRole && !userRoles.includes(primaryRole)) {
          userRoles = [primaryRole, ...userRoles];
        }
        updateData.roles = userRoles;
      }
      if (req.body.languageCapabilities !== undefined) {
        updateData.languageCapabilities = await assertActiveMasterLanguages(
          req.body.languageCapabilities,
          'Language capability'
        );
      }
      if (req.body.assignedTerritories) updateData.assignedTerritories = req.body.assignedTerritories;
      if (req.body.teamLeadId !== undefined) {
        if (req.body.teamLeadId) {
          const teamLead = await User.findById(req.body.teamLeadId);
          if (!teamLead || teamLead.role !== 'team_lead') {
            const error: AppError = new Error('Invalid team lead');
            error.statusCode = 400;
            throw error;
          }
          updateData.teamLeadId = req.body.teamLeadId;
        } else {
          updateData.teamLeadId = null;
        }
      }
      if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

      if (req.body.agentKind !== undefined) {
        const targetRole = req.body.role || (await User.findById(userId))?.role;
        updateData.agentKind =
          targetRole === 'cc_agent' && req.body.agentKind === 'virtual' ? 'virtual' : 'human';
      }

      const user = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      logger.info(`User updated: ${user.email} by ${req.user?.email}`);

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   DELETE /api/users/:id
// @desc    Deactivate user (soft delete)
// @access  Private (MIS Admin only)
router.delete(
  '/:id',
  requirePermission('users.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id;

      // Prevent deactivating own account
      if (userId === req.user?._id.toString()) {
        const error: AppError = new Error('Cannot deactivate your own account');
        error.statusCode = 400;
        throw error;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { isActive: false },
        { new: true }
      ).select('-password');

      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      logger.info(`User deactivated: ${user.email} by ${req.user?.email}`);

      res.json({
        success: true,
        message: 'User deactivated successfully',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/users/:id/reset-default-password
// @desc    Set password to configured default and require user to change password on next login
// @access  Private (MIS Admin only)
router.post(
  '/:id/reset-default-password',
  requirePermission('users.edit'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id;

      if (userId === req.user?._id.toString()) {
        const error: AppError = new Error('Cannot reset your own password with this action');
        error.statusCode = 400;
        throw error;
      }

      const user = await User.findById(userId).select('agentKind role');
      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      const isVirtualAgent = user.role === 'cc_agent' && user.agentKind === 'virtual';
      const defaultPlain = isVirtualAgent
        ? resolveVirtualAgentDefaultPassword()
        : resolveDefaultResetPassword();
      if (!defaultPlain) {
        return res.status(503).json({
          success: false,
          error: {
            message: isVirtualAgent
              ? 'Virtual agent default password is not configured. Set USER_VIRTUAL_AGENT_DEFAULT_PASSWORD (at least 8 characters) on the server.'
              : 'Default reset password is not configured. Set USER_DEFAULT_RESET_PASSWORD (at least 8 characters) on the server.',
          },
        });
      }

      const hashedPassword = await hashPassword(defaultPlain);

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          password: hashedPassword,
          mustChangePassword: isVirtualAgent ? false : true,
        },
        { new: true }
      ).select('-password');

      if (!updatedUser) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      logger.info(
        `Default password reset for user: ${updatedUser.email} by ${req.user?.email} (virtual=${isVirtualAgent})`
      );

      res.json({
        success: true,
        message: isVirtualAgent
          ? 'Virtual agent default password applied. The agent can sign in with the configured virtual agent default password.'
          : 'Temporary password applied. The user must sign in with the configured default password and choose a new password.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   PUT /api/users/:id/password
// @desc    Reset user password
// @access  Private (MIS Admin only)
router.put(
  '/:id/password',
  requirePermission('users.edit'),
  [
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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

      const userId = req.params.id;
      const { newPassword } = req.body;

      const hashedPassword = await hashPassword(newPassword);

      const user = await User.findByIdAndUpdate(
        userId,
        { password: hashedPassword, mustChangePassword: false },
        { new: true }
      ).select('-password');

      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      logger.info(`Password reset for user: ${user.email} by ${req.user?.email}`);

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;


