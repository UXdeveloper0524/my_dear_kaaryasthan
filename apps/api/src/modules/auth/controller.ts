import type { Request, Response } from 'express';
import mongoose from 'mongoose';
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
import * as phase3b from './phase3b.js';
import { waitUntil } from '@vercel/functions';

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
  if ('mfaRequired' in result) {
    send(response, result);
    return;
  }
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
    expiresAt: mongoose.trusted({ $gt: new Date() }),
    idleExpiresAt: mongoose.trusted({ $gt: new Date() }),
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

function context(request: Request, response: Response) {
  return { requestId: id(response), ip: ip(request) };
}
export function forgotPassword(request: Request, response: Response) {
  const work = Promise.resolve()
    .then(() =>
      phase3b.forgotPassword(request.body.email, context(request, response)),
    )
    .catch(() => undefined);
  try {
    waitUntil(work);
  } catch {
    /* Local Node keeps the promise alive until it settles. */
  }
  send(response, { accepted: true }, 202);
}
export async function resetPassword(request: Request, response: Response) {
  await phase3b.resetPassword(
    request.body.token,
    request.body.newPassword,
    context(request, response),
  );
  clearAuthCookies(response);
  send(response, { reset: true });
}
export async function changePassword(request: Request, response: Response) {
  await phase3b.changePassword(
    response.locals.auth.user,
    response.locals.auth.session._id,
    request.body.currentPassword,
    request.body.newPassword,
    context(request, response),
  );
  send(response, { changed: true });
}
export async function setupMfa(request: Request, response: Response) {
  const otpauthUri = await phase3b.setup(
    response.locals.auth.user,
    response.locals.auth.session._id,
    request.body.password,
    context(request, response),
  );
  send(response, { otpauthUri });
}
export async function confirmMfa(request: Request, response: Response) {
  const recoveryCodes = await phase3b.confirm(
    response.locals.auth.user._id,
    response.locals.auth.session._id,
    request.body.code,
    context(request, response),
  );
  send(response, { enabled: true, recoveryCodes });
}
export async function challengeMfa(request: Request, response: Response) {
  const result = await phase3b.challenge(
    request.body.challengeToken,
    request.body.factor,
    request.body.code,
    request.header('user-agent') ?? 'Unknown device',
    context(request, response),
  );
  setAuthCookies(response, result.access, result.refresh);
  send(response, {
    user: service.safeUser(result.user),
    session: service.safeSession(result.session, true),
    ...(result.remainingRecoveryCodes === undefined
      ? {}
      : { remainingRecoveryCodes: result.remainingRecoveryCodes }),
  });
}
export async function disableMfa(request: Request, response: Response) {
  await phase3b.disable(
    response.locals.auth.user,
    response.locals.auth.session._id,
    request.body.password,
    request.body.factor,
    request.body.code,
    context(request, response),
  );
  send(response, { enabled: false });
}
export async function regenerateMfa(request: Request, response: Response) {
  const recoveryCodes = await phase3b.regenerate(
    response.locals.auth.user,
    request.body.password,
    request.body.code,
    context(request, response),
  );
  send(response, { recoveryCodes, remainingCount: 10 });
}
