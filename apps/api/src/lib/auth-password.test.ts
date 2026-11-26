import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from './auth-password.js';

describe('Phase 3a password policy', () => {
  it('accepts long passphrases without composition rules and rejects short, long, and common choices', () => {
    expect(validatePassword('short')).toBe(false);
    expect(validatePassword('x'.repeat(129))).toBe(false);
    expect(validatePassword('password123456')).toBe(false);
    expect(validatePassword('a plain but sufficiently long passphrase')).toBe(
      true,
    );
    const localList = readFileSync(
      new URL('./common-passwords.txt', import.meta.url),
      'utf8',
    ).split(/\r?\n/);
    expect(localList.length).toBeGreaterThan(10000);
    const blockedLong = localList.find((value) => value.length >= 12);
    expect(blockedLong).toBeDefined();
    expect(validatePassword(blockedLong!)).toBe(false);
  });
  it('stores Argon2id hashes and identifies outdated parameters', async () => {
    const stored = await hashPassword(
      'a plain but sufficiently long passphrase',
    );
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(
      await verifyPassword(stored, 'a plain but sufficiently long passphrase'),
    ).toBe(true);
    expect(await verifyPassword(stored, 'wrong passphrase')).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash(stored.replace('m=19456', 'm=12288'))).toBe(true);
  });
});
