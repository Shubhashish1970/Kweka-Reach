import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

const router = express.Router();

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            errors: errors.array(),
          },
        });
      }

      let { email, password } = req.body;

      // Normalize email (lowercase and trim)
      email = email.toLowerCase().trim();

      // Check database connection before querying
      const mongoose = await import('mongoose');
      const dbState = mongoose.default.connection.readyState;
      if (dbState !== 1) {
        logger.error(`Database not connected. ReadyState: ${dbState} (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)`);
        const error: AppError = new Error('Database connection error. Please try again later.');
        error.statusCode = 503;
        throw error;
      }

      logger.info(`Login attempt for email: ${email}`);

      // Find user by email (include password field) - email is already lowercase in DB
      const user = await User.findOne({ email }).select('+password');

      if (!user) {
        logger.warn(`Login failed: User not found for email: ${email}`);
        // Check if any users exist at all (for debugging)
        const userCount = await User.countDocuments();
        logger.info(`Total users in database: ${userCount}`);
        const error: AppError = new Error('Invalid credentials');
        error.statusCode = 401;
        throw error;
      }

      logger.info(`User found: ${user.email} (ID: ${user._id}, Role: ${user.role}, Active: ${user.isActive})`);

      if (!user.isActive) {
        const error: AppError = new Error('Account is inactive');
        error.statusCode = 401;
        throw error;
      }

      // Check password
      if (!user.password) {
        logger.error(`User ${user.email} exists but password field is missing or null`);
        const error: AppError = new Error('Invalid credentials');
        error.statusCode = 401;
        throw error;
      }

      logger.info(`Password field exists: ${!!user.password}, Length: ${user.password.length}, Starts with: ${user.password.substring(0, 10)}`);
      
      const isPasswordValid = await comparePassword(password, user.password);

      if (!isPasswordValid) {
        logger.warn(`Password mismatch for user: ${user.email}. Password provided: [REDACTED], Hash length: ${user.password.length}`);
        // Check if password hash format is correct
        if (!user.password.startsWith('$2')) {
          logger.error(`Password hash for user ${user.email} is not in bcrypt format!`);
        }
        const error: AppError = new Error('Invalid credentials');
        error.statusCode = 401;
        throw error;
      }

      logger.info(`Password verified successfully for user: ${user.email}`);

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate token
      const token = generateToken(user);

      logger.info(`User logged in: ${user.email} (${user.role})`);

      // Ensure roles array exists (for backward compatibility with existing users)
      const userRoles = user.roles && user.roles.length > 0 ? user.roles : [user.role];

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role, // Primary/default role
            roles: userRoles, // All available roles
            employeeId: user.employeeId,
            languageCapabilities: user.languageCapabilities,
            assignedTerritories: user.assignedTerritories,
            mustChangePassword: !!user.mustChangePassword,
          },
        },
      });
    } catch (error) {
      // Enhanced error logging for debugging
      if (error instanceof Error) {
        if (error.name === 'MongoNetworkError' || error.message.includes('MongoServerError')) {
          logger.error(`Database connection error during login: ${error.message}`, { stack: error.stack });
          const dbError: AppError = new Error('Database connection error. Please try again later.');
          dbError.statusCode = 503;
          return next(dbError);
        }
        logger.error(`Login error for ${req.body.email}: ${error.message}`, { stack: error.stack });
      }
      next(error);
    }
  }
);

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', authenticate, (req: Request, res: Response) => {
  logger.info(`User logged out: ${req.user?.email}`);
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      const error: AppError = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Ensure roles array exists (for backward compatibility with existing users)
    const userRoles = user.roles && user.roles.length > 0 ? user.roles : [user.role];

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role, // Primary/default role
          roles: userRoles, // All available roles
          employeeId: user.employeeId,
          languageCapabilities: user.languageCapabilities,
          assignedTerritories: user.assignedTerritories,
          teamLeadId: user.teamLeadId,
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          mustChangePassword: !!user.mustChangePassword,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/change-password
// @desc    After admin "default password" reset: verify current password and set a new one (clears mustChangePassword)
// @access  Private
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
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

      const authReq = req as AuthRequest;
      const user = await User.findById(authReq.user._id).select('+password');
      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      if (!user.mustChangePassword) {
        return res.status(400).json({
          success: false,
          error: { message: 'Password change is not required for your account' },
        });
      }

      const { currentPassword, newPassword } = req.body;
      const valid = await comparePassword(currentPassword, user.password);
      if (!valid) {
        const error: AppError = new Error('Current password is incorrect');
        error.statusCode = 401;
        throw error;
      }

      if (newPassword === currentPassword) {
        return res.status(400).json({
          success: false,
          error: { message: 'New password must be different from your current password' },
        });
      }

      user.password = await hashPassword(newPassword);
      user.mustChangePassword = false;
      await user.save();

      logger.info(`User ${user.email} completed forced password change`);

      res.json({
        success: true,
        message: 'Password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post(
  '/forgot-password',
  [
    body('email').isEmail().withMessage('Please provide a valid email'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            errors: errors.array(),
          },
        });
      }

      const { email } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      // Check database connection
      const mongoose = await import('mongoose');
      if (mongoose.default.connection.readyState !== 1) {
        const error: AppError = new Error('Database connection error. Please try again later.');
        error.statusCode = 503;
        throw error;
      }

      // Find user by email
      logger.info(`Looking for user with email: ${normalizedEmail}`);
      const user = await User.findOne({ email: normalizedEmail });
      
      // Debug: Check if any users exist and what emails they have
      if (!user) {
        const userCount = await User.countDocuments();
        logger.warn(`User not found. Total users in database: ${userCount}`);
        
        // Try to find user with case-insensitive search as fallback
        const allUsers = await User.find({}, { email: 1, name: 1, role: 1 }).limit(10);
        logger.info(`Sample users in database:`, {
          count: allUsers.length,
          users: allUsers.map(u => ({ email: u.email, name: u.name, role: u.role })),
        });
      }

      // Always return success message to prevent email enumeration
      // But only send email if user exists
      if (!user) {
        logger.warn(`Password reset requested for non-existent email: ${normalizedEmail}`);
        return res.json({
          success: true,
          message: 'If an account with that email exists, a password reset link has been sent.',
        });
      }

      if (!user.isActive) {
        logger.warn(`Password reset requested for inactive account: ${normalizedEmail}`);
        return res.json({
          success: true,
          message: 'If an account with that email exists, a password reset link has been sent.',
        });
      }

      // Import PasswordResetToken model
      const { PasswordResetToken, generateResetToken } = await import('../models/PasswordResetToken.js');
      
      // Invalidate any existing unused tokens for this user
      await PasswordResetToken.updateMany(
        { userId: user._id, used: false },
        { used: true }
      );

      // Generate new reset token
      const resetToken = generateResetToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

      // Save reset token
      const passwordResetToken = new PasswordResetToken({
        userId: user._id,
        token: resetToken,
        expiresAt,
        used: false,
      });

      await passwordResetToken.save();

      // Send password reset email
      const { sendEmail, generatePasswordResetEmail } = await import('../utils/email.js');
      const emailContent = generatePasswordResetEmail(resetToken, user.name);
      
      const emailSent = await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      if (!emailSent) {
        logger.error(`Failed to send password reset email to ${user.email}`);
      }

      logger.info(`Password reset token generated for user: ${user.email}`);

      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    } catch (error) {
      logger.error('Error in forgot-password:', error);
      next(error);
    }
  }
);

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            errors: errors.array(),
          },
        });
      }

      const { token, password } = req.body;

      // Check database connection
      const mongoose = await import('mongoose');
      if (mongoose.default.connection.readyState !== 1) {
        const error: AppError = new Error('Database connection error. Please try again later.');
        error.statusCode = 503;
        throw error;
      }

      // Import PasswordResetToken model
      const { PasswordResetToken } = await import('../models/PasswordResetToken.js');
      
      // Find valid reset token
      const resetToken = await PasswordResetToken.findOne({
        token,
        used: false,
        expiresAt: { $gt: new Date() },
      }).populate('userId');

      if (!resetToken) {
        const error: AppError = new Error('Invalid or expired reset token');
        error.statusCode = 400;
        throw error;
      }

      // Get user
      const user = await User.findById(resetToken.userId);
      if (!user) {
        const error: AppError = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      if (!user.isActive) {
        const error: AppError = new Error('Account is inactive');
        error.statusCode = 401;
        throw error;
      }

      // Hash new password
      const hashedPassword = await hashPassword(password);

      // Update user password
      user.password = hashedPassword;
      await user.save();

      // Mark token as used
      resetToken.used = true;
      await resetToken.save();

      logger.info(`Password reset successful for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Password has been reset successfully. You can now log in with your new password.',
      });
    } catch (error) {
      logger.error('Error in reset-password:', error);
      next(error);
    }
  }
);

// @route   POST /api/auth/verify-reset-token
// @desc    Verify reset token is valid
// @access  Public
router.post(
  '/verify-reset-token',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            errors: errors.array(),
          },
        });
      }

      const { token } = req.body;

      // Check database connection
      const mongoose = await import('mongoose');
      if (mongoose.default.connection.readyState !== 1) {
        return res.status(503).json({
          success: false,
          error: { message: 'Database connection error' },
        });
      }

      // Import PasswordResetToken model
      const { PasswordResetToken } = await import('../models/PasswordResetToken.js');
      
      // Find valid reset token
      const resetToken = await PasswordResetToken.findOne({
        token,
        used: false,
        expiresAt: { $gt: new Date() },
      });

      if (!resetToken) {
        return res.json({
          success: false,
          message: 'Invalid or expired reset token',
        });
      }

      res.json({
        success: true,
        message: 'Reset token is valid',
      });
    } catch (error) {
      logger.error('Error in verify-reset-token:', error);
      next(error);
    }
  }
);

export default router;


