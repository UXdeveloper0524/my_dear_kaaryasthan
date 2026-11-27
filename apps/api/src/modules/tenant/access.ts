import mongoose from 'mongoose';
import {
  builtInGrants,
  canGrantScope,
  type PermissionKey,
  type Scope,
} from '@kaaryasthan/shared';
import { ForbiddenError, NotFoundError } from '../../errors/app-error.js';
import {
  activeMembershipsForUser,
  findActiveMembership,
} from './repository.js';

export type RoleView = {
  _id: mongoose.Types.ObjectId;
  rank: number;
  builtInKey?: string | null;
  grants?: unknown;
  creatorCeiling?: unknown;
  creatorRankCeiling?: number | null;
  creatorId?: mongoose.Types.ObjectId | null;
};
export type MembershipView = {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  roleId: mongoose.Types.ObjectId;
  status: string;
};
export type TenantContext = {
  userId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  membership: MembershipView;
  role: RoleView;
};
export type Resource = {
  _id?: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  visible: boolean;
  ownerId?: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
};
export type ScopeResolver = (
  context: TenantContext,
  resource: Resource,
) => Promise<boolean>;
export const denyScopedResource: ScopeResolver = async () => false;

export function grantsFor(
  role: RoleView,
): Partial<Record<PermissionKey, Scope>> {
  return role.builtInKey
    ? builtInGrants(role.builtInKey as Parameters<typeof builtInGrants>[0])
    : ((role.grants ?? {}) as Partial<Record<PermissionKey, Scope>>);
}
export async function activeMembership(
  userId: mongoose.Types.ObjectId,
  organizationId: mongoose.Types.ObjectId,
) {
  return findActiveMembership(userId, organizationId);
}
export async function chooseOrganization(
  userId: mongoose.Types.ObjectId,
  remembered?: mongoose.Types.ObjectId | null,
): Promise<mongoose.Types.ObjectId | null> {
  if (remembered && (await activeMembership(userId, remembered)))
    return remembered;
  const rows = await activeMembershipsForUser(userId, 2);
  return rows.length === 1 ? rows[0]!.organizationId : null;
}
export async function authorize(
  context: TenantContext,
  key: PermissionKey,
  resource?: Resource,
  resolveS: ScopeResolver = denyScopedResource,
): Promise<Record<string, unknown>> {
  if (context.membership.status !== 'active') throw new ForbiddenError();
  if (
    resource &&
    (String(resource.organizationId) !== String(context.organizationId) ||
      !resource.visible)
  )
    throw new NotFoundError();
  const scope = grantsFor(context.role)[key];
  if (!scope) throw new ForbiddenError();
  if (!resource) return scope === 'Y' ? {} : { _id: { $in: [] } };
  if (scope === 'Y') return {};
  if (scope === 'O' && String(resource.ownerId) === String(context.userId))
    return { ownerId: context.userId };
  if (scope === 'S') {
    if (
      resource.assigneeId &&
      String(resource.assigneeId) === String(context.userId)
    )
      return { assigneeId: context.userId };
    if (await resolveS(context, resource))
      return resource._id ? { _id: resource._id } : { _id: { $in: [] } };
  }
  throw new ForbiddenError();
}
export function assertRoleGrant(
  actor: TenantContext,
  targetRank: number,
  proposed: Partial<Record<PermissionKey, Scope>>,
  creatorCeiling?: Partial<Record<PermissionKey, Scope>>,
  creatorRankCeiling?: number | null,
): void {
  if (
    targetRank >= actor.role.rank ||
    (creatorRankCeiling !== undefined &&
      creatorRankCeiling !== null &&
      targetRank >= creatorRankCeiling)
  )
    throw new ForbiddenError();
  const own = grantsFor(actor.role);
  for (const [key, scope] of Object.entries(proposed) as [
    PermissionKey,
    Scope,
  ][]) {
    if (
      !own[key] ||
      !canGrantScope(own[key], scope) ||
      (creatorCeiling &&
        (!creatorCeiling[key] || !canGrantScope(creatorCeiling[key], scope)))
    )
      throw new ForbiddenError();
  }
}
