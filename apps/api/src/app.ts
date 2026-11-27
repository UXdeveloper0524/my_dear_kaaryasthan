import express from 'express';
import type { RequestHandler } from 'express';
import cors from 'cors';
import * as helmet from 'helmet';
import { emptyQuerySchema, healthResponseSchema } from '@kaaryasthan/shared';
import { parseAllowedOrigins, readEnv } from './config/env.js';
import { AppError } from './errors/app-error.js';
import { pingDatabase } from './lib/db.js';
import { openApiDocument } from './lib/openapi.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { rateLimit } from './middleware/rate-limit.js';
import { registerRoute } from './middleware/route-policy.js';
import { validateQuery } from './middleware/validate.js';
import { authRoutes } from './modules/auth/routes.js';
import { tenantRoutes } from './modules/tenant/routes.js';

const app = express();
app.disable('x-powered-by');
// Vercel overwrites X-Forwarded-For; trust exactly its immediate proxy hop.
app.set('trust proxy', process.env.VERCEL === '1' ? 1 : false);
app.use(requestId);
app.use((_request, _response, next) => {
  try {
    readEnv();
    next();
  } catch (error) {
    next(error);
  }
});
// Vercel's framework type check resolves Helmet's default export as a module namespace.
const helmetMiddleware = helmet.default as unknown as () => RequestHandler;
app.use(helmetMiddleware());
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        parseAllowedOrigins(readEnv().WEB_ORIGIN).includes(origin)
      ) {
        return callback(null, origin ?? false);
      }
      callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-CSRF-Token',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', rateLimit);
app.use('/api/v1/auth', authRoutes);

registerRoute(
  app,
  'get',
  '/api/v1/health',
  { kind: 'public' },
  validateQuery(emptyQuerySchema),
  (_request, response) => {
    response.json(
      healthResponseSchema.parse({
        data: { status: 'ok', service: 'kaaryasthan-api' },
        meta: null,
        error: null,
      }),
    );
  },
);

registerRoute(
  app,
  'get',
  '/api/v1/ready',
  { kind: 'public' },
  async (_request, response) => {
    try {
      await pingDatabase();
      response.json(
        healthResponseSchema.parse({
          data: { status: 'ok', service: 'kaaryasthan-api' },
          meta: null,
          error: null,
        }),
      );
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable');
    }
  },
);

registerRoute(
  app,
  'get',
  '/api/v1/openapi.json',
  { kind: 'public' },
  (_request, response) => {
    response.json(openApiDocument);
  },
);

app.use('/api/v1', tenantRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
