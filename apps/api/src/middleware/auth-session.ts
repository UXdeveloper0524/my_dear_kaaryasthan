import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/app-error.js';
import { cookies, accessName } from '../lib/auth-cookies.js';
import { verifyAccess } from '../lib/auth-jwt.js';
import { db } from '../modules/auth/repository.js';
import { activeMembership } from '../modules/tenant/access.js';
import { readEnv } from '../config/env.js';
import mongoose from 'mongoose';

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
      user.status !== 'active' ||
      user.deletedAt !== null
    )
      throw new UnauthorizedError();
    const selected = session.activeOrganizationId
      ? await activeMembership(user._id, session.activeOrganizationId)
      : null;
    if (session.activeOrganizationId && !selected) {
      await Session.updateOne(
        {
          _id: session._id,
          activeOrganizationId: session.activeOrganizationId,
        },
        { $set: { activeOrganizationId: null } },
      );
      session.activeOrganizationId = null;
    }
    const cutoff = new Date(
      now.getTime() - readEnv().SESSION_TOUCH_INTERVAL_SECONDS * 1000,
    );
    if (session.lastSeenAt < cutoff) {
      await Session.updateOne(
        {
          _id: session._id,
          lastSeenAt: mongoose.trusted({ $lt: cutoff }),
          revokedAt: null,
        },
        { $set: { lastSeenAt: now } },
      );
      session.lastSeenAt = now;
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.vary('Origin');
    response.locals.auth = {
      session,
      user,
      membership: selected?.membership ?? null,
      role: selected?.role ?? null,
    };
    next();
  } catch {
    next(new UnauthorizedError());
  }
};
