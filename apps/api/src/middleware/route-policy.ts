import type { RequestHandler } from 'express';
import type { PermissionKey } from '@kaaryasthan/shared';
import { NotFoundError, UnauthorizedError } from '../errors/app-error.js';
import { authorize, type TenantContext } from '../modules/tenant/access.js';

export type RoutePolicy =
  | { kind: 'public' }
  | { kind: 'account' }
  | { kind: 'tenant'; permission: PermissionKey };
export type RouteMethod = 'get' | 'post' | 'patch' | 'delete';

type RouteLayer = { route?: { policy?: RoutePolicy } };
type Routable = {
  [method in RouteMethod]: (
    path: string,
    ...handlers: RequestHandler[]
  ) => unknown;
} & { stack?: RouteLayer[]; router?: { stack: RouteLayer[] } };

export function routeLayers(router: object): RouteLayer[] {
  const surface = router as Pick<Routable, 'stack' | 'router'>;
  return surface.stack ?? surface.router?.stack ?? [];
}

function enforcePolicy(policy: RoutePolicy): RequestHandler {
  return async (_request, response, next) => {
    try {
      if (policy.kind === 'public') return next();
      const auth = response.locals.auth as
        | {
            user: { _id: TenantContext['userId'] };
            session: {
              activeOrganizationId?: TenantContext['organizationId'] | null;
            };
            membership: TenantContext['membership'] | null;
            role: TenantContext['role'] | null;
          }
        | undefined;
      if (!auth) throw new UnauthorizedError();
      if (policy.kind === 'account') return next();
      const organizationId = auth.session.activeOrganizationId;
      if (!organizationId || !auth.membership || !auth.role)
        throw new NotFoundError();
      const context: TenantContext = {
        userId: auth.user._id,
        organizationId,
        membership: auth.membership,
        role: auth.role,
      };
      response.locals.policyScope = await authorize(context, policy.permission);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function registerRoute(
  router: object,
  method: RouteMethod,
  path: string,
  policy: RoutePolicy,
  ...handlers: RequestHandler[]
): void {
  if (handlers.length === 0) throw new Error('A route requires a handler');
  const target = router as Routable;
  const handler = handlers.at(-1)!;
  target[method](
    path,
    ...handlers.slice(0, -1),
    enforcePolicy(policy),
    handler,
  );
  const route = routeLayers(router).at(-1)?.route;
  if (!route) throw new Error(`Route registration failed: ${method} ${path}`);
  route.policy = policy;
}
