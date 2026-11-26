import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { readEnv } from '../config/env.js';

function master(version: number): Buffer {
  const env = readEnv();
  const encoded = version === 1 ? env.KEY_MASTER_V1 : env.KEY_MASTER_V2;
  if (!encoded) throw new Error(`KEY_MASTER_V${version} is not configured`);
  const key = Buffer.from(encoded, 'base64url');
  if (key.length < 32) throw new Error(`KEY_MASTER_V${version} is invalid`);
  return key;
}

export function activeKeyVersion(): number {
  return readEnv().AUTH_ACTIVE_KEY_VERSION;
}
export function keyFor(purpose: string, version = activeKeyVersion()): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      master(version),
      Buffer.from('kaaryasthan:' + readEnv().NODE_ENV),
      Buffer.from(purpose),
      32,
    ),
  );
}
export function hmac(
  purpose: string,
  value: string,
  version = activeKeyVersion(),
): string {
  return createHmac('sha256', keyFor(purpose, version))
    .update(value)
    .digest('base64url');
}
export function constantEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function encrypt(
  purpose: string,
  value: string,
  version = activeKeyVersion(),
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    keyFor('encrypt:' + purpose, version),
    iv,
  );
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    keyVersion: version,
    value: [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString('base64url'))
      .join('.'),
  };
}
export function decrypt(
  purpose: string,
  encrypted: { keyVersion: number; value: string },
): string {
  const [iv, tag, body] = encrypted.value
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body) throw new Error('Invalid ciphertext');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor('encrypt:' + purpose, encrypted.keyVersion),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    'utf8',
  );
}
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
export function tokenHmac(token: string, version = activeKeyVersion()): string {
  return hmac('token', token, version);
}
export function emailHmac(email: string, version = activeKeyVersion()): string {
  return hmac('email-lookup', email.trim().toLowerCase(), version);
}
