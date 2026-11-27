import { Router } from 'express';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  switchOrganizationSchema,
  createRoleSchema,
  updateRoleSchema,
  roleIdSchema,
  cursorQuerySchema,
} from '@kaaryasthan/shared';
import { requireAuth } from '../../middleware/auth-session.js';
import { requireCsrf } from '../../middleware/auth-csrf.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  registerRoute,
  type RoutePolicy,
} from '../../middleware/route-policy.js';

export const tenantRoutePermissions = {
  'POST /organizations': 'verified-user',
  'GET /organizations': 'active-memberships',
  'GET /organizations/current': 'organization.view',
  'PATCH /organizations/current': 'organization.manage',
  'POST /organizations/switch': 'active-membership',
  'GET /roles': 'roles.view',
  'POST /roles': 'roles.manage',
  'GET /roles/:roleId': 'roles.view',
  'PATCH /roles/:roleId': 'roles.manage',
  'DELETE /roles/:roleId': 'roles.manage',
} as const;
const accountPolicy = { kind: 'account' } as const;
function tenantPolicy(
  permission: Extract<RoutePolicy, { kind: 'tenant' }>['permission'],
): RoutePolicy {
  return { kind: 'tenant', permission };
}

export const tenantRoutes = Router();
tenantRoutes.use((request, _response, next) =>
  ['organizations', 'roles'].includes(request.path.split('/')[1] ?? '')
    ? next()
    : next('router'),
);
tenantRoutes.use(requireAuth);
registerRoute(
  tenantRoutes,
  'post',
  '/organizations',
  accountPolicy,
  requireCsrf,
  validateBody(createOrganizationSchema),
  controller.createOrganization,
);
registerRoute(
  tenantRoutes,
  'get',
  '/organizations',
  accountPolicy,
  validateQuery(cursorQuerySchema),
  controller.listOrganizations,
);
registerRoute(
  tenantRoutes,
  'get',
  '/organizations/current',
  tenantPolicy(tenantRoutePermissions['GET /organizations/current']),
  controller.currentOrganization,
);
registerRoute(
  tenantRoutes,
  'patch',
  '/organizations/current',
  tenantPolicy(tenantRoutePermissions['PATCH /organizations/current']),
  requireCsrf,
  validateBody(updateOrganizationSchema),
  controller.updateOrganization,
);
registerRoute(
  tenantRoutes,
  'post',
  '/organizations/switch',
  accountPolicy,
  requireCsrf,
  validateBody(switchOrganizationSchema),
  controller.switchOrganization,
);
registerRoute(
  tenantRoutes,
  'get',
  '/roles',
  tenantPolicy(tenantRoutePermissions['GET /roles']),
  validateQuery(cursorQuerySchema),
  controller.listRoles,
);
registerRoute(
  tenantRoutes,
  'post',
  '/roles',
  tenantPolicy(tenantRoutePermissions['POST /roles']),
  requireCsrf,
  validateBody(createRoleSchema),
  controller.createRole,
);
registerRoute(
  tenantRoutes,
  'get',
  '/roles/:roleId',
  tenantPolicy(tenantRoutePermissions['GET /roles/:roleId']),
  validateParams(roleIdSchema),
  controller.getRole,
);
registerRoute(
  tenantRoutes,
  'patch',
  '/roles/:roleId',
  tenantPolicy(tenantRoutePermissions['PATCH /roles/:roleId']),
  requireCsrf,
  validateParams(roleIdSchema),
  validateBody(updateRoleSchema),
  controller.updateRole,
);
registerRoute(
  tenantRoutes,
  'delete',
  '/roles/:roleId',
  tenantPolicy(tenantRoutePermissions['DELETE /roles/:roleId']),
  requireCsrf,
  validateParams(roleIdSchema),
  controller.deleteRole,
);
