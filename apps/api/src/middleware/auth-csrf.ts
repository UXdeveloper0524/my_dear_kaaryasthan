import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { constantEqual, hmac, newToken } from '../lib/auth-crypto.js';
import {
  accessName,
  cookies,
  csrfName,
  setCsrfCookie,
} from '../lib/auth-cookies.js';
import { parseAllowedOrigins, readEnv } from '../config/env.js';

function boundSession(request: Parameters<RequestHandler>[0]): string {
  const raw = cookies(request)[accessName];
  if (!raw) return 'anonymous';
  try {
    const sid = JSON.parse(
      Buffer.from(raw.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sid?: unknown };
    return typeof sid.sid === 'string' ? sid.sid : 'anonymous';
  } catch {
    return 'anonymous';
  }
}
function signed(nonce: string, sid: string) {
  return nonce + '.' + hmac('csrf', sid + '\0' + nonce);
}
export const issueCsrf: RequestHandler = (request, response) => {
  const token = signed(newToken(), boundSession(request));
  setCsrfCookie(response, token);
  response.json({ data: { csrfToken: token }, meta: null, error: null });
};
export const requireCsrf: RequestHandler = (request, _response, next) => {
  const origin = request.headers.origin;
  if (
    origin === 'null' ||
    (origin && !parseAllowedOrigins(readEnv().WEB_ORIGIN).includes(origin))
  )
    return next(new AppError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
  const provided = request.header('X-CSRF-Token');
  const cookie = cookies(request)[csrfName];
  if (!provided || !cookie || !constantEqual(provided, cookie))
    return next(new AppError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
  const [nonce, mac] = provided.split('.');
  if (
    !nonce ||
    !mac ||
    !constantEqual(mac, hmac('csrf', boundSession(request) + '\0' + nonce))
  )
    return next(new AppError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
  next();
};
