import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { hmac, activeKeyVersion, constantEqual } from './auth-crypto.js';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}
export function otpauthUri(secret: string, email: string): string {
  return new TOTP({
    issuer: 'MyDear Kaaryasthan',
    label: email,
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).toString();
}
export function matchedStep(
  secret: string,
  code: string,
  now = Date.now(),
): number | null {
  const step = Math.floor(now / 30000);
  const supplied = Buffer.from(/^\d{6}$/.test(code) ? code : 'xxxxxx');
  let match: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const candidate = TOTP.generate({
      secret: Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      timestamp: (step + offset) * 30000,
    });
    if (timingSafeEqual(supplied, Buffer.from(candidate)))
      match = step + offset;
  }
  return match;
}
export function newRecoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from({ length: 10 }, () => {
    let bits = BigInt('0x' + randomBytes(10).toString('hex'));
    let value = '';
    for (let index = 0; index < 16; index += 1) {
      value = alphabet[Number(bits & 31n)] + value;
      bits >>= 5n;
    }
    return value.match(/.{4}/g)!.join('-');
  });
}
export function recoveryHmac(
  code: string,
  version = activeKeyVersion(),
): string {
  return hmac('mfa-recovery', code.replaceAll('-', '').toUpperCase(), version);
}
export function recoveryMatch(
  code: string,
  stored: { hmac?: string | null; keyVersion?: number | null }[],
): string | null {
  if (!/^[A-Za-z2-7]{4}(?:-[A-Za-z2-7]{4}){3}$/.test(code)) return null;
  for (const entry of stored) {
    if (
      entry.hmac &&
      entry.keyVersion &&
      constantEqual(entry.hmac, recoveryHmac(code, entry.keyVersion))
    )
      return entry.hmac;
  }
  return null;
}
