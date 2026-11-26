import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { readEnv } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

type LimitResult = Pick<
  Awaited<ReturnType<Ratelimit['limit']>>,
  'success' | 'reset'
>;
type Limit = (identifier: string) => Promise<LimitResult>;

let limiter: Ratelimit | undefined;

function getLimiter(): Limit {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = readEnv();
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Service unavailable');
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
    try {
      const forwarded = request
        .get('x-vercel-forwarded-for')
        ?.split(',')[0]
        ?.trim();
      const address =
        process.env.VERCEL === '1' && forwarded ? forwarded : request.ip;
      const identifier = createHash('sha256')
        .update(address ?? 'unknown')
        .digest('hex');
      const result = await limit(identifier);
      if (!result.success) {
        response.setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
        );
        throw new AppError(429, 'RATE_LIMITED', 'Too many requests');
      }
      next();
    } catch (error) {
      next(
        error instanceof AppError
          ? error
          : new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Service unavailable'),
      );
    }
  };
}

export const rateLimit: RequestHandler = (request, response, next) => {
  try {
    return createRateLimit(getLimiter())(request, response, next);
  } catch (error) {
    next(error);
  }
};
