import mongoose from 'mongoose';
import type { Model, PipelineStage } from 'mongoose';
import { connectToDatabase } from '../../lib/db.js';
import { Membership, Organization, Role, TenantAudit } from './models.js';
import { User, Session } from '../auth/models.js';
import {
  roleKeys,
  roleRanks,
  type PermissionKey,
  type Scope,
} from '@kaaryasthan/shared';
import { AppError, NotFoundError } from '../../errors/app-error.js';

export async function activeMembershipsForUser(
  userId: mongoose.Types.ObjectId,
  limit = 100,
) {
  await connectToDatabase();
  return Membership.find({ userId, status: 'active' })
    .sort({ _id: 1 })
    .limit(limit);
}
export async function findActiveMembership(
  userId: mongoose.Types.ObjectId,
  organizationId: mongoose.Types.ObjectId,
) {
  const membership = await tenantRepository(
    Membership,
    organizationId,
    false,
  ).findOne({ userId, status: 'active' });
  if (!membership) return null;
  const role = await tenantRepository(Role, organizationId).findOne({
    _id: membership.roleId,
  });
  return role ? { membership, role } : null;
}
export async function createOrganizationRecords(
  userId: mongoose.Types.ObjectId,
  input: {
    name: string;
    slug: string;
    settings?: { timezone?: string; locale?: string };
  },
  max: number,
  requestId: string,
) {
  await connectToDatabase();
  const now = new Date();
  try {
    return await mongoose.connection.transaction(async (session) => {
      const claimed = await User.updateOne(
        {
          _id: userId,
          status: 'active',
          verifiedAt: mongoose.trusted({ $ne: null }),
          $or: [
            { organizationsCreatedCount: mongoose.trusted({ $lt: max }) },
            { organizationsCreatedCount: mongoose.trusted({ $exists: false }) },
          ],
        },
        { $inc: { organizationsCreatedCount: 1 } },
        { session },
      );
      if (claimed.modifiedCount !== 1)
        throw new AppError(
          403,
          'ORGANIZATION_LIMIT',
          'Organization creation unavailable',
        );
      const [organization] = await Organization.create(
        [
          {
            slug: input.slug,
            name: input.name,
            ownerId: userId,
            settings: input.settings ?? {},
            deletedAt: null,
          },
        ],
        { session },
      );
      const seeded = await Role.create(
        roleKeys.map((key) => ({
          organizationId: organization!._id,
          name: key,
          nameCanonical: key.toLowerCase(),
          builtInKey: key,
          rank: roleRanks[key],
          deletedAt: null,
        })),
        { session, ordered: true },
      );
      const owner = seeded.find((role) => role.builtInKey === 'Owner');
      if (!owner) throw new Error('Owner role seed failed');
      const [membership] = await Membership.create(
        [
          {
            organizationId: organization!._id,
            userId,
            roleId: owner._id,
            status: 'active',
            joinedAt: now,
          },
        ],
        { session },
      );
      await TenantAudit.create(
        [
          {
            organizationId: organization!._id,
            actorId: userId,
            event: 'organization.created',
            subjectId: organization!._id,
            outcome: 'success',
            requestId,
            occurredAt: now,
          },
        ],
        { session },
      );
      return { organization: organization!, membership: membership! };
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new AppError(409, 'SLUG_TAKEN', 'Slug unavailable');
    throw error;
  }
}
export async function listMyOrganizations(
  userId: mongoose.Types.ObjectId,
  cursor?: mongoose.Types.ObjectId,
  limit = 50,
) {
  await connectToDatabase();
  const memberships = await Membership.find({
    userId,
    status: 'active',
    ...(cursor ? { _id: mongoose.trusted({ $gt: cursor }) } : {}),
  })
    .sort({ _id: 1 })
    .limit(limit + 1);
  const page = memberships.slice(0, limit);
  const organizations = await Organization.find({
    _id: mongoose.trusted({ $in: page.map((entry) => entry.organizationId) }),
    deletedAt: mongoose.trusted({ $type: 'null' }),
  });
  const byId = new Map(organizations.map((org) => [String(org._id), org]));
  return {
    items: page.flatMap((membership) => {
      const org = byId.get(String(membership.organizationId));
      return org ? [org] : [];
    }),
    nextCursor: memberships.length > limit ? String(page.at(-1)!._id) : null,
  };
}
export async function getOrganization(organizationId: mongoose.Types.ObjectId) {
  await connectToDatabase();
  const organization = await Organization.findOne({
    _id: organizationId,
    deletedAt: mongoose.trusted({ $type: 'null' }),
  });
  if (!organization) throw new NotFoundError();
  return organization;
}
export async function updateOrganization(
  organizationId: mongoose.Types.ObjectId,
  input: { name?: string; settings?: { timezone?: string; locale?: string } },
  actorId: mongoose.Types.ObjectId,
  requestId: string,
) {
  await connectToDatabase();
  const changes: Record<string, unknown> = {};
  if (input.name) changes.name = input.name;
  if (input.settings?.timezone)
    changes['settings.timezone'] = input.settings.timezone;
  if (input.settings?.locale)
    changes['settings.locale'] = input.settings.locale;
  const organization = await Organization.findOneAndUpdate(
    { _id: organizationId, deletedAt: mongoose.trusted({ $type: 'null' }) },
    { $set: changes },
    { returnDocument: 'after' },
  );
  if (!organization) throw new NotFoundError();
  await writeTenantAudit(
    organizationId,
    actorId,
    'organization.updated',
    organizationId,
    requestId,
  );
  return organization;
}
export async function switchActiveOrganization(
  sessionId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  organizationId: mongoose.Types.ObjectId,
  requestId: string,
) {
  await connectToDatabase();
  const membership = await tenantRepository(
    Membership,
    organizationId,
    false,
  ).findOne({ userId, status: 'active' });
  if (!membership) throw new NotFoundError();
  const organization = await getOrganization(organizationId);
  await mongoose.connection.transaction(async (session) => {
    const current = await Membership.findOne({
      _id: membership._id,
      organizationId,
      userId,
      status: 'active',
    }).session(session);
    if (!current) throw new NotFoundError();
    const updated = await Session.updateOne(
      { _id: sessionId, userId, revokedAt: null },
      { $set: { activeOrganizationId: organizationId } },
      { session },
    );
    if (updated.modifiedCount !== 1 && updated.matchedCount !== 1)
      throw new NotFoundError();
    await User.updateOne(
      { _id: userId },
      { $set: { lastUsedOrganizationId: organizationId } },
      { session },
    );
    await TenantAudit.create(
      [
        {
          organizationId,
          actorId: userId,
          event: 'membership.organization_switched',
          subjectId: membership._id,
          outcome: 'success',
          requestId,
          occurredAt: new Date(),
        },
      ],
      { session },
    );
  });
  return organization;
}
export async function writeTenantAudit(
  organizationId: mongoose.Types.ObjectId,
  actorId: mongoose.Types.ObjectId,
  event: string,
  subjectId: mongoose.Types.ObjectId,
  requestId: string,
) {
  await connectToDatabase();
  await TenantAudit.create({
    organizationId,
    actorId,
    event,
    subjectId,
    outcome: 'success',
    requestId,
    occurredAt: new Date(),
  });
}
export async function roleById(
  organizationId: mongoose.Types.ObjectId,
  roleId: mongoose.Types.ObjectId,
) {
  const role = await tenantRepository(Role, organizationId).findOne({
    _id: roleId,
  });
  if (!role) throw new NotFoundError();
  return role;
}
export async function listRoles(
  organizationId: mongoose.Types.ObjectId,
  cursor?: mongoose.Types.ObjectId,
  limit = 50,
) {
  const rows = await tenantRepository(Role, organizationId).list(
    {},
    cursor ? { _id: mongoose.trusted({ $gt: cursor }) } : {},
    limit + 1,
  );
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? String(rows[limit - 1]!._id) : null,
  };
}
export async function createCustomRole(
  organizationId: mongoose.Types.ObjectId,
  actorId: mongoose.Types.ObjectId,
  input: {
    name: string;
    rank: number;
    grants: Partial<Record<PermissionKey, Scope>>;
  },
  ceiling: Partial<Record<PermissionKey, Scope>>,
  actorRank: number,
  requestId: string,
) {
  await connectToDatabase();
  try {
    const [role] = await Role.create([
      {
        organizationId,
        name: input.name,
        nameCanonical: input.name.trim().toLowerCase(),
        rank: input.rank,
        grants: input.grants,
        creatorId: actorId,
        creatorCeiling: ceiling,
        creatorRankCeiling: actorRank,
        deletedAt: null,
      },
    ]);
    await writeTenantAudit(
      organizationId,
      actorId,
      'role.created',
      role!._id,
      requestId,
    );
    return role!;
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new AppError(409, 'ROLE_NAME_TAKEN', 'Role name unavailable');
    throw error;
  }
}
export async function updateCustomRole(
  organizationId: mongoose.Types.ObjectId,
  roleId: mongoose.Types.ObjectId,
  actorId: mongoose.Types.ObjectId,
  input: {
    name?: string;
    rank?: number;
    grants?: Partial<Record<PermissionKey, Scope>>;
  },
  requestId: string,
) {
  const changes: Record<string, unknown> = {};
  if (input.name) {
    changes.name = input.name;
    changes.nameCanonical = input.name.trim().toLowerCase();
  }
  if (input.rank !== undefined) changes.rank = input.rank;
  if (input.grants) changes.grants = input.grants;
  const role = await tenantRepository(Role, organizationId).updateOne(
    { _id: roleId, builtInKey: null },
    changes,
  );
  if (role.matchedCount !== 1) throw new NotFoundError();
  await writeTenantAudit(
    organizationId,
    actorId,
    'role.updated',
    roleId,
    requestId,
  );
  return roleById(organizationId, roleId);
}
export async function deleteCustomRole(
  organizationId: mongoose.Types.ObjectId,
  roleId: mongoose.Types.ObjectId,
  actorId: mongoose.Types.ObjectId,
  requestId: string,
) {
  const used = await tenantRepository(
    Membership,
    organizationId,
    false,
  ).findOne({ roleId, status: 'active' });
  if (used) throw new AppError(409, 'ROLE_IN_USE', 'Role is assigned');
  const result = await tenantRepository(Role, organizationId).softDelete({
    _id: roleId,
    builtInKey: null,
  });
  if (result.modifiedCount !== 1) throw new NotFoundError();
  await writeTenantAudit(
    organizationId,
    actorId,
    'role.deleted',
    roleId,
    requestId,
  );
}

export function rejectClientOperators(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.'))
      throw new Error('Unsafe client filter');
    rejectClientOperators(child);
  }
}

export function tenantQuery(
  organizationId: mongoose.Types.ObjectId,
  clientFilter: Record<string, unknown> = {},
  scopeFilter: Record<string, unknown> = {},
  softDelete = true,
) {
  rejectClientOperators(clientFilter);
  return mongoose.trusted({
    $and: [
      { organizationId },
      ...(softDelete
        ? [{ deletedAt: mongoose.trusted({ $type: 'null' }) }]
        : []),
      clientFilter,
      mongoose.trusted(scopeFilter),
    ],
  });
}

export function tenantRepository<T extends object>(
  model: Model<T>,
  organizationId: mongoose.Types.ObjectId,
  softDelete = true,
) {
  return {
    async findOne(
      clientFilter: Record<string, unknown> = {},
      scopeFilter: Record<string, unknown> = {},
    ) {
      await connectToDatabase();
      return model.findOne(
        tenantQuery(organizationId, clientFilter, scopeFilter, softDelete),
      );
    },
    async list(
      clientFilter: Record<string, unknown> = {},
      scopeFilter: Record<string, unknown> = {},
      limit = 50,
    ) {
      await connectToDatabase();
      return model
        .find(
          tenantQuery(organizationId, clientFilter, scopeFilter, softDelete),
        )
        .sort({ _id: 1 })
        .limit(Math.min(101, Math.max(1, limit)));
    },
    async updateOne(
      clientFilter: Record<string, unknown>,
      changes: Record<string, unknown>,
      scopeFilter: Record<string, unknown> = {},
    ) {
      rejectClientOperators(clientFilter);
      rejectClientOperators(changes);
      if ('organizationId' in changes || 'deletedAt' in changes)
        throw new Error('Immutable tenant fields');
      await connectToDatabase();
      return model.updateOne(
        tenantQuery(organizationId, clientFilter, scopeFilter, softDelete),
        { $set: changes },
      );
    },
    async softDelete(
      clientFilter: Record<string, unknown>,
      scopeFilter: Record<string, unknown> = {},
    ) {
      rejectClientOperators(clientFilter);
      if (!softDelete) throw new Error('Not soft deletable');
      await connectToDatabase();
      return model.updateOne(
        tenantQuery(organizationId, clientFilter, scopeFilter),
        { $set: { deletedAt: new Date() } },
      );
    },
  };
}

const tenantLookupCollections = new Set(['memberships', 'roles', 'auditLogs']);
function constrainedPipeline(
  pipeline: PipelineStage[],
  organizationId: mongoose.Types.ObjectId,
): PipelineStage[] {
  return pipeline.map((stage) => {
    const object = stage as unknown as Record<string, unknown>;
    if ('$lookup' in object) {
      const lookup = object.$lookup as {
        from?: string;
        pipeline?: PipelineStage[];
        let?: Record<string, unknown>;
        as?: string;
      };
      if (
        !lookup.from ||
        !tenantLookupCollections.has(lookup.from) ||
        !Array.isArray(lookup.pipeline) ||
        !lookup.as ||
        'localField' in lookup ||
        'foreignField' in lookup
      )
        throw new Error('Unsafe lookup');
      return {
        $lookup: {
          from: lookup.from,
          let: lookup.let ?? {},
          pipeline: [
            { $match: { organizationId } },
            ...constrainedPipeline(lookup.pipeline, organizationId),
          ],
          as: lookup.as,
        },
      } as PipelineStage;
    }
    if (
      Object.keys(object).length !== 1 ||
      !Object.keys(object).every((key) =>
        [
          '$match',
          '$group',
          '$project',
          '$sort',
          '$limit',
          '$skip',
          '$unwind',
          '$count',
        ].includes(key),
      )
    )
      throw new Error('Unsafe aggregation stage');
    return stage;
  });
}
export async function tenantAggregate<T extends object>(
  model: Model<T>,
  organizationId: mongoose.Types.ObjectId,
  pipeline: PipelineStage[],
  softDelete = true,
) {
  await connectToDatabase();
  return model.aggregate([
    {
      $match: {
        organizationId,
        ...(softDelete ? { deletedAt: { $type: 'null' } } : {}),
      },
    },
    ...constrainedPipeline(pipeline, organizationId),
  ]);
}
