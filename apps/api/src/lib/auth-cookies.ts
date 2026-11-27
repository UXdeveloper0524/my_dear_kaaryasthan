import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';
import { readEnv } from '../config/env.js';

export const accessName = '__Secure-kaaryasthan-access';
export const refreshName = '__Secure-kaaryasthan-refresh';
export const csrfName = '__Secure-kaaryasthan-csrf';
const root = '/api/v1/auth';
export function cookies(request: Request): Record<string, string | undefined> {
  return parseCookie(request.headers.cookie ?? '');
}
function serialize(
  name: string,
  value: string,
  options: ReturnType<typeof attributes> & { maxAge: number },
) {
  return stringifySetCookie({ name, value, ...options });
}
function attributes(path: string, httpOnly: boolean) {
  const env = readEnv();
  return {
    path,
    httpOnly,
    secure: env.NODE_ENV !== 'test',
    sameSite: 'lax' as const,
    domain: env.COOKIE_DOMAIN,
  };
}
export function setAuthCookies(
  response: Response,
  access: string,
  refresh: string,
): void {
  response.append(
    'Set-Cookie',
    serialize(accessName, access, { ...attributes('/', true), maxAge: 900 }),
  );
  response.append(
    'Set-Cookie',
    serialize(refreshName, refresh, {
      ...attributes(root, true),
      maxAge: readEnv().AUTH_SESSION_ABSOLUTE_DAYS * 86400,
    }),
  );
}
export function clearAuthCookies(response: Response): void {
  response.append(
    'Set-Cookie',
    serialize(accessName, '', { ...attributes('/', true), maxAge: 0 }),
  );
  response.append(
    'Set-Cookie',
    serialize(refreshName, '', { ...attributes(root, true), maxAge: 0 }),
  );
}
export function setCsrfCookie(response: Response, token: string): void {
  response.append(
    'Set-Cookie',
    serialize(csrfName, token, { ...attributes('/', true), maxAge: 3600 }),
  );
}
