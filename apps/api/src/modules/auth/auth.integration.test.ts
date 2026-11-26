import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { useInMemoryDatabase } from '../../test/mongo.js';
import { setTestMailer, type MailMessage } from '../../lib/auth-mailer.js';
import { setTestAuthRateStore } from '../../middleware/auth-rate-limit.js';
import { AuthAudit, AuthToken, RefreshToken, Session, User } from './models.js';
import { issueAccess, verifyAccess } from '../../lib/auth-jwt.js';
import { dummyVerify } from '../../lib/auth-password.js';
import { activeKeyVersion, decrypt, emailHmac } from '../../lib/auth-crypto.js';
import { DevelopmentOutbox } from '../../lib/auth-mailer.js';
import { readEnv } from '../../config/env.js';
import mongoose from 'mongoose';
import * as passwordTools from '../../lib/auth-password.js';

useInMemoryDatabase();
const messages: MailMessage[] = [];
const keys: string[] = [];
const counts = new Map<string, number>();
const delayed = new Map<string, number>();
beforeEach(() => {
  messages.length = 0;
  keys.length = 0;
  counts.clear();
  delayed.clear();
  setTestMailer({
    async send(message) {
      messages.push(message);
    },
  });
  setTestAuthRateStore({
    async incr(key) {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    },
    async expire() {
      return 1;
    },
    async get<T>(key: string) {
      return (delayed.get(key) ?? null) as T | null;
    },
    async set(key, value) {
      delayed.set(key, value);
      return 'OK';
    },
  });
});
afterEach(async () => {
  setTestMailer(undefined);
  setTestAuthRateStore(undefined);
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    RefreshToken.deleteMany({}),
    AuthToken.deleteMany({}),
    AuthAudit.deleteMany({}),
  ]);
  vi.restoreAllMocks();
});
const email = 'alice@example.com';
const password = 'Strong testing password 34!';
function setCookies(response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] {
  return (response.headers['set-cookie'] as string[]) ?? [];
}
async function browser() {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf');
  expect(csrf.status).toBe(200);
  return { agent, csrf: csrf.body.data.csrfToken as string };
}
async function registered() {
  const client = await browser();
  const registeredResponse = await client.agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', client.csrf)
    .send({ email, password, displayName: 'Alice' });
  expect(registeredResponse.status).toBe(202);
  expect(messages).toHaveLength(1);
  const token = new URL(
    messages[0]!.text.split(' ').at(-1) ?? '',
  ).searchParams.get('token');
  expect(token).toBeTruthy();
  const verified = await client.agent
    .post('/api/v1/auth/verify-email')
    .set('X-CSRF-Token', client.csrf)
    .send({ token });
  expect(verified.status).toBe(200);
  return client;
}
async function loggedIn() {
  const client = await registered();
  const login = await client.agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', client.csrf)
    .send({ email, password });
  expect(login.status).toBe(200);
  const csrf = await client.agent.get('/api/v1/auth/csrf');
  return { ...client, csrf: csrf.body.data.csrfToken as string, login };
}

describe('Phase 3a auth', () => {
  it('registers, verifies, logs in, reads me and lists devices with secure cookie flags', async () => {
    const { agent, login } = await loggedIn();
    expect(login.headers['cache-control']).toBe('no-store');
    expect(setCookies(login).join(';')).toContain('HttpOnly');
    expect(setCookies(login).join(';')).toContain('SameSite=Lax');
    expect(setCookies(login).join(';')).toContain('Path=/api/v1/auth');
    expect(login.body.data.session.activeOrganizationId).toBeNull();
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
    const sessions = await agent.get('/api/v1/auth/sessions');
    expect(sessions.body.data.sessions).toHaveLength(1);
    expect(keys.join(' ')).not.toContain(email);
    expect(keys.join(' ')).not.toContain('127.0.0.1');
  });
  it('keeps registration generic for existing email and sends account notice', async () => {
    const client = await registered();
    messages.length = 0;
    const again = await client.agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password, displayName: 'Other' });
    expect(again.status).toBe(202);
    expect(again.body).toEqual({
      data: { accepted: true },
      meta: null,
      error: null,
    });
    expect(messages[0]?.subject).toMatch(/already exists/);
  });
  it('invalidates an older verification token on resend and consumes the new one once', async () => {
    const client = await browser();
    await client.agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password, displayName: 'Alice' });
    const first = new URL(
      messages[0]!.text.split(' ').at(-1)!,
    ).searchParams.get('token');
    const resent = await client.agent
      .post('/api/v1/auth/verify-email/resend')
      .set('X-CSRF-Token', client.csrf)
      .send({ email });
    expect(resent.status).toBe(202);
    const second = new URL(
      messages[1]!.text.split(' ').at(-1)!,
    ).searchParams.get('token');
    expect(
      (
        await client.agent
          .post('/api/v1/auth/verify-email')
          .set('X-CSRF-Token', client.csrf)
          .send({ token: first })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.agent
          .post('/api/v1/auth/verify-email')
          .set('X-CSRF-Token', client.csrf)
          .send({ token: second })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.agent
          .post('/api/v1/auth/verify-email')
          .set('X-CSRF-Token', client.csrf)
          .send({ token: second })
      ).status,
    ).toBe(400);
  });
  it('calls the dummy verifier for an unknown email and rejects unverified login', async () => {
    const client = await browser();
    const dummy = vi.spyOn(passwordTools, 'dummyVerify');
    const unknown = await client.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password });
    expect(unknown.status).toBe(401);
    expect(dummy).toHaveBeenCalledWith(password);
    await client.agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password, displayName: 'Alice' });
    const unverified = await client.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    await expect(dummyVerify(password)).resolves.toBeUndefined();
  });
  it('rejects a missing CSRF token, null Origin, and unapproved Origin', async () => {
    const client = await browser();
    const input = { email, password, displayName: 'Alice' };
    expect(
      (await client.agent.post('/api/v1/auth/register').send(input)).body.error
        .code,
    ).toBe('CSRF_INVALID');
    expect(
      (
        await client.agent
          .post('/api/v1/auth/register')
          .set('Origin', 'null')
          .set('X-CSRF-Token', client.csrf)
          .send(input)
      ).status,
    ).toBe(403);
    expect(
      (
        await client.agent
          .post('/api/v1/auth/register')
          .set('Origin', 'https://evil.example')
          .set('X-CSRF-Token', client.csrf)
          .send(input)
      ).status,
    ).toBe(403);
  });
  it('rotates refresh and returns 409 on grace-window reuse', async () => {
    const { agent, csrf, login } = await loggedIn();
    const original = setCookies(login)
      .find((item) => item.startsWith('__Secure-kaaryasthan-refresh='))!
      .split(';')[0]!;
    const access = setCookies(login)
      .find((item) => item.startsWith('__Secure-kaaryasthan-access='))!
      .split(';')[0]!;
    const first = await agent
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Token', csrf);
    expect(first.status).toBe(200);
    const retry = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        original,
        access,
        `__Secure-kaaryasthan-csrf=${encodeURIComponent(csrf)}`,
      ])
      .set('X-CSRF-Token', csrf);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('REFRESH_RETRY');
    const session = await Session.findById(login.body.data.session.id);
    expect(session?.revokedAt).toBeNull();
  });
  it('revokes a family after the grace window', async () => {
    const { agent, csrf, login } = await loggedIn();
    const original = setCookies(login)
      .find((item) => item.startsWith('__Secure-kaaryasthan-refresh='))!
      .split(';')[0]!;
    const access = setCookies(login)
      .find((item) => item.startsWith('__Secure-kaaryasthan-access='))!
      .split(';')[0]!;
    expect(
      (await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf))
        .status,
    ).toBe(200);
    const used = await RefreshToken.findOne({ usedAt: { $ne: null } });
    used!.usedAt = new Date(Date.now() - 11000);
    await used!.save();
    const retry = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        original,
        access,
        `__Secure-kaaryasthan-csrf=${encodeURIComponent(csrf)}`,
      ])
      .set('X-CSRF-Token', csrf);
    expect(retry.status).toBe(401);
    expect(
      (await Session.findById(login.body.data.session.id))?.revokedAt,
    ).not.toBeNull();
  });
  it('rejects a JWT with an unexpected algorithm', async () => {
    const raw = await issueAccess('user-id', 'session-id');
    expect(await verifyAccess(raw)).toEqual({
      userId: 'user-id',
      sessionId: 'session-id',
    });
    const altered =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      ) +
      '.' +
      raw.split('.').slice(1).join('.');
    await expect(verifyAccess(altered)).rejects.toThrow();
  });
  it('revokes its own device and clears access', async () => {
    const { agent, csrf, login } = await loggedIn();
    const id = login.body.data.session.id as string;
    const revoked = await agent
      .delete(`/api/v1/auth/sessions/${id}`)
      .set('X-CSRF-Token', csrf);
    expect(revoked.status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('prevents a user from revoking another user session', async () => {
    const first = await loggedIn();
    const otherEmail = 'bob@example.com';
    const second = await browser();
    await second.agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', second.csrf)
      .send({ email: otherEmail, password, displayName: 'Bob' });
    const token = new URL(
      messages.at(-1)!.text.split(' ').at(-1)!,
    ).searchParams.get('token');
    await second.agent
      .post('/api/v1/auth/verify-email')
      .set('X-CSRF-Token', second.csrf)
      .send({ token });
    expect(
      (
        await second.agent
          .post('/api/v1/auth/login')
          .set('X-CSRF-Token', second.csrf)
          .send({ email: otherEmail, password })
      ).status,
    ).toBe(200);
    const csrf = (await second.agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken;
    const forbidden = await second.agent
      .delete(`/api/v1/auth/sessions/${first.login.body.data.session.id}`)
      .set('X-CSRF-Token', csrf);
    expect(forbidden.status).toBe(404);
  });
  it('logs out and revokes the refresh family', async () => {
    const { agent, csrf, login } = await loggedIn();
    expect(
      (await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf))
        .status,
    ).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await Session.findById(login.body.data.session.id))?.revokedAt,
    ).not.toBeNull();
  });
  it('rejects expired and revoked refresh tokens', async () => {
    const { agent, csrf } = await loggedIn();
    await RefreshToken.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf))
        .status,
    ).toBe(401);
    await RefreshToken.updateMany(
      {},
      {
        $set: {
          expiresAt: new Date(Date.now() + 60000),
          revokedAt: new Date(),
        },
      },
    );
    expect(
      (await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf))
        .status,
    ).toBe(401);
  });
  it('allows only one successor in concurrent refresh', async () => {
    const { agent, login } = await loggedIn();
    const cookie = setCookies(login).map((item) => item.split(';')[0]!);
    const csrfResponse = await agent.get('/api/v1/auth/csrf');
    const authCsrf = setCookies(csrfResponse)[0]!.split(';')[0]!;
    const sent = [...cookie, authCsrf];
    const results = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', sent)
          .set('X-CSRF-Token', csrfResponse.body.data.csrfToken),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await RefreshToken.countDocuments({ successorTokenId: { $ne: null } }),
    ).toBe(1);
  });
  it('looks up an older HMAC key version and decrypts its email', async () => {
    const client = await registered();
    const user = await User.findOne({});
    expect(user).toBeTruthy();
    const old = user!.emailLookupHmac;
    process.env.KEY_MASTER_V2 = Buffer.alloc(32, 7).toString('base64url');
    process.env.AUTH_ACTIVE_KEY_VERSION = '2';
    try {
      expect(emailHmac(email)).not.toBe(old);
      expect(decrypt('email', user!.emailEncrypted)).toBe(email);
      const rotatedCsrf = await client.agent.get('/api/v1/auth/csrf');
      const response = await client.agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', rotatedCsrf.body.data.csrfToken)
        .send({ email, password });
      expect(response.status).toBe(200);
      expect(activeKeyVersion()).toBe(2);
    } finally {
      delete process.env.KEY_MASTER_V2;
      delete process.env.AUTH_ACTIVE_KEY_VERSION;
    }
  });
  it('enforces the active-user partial unique index and permits reuse after soft deletion', async () => {
    const client = await registered();
    await User.createIndexes();
    const index = (await User.collection.indexes()).find(
      (item) => item.key?.emailLookupHmac === 1,
    );
    expect(index?.partialFilterExpression).toEqual({
      deletedAt: { $type: 'null' },
    });
    const first = await User.findOne({});
    expect(first).toBeTruthy();
    await expect(
      User.create({
        emailLookupHmac: first!.emailLookupHmac,
        emailEncrypted: first!.emailEncrypted,
        keyVersion: 1,
        displayName: 'Duplicate',
        passwordHash: first!.passwordHash,
        status: 'pending',
        deletedAt: null,
      }),
    ).rejects.toMatchObject({ code: 11000 });
    first!.deletedAt = new Date();
    await first!.save();
    const second = await client.agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', client.csrf)
      .send({ email, password, displayName: 'Second' });
    expect(second.status).toBe(202);
    expect(await User.countDocuments({})).toBe(2);
  });
  it('rate limits with HMAC-only keys and fails closed without Redis', async () => {
    const client = await browser();
    process.env.AUTH_EMAIL_IP_LIMIT_PER_10_MIN = '1';
    try {
      const one = await client.agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', client.csrf)
        .send({ email, password });
      expect(one.status).toBe(401);
      const two = await client.agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', client.csrf)
        .send({ email, password });
      expect(two.status).toBe(401);
      const three = await client.agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', client.csrf)
        .send({ email, password });
      expect(three.status).toBe(429);
      expect(keys.join(' ')).not.toContain(email);
      expect(keys.join(' ')).not.toContain('127.0.0.1');
      setTestAuthRateStore({
        async incr() {
          throw new Error('down');
        },
        async expire() {
          return 1;
        },
        async get() {
          return null;
        },
        async set() {
          return 'OK';
        },
      });
      const down = await client.agent.get('/api/v1/auth/csrf');
      expect(down.status).toBe(503);
    } finally {
      delete process.env.AUTH_EMAIL_IP_LIMIT_PER_10_MIN;
    }
  });
  it('refuses the development outbox in production mode', async () => {
    expect(() =>
      readEnv({ NODE_ENV: 'production', AUTH_DEV_OUTBOX: 'true' }),
    ).toThrow('AUTH_DEV_OUTBOX');
    expect(() =>
      readEnv({
        NODE_ENV: 'development',
        VERCEL_ENV: 'preview',
        AUTH_DEV_OUTBOX: 'true',
      }),
    ).toThrow('AUTH_DEV_OUTBOX');
    await expect(
      new DevelopmentOutbox().send({ to: email, subject: 'x', text: 'secret' }),
    ).rejects.toThrow();
  });
  it('sets Secure cookies outside test mode', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const response = await request(app).get('/api/v1/auth/csrf');
      expect(response.status).toBe(200);
      expect(setCookies(response).join(';')).toContain('Secure');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
  it('rejects client organization selection and a forged cross-tenant session', async () => {
    const { agent, csrf, login } = await loggedIn();
    const invalid = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({
        email,
        password,
        organizationId: new mongoose.Types.ObjectId().toString(),
      });
    expect(invalid.status).toBe(400);
    await Session.updateOne(
      { _id: login.body.data.session.id },
      { $set: { activeOrganizationId: new mongoose.Types.ObjectId() } },
    );
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf))
        .status,
    ).toBe(401);
  });
});
