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

export async function limitUser(
  userId: string,
  action: string,
  ip: string,
): Promise<void> {
  try {
    const r = redis();
    const delayKey =
      'auth:user-delay:' + hmac('rate-user', userId) + ':' + action;
    const nextAllowed = await r.get<number>(delayKey);
    if (nextAllowed && nextAllowed > Date.now())
      throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many requests');
    const key = 'auth:user:' + hmac('rate-user', userId) + ':' + action;
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, 600);
    if (count > 5)
      throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many requests');
    const pair =
      'auth:user-ip:' + hmac('rate-user-ip', userId + '\0' + ip) + ':' + action;
    const pairCount = await r.incr(pair);
    if (pairCount === 1) await r.expire(pair, 600);
    if (pairCount > 5)
      throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many requests');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      'AUTH_RATE_UNAVAILABLE',
      'Authentication temporarily unavailable',
    );
  }
}

export async function recordUserFailure(
  userId: string,
  action: string,
): Promise<void> {
  try {
    const r = redis();
    const suffix = hmac('rate-user', userId) + ':' + action;
    const failures = await r.incr('auth:user-fail:' + suffix);
    if (failures === 1) await r.expire('auth:user-fail:' + suffix, 600);
    if (failures > 1) {
      const seconds = Math.min(60, 2 ** Math.min(failures - 2, 5));
      await r.set('auth:user-delay:' + suffix, Date.now() + seconds * 1000, {
        ex: 600,
      });
    }
  } catch {
    throw new AppError(
      503,
      'AUTH_RATE_UNAVAILABLE',
      'Authentication temporarily unavailable',
    );
  }
}
