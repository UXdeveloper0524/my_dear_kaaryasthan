import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app.js';
import { useInMemoryDatabase } from '../../test/mongo.js';
import { setTestMailer, type MailMessage } from '../../lib/auth-mailer.js';
import { setTestAuthRateStore } from '../../middleware/auth-rate-limit.js';
import { Membership, Organization, Role, TenantAudit } from './models.js';
import {
  User,
  Session,
  RefreshToken,
  AuthToken,
  AuthAudit,
} from '../auth/models.js';
import {
  tenantQuery,
  rejectClientOperators,
  tenantAggregate,
} from './repository.js';
import {
  authorize,
  assertRoleGrant,
  grantsFor,
  type TenantContext,
} from './access.js';
import {
  builtInGrants,
  canGrantScope,
  roleKeys,
  scopes,
} from '@kaaryasthan/shared';
import { authRoutes } from '../auth/routes.js';
import { tenantRoutes } from './routes.js';
import {
  routeLayers,
  type RoutePolicy,
} from '../../middleware/route-policy.js';

useInMemoryDatabase();
const messages: MailMessage[] = [];
const counts = new Map<string, number>();
beforeEach(() => {
  messages.length = 0;
  counts.clear();
  setTestMailer({
    async send(message) {
      messages.push(message);
    },
  });
  setTestAuthRateStore({
    async incr(key) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
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
});
afterEach(async () => {
  vi.restoreAllMocks();
  setTestMailer(undefined);
  setTestAuthRateStore(undefined);
  if (mongoose.connection.readyState === 1)
    await Promise.all([
      Membership.deleteMany({}),
      Organization.deleteMany({}),
      Role.deleteMany({}),
      TenantAudit.deleteMany({}),
      User.deleteMany({}),
      Session.deleteMany({}),
      RefreshToken.deleteMany({}),
      AuthToken.deleteMany({}),
      AuthAudit.deleteMany({}),
    ]);
});
async function loggedIn(email = 'tenant@example.com') {
  const agent = request.agent(app);
  const messageIndex = messages.length;
  let csrf = (await agent.get('/api/v1/auth/csrf')).body.data
    .csrfToken as string;
  const registration = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({
      email,
      password: 'Strong testing password 34!',
      displayName: 'Tenant',
    });
  expect(registration.status, JSON.stringify(registration.body)).toBe(202);
  const token = new URL(
    messages[messageIndex]!.text.split(' ').at(-1) ?? '',
  ).searchParams.get('token');
  const verification = await agent
    .post('/api/v1/auth/verify-email')
    .set('X-CSRF-Token', csrf)
    .send({ token });
  expect(verification.status, JSON.stringify(verification.body)).toBe(200);
  const login = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({
      email,
      password: 'Strong testing password 34!',
    });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  return { agent, csrf };
}
async function createOrganization(
  account: Awaited<ReturnType<typeof loggedIn>>,
  name: string,
) {
  const reply = await account.agent
    .post('/api/v1/organizations')
    .set('X-CSRF-Token', account.csrf)
    .send({ name, slug: name.toLowerCase() });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body.data.organization.id as string;
}
describe('Phase 4a tenancy', () => {
  it('rejects missing CSRF on every registered cookie mutation route', async () => {
    const account = await loggedIn();
    const organizationId = await createOrganization(account, 'Alpha');
    await account.agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', account.csrf)
      .send({ organizationId });
    const routes = [
      { router: authRoutes, prefix: '/api/v1/auth' },
      { router: tenantRoutes, prefix: '/api/v1' },
    ].flatMap(({ router, prefix }) =>
      (
        router as unknown as {
          stack: {
            route?: { path: string; methods: Record<string, boolean> };
          }[];
        }
      ).stack.flatMap((layer) =>
        layer.route
          ? Object.keys(layer.route.methods)
              .filter((method) => ['post', 'patch', 'delete'].includes(method))
              .map((method) => ({
                method: method as 'post' | 'patch' | 'delete',
                path: (prefix + layer.route!.path).replace(
                  /:(roleId|sessionId)/g,
                  new mongoose.Types.ObjectId().toString(),
                ),
              }))
          : [],
      ),
    );
    expect(routes).toHaveLength(21);
    for (const { method, path } of routes) {
      const reply = await account.agent[method](path).send({});
      expect(reply.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(reply.body.error.code, `${method.toUpperCase()} ${path}`).toBe(
        'CSRF_INVALID',
      );
    }
  });
  it('sets private no-store and Vary Origin on every authenticated route', async () => {
    const account = await loggedIn();
    const organizationId = await createOrganization(account, 'Alpha');
    await account.agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', account.csrf)
      .send({ organizationId });
    const routes = [
      { router: authRoutes, prefix: '/api/v1/auth' },
      { router: tenantRoutes, prefix: '/api/v1' },
    ].flatMap(({ router, prefix }) =>
      routeLayers(router).flatMap((layer) => {
        const route = layer.route as
          | {
              path: string;
              methods: Record<string, boolean>;
              policy?: RoutePolicy;
            }
          | undefined;
        return route?.policy && route.policy.kind !== 'public'
          ? Object.keys(route.methods).map((method) => ({
              method: method as 'get' | 'post' | 'patch' | 'delete',
              path: (prefix + route.path).replace(
                /:(roleId|sessionId)/g,
                new mongoose.Types.ObjectId().toString(),
              ),
            }))
          : [];
      }),
    );
    expect(routes).toHaveLength(18);
    for (const { method, path } of routes) {
      const reply = await account.agent[method](path).send({});
      expect(
        reply.headers['cache-control'],
        `${method.toUpperCase()} ${path}`,
      ).toBe('private, no-store');
      expect(reply.headers.vary, `${method.toUpperCase()} ${path}`).toContain(
        'Origin',
      );
    }
  });
  it('requires authentication on every new route', async () => {
    for (const path of [
      '/api/v1/organizations',
      '/api/v1/organizations/current',
      '/api/v1/roles',
      `/api/v1/roles/${new mongoose.Types.ObjectId()}`,
    ])
      expect((await request(app).get(path)).status).toBe(401);
    for (const path of [
      '/api/v1/organizations',
      '/api/v1/organizations/switch',
      '/api/v1/roles',
    ])
      expect((await request(app).post(path)).status).toBe(401);
    for (const path of [
      '/api/v1/organizations/current',
      `/api/v1/roles/${new mongoose.Types.ObjectId()}`,
    ])
      expect((await request(app).patch(path)).status).toBe(401);
    expect(
      (
        await request(app).delete(
          `/api/v1/roles/${new mongoose.Types.ObjectId()}`,
        )
      ).status,
    ).toBe(401);
  });
  it('enforces the complete scope partial order', () => {
    for (const parent of scopes)
      for (const child of scopes) {
        const expected =
          parent === child ||
          (parent === 'Y' && ['S', 'O'].includes(child)) ||
          (parent === 'S' && child === 'O');
        expect(canGrantScope(parent, child)).toBe(expected);
      }
  });
  it('composes tenant filters and rejects client operators', () => {
    const organizationId = new mongoose.Types.ObjectId();
    expect(
      JSON.parse(
        JSON.stringify(tenantQuery(organizationId, { name: 'X' })),
      ).$and.slice(0, 3),
    ).toEqual([
      { organizationId: String(organizationId) },
      { deletedAt: { $type: 'null' } },
      { name: 'X' },
    ]);
    expect(() =>
      rejectClientOperators({
        $or: [{ organizationId: new mongoose.Types.ObjectId() }],
      }),
    ).toThrow();
    expect(() => rejectClientOperators({ nested: { $ne: null } })).toThrow();
  });
  it('rejects unsafe aggregation and cross-tenant lookup collections', async () => {
    const id = new mongoose.Types.ObjectId();
    await expect(
      tenantAggregate(Role, id, [
        { $lookup: { from: 'users', as: 'users', pipeline: [] } },
      ]),
    ).rejects.toThrow('Unsafe lookup');
    await expect(
      tenantAggregate(Role, id, [{ $unionWith: 'users' }]),
    ).rejects.toThrow('Unsafe aggregation');
  });
  it('creates an organization, requires CSRF, and switches only to an active membership', async () => {
    const { agent, csrf } = await loggedIn();
    expect(
      (
        await agent
          .post('/api/v1/organizations')
          .send({ name: 'A', slug: 'alpha' })
      ).status,
    ).toBe(403);
    const created = await agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Alpha', slug: 'alpha' });
    expect(created.status).toBe(201);
    expect(
      await Role.countDocuments({
        organizationId: created.body.data.organization.id,
      }),
    ).toBe(6);
    for (const key of roleKeys) {
      const role = await Role.findOne({
        organizationId: created.body.data.organization.id,
        builtInKey: key,
      });
      expect(role?.grants, key).toBeUndefined();
      expect(grantsFor(role!), key).toEqual(builtInGrants(key));
    }
    const switchResponse = await agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', csrf)
      .send({ organizationId: created.body.data.organization.id });
    expect(switchResponse.status).toBe(200);
    const current = await agent.get('/api/v1/organizations/current');
    expect(current.status).toBe(200);
    expect(current.body.data.organization.slug).toBe('alpha');
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(current.headers.vary).toContain('Origin');
    expect(
      (
        await agent
          .get('/api/v1/organizations/current')
          .set('X-Organization-Id', new mongoose.Types.ObjectId().toString())
      ).body.data.organization.id,
    ).toBe(created.body.data.organization.id);
    expect(
      (
        await agent
          .get('/api/v1/organizations')
          .query({ organizationId: new mongoose.Types.ObjectId().toString() })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .patch('/api/v1/organizations/current')
          .set('X-CSRF-Token', csrf)
          .send({
            organizationId: new mongoose.Types.ObjectId().toString(),
            name: 'Ignored',
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', csrf)
          .send({ organizationId: new mongoose.Types.ObjectId().toString() })
      ).status,
    ).toBe(404);
    await Membership.updateOne(
      { organizationId: created.body.data.organization.id },
      { $set: { status: 'deactivated' } },
    );
    expect((await agent.get('/api/v1/organizations/current')).status).toBe(404);
    expect(
      (
        await agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', csrf)
          .send({ organizationId: created.body.data.organization.id })
      ).status,
    ).toBe(404);
    expect((await agent.get('/api/v1/organizations')).body.data.items).toEqual(
      [],
    );
  });
  it('limits organization creation atomically under parallel requests', async () => {
    const { agent, csrf } = await loggedIn();
    const replies = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        agent
          .post('/api/v1/organizations')
          .set('X-CSRF-Token', csrf)
          .send({ name: `Org ${i}`, slug: `org-${i}` }),
      ),
    );
    expect(replies.filter((reply) => reply.status === 201)).toHaveLength(3);
    expect(await Organization.countDocuments()).toBe(3);
  });
  it('returns 429 at the per-user creation and switching limits', async () => {
    const account = await loggedIn();
    const organizationId = await createOrganization(account, 'Alpha');
    for (let index = 1; index < 5; index++)
      await account.agent
        .post('/api/v1/organizations')
        .set('X-CSRF-Token', account.csrf)
        .send({ name: `Extra ${index}`, slug: `extra-${index}` });
    const creationLimited = await account.agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', account.csrf)
      .send({ name: 'Extra 5', slug: 'extra-5' });
    expect(creationLimited.status).toBe(429);
    for (let index = 0; index < 5; index++)
      expect(
        (
          await account.agent
            .post('/api/v1/organizations/switch')
            .set('X-CSRF-Token', account.csrf)
            .send({ organizationId })
        ).status,
      ).toBe(200);
    const switchLimited = await account.agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', account.csrf)
      .send({ organizationId });
    expect(switchLimited.status).toBe(429);
  });
  it('writes lastSeenAt at most once within the configured interval', async () => {
    const account = await loggedIn();
    const session = await Session.findOne({ revokedAt: null });
    expect(session).toBeTruthy();
    await Session.updateOne(
      { _id: session!._id },
      { $set: { lastSeenAt: new Date(Date.now() - 600_000) } },
    );
    const updates = vi.spyOn(Session, 'updateOne');
    expect((await account.agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await account.agent.get('/api/v1/auth/me')).status).toBe(200);
    expect(
      updates.mock.calls.filter(([, change]) => {
        const update = change as { $set?: Record<string, unknown> };
        return Object.prototype.hasOwnProperty.call(
          update.$set ?? {},
          'lastSeenAt',
        );
      }),
    ).toHaveLength(1);
  });
  it('leaves the organization unset with several memberships and no remembered choice', async () => {
    const account = await loggedIn();
    await createOrganization(account, 'Alpha');
    await createOrganization(account, 'Beta');
    expect(
      (
        await account.agent
          .post('/api/v1/auth/logout')
          .set('X-CSRF-Token', account.csrf)
      ).status,
    ).toBe(200);
    const csrf = (await account.agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken as string;
    const login = await account.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({
        email: 'tenant@example.com',
        password: 'Strong testing password 34!',
      });
    expect(login.status).toBe(200);
    expect(login.body.data.session.activeOrganizationId).toBeNull();
  });
  it('selects a sole active organization at login and remembers an explicit switch', async () => {
    const { agent, csrf } = await loggedIn();
    const first = await agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'First', slug: 'first' });
    const firstId = first.body.data.organization.id as string;
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf);
    let nextCsrf = (await agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken as string;
    const sole = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', nextCsrf)
      .send({
        email: 'tenant@example.com',
        password: 'Strong testing password 34!',
      });
    expect(sole.body.data.session.activeOrganizationId).toBe(firstId);
    nextCsrf = (await agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken as string;
    const second = await agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', nextCsrf)
      .send({ name: 'Second', slug: 'second' });
    expect(second.status).toBe(201);
    await agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', nextCsrf)
      .send({ organizationId: second.body.data.organization.id });
    const refreshed = await agent
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Token', nextCsrf);
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    expect(refreshed.body.data.session.activeOrganizationId).toBe(
      second.body.data.organization.id,
    );
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', nextCsrf);
    nextCsrf = (await agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken as string;
    const remembered = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', nextCsrf)
      .send({
        email: 'tenant@example.com',
        password: 'Strong testing password 34!',
      });
    expect(remembered.body.data.session.activeOrganizationId).toBe(
      second.body.data.organization.id,
    );
  });
  it('rolls back organization creation if role seeding fails', async () => {
    const { agent, csrf } = await loggedIn();
    vi.spyOn(Role, 'create').mockRejectedValueOnce(new Error('seed failure'));
    expect(
      (
        await agent
          .post('/api/v1/organizations')
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Rollback', slug: 'rollback' })
      ).status,
    ).toBe(500);
    expect(await Organization.countDocuments()).toBe(0);
    expect((await User.findOne())?.organizationsCreatedCount).toBe(0);
  });
  it('enforces role ceilings, self-edit protection, and cross-tenant 404', async () => {
    const { agent, csrf } = await loggedIn();
    const a = await agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Alpha', slug: 'alpha' });
    const b = await agent
      .post('/api/v1/organizations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Beta', slug: 'beta' });
    const aId = a.body.data.organization.id as string;
    const bId = b.body.data.organization.id as string;
    const page = await agent.get('/api/v1/organizations').query({ limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.data.nextCursor).toBeTruthy();
    expect(
      (
        await agent
          .get('/api/v1/organizations')
          .query({ cursor: page.body.data.nextCursor, limit: 1 })
      ).body.data.items,
    ).toHaveLength(1);
    await agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', csrf)
      .send({ organizationId: aId });
    const created = await agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', csrf)
      .send({
        name: 'Operations',
        rank: 400,
        grants: { 'organization.view': 'Y', 'roles.manage': 'Y' },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const roleId = created.body.data.role.id as string;
    expect((await agent.get(`/api/v1/roles/${roleId}`)).status).toBe(200);
    expect(
      (
        await agent
          .patch(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Operations' })
      ).status,
    ).toBe(200);
    expect(
      (
        await agent
          .patch(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', csrf)
          .send({ rank: 500 })
      ).status,
    ).toBe(200);
    await agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', csrf)
      .send({ organizationId: bId });
    expect((await agent.get(`/api/v1/roles/${roleId}`)).status).toBe(404);
    expect(
      (
        await agent
          .patch(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Stolen' })
      ).status,
    ).toBe(404);
    expect(
      (await agent.delete(`/api/v1/roles/${roleId}`).set('X-CSRF-Token', csrf))
        .status,
    ).toBe(404);
    await agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', csrf)
      .send({ organizationId: aId });
    const memberRole = await Role.findOne({
      organizationId: aId,
      builtInKey: 'Member',
    });
    await Membership.updateOne(
      { organizationId: aId },
      { $set: { roleId: memberRole!._id } },
    );
    const current = await agent.get('/api/v1/organizations/current');
    expect(current.status).toBe(200);
    expect(current.body.data.organization.settings).toBeUndefined();
    expect(
      (
        await agent
          .patch('/api/v1/organizations/current')
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Denied' })
      ).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post('/api/v1/roles')
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Denied', rank: 100, grants: {} })
      ).status,
    ).toBe(403);
    await Membership.updateOne({ organizationId: aId }, { $set: { roleId } });
    expect(
      (
        await agent
          .patch(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Self-edit' })
      ).status,
    ).toBe(403);
  });
  it('rejects scope or rank escalation and editing a role at the actor rank', () => {
    const org = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const ctx = {
      userId: user,
      organizationId: org,
      membership: {
        _id: new mongoose.Types.ObjectId(),
        organizationId: org,
        userId: user,
        roleId: new mongoose.Types.ObjectId(),
        status: 'active',
      },
      role: {
        _id: new mongoose.Types.ObjectId(),
        rank: 300,
        builtInKey: 'Team Lead',
      },
    } as TenantContext;
    expect(() => assertRoleGrant(ctx, 300, {})).toThrow();
    expect(() =>
      assertRoleGrant(ctx, 200, { 'organization.manage': 'Y' }),
    ).toThrow();
    expect(() => assertRoleGrant(ctx, 200, { 'tasks.view': 'Y' })).toThrow();
    expect(() =>
      assertRoleGrant(ctx, 200, { 'tasks.view': 'S' }, { 'tasks.view': 'O' }),
    ).toThrow();
  });
  it('returns 404 for an invisible resource and 403 for a visible denied action, with a stub S resolver', async () => {
    const org = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const ctx = {
      userId: user,
      organizationId: org,
      membership: {
        _id: new mongoose.Types.ObjectId(),
        organizationId: org,
        userId: user,
        roleId: new mongoose.Types.ObjectId(),
        status: 'active',
      },
      role: {
        _id: new mongoose.Types.ObjectId(),
        rank: 300,
        builtInKey: 'Team Lead',
      },
    } as TenantContext;
    await expect(
      authorize(ctx, 'tasks.view', { organizationId: other, visible: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      authorize(ctx, 'tasks.view', { organizationId: org, visible: false }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      authorize(ctx, 'roles.manage', { organizationId: org, visible: true }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      authorize(
        ctx,
        'tasks.view',
        { organizationId: org, visible: true },
        async () => true,
      ),
    ).resolves.toEqual({ _id: { $in: [] } });
    const resourceId = new mongoose.Types.ObjectId();
    await expect(
      authorize(
        ctx,
        'tasks.view',
        {
          _id: resourceId,
          organizationId: org,
          projectId: new mongoose.Types.ObjectId(),
          visible: true,
        },
        async () => true,
      ),
    ).resolves.toEqual({ _id: resourceId });
  });
  it('requires verified email before organization creation', async () => {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data
      .csrfToken as string;
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set('X-CSRF-Token', csrf)
          .send({
            email: 'unverified@example.com',
            password: 'Strong testing password 34!',
            displayName: 'Unverified',
          })
      ).status,
    ).toBe(202);
    // A pending account has no session, so it cannot reach the organization route.
    expect(
      (
        await agent
          .post('/api/v1/organizations')
          .set('X-CSRF-Token', csrf)
          .send({ name: 'Pending', slug: 'pending' })
      ).status,
    ).toBe(401);
    expect(await Organization.countDocuments()).toBe(0);
  });
  it('isolates every organization and role route between two accounts', async () => {
    const a = await loggedIn('a@example.com');
    const b = await loggedIn('b@example.com');
    const aId = await createOrganization(a, 'Alpha');
    const bId = await createOrganization(b, 'Beta');
    expect(
      (
        await a.agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', a.csrf)
          .send({ organizationId: aId })
      ).status,
    ).toBe(200);
    expect(
      (
        await b.agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', b.csrf)
          .send({ organizationId: bId })
      ).status,
    ).toBe(200);
    const aRole = await a.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', a.csrf)
      .send({ name: 'Alpha Role', rank: 300, grants: { 'roles.view': 'Y' } });
    expect(aRole.status, JSON.stringify(aRole.body)).toBe(201);
    const aRoleId = aRole.body.data.role.id as string;
    const bRole = await b.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', b.csrf)
      .send({ name: 'Beta Role', rank: 300, grants: { 'roles.view': 'Y' } });
    expect(bRole.status, JSON.stringify(bRole.body)).toBe(201);
    const bRoleId = bRole.body.data.role.id as string;

    for (const [account, ownId, foreignId, ownRoleId, foreignRoleId] of [
      [a, aId, bId, aRoleId, bRoleId],
      [b, bId, aId, bRoleId, aRoleId],
    ] as const) {
      const mine = await account.agent.get('/api/v1/organizations');
      expect(mine.status).toBe(200);
      expect(mine.body.data.items.map((org: { id: string }) => org.id)).toEqual(
        [ownId],
      );
      expect(
        (
          await account.agent
            .post('/api/v1/organizations/switch')
            .set('X-CSRF-Token', account.csrf)
            .send({ organizationId: foreignId })
        ).status,
      ).toBe(404);
      expect(
        (await account.agent.get('/api/v1/organizations/current')).body.data
          .organization.id,
      ).toBe(ownId);
      expect(
        (
          await account.agent
            .get('/api/v1/organizations/current')
            .set('X-Organization-Id', foreignId)
        ).body.data.organization.id,
      ).toBe(ownId);
      const roles = await account.agent.get('/api/v1/roles');
      expect(roles.status).toBe(200);
      expect(
        roles.body.data.items.some(
          (role: { id: string }) => role.id === ownRoleId,
        ),
      ).toBe(true);
      expect(
        roles.body.data.items.some(
          (role: { id: string }) => role.id === foreignRoleId,
        ),
      ).toBe(false);
      expect(
        (await account.agent.get(`/api/v1/roles/${foreignRoleId}`)).status,
      ).toBe(404);
      expect(
        (
          await account.agent
            .patch(`/api/v1/roles/${foreignRoleId}`)
            .set('X-CSRF-Token', account.csrf)
            .send({ name: 'Stolen' })
        ).status,
      ).toBe(404);
      expect(
        (
          await account.agent
            .delete(`/api/v1/roles/${foreignRoleId}`)
            .set('X-CSRF-Token', account.csrf)
        ).status,
      ).toBe(404);
      expect(
        (
          await account.agent
            .patch('/api/v1/organizations/current')
            .set('X-CSRF-Token', account.csrf)
            .send({ name: 'Safe', organizationId: foreignId })
        ).status,
      ).toBe(400);
      expect(
        (
          await account.agent
            .post('/api/v1/roles')
            .set('X-CSRF-Token', account.csrf)
            .send({
              name: 'Injected',
              rank: 200,
              grants: {},
              organizationId: foreignId,
            })
        ).status,
      ).toBe(400);
      expect(
        (
          await account.agent
            .post('/api/v1/organizations')
            .set('X-CSRF-Token', account.csrf)
            .send({
              name: 'Injected',
              slug: 'injected',
              organizationId: foreignId,
            })
        ).status,
      ).toBe(400);
    }
    expect((await Role.findById(aRoleId))?.name).toBe('Alpha Role');
    expect((await Role.findById(bRoleId))?.name).toBe('Beta Role');
  });
  it('denies tenant reads and writes when the active custom role lacks grants', async () => {
    const account = await loggedIn();
    const organizationId = await createOrganization(account, 'Alpha');
    expect(
      (
        await account.agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', account.csrf)
          .send({ organizationId })
      ).status,
    ).toBe(200);
    const created = await account.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', account.csrf)
      .send({ name: 'No Access', rank: 100, grants: {} });
    expect(created.status).toBe(201);
    const roleId = created.body.data.role.id as string;
    await Membership.updateOne(
      { organizationId },
      { $set: { roleId: new mongoose.Types.ObjectId(roleId) } },
    );
    for (const path of [
      '/api/v1/organizations/current',
      '/api/v1/roles',
      `/api/v1/roles/${roleId}`,
    ])
      expect((await account.agent.get(path)).status).toBe(403);
    expect(
      (
        await account.agent
          .patch('/api/v1/organizations/current')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Forbidden' })
      ).status,
    ).toBe(403);
    expect(
      (
        await account.agent
          .post('/api/v1/roles')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Forbidden', rank: 1, grants: {} })
      ).status,
    ).toBe(403);
    expect(
      (
        await account.agent
          .patch(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Forbidden' })
      ).status,
    ).toBe(403);
    expect(
      (
        await account.agent
          .delete(`/api/v1/roles/${roleId}`)
          .set('X-CSRF-Token', account.csrf)
      ).status,
    ).toBe(403);
  });
  it('validates tenant inputs and keeps built-in and assigned roles immutable', async () => {
    const account = await loggedIn();
    expect(
      (
        await account.agent
          .post('/api/v1/organizations')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Reserved', slug: 'admin' })
      ).status,
    ).toBe(400);
    const organizationId = await createOrganization(account, 'Alpha');
    expect(
      (
        await account.agent
          .post('/api/v1/organizations')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Duplicate', slug: 'alpha' })
      ).status,
    ).toBe(409);
    expect(
      (
        await account.agent
          .post('/api/v1/organizations/switch')
          .set('X-CSRF-Token', account.csrf)
          .send({ organizationId })
      ).status,
    ).toBe(200);
    expect(
      (await account.agent.get('/api/v1/roles').query({ limit: 0 })).status,
    ).toBe(400);
    expect((await account.agent.get('/api/v1/roles/not-an-id')).status).toBe(
      400,
    );
    expect(
      (
        await account.agent
          .patch('/api/v1/organizations/current')
          .set('X-CSRF-Token', account.csrf)
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await account.agent
          .post('/api/v1/roles')
          .set('X-CSRF-Token', account.csrf)
          .send({
            name: 'Invalid Grant',
            rank: 200,
            grants: { 'unknown.key': 'Y' },
          })
      ).status,
    ).toBe(400);
    const owner = await Role.findOne({ organizationId, builtInKey: 'Owner' });
    expect(owner).toBeTruthy();
    expect(
      (
        await account.agent
          .patch(`/api/v1/roles/${owner!._id}`)
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Altered Owner' })
      ).status,
    ).toBe(403);
    expect(
      (
        await account.agent
          .delete(`/api/v1/roles/${owner!._id}`)
          .set('X-CSRF-Token', account.csrf)
      ).status,
    ).toBe(403);
    const custom = await account.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', account.csrf)
      .send({ name: 'Assigned', rank: 200, grants: {} });
    expect(custom.status).toBe(201);
    const customId = custom.body.data.role.id as string;
    await Membership.create({
      organizationId,
      userId: new mongoose.Types.ObjectId(),
      roleId: new mongoose.Types.ObjectId(customId),
      status: 'active',
      joinedAt: new Date(),
    });
    expect(
      (
        await account.agent
          .delete(`/api/v1/roles/${customId}`)
          .set('X-CSRF-Token', account.csrf)
      ).status,
    ).toBe(409);
    expect((await Role.findById(customId))?.deletedAt).toBeNull();
  });
  it('applies scoped permission filters to role lists and single-resource actions', async () => {
    const account = await loggedIn();
    const organizationId = await createOrganization(account, 'Alpha');
    await account.agent
      .post('/api/v1/organizations/switch')
      .set('X-CSRF-Token', account.csrf)
      .send({ organizationId });
    const created = await account.agent
      .post('/api/v1/roles')
      .set('X-CSRF-Token', account.csrf)
      .send({
        name: 'Scoped',
        rank: 200,
        grants: {
          'roles.view': 'S',
          'roles.manage': 'S',
          'organization.view': 'Y',
          'organization.manage': 'S',
        },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const roleId = created.body.data.role.id as string;
    await Membership.updateOne(
      { organizationId },
      { $set: { roleId: new mongoose.Types.ObjectId(roleId) } },
    );
    const list = await account.agent.get('/api/v1/roles');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.items).toEqual([]);
    expect((await account.agent.get(`/api/v1/roles/${roleId}`)).status).toBe(
      403,
    );
    const current = await account.agent.get('/api/v1/organizations/current');
    expect(current.status).toBe(200);
    expect(current.body.data.organization.settings).toBeUndefined();
    expect(
      (
        await account.agent
          .patch('/api/v1/organizations/current')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Excess' })
      ).status,
    ).toBe(403);
    expect(
      (
        await account.agent
          .post('/api/v1/roles')
          .set('X-CSRF-Token', account.csrf)
          .send({ name: 'Excess', rank: 100, grants: {} })
      ).status,
    ).toBe(403);
  });
});
