import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = Number(process.env.VOICE_WEBHOOK_RATE_LIMIT_PER_MIN || 120);

const hits = new Map<string, number[]>();

/** Simple in-memory rate limit for the voice webhook (per client IP). */
export function voiceWebhookRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      success: false,
      error: { message: 'Too many voice webhook requests — try again later' },
    });
    return;
  }

  recent.push(now);
  hits.set(key, recent);
  next();
}
