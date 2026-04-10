import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    statusCode,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(err.code && { code: err.code }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error: AppError = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};


