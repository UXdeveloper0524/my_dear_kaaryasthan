import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { AppError, UnauthorizedError } from '../../errors/app-error.js';
import {
  activeKeyVersion,
  constantEqual,
  decrypt,
  emailHmac,
  encrypt,
  hmac,
  newToken,
  tokenHmac,
  purposeTokenHmac,
} from '../../lib/auth-crypto.js';
import {
  dummyVerify,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from '../../lib/auth-password.js';
import { issueAccess } from '../../lib/auth-jwt.js';
import { connectToDatabase } from '../../lib/db.js';
import { getMailer } from '../../lib/auth-mailer.js';
import { readEnv } from '../../config/env.js';
import { limitUser } from '../../middleware/auth-rate-limit.js';
import { activeMembership, chooseOrganization } from '../tenant/access.js';
import {
  AuthAudit,
  AuthNotification,
  AuthToken,
  RefreshToken,
  Session,
  User,
} from './models.js';

export async function db() {
  await connectToDatabase();
  return {
    User,
    Session,
    RefreshToken,
    AuthToken,
    AuthAudit,
    AuthNotification,
  };
}
export async function findUserByEmail(email: string) {
  const { User } = await db();
  for (const version of [
    activeKeyVersion(),
    ...[1, 2].filter((v) => v !== activeKeyVersion()),
  ]) {
    try {
      const user = await User.findOne({
        emailLookupHmac: emailHmac(email, version),
        deletedAt: mongoose.trusted({ $type: 'null' }),
      });
      if (user) return user;
    } catch (error) {
      if (String(error).includes('KEY_MASTER_V')) continue;
      throw error;
    }
  }
  return null;
}
export async function findToken(raw: string, purpose: string) {
  const { AuthToken } = await db();
  const token = await AuthToken.findOne({
    purpose,
    tokenPrefix: raw.slice(0, 16),
  });
  if (!token) return null;
  const expected = ['password_reset', 'mfa_login'].includes(purpose)
    ? purposeTokenHmac(raw, purpose, token.keyVersion)
    : tokenHmac(raw, token.keyVersion);
  return constantEqual(token.tokenHmac, expected) ? token : null;
}
export async function findRefresh(raw: string) {
  const { RefreshToken } = await db();
  for (const version of [
    activeKeyVersion(),
    ...[1, 2].filter((v) => v !== activeKeyVersion()),
  ]) {
    try {
      const token = await RefreshToken.findOne({
        tokenHmac: tokenHmac(raw, version),
      });
      if (
        token &&
        constantEqual(token.tokenHmac, tokenHmac(raw, token.keyVersion))
      )
        return token;
    } catch (error) {
      if (String(error).includes('KEY_MASTER_V')) continue;
      throw error;
    }
  }
  return null;
}
export function transaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
) {
  return mongoose.connection.transaction(fn);
}

const hours = (n: number) => n * 3600000;
function date(value: Date) {
  return value.toISOString();
}
type UserView = {
  id: string;
  displayName: string;
  emailEncrypted: { keyVersion: number; value: string };
  status: 'pending' | 'active' | 'disabled';
  verifiedAt?: Date | null;
};
type SessionView = {
  id: string;
  deviceLabel: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  activeOrganizationId?: mongoose.Types.ObjectId | null;
};
export function safeUser(user: UserView) {
  return {
    id: String(user.id),
    displayName: user.displayName,
    email: decrypt('email', user.emailEncrypted),
    status: user.status,
    verifiedAt: user.verifiedAt ? date(user.verifiedAt) : null,
  };
}
export function safeSession(session: SessionView, current = false) {
  return {
    id: String(session.id),
    deviceLabel: session.deviceLabel,
    createdAt: date(session.createdAt),
    lastSeenAt: date(session.lastSeenAt),
    expiresAt: date(session.expiresAt),
    current,
    activeOrganizationId: session.activeOrganizationId
      ? String(session.activeOrganizationId)
      : null,
  };
}
export async function audit(
  event: string,
  outcome: string,
  requestId: string,
  ip: string,
  userId?: mongoose.Types.ObjectId,
) {
  const { AuthAudit } = await db();
  await AuthAudit.create({
    userId: userId ?? null,
    event,
    outcome,
    requestId,
    ipHmac: hmac('audit-ip', ip),
    keyVersion: activeKeyVersion(),
    occurredAt: new Date(),
    purgeAfter: new Date(Date.now() + 365 * 86400000),
  });
}
async function issueEmailToken(
  userId: mongoose.Types.ObjectId,
  purpose: 'verify_email',
  email: string,
) {
  const { AuthToken } = await db();
  const now = new Date();
  await AuthToken.updateMany(
    { userId, purpose, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  let raw = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    raw = newToken();
    try {
      await AuthToken.create({
        userId,
        purpose,
        tokenPrefix: raw.slice(0, 16),
        tokenHmac: tokenHmac(raw),
        keyVersion: activeKeyVersion(),
        expiresAt: new Date(now.getTime() + 86400000),
      });
      break;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || attempt === 2)
        throw error;
    }
  }
  const url = new URL(
    '/verify-email',
    readEnv().WEB_PUBLIC_URL ?? readEnv().WEB_ORIGIN.split(',')[0],
  );
  url.searchParams.set('token', raw);
  await getMailer().send({
    to: email,
    subject: 'Verify your Kaaryasthan email',
    text: `Open this link to verify your email: ${url.toString()}`,
  });
}
export async function register(
  input: { email: string; password: string; displayName: string },
  requestId: string,
  ip: string,
) {
  if (!validatePassword(input.password))
    throw new AppError(400, 'WEAK_PASSWORD', 'Choose a stronger password');
  const existing = await findUserByEmail(input.email);
  if (existing) {
    await dummyVerify(input.password);
    await getMailer().send({
      to: input.email,
      subject: 'Kaaryasthan account already exists',
      text: 'An account already exists for this email. Sign in or contact support if this was not you.',
    });
    await audit('auth.register', 'existing', requestId, ip, existing._id);
    return;
  }
  const { User } = await db();
  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    user = await User.create({
      emailLookupHmac: emailHmac(input.email),
      emailEncrypted: encrypt('email', input.email),
      keyVersion: activeKeyVersion(),
      displayName: input.displayName,
      passwordHash,
      status: 'pending',
      deletedAt: null,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    await getMailer().send({
      to: input.email,
      subject: 'Kaaryasthan account already exists',
      text: 'An account already exists for this email. Sign in if this was you.',
    });
    return;
  }
  await issueEmailToken(user._id, 'verify_email', input.email);
  await audit('auth.register', 'created', requestId, ip, user._id);
}
export async function resend(email: string, requestId: string, ip: string) {
  const user = await findUserByEmail(email);
  if (user && user.status === 'pending')
    await issueEmailToken(user._id, 'verify_email', email);
  else {
    await dummyVerify(email);
    if (user)
      await getMailer().send({
        to: email,
        subject: 'Kaaryasthan account already exists',
        text: 'This account is already verified. Sign in if this was you.',
      });
  }
  await audit('auth.verify_resend', 'accepted', requestId, ip, user?._id);
}
export async function verifyEmail(raw: string, requestId: string, ip: string) {
  const token = await findToken(raw, 'verify_email');
  const now = new Date();
  if (
    !token ||
    token.purpose !== 'verify_email' ||
    token.consumedAt ||
    token.expiresAt <= now
  )
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token');
  const { User, AuthToken } = await db();
  await transaction(async (mongoSession) => {
    const consumed = await AuthToken.updateOne(
      {
        _id: token._id,
        consumedAt: null,
        expiresAt: mongoose.trusted({ $gt: now }),
      },
      { $set: { consumedAt: now } },
      { session: mongoSession },
    );
    if (consumed.modifiedCount !== 1)
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token');
    await User.updateOne(
      { _id: token.userId, deletedAt: mongoose.trusted({ $type: 'null' }) },
      { $set: { status: 'active', verifiedAt: now } },
      { session: mongoSession },
    );
  });
  await audit('auth.verify_email', 'success', requestId, ip, token.userId);
}
export async function createSession(
  user: { id: string; _id: mongoose.Types.ObjectId },
  ip: string,
  deviceLabel: string,
  mfaVerifiedAt?: Date,
) {
  const { Session, RefreshToken } = await db();
  const { User } = await db();
  const account = await User.findById(user._id);
  const initialOrganizationId = await chooseOrganization(
    user._id,
    account?.lastUsedOrganizationId,
  );
  const now = new Date();
  const env = readEnv();
  const expiresAt = new Date(
    now.getTime() + env.AUTH_SESSION_ABSOLUTE_DAYS * 86400000,
  );
  const idleExpiresAt = new Date(
    Math.min(
      expiresAt.getTime(),
      now.getTime() + hours(env.AUTH_SESSION_IDLE_HOURS),
    ),
  );
  const raw = newToken();
  const familyId = randomUUID();
  const session = await transaction(async (mongoSession) => {
    const [created] = await Session.create(
      [
        {
          userId: user._id,
          activeOrganizationId: initialOrganizationId,
          familyId,
          deviceLabel: deviceLabel.slice(0, 120),
          createdIpHmac: hmac('device-ip', ip),
          keyVersion: activeKeyVersion(),
          mfaVerifiedAt: mfaVerifiedAt ?? null,
          lastSeenAt: now,
          idleExpiresAt,
          expiresAt,
        },
      ],
      { session: mongoSession },
    );
    const [token] = await RefreshToken.create(
      [
        {
          sessionId: created!._id,
          userId: user._id,
          familyId,
          tokenHmac: tokenHmac(raw),
          keyVersion: activeKeyVersion(),
          issuedAt: now,
          expiresAt: idleExpiresAt,
          purgeAfter: new Date(expiresAt.getTime() + 86400000),
        },
      ],
      { session: mongoSession },
    );
    created!.currentRefreshTokenId = token!._id;
    await created!.save({ session: mongoSession });
    return created!;
  });
  return {
    session,
    access: await issueAccess(String(user.id), String(session.id)),
    refresh: raw,
  };
}
export async function login(
  email: string,
  password: string,
  requestId: string,
  ip: string,
  deviceLabel: string,
) {
  const user = await findUserByEmail(email);
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : (await dummyVerify(password), false);
  if (!valid || !user || user.status === 'disabled') {
    await audit('auth.login', 'failure', requestId, ip, user?._id);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  if (user.status !== 'active') {
    await audit('auth.login', 'unverified', requestId, ip, user._id);
    throw new AppError(
      403,
      'EMAIL_NOT_VERIFIED',
      'Verify your email before signing in',
    );
  }
  if (needsRehash(user.passwordHash)) {
    const { User } = await db();
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(password) } },
    );
  }
  if (user.mfaEnabledAt && user.mfaSecretEncrypted) {
    await limitUser(String(user.id), 'mfa-login', ip);
    const { AuthToken } = await db();
    const raw = newToken();
    await AuthToken.create({
      userId: user._id,
      purpose: 'mfa_login',
      tokenPrefix: raw.slice(0, 16),
      tokenHmac: purposeTokenHmac(raw, 'mfa_login'),
      keyVersion: activeKeyVersion(),
      expiresAt: new Date(Date.now() + 300000),
      credentialVersion: user.credentialVersion ?? 0,
    });
    await audit(
      'auth.mfa_challenge_issued',
      'success',
      requestId,
      ip,
      user._id,
    );
    return { mfaRequired: true as const, challengeToken: raw };
  }
  const result = await createSession(user, ip, deviceLabel);
  await audit('auth.login', 'success', requestId, ip, user._id);
  return { ...result, user };
}
export async function refresh(raw: string, requestId: string, ip: string) {
  const token = await findRefresh(raw);
  const now = new Date();
  if (!token) throw new UnauthorizedError();
  const { Session, RefreshToken, User } = await db();
  if (token.usedAt) {
    if (now.getTime() - token.usedAt.getTime() <= 10000)
      throw new AppError(409, 'REFRESH_RETRY', 'Retry sign-in request');
    await transaction(async (mongoSession) => {
      await Session.updateMany(
        { familyId: token.familyId },
        { $set: { revokedAt: now } },
        { session: mongoSession },
      );
      await RefreshToken.updateMany(
        { familyId: token.familyId },
        { $set: { revokedAt: now } },
        { session: mongoSession },
      );
    });
    await audit(
      'auth.refresh_reuse',
      'revoked_family',
      requestId,
      ip,
      token.userId,
    );
    throw new UnauthorizedError();
  }
  if (token.revokedAt || token.expiresAt <= now) throw new UnauthorizedError();
  const session = await Session.findById(token.sessionId);
  const user = await User.findById(token.userId);
  if (
    !session ||
    !user ||
    user.status !== 'active' ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.idleExpiresAt <= now ||
    String(session.currentRefreshTokenId) !== String(token.id) ||
    user.deletedAt !== null
  )
    throw new UnauthorizedError();
  if (
    session.activeOrganizationId &&
    !(await activeMembership(user._id, session.activeOrganizationId))
  ) {
    await Session.updateOne(
      { _id: session._id, activeOrganizationId: session.activeOrganizationId },
      { $set: { activeOrganizationId: null } },
    );
    throw new UnauthorizedError();
  }
  const successorRaw = newToken();
  const idleExpiresAt = new Date(
    Math.min(
      session.expiresAt.getTime(),
      now.getTime() + hours(readEnv().AUTH_SESSION_IDLE_HOURS),
    ),
  );
  await transaction(async (mongoSession) => {
    const used = await RefreshToken.updateOne(
      { _id: token._id, usedAt: null, revokedAt: null },
      { $set: { usedAt: now } },
      { session: mongoSession },
    );
    if (used.modifiedCount !== 1)
      throw new AppError(409, 'REFRESH_RETRY', 'Retry sign-in request');
    const [successor] = await RefreshToken.create(
      [
        {
          sessionId: session._id,
          userId: user._id,
          familyId: session.familyId,
          tokenHmac: tokenHmac(successorRaw),
          keyVersion: activeKeyVersion(),
          issuedAt: now,
          expiresAt: idleExpiresAt,
          purgeAfter: new Date(session.expiresAt.getTime() + 86400000),
        },
      ],
      { session: mongoSession },
    );
    await RefreshToken.updateOne(
      { _id: token._id },
      { $set: { successorTokenId: successor!._id } },
      { session: mongoSession },
    );
    const updated = await Session.updateOne(
      { _id: session._id, currentRefreshTokenId: token._id, revokedAt: null },
      {
        $set: {
          currentRefreshTokenId: successor!._id,
          idleExpiresAt,
          lastSeenAt: now,
        },
      },
      { session: mongoSession },
    );
    if (updated.modifiedCount !== 1)
      throw new AppError(409, 'REFRESH_RETRY', 'Retry sign-in request');
  }).catch((error: unknown) => {
    if (error instanceof AppError) throw error;
    if (
      error instanceof Error &&
      /WriteConflict|TransientTransactionError|conflict/i.test(error.message)
    )
      throw new AppError(409, 'REFRESH_RETRY', 'Retry sign-in request');
    throw error;
  });
  session.lastSeenAt = now;
  await audit('auth.refresh', 'success', requestId, ip, user._id);
  return {
    user,
    session,
    access: await issueAccess(String(user.id), String(session.id)),
    refresh: successorRaw,
  };
}
export async function revokeSession(
  sessionId: string,
  userId: string,
  requestId: string,
  ip: string,
) {
  const { Session, RefreshToken } = await db();
  const session = await Session.findOne({
    _id: sessionId,
    userId,
    revokedAt: null,
  });
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const now = new Date();
  await transaction(async (mongoSession) => {
    await Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: now } },
      { session: mongoSession },
    );
    await RefreshToken.updateMany(
      { familyId: session.familyId },
      { $set: { revokedAt: now } },
      { session: mongoSession },
    );
  });
  await audit('auth.session_revoke', 'success', requestId, ip, session.userId);
}
