import { Algorithm, hash, verify } from '@node-rs/argon2';
import { readFileSync } from 'node:fs';

const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const common = new Set(
  readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
export function validatePassword(password: string): boolean {
  return (
    password.length >= 12 &&
    password.length <= 128 &&
    !common.has(password.toLowerCase())
  );
}
export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}
export function verifyPassword(
  stored: string,
  supplied: string,
): Promise<boolean> {
  return verify(stored, supplied);
}
let dummyHash: Promise<string> | undefined;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('unknown-account-password-placeholder');
  await verifyPassword(await dummyHash, password);
}
export function needsRehash(stored: string): boolean {
  return !stored.startsWith('$argon2id$v=19$m=19456,t=2,p=1$');
}
