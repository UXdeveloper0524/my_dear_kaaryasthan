import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/app-error.js';
import { cookies, accessName } from '../lib/auth-cookies.js';
import { verifyAccess } from '../lib/auth-jwt.js';
import { db } from '../modules/auth/repository.js';

export const requireAuth: RequestHandler = async (request, response, next) => {
  try {
    const raw = cookies(request)[accessName];
    if (!raw) throw new UnauthorizedError();
    const { userId, sessionId } = await verifyAccess(raw);
    const { Session, User } = await db();
    const now = new Date();
    const [session, user] = await Promise.all([
      Session.findById(sessionId),
      User.findById(userId),
    ]);
    if (
      !session ||
      !user ||
      String(session.userId) !== userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.activeOrganizationId !== null ||
      user.status !== 'active' ||
      user.deletedAt !== null
    )
      throw new UnauthorizedError();
    response.locals.auth = { session, user };
    next();
  } catch {
    next(new UnauthorizedError());
  }
};
