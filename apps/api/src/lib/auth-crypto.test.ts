import { describe, expect, it } from 'vitest';
import {
  constantEqual,
  decrypt,
  emailHmac,
  encrypt,
  hmac,
  newToken,
  tokenHmac,
} from './auth-crypto.js';

describe('Phase 3a crypto', () => {
  it('generates 256-bit tokens and separates HMAC purposes', () => {
    const token = newToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokenHmac(token)).not.toBe(hmac('email-lookup', token));
    expect(emailHmac('Alice@Example.com')).toBe(emailHmac('alice@example.com'));
    expect(constantEqual('abc', 'abc')).toBe(true);
    expect(constantEqual('abc', 'abd')).toBe(false);
  });
  it('encrypts fields with fresh nonces and authenticated decryption', () => {
    const first = encrypt('email', 'alice@example.com');
    const second = encrypt('email', 'alice@example.com');
    expect(first.value).not.toBe(second.value);
    expect(decrypt('email', first)).toBe('alice@example.com');
    expect(() => decrypt('other-purpose', first)).toThrow();
  });
});
