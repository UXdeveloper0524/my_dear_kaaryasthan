import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { readEnv } from '../../config/env.js';
import { ForbiddenError, NotFoundError } from '../../errors/app-error.js';
import { limitUser } from '../../middleware/auth-rate-limit.js';
import {
  authorize,
  assertRoleGrant,
  grantsFor,
  type TenantContext,
} from './access.js';
import * as repo from './repository.js';
import type { PermissionKey, Scope } from '@kaaryasthan/shared';

function auth(response: Response) {
  return response.locals.auth as {
    user: { _id: mongoose.Types.ObjectId; verifiedAt?: Date | null };
    session: {
      _id: mongoose.Types.ObjectId;
      activeOrganizationId?: mongoose.Types.ObjectId | null;
    };
    membership: TenantContext['membership'] | null;
    role: TenantContext['role'] | null;
  };
}
function context(response: Response): TenantContext {
  const { user, session, membership, role } = auth(response);
  if (!session.activeOrganizationId || !membership || !role)
    throw new NotFoundError();
  return {
    userId: user._id,
    organizationId: session.activeOrganizationId,
    membership,
    role,
  };
}
function send(
  response: Response,
  data: unknown,
  meta: unknown = null,
  status = 200,
) {
  response.status(status).json({ data, meta, error: null });
}
function requestId(response: Response) {
  return String(response.locals.requestId ?? 'unknown');
}
function oid(value: string) {
  return new mongoose.Types.ObjectId(value);
}
async function authorizeUnscoped(
  ctx: TenantContext,
  permission: PermissionKey,
) {
  const filter = await authorize(ctx, permission);
  if (Object.keys(filter).length > 0) throw new ForbiddenError();
}
function organizationView(
  org: {
    _id: mongoose.Types.ObjectId;
    name: string;
    slug: string;
    branding?: { logoUrl?: string | null; primaryColor?: string | null } | null;
    settings?: { timezone?: string; locale?: string } | null;
  },
  includeSettings = false,
) {
  return {
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    branding: {
      logoUrl: org.branding?.logoUrl ?? null,
      primaryColor: org.branding?.primaryColor ?? null,
    },
    ...(includeSettings ? { settings: org.settings } : {}),
  };
}
function roleView(role: TenantContext['role'] & { name: string }) {
  return {
    id: String(role._id),
    name: role.name,
    rank: role.rank,
    builtInKey: role.builtInKey ?? null,
    grants: grantsFor(role),
  };
}

export async function createOrganization(request: Request, response: Response) {
  const { user } = auth(response);
  if (!user.verifiedAt) throw new ForbiddenError();
  await limitUser(
    String(user._id),
    'organization-create',
    request.ip ?? 'unknown',
  );
  const { organization } = await repo.createOrganizationRecords(
    user._id,
    request.body,
    readEnv().MAX_ORGANIZATIONS_PER_USER,
    requestId(response),
  );
  send(
    response,
    {
      organization: organizationView(organization, true),
      membership: { role: 'Owner' },
    },
    null,
    201,
  );
}
export async function listOrganizations(_request: Request, response: Response) {
  const { user } = auth(response);
  const { cursor, limit } = response.locals.query as {
    cursor?: string;
    limit: number;
  };
  const result = await repo.listMyOrganizations(
    user._id,
    cursor ? oid(cursor) : undefined,
    limit,
  );
  send(response, {
    items: result.items.map((org) => organizationView(org)),
    nextCursor: result.nextCursor,
  });
}
export async function currentOrganization(
  _request: Request,
  response: Response,
) {
  const ctx = context(response);
  const org = await repo.getOrganization(ctx.organizationId);
  await authorize(ctx, 'organization.view', {
    organizationId: org._id,
    ownerId: org.ownerId,
    visible: true,
  });
  const manageScope = grantsFor(ctx.role)['organization.manage'];
  const canManage =
    manageScope === 'Y' ||
    (manageScope === 'O' && String(org.ownerId) === String(ctx.userId));
  send(response, {
    organization: organizationView(org, canManage),
    membership: { roleId: String(ctx.membership.roleId) },
    role: roleView(ctx.role as TenantContext['role'] & { name: string }),
  });
}
export async function updateOrganization(request: Request, response: Response) {
  const ctx = context(response);
  const current = await repo.getOrganization(ctx.organizationId);
  await authorize(ctx, 'organization.manage', {
    organizationId: current._id,
    ownerId: current.ownerId,
    visible: true,
  });
  const org = await repo.updateOrganization(
    ctx.organizationId,
    request.body,
    ctx.userId,
    requestId(response),
  );
  send(response, { organization: organizationView(org, true) });
}
export async function switchOrganization(request: Request, response: Response) {
  const { user, session } = auth(response);
  await limitUser(
    String(user._id),
    'organization-switch',
    request.ip ?? 'unknown',
  );
  const orgId = oid(request.body.organizationId);
  const org = await repo.switchActiveOrganization(
    session._id,
    user._id,
    orgId,
    requestId(response),
  );
  send(response, {
    activeOrganizationId: String(orgId),
    organization: organizationView(org),
  });
}
export async function listRoles(_request: Request, response: Response) {
  const ctx = context(response);
  const scopeFilter = await authorize(ctx, 'roles.view');
  if (Object.keys(scopeFilter).length > 0) {
    send(response, { items: [], nextCursor: null });
    return;
  }
  const { cursor, limit } = response.locals.query as {
    cursor?: string;
    limit: number;
  };
  const result = await repo.listRoles(
    ctx.organizationId,
    cursor ? oid(cursor) : undefined,
    limit,
  );
  send(response, {
    items: result.items.map((role) =>
      roleView(role as typeof role & { name: string }),
    ),
    nextCursor: result.nextCursor,
  });
}
export async function getRole(_request: Request, response: Response) {
  const ctx = context(response);
  const { roleId } = response.locals.params as { roleId: string };
  const role = await repo.roleById(ctx.organizationId, oid(roleId));
  await authorize(ctx, 'roles.view', {
    organizationId: role.organizationId,
    visible: true,
  });
  send(response, { role: roleView(role as typeof role & { name: string }) });
}
export async function createRole(request: Request, response: Response) {
  const ctx = context(response);
  await authorizeUnscoped(ctx, 'roles.manage');
  assertRoleGrant(ctx, request.body.rank, request.body.grants);
  const role = await repo.createCustomRole(
    ctx.organizationId,
    ctx.userId,
    request.body,
    grantsFor(ctx.role),
    ctx.role.rank,
    requestId(response),
  );
  send(
    response,
    { role: roleView(role as typeof role & { name: string }) },
    null,
    201,
  );
}
export async function updateRole(request: Request, response: Response) {
  const ctx = context(response);
  const { roleId } = response.locals.params as { roleId: string };
  const role = await repo.roleById(ctx.organizationId, oid(roleId));
  await authorize(ctx, 'roles.manage', {
    organizationId: role.organizationId,
    visible: true,
  });
  if (role.builtInKey || String(role._id) === String(ctx.role._id))
    throw new ForbiddenError();
  const grants = (request.body.grants ?? role.grants ?? {}) as Partial<
    Record<PermissionKey, Scope>
  >;
  assertRoleGrant(
    ctx,
    request.body.rank ?? role.rank,
    grants,
    role.creatorCeiling as Partial<Record<PermissionKey, Scope>>,
    role.creatorRankCeiling,
  );
  const updated = await repo.updateCustomRole(
    ctx.organizationId,
    role._id,
    ctx.userId,
    request.body,
    requestId(response),
  );
  send(response, {
    role: roleView(updated as typeof updated & { name: string }),
  });
}
export async function deleteRole(_request: Request, response: Response) {
  const ctx = context(response);
  const { roleId } = response.locals.params as { roleId: string };
  const role = await repo.roleById(ctx.organizationId, oid(roleId));
  await authorize(ctx, 'roles.manage', {
    organizationId: role.organizationId,
    visible: true,
  });
  if (
    role.builtInKey ||
    String(role._id) === String(ctx.role._id) ||
    role.rank >= ctx.role.rank
  )
    throw new ForbiddenError();
  await repo.deleteCustomRole(
    ctx.organizationId,
    role._id,
    ctx.userId,
    requestId(response),
  );
  send(response, { deleted: true });
}
