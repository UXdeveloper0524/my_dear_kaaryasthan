import { SignJWT, jwtVerify } from 'jose';
import { keyFor, activeKeyVersion } from './auth-crypto.js';
import { readEnv } from '../config/env.js';

export async function issueAccess(
  userId: string,
  sessionId: string,
): Promise<string> {
  const env = readEnv();
  const version = activeKeyVersion();
  return new SignJWT({ sid: sessionId, kv: version })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(keyFor('jwt-access', version));
}
export async function verifyAccess(
  raw: string,
): Promise<{ userId: string; sessionId: string }> {
  const env = readEnv();
  // The unverified key version selects a key only. jwtVerify authenticates it before use.
  const parts = raw.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const payload = JSON.parse(
    Buffer.from(parts[1]!, 'base64url').toString('utf8'),
  ) as { kv?: unknown };
  if (payload.kv !== 1 && payload.kv !== 2) throw new Error('Invalid token');
  const { payload: verified } = await jwtVerify(
    raw,
    keyFor('jwt-access', payload.kv),
    {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );
  if (typeof verified.sub !== 'string' || typeof verified.sid !== 'string')
    throw new Error('Invalid token');
  return { userId: verified.sub, sessionId: verified.sid };
}
