import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

/**
 * Authenticate inbound Calling agent webhooks via shared secret.
 * Accepts X-API-Key or X-Voice-Webhook-Key (same value as VOICE_WEBHOOK_API_KEY).
 */
export const requireVoiceWebhookKey = (req: Request, res: Response, next: NextFunction): void => {
  const expected = process.env.VOICE_WEBHOOK_API_KEY?.trim();
  if (!expected) {
    const error: AppError = new Error('Voice webhook is not configured');
    error.statusCode = 503;
    return next(error);
  }

  const provided =
    (typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key']) ||
    (typeof req.headers['x-voice-webhook-key'] === 'string' && req.headers['x-voice-webhook-key']) ||
    '';

  if (!provided || provided !== expected) {
    const error: AppError = new Error('Invalid voice webhook API key');
    error.statusCode = 401;
    return next(error);
  }

  next();
};
