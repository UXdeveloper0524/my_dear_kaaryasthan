import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { readEnv } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

type LimitResult = Pick<
  Awaited<ReturnType<Ratelimit['limit']>>,
  'success' | 'reset'
>;
type Limit = (identifier: string) => Promise<LimitResult>;

let limiter: Ratelimit | undefined;

function getLimiter(): Limit | undefined {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = readEnv();
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    return undefined;
  }
  const activeLimiter = (limiter ??= new Ratelimit({
    redis: new Redis({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN }),
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'kaaryasthan:api:rate-limit',
  }));
  return (identifier) => activeLimiter.limit(identifier);
}

export function createRateLimit(limit: Limit): RequestHandler {
  return async (request, response, next) => {
    const identifier = createHash('sha256')
      .update(request.ip ?? 'unknown')
      .digest('hex');
    let result: LimitResult;
    try {
      result = await limit(identifier);
    } catch {
      logger.error(
        { requestId: response.locals.requestId },
        'rate limit store unavailable',
      );
      next();
      return;
    }
    if (!result.success) {
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      );
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests'));
      return;
    }
    next();
  };
}

export const rateLimit: RequestHandler = (request, response, next) => {
  try {
    const limit = getLimiter();
    if (limit) return createRateLimit(limit)(request, response, next);
    logger.warn(
      { requestId: response.locals.requestId },
      'rate limit store not configured',
    );
    next();
  } catch {
    logger.error(
      { requestId: response.locals.requestId },
      'rate limit store unavailable',
    );
    next();
  }
};
