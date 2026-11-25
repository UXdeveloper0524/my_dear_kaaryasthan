import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthResponseSchema } from '@kaaryasthan/shared';
import { readEnv } from './config/env.js';
import { AppError } from './errors/app-error.js';
import { pingDatabase } from './lib/db.js';
import { openApiDocument } from './lib/openapi.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';

const { WEB_ORIGIN } = readEnv();
const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === WEB_ORIGIN) return callback(null, true);
      callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed'));
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (_request, response) => {
  response.json(
    healthResponseSchema.parse({
      data: { status: 'ok', service: 'kaaryasthan-api' },
      meta: null,
      error: null,
    }),
  );
});

app.get('/api/v1/ready', async (_request, response) => {
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
});

app.get('/api/v1/openapi.json', (_request, response) => {
  response.json(openApiDocument);
});

app.use(notFound);
app.use(errorHandler);

export default app;
