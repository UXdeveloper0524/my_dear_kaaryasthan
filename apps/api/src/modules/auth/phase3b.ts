import mongoose from 'mongoose';
import { AppError, UnauthorizedError } from '../../errors/app-error.js';
import {
  activeKeyVersion,
  decrypt,
  encrypt,
  newToken,
  purposeTokenHmac,
} from '../../lib/auth-crypto.js';
import { getMailer } from '../../lib/auth-mailer.js';
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../../lib/auth-password.js';
import {
  matchedStep,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  recoveryHmac,
  recoveryMatch,
} from '../../lib/auth-totp.js';
import {
  limitUser,
  recordUserFailure,
} from '../../middleware/auth-rate-limit.js';
import { readEnv } from '../../config/env.js';
import { audit, createSession } from './service.js';
import { db, findToken, findUserByEmail, transaction } from './repository.js';

type Context = { requestId: string; ip: string };
type Account = Awaited<ReturnType<typeof findUserByEmail>>;
function invalidToken(): never {
  throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token');
}
function invalidFactor(): never {
  throw new AppError(401, 'INVALID_MFA_CODE', 'Invalid security code');
}
function weak(): never {
  throw new AppError(400, 'WEAK_PASSWORD', 'Choose a stronger password');
}
async function guard(
  userId: mongoose.Types.ObjectId,
  action: string,
  context: Context,
) {
  try {
    await limitUser(String(userId), action, context.ip);
  } catch (error) {
    if (error instanceof AppError && error.code === 'AUTH_RATE_LIMITED')
      await audit(
        'auth.rate_limited',
        action,
        context.requestId,
        context.ip,
        userId,
      );
    throw error;
  }
}
async function notify(
  user: NonNullable<Account>,
  template: string,
  text: string,
) {
  const { AuthNotification } = await db();
  const notice = await AuthNotification.create({
    userId: user._id,
    template,
    nextCheckAt: new Date(),
  });
  try {
    await getMailer().send({
      to: decrypt('email', user.emailEncrypted),
      subject: `Kaaryasthan security: ${template}`,
      text,
    });
    await AuthNotification.updateOne(
      { _id: notice._id },
      {
        $set: {
          state: 'sent',
          purgeAfter: new Date(Date.now() + 30 * 86400000),
        },
      },
    );
  } catch {
    // The pending record has no secret; a later scheduler can retry it.
  }
}
async function revokeSessions(
  userId: mongoose.Types.ObjectId,
  except?: mongoose.Types.ObjectId,
  mongoSession?: mongoose.ClientSession,
) {
  const { Session, RefreshToken } = await db();
  const now = new Date();
  const filter = {
    userId,
    revokedAt: null,
    ...(except ? { _id: mongoose.trusted({ $ne: except }) } : {}),
  };
  const sessions = await Session.find(filter)
    .select('familyId')
    .session(mongoSession ?? null);
  await Session.updateMany(
    filter,
    { $set: { revokedAt: now } },
    { session: mongoSession },
  );
  const families = sessions.map((s) => s.familyId);
  if (families.length)
    await RefreshToken.updateMany(
      { familyId: mongoose.trusted({ $in: families }) },
      { $set: { revokedAt: now } },
      { session: mongoSession },
    );
}
export async function forgotPassword(email: string, context: Context) {
  const user = await findUserByEmail(email);
  if (user && user.status !== 'disabled') {
    const { AuthToken } = await db();
    const now = new Date();
    const raw = newToken();
    await transaction(async (session) => {
      await AuthToken.updateMany(
        { userId: user._id, purpose: 'password_reset', consumedAt: null },
        { $set: { consumedAt: now } },
        { session },
      );
      await AuthToken.create(
        [
          {
            userId: user._id,
            purpose: 'password_reset',
            tokenPrefix: raw.slice(0, 16),
            tokenHmac: purposeTokenHmac(raw, 'password_reset'),
            keyVersion: activeKeyVersion(),
            expiresAt: new Date(now.getTime() + 3600000),
          },
        ],
        { session },
      );
    });
    const url = new URL(
      '/reset-password',
      readEnv().WEB_PUBLIC_URL ?? readEnv().WEB_ORIGIN.split(',')[0],
    );
    url.hash = 'token=' + encodeURIComponent(raw);
    await getMailer().send({
      to: email,
      subject: 'Reset your Kaaryasthan password',
      text: `Open this link to reset your password: ${url.toString()}`,
    });
  }
  await audit(
    'auth.password_reset_requested',
    'accepted',
    context.requestId,
    context.ip,
    user?._id,
  );
}
export async function resetPassword(
  raw: string,
  password: string,
  context: Context,
) {
  if (!validatePassword(password)) weak();
  const token = await findToken(raw, 'password_reset');
  const now = new Date();
  if (!token || token.consumedAt || token.expiresAt <= now) invalidToken();
  const { User, AuthToken, Session, RefreshToken } = await db();
  const user = await User.findById(token.userId);
  if (!user || user.status === 'disabled' || user.deletedAt !== null)
    invalidToken();
  if (await verifyPassword(user.passwordHash, password))
    throw new AppError(400, 'PASSWORD_REUSED', 'Choose a different password');
  const hash = await hashPassword(password);
  await transaction(async (session) => {
    const used = await AuthToken.updateOne(
      {
        _id: token._id,
        consumedAt: null,
        expiresAt: mongoose.trusted({ $gt: now }),
      },
      { $set: { consumedAt: now } },
      { session },
    );
    if (used.modifiedCount !== 1) invalidToken();
    await AuthToken.updateMany(
      {
        userId: user._id,
        purpose: mongoose.trusted({ $in: ['password_reset', 'mfa_login'] }),
        consumedAt: null,
      },
      { $set: { consumedAt: now } },
      { session },
    );
    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash: hash, status: 'active', verifiedAt: now },
        $inc: { credentialVersion: 1 },
      },
      { session },
    );
    await Session.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: now } },
      { session },
    );
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: now } },
      { session },
    );
  });
  await audit(
    'auth.password_reset_completed',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  await notify(
    user,
    'Password changed',
    'Your password was changed. If this was not you, contact support.',
  );
}
export async function changePassword(
  user: NonNullable<Account>,
  sessionId: mongoose.Types.ObjectId,
  currentPassword: string,
  newPassword: string,
  context: Context,
) {
  await guard(user._id, 'change-password', context);
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    await recordUserFailure(String(user.id), 'change-password');
    await audit(
      'auth.password_change_failed',
      'invalid_password',
      context.requestId,
      context.ip,
      user._id,
    );
    throw new UnauthorizedError();
  }
  if (!validatePassword(newPassword)) weak();
  if (await verifyPassword(user.passwordHash, newPassword))
    throw new AppError(400, 'PASSWORD_REUSED', 'Choose a different password');
  const { User, Session, RefreshToken, AuthToken } = await db();
  const now = new Date();
  const hash = await hashPassword(newPassword);
  await transaction(async (session) => {
    const others = await Session.find({
      userId: user._id,
      _id: mongoose.trusted({ $ne: sessionId }),
      revokedAt: null,
    })
      .select('familyId')
      .session(session);
    const changed = await User.updateOne(
      { _id: user._id, passwordHash: user.passwordHash },
      { $set: { passwordHash: hash }, $inc: { credentialVersion: 1 } },
      { session },
    );
    if (changed.modifiedCount !== 1)
      throw new AppError(409, 'PASSWORD_CONFLICT', 'Retry password change');
    await Session.updateMany(
      {
        userId: user._id,
        _id: mongoose.trusted({ $ne: sessionId }),
        revokedAt: null,
      },
      { $set: { revokedAt: now } },
      { session },
    );
    await RefreshToken.updateMany(
      {
        familyId: mongoose.trusted({
          $in: others.map((item) => item.familyId),
        }),
      },
      { $set: { revokedAt: now } },
      { session },
    );
    await AuthToken.updateMany(
      {
        userId: user._id,
        purpose: mongoose.trusted({ $in: ['mfa_login', 'password_reset'] }),
        consumedAt: null,
      },
      { $set: { consumedAt: now } },
      { session },
    );
  });
  await audit(
    'auth.password_changed',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  await notify(
    user,
    'Password changed',
    'Your password was changed. If this was not you, contact support.',
  );
}
export async function setup(
  user: NonNullable<Account>,
  sessionId: mongoose.Types.ObjectId,
  password: string,
  context: Context,
) {
  await guard(user._id, 'mfa-setup', context);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordUserFailure(String(user.id), 'mfa-setup');
    await audit(
      'auth.mfa_setup_failed',
      'invalid_password',
      context.requestId,
      context.ip,
      user._id,
    );
    throw new UnauthorizedError();
  }
  if (user.mfaEnabledAt)
    throw new AppError(
      409,
      'MFA_ALREADY_ENABLED',
      'Two-factor authentication is already enabled',
    );
  const secret = newTotpSecret();
  const { User } = await db();
  const started = await User.updateOne(
    { _id: user._id, mfaEnabledAt: null },
    {
      $set: {
        mfaPendingSecretEncrypted: encrypt('mfa-pending', secret),
        mfaPendingExpiresAt: new Date(Date.now() + 600000),
        mfaPendingSessionId: sessionId,
        mfaPendingAttempts: 0,
      },
    },
  );
  if (started.modifiedCount !== 1)
    throw new AppError(
      409,
      'MFA_ALREADY_ENABLED',
      'Two-factor authentication is already enabled',
    );
  await audit(
    'auth.mfa_setup_started',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  return otpauthUri(secret, decrypt('email', user.emailEncrypted));
}
export async function confirm(
  userId: mongoose.Types.ObjectId,
  sessionId: mongoose.Types.ObjectId,
  code: string,
  context: Context,
) {
  await guard(userId, 'mfa-confirm', context);
  const { User } = await db();
  const now = new Date();
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      mfaEnabledAt: null,
      mfaPendingSessionId: sessionId,
      mfaPendingExpiresAt: mongoose.trusted({ $gt: now }),
      mfaPendingAttempts: mongoose.trusted({ $lt: 5 }),
    },
    { $inc: { mfaPendingAttempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!user?.mfaPendingSecretEncrypted)
    throw new AppError(
      400,
      'MFA_SETUP_EXPIRED',
      'Start two-factor setup again',
    );
  const secret = decrypt('mfa-pending', user.mfaPendingSecretEncrypted);
  const step = matchedStep(secret, code);
  if (step === null) {
    await recordUserFailure(String(user.id), 'mfa-confirm');
    await audit(
      'auth.mfa_setup_failed',
      'invalid_code',
      context.requestId,
      context.ip,
      user._id,
    );
    invalidFactor();
  }
  const codes = newRecoveryCodes();
  await transaction(async (mongoSession) => {
    const changed = await User.updateOne(
      {
        _id: user._id,
        mfaEnabledAt: null,
        mfaPendingSessionId: sessionId,
        mfaPendingExpiresAt: mongoose.trusted({ $gt: now }),
      },
      {
        $set: {
          mfaSecretEncrypted: encrypt('mfa-secret', secret),
          mfaEnabledAt: now,
          mfaLastUsedStep: step,
          recoveryCodes: codes.map((value) => ({
            hmac: recoveryHmac(value),
            keyVersion: activeKeyVersion(),
          })),
          mfaPendingSecretEncrypted: null,
          mfaPendingExpiresAt: null,
          mfaPendingSessionId: null,
        },
      },
      { session: mongoSession },
    );
    if (changed.modifiedCount !== 1)
      throw new AppError(
        409,
        'MFA_SETUP_CONFLICT',
        'Start two-factor setup again',
      );
    await revokeSessions(user._id, sessionId, mongoSession);
  });
  await audit(
    'auth.mfa_enabled',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  await notify(
    user,
    'Two-factor authentication enabled',
    'Two-factor authentication was enabled on your account.',
  );
  return codes;
}
async function consumeFactor(
  user: NonNullable<Account>,
  factor: 'totp' | 'recovery',
  code: string,
): Promise<number | null> {
  const { User } = await db();
  if (factor === 'totp') {
    if (!user.mfaSecretEncrypted) invalidFactor();
    const step = matchedStep(
      decrypt('mfa-secret', user.mfaSecretEncrypted),
      code,
    );
    if (step === null) invalidFactor();
    const updated = await User.updateOne(
      {
        _id: user._id,
        mfaLastUsedStep: mongoose.trusted({ $lt: step }),
        mfaEnabledAt: mongoose.trusted({ $ne: null }),
      },
      { $set: { mfaLastUsedStep: step } },
    );
    if (updated.modifiedCount !== 1) invalidFactor();
    return null;
  }
  const match = recoveryMatch(code, user.recoveryCodes);
  if (!match) invalidFactor();
  const updated = await User.updateOne(
    { _id: user._id, 'recoveryCodes.hmac': match },
    { $pull: { recoveryCodes: { hmac: match } } },
  );
  if (updated.modifiedCount !== 1) invalidFactor();
  return Math.max(0, user.recoveryCodes.length - 1);
}
export async function challenge(
  raw: string,
  factor: 'totp' | 'recovery',
  code: string,
  deviceLabel: string,
  context: Context,
) {
  const token = await findToken(raw, 'mfa_login');
  const now = new Date();
  if (
    !token ||
    token.consumedAt ||
    token.invalidatedAt ||
    token.expiresAt <= now
  )
    invalidToken();
  await guard(token.userId, 'mfa-challenge', context);
  const { User, AuthToken } = await db();
  const reserved = await AuthToken.findOneAndUpdate(
    {
      _id: token._id,
      attempts: mongoose.trusted({ $lt: 5 }),
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: mongoose.trusted({ $gt: now }),
    },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!reserved) {
    await audit(
      'auth.mfa_challenge_locked',
      'attempt_limit',
      context.requestId,
      context.ip,
      token.userId,
    );
    invalidToken();
  }
  const user = await User.findById(token.userId);
  if (
    !user ||
    !user.mfaEnabledAt ||
    user.status !== 'active' ||
    user.credentialVersion !== token.credentialVersion
  )
    invalidToken();
  let remaining: number | null;
  try {
    remaining = await consumeFactor(user, factor, code);
  } catch (error) {
    await recordUserFailure(String(user.id), 'mfa-challenge');
    if (reserved.attempts >= 5) {
      await AuthToken.updateOne(
        { _id: token._id },
        { $set: { invalidatedAt: now } },
      );
      await audit(
        'auth.mfa_challenge_locked',
        'attempt_limit',
        context.requestId,
        context.ip,
        user._id,
      );
      await notify(
        user,
        'Second-factor challenge locked',
        'A sign-in challenge was locked after too many incorrect codes.',
      );
    } else
      await audit(
        'auth.mfa_challenge_failed',
        'invalid_code',
        context.requestId,
        context.ip,
        user._id,
      );
    throw error;
  }
  const consumed = await AuthToken.updateOne(
    { _id: token._id, consumedAt: null, invalidatedAt: null },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) invalidToken();
  const result = await createSession(user, context.ip, deviceLabel, now);
  await audit(
    'auth.mfa_challenge_succeeded',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  if (remaining !== null) {
    await audit(
      'auth.mfa_recovery_code_used',
      'success',
      context.requestId,
      context.ip,
      user._id,
    );
    await notify(
      user,
      'Recovery code used',
      `A recovery code was used. ${remaining} codes remain.`,
    );
  }
  return { ...result, user, remainingRecoveryCodes: remaining ?? undefined };
}
export async function disable(
  user: NonNullable<Account>,
  sessionId: mongoose.Types.ObjectId,
  password: string,
  factor: 'totp' | 'recovery',
  code: string,
  context: Context,
) {
  await guard(user._id, 'mfa-disable', context);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordUserFailure(String(user.id), 'mfa-disable');
    await audit(
      'auth.mfa_disable_failed',
      'invalid_password',
      context.requestId,
      context.ip,
      user._id,
    );
    throw new UnauthorizedError();
  }
  if (!user.mfaEnabledAt)
    throw new AppError(
      409,
      'MFA_NOT_ENABLED',
      'Two-factor authentication is not enabled',
    );
  await consumeFactor(user, factor, code);
  const { User } = await db();
  await transaction(async (mongoSession) => {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          mfaSecretEncrypted: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: -1,
          recoveryCodes: [],
        },
      },
      { session: mongoSession },
    );
    await revokeSessions(user._id, sessionId, mongoSession);
  });
  await audit(
    'auth.mfa_disabled',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  await notify(
    user,
    'Two-factor authentication disabled',
    'Two-factor authentication was disabled on your account.',
  );
}
export async function regenerate(
  user: NonNullable<Account>,
  password: string,
  code: string,
  context: Context,
) {
  await guard(user._id, 'mfa-regenerate', context);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordUserFailure(String(user.id), 'mfa-regenerate');
    await audit(
      'auth.mfa_regenerate_failed',
      'invalid_password',
      context.requestId,
      context.ip,
      user._id,
    );
    throw new UnauthorizedError();
  }
  if (!user.mfaEnabledAt)
    throw new AppError(
      409,
      'MFA_NOT_ENABLED',
      'Two-factor authentication is not enabled',
    );
  await consumeFactor(user, 'totp', code);
  const codes = newRecoveryCodes();
  const { User } = await db();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        recoveryCodes: codes.map((value) => ({
          hmac: recoveryHmac(value),
          keyVersion: activeKeyVersion(),
        })),
      },
    },
  );
  await audit(
    'auth.mfa_recovery_codes_regenerated',
    'success',
    context.requestId,
    context.ip,
    user._id,
  );
  await notify(
    user,
    'Recovery codes regenerated',
    'Your recovery codes were regenerated. Previous codes no longer work.',
  );
  return codes;
}
