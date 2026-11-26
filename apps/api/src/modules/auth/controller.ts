import type { Request, Response } from 'express';
import {
  accessName,
  clearAuthCookies,
  cookies,
  refreshName,
  setAuthCookies,
} from '../../lib/auth-cookies.js';
import { AppError, UnauthorizedError } from '../../errors/app-error.js';
import { db, findRefresh } from './repository.js';
import * as service from './service.js';

function ip(request: Request) {
  return request.ip ?? 'unknown';
}
function id(response: Response) {
  return String(response.locals.requestId ?? 'unknown');
}
function send(response: Response, data: unknown, status = 200) {
  response.status(status).json({ data, meta: null, error: null });
}
export async function register(request: Request, response: Response) {
  await service.register(request.body, id(response), ip(request));
  send(response, { accepted: true }, 202);
}
export async function resend(request: Request, response: Response) {
  await service.resend(request.body.email, id(response), ip(request));
  send(response, { accepted: true }, 202);
}
export async function verifyEmail(request: Request, response: Response) {
  await service.verifyEmail(request.body.token, id(response), ip(request));
  send(response, { verified: true });
}
export async function login(request: Request, response: Response) {
  const result = await service.login(
    request.body.email,
    request.body.password,
    id(response),
    ip(request),
    request.header('user-agent') ?? 'Unknown device',
  );
  setAuthCookies(response, result.access, result.refresh);
  send(response, {
    user: service.safeUser(result.user),
    session: service.safeSession(result.session, true),
  });
}
export async function refresh(request: Request, response: Response) {
  const raw = cookies(request)[refreshName];
  if (!raw) throw new UnauthorizedError();
  const result = await service.refresh(raw, id(response), ip(request));
  setAuthCookies(response, result.access, result.refresh);
  send(response, {
    user: service.safeUser(result.user),
    session: service.safeSession(result.session, true),
  });
}
export async function logout(request: Request, response: Response) {
  const supplied = cookies(request);
  const rawRefresh = supplied[refreshName];
  if (rawRefresh) {
    const token = await findRefresh(rawRefresh);
    if (token) {
      try {
        await service.revokeSession(
          String(token.sessionId),
          String(token.userId),
          id(response),
          ip(request),
        );
        await service.audit(
          'auth.logout',
          'success',
          id(response),
          ip(request),
          token.userId,
        );
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'NOT_FOUND'))
          throw error;
      }
    }
  } else if (supplied[accessName]) {
    const { verifyAccess } = await import('../../lib/auth-jwt.js');
    const claims = await verifyAccess(supplied[accessName]).catch(() => null);
    if (claims) {
      await service.revokeSession(
        claims.sessionId,
        claims.userId,
        id(response),
        ip(request),
      );
      await service.audit('auth.logout', 'success', id(response), ip(request));
    }
  }
  clearAuthCookies(response);
  send(response, { loggedOut: true });
}
export function me(_request: Request, response: Response) {
  send(response, {
    user: service.safeUser(response.locals.auth.user),
    session: service.safeSession(response.locals.auth.session, true),
  });
}
export async function sessions(_request: Request, response: Response) {
  const { Session } = await db();
  const active = response.locals.auth.session;
  const entries = await Session.find({
    userId: active.userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    idleExpiresAt: { $gt: new Date() },
  })
    .sort({ lastSeenAt: -1 })
    .limit(100);
  send(response, {
    sessions: entries.map((entry) =>
      service.safeSession(entry, String(entry.id) === String(active.id)),
    ),
  });
}
export async function revoke(request: Request, response: Response) {
  const { sessionId } = response.locals.params as { sessionId: string };
  const active = response.locals.auth.session;
  await service.revokeSession(
    sessionId,
    String(active.userId),
    id(response),
    ip(request),
  );
  if (sessionId === String(active.id)) clearAuthCookies(response);
  send(response, { revoked: true });
}
