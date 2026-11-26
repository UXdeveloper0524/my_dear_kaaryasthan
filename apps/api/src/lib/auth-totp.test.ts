import { describe, expect, it } from 'vitest';
import {
  newRecoveryCodes,
  newTotpSecret,
  matchedStep,
  otpauthUri,
} from './auth-totp.js';
import { TOTP } from 'otpauth';

describe('TOTP and recovery code primitives', () => {
  it('accepts one clock step on either side and returns the matched step', () => {
    const secret = newTotpSecret();
    const now = Math.floor(Date.now() / 30000) * 30000;
    for (const offset of [-1, 0, 1]) {
      const token = TOTP.generate({ secret, timestamp: now + offset * 30000 });
      expect(matchedStep(secret, token, now)).toBe(
        Math.floor(now / 30000) + offset,
      );
    }
    const uri = otpauthUri(secret, 'a@example.com');
    expect(new URL(uri).searchParams.get('secret')).toBe(secret);
  });
  it('generates ten distinct 80-bit base32 recovery codes', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
  });
});
