import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { errorHandler } from './error-handler.js';
import {
  registerRoute,
  routeLayers,
  type RoutePolicy,
} from './route-policy.js';

type Layer = {
  route?: { path: string; policy?: RoutePolicy };
  handle?: { stack?: Layer[] };
};
function registeredRoutes(layers: Layer[]): Layer['route'][] {
  return layers.flatMap((layer) => [
    ...(layer.route ? [layer.route] : []),
    ...registeredRoutes(layer.handle?.stack ?? []),
  ]);
}

describe('route policies', () => {
  it('declares a policy on every route in the real app router', () => {
    const routes = registeredRoutes(routeLayers(app) as Layer[]);
    expect(routes).toHaveLength(31);
    for (const route of routes) {
      expect(route?.policy, route?.path).toMatchObject({
        kind: expect.stringMatching(/^(public|account|tenant)$/),
      });
      if (route?.policy?.kind === 'tenant')
        expect(route.policy.permission).toBeTruthy();
    }
  });

  it('denies a tenant route before its handler when permission is absent', async () => {
    const handler = vi.fn<RequestHandler>((_request, response) =>
      response.send('exposed'),
    );
    const router = Router();
    const organizationId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    router.use((_request, response, next) => {
      response.locals.auth = {
        user: { _id: userId },
        session: { activeOrganizationId: organizationId },
        membership: {
          _id: new mongoose.Types.ObjectId(),
          organizationId,
          userId,
          roleId: new mongoose.Types.ObjectId(),
          status: 'active',
        },
        role: { _id: new mongoose.Types.ObjectId(), rank: 100, grants: {} },
      };
      next();
    });
    registerRoute(
      router,
      'get',
      '/restricted',
      { kind: 'tenant', permission: 'roles.manage' },
      handler,
    );
    const local = express();
    local.use(router);
    local.use(errorHandler);
    const response = await request(local).get('/restricted');
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
