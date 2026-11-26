import mongoose from 'mongoose';
import {
  activeKeyVersion,
  constantEqual,
  emailHmac,
  tokenHmac,
} from '../../lib/auth-crypto.js';
import { connectToDatabase } from '../../lib/db.js';
import { AuthAudit, AuthToken, RefreshToken, Session, User } from './models.js';

export async function db() {
  await connectToDatabase();
  return { User, Session, RefreshToken, AuthToken, AuthAudit };
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
        deletedAt: { $type: 'null' },
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
  return constantEqual(token.tokenHmac, tokenHmac(raw, token.keyVersion))
    ? token
    : null;
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
