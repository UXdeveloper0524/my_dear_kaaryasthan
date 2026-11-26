import type { RequestHandler } from 'express';
import { Redis } from '@upstash/redis';
import { readEnv } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { hmac } from '../lib/auth-crypto.js';

export interface AuthRateStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: number, options: { ex: number }): Promise<unknown>;
}
type Store = AuthRateStore;
let store: Store | undefined;
export function setTestAuthRateStore(value?: Store): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test-only');
  store = value;
}
function redis(): Store {
  if (store) return store;
  const env = readEnv();
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN)
    throw new Error('Redis is not configured');
  return (store = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
  }));
}
export const authRateLimit: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const env = readEnv();
    const clientIp = request.ip ?? 'unknown';
    const ipKey = 'auth:ip:' + hmac('rate-ip', clientIp);
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : undefined;
    const emailKey = email
      ? 'auth:email-ip:' + hmac('rate-email-ip', email + '\0' + clientIp)
      : undefined;
    const emailHmac = email ? hmac('rate-email', email) : undefined;
    const globalEmailKey = emailHmac ? 'auth:email:' + emailHmac : undefined;
    const delayKey = emailHmac ? 'auth:email-delay:' + emailHmac : undefined;
    const r = redis();
    const ipCount = await r.incr(ipKey);
    if (ipCount === 1) await r.expire(ipKey, 600);
    let emailCount = 0;
    if (emailKey) {
      emailCount = await r.incr(emailKey);
      if (emailCount === 1) await r.expire(emailKey, 600);
    }
    let globalEmailCount = 0;
    if (globalEmailKey) {
      globalEmailCount = await r.incr(globalEmailKey);
      if (globalEmailCount === 1) await r.expire(globalEmailKey, 600);
    }
    if (ipCount > env.AUTH_IP_LIMIT_PER_10_MIN) {
      response.setHeader('Retry-After', 600);
      throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many requests');
    }
    const delayCount = Math.max(emailCount, globalEmailCount);
    if (delayCount > env.AUTH_EMAIL_IP_LIMIT_PER_10_MIN && delayKey) {
      const nextAllowed = await r.get<number>(delayKey);
      if (nextAllowed && nextAllowed > Date.now()) {
        response.setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((nextAllowed - Date.now()) / 1000)),
        );
        throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many requests');
      }
      const delay = Math.min(
        60,
        env.AUTH_EMAIL_DELAY_BASE_SECONDS *
          2 ** Math.min(5, delayCount - env.AUTH_EMAIL_IP_LIMIT_PER_10_MIN - 1),
      );
      await r.set(delayKey, Date.now() + delay * 1000, { ex: 600 });
    }
    next();
  } catch (error) {
    if (error instanceof AppError) next(error);
    else
      next(
        new AppError(
          503,
          'AUTH_RATE_UNAVAILABLE',
          'Authentication temporarily unavailable',
        ),
      );
  }
};
