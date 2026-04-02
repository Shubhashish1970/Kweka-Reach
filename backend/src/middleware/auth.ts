import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt.js';
import { User, IUser } from '../models/User.js';
import { AppError } from './errorHandler.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export interface AuthRequest extends Request {
  user: IUser;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const error: AppError = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token — verifyToken throws a plain Error; wrap it as 401
    let decoded: JWTPayload;
    try {
      decoded = verifyToken(token) as JWTPayload;
    } catch {
      const tokenError: AppError = new Error('Invalid or expired token');
      tokenError.statusCode = 401;
      throw tokenError;
    }

    // Get user from database
    const user = await User.findById(decoded.userId).select('+password');
    
    if (!user) {
      const error: AppError = new Error('User not found');
      error.statusCode = 401;
      throw error;
    }

    if (!user.isActive) {
      const error: AppError = new Error('User account is inactive');
      error.statusCode = 401;
      throw error;
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};


