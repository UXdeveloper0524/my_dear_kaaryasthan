import express from 'express';
import { healthResponseSchema } from '@kaaryasthan/shared';
import { readEnv } from './config/env.js';
import { pingDatabase } from './lib/db.js';

readEnv();
const app = express();
app.disable('x-powered-by');
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
    response.status(503).json({
      data: null,
      meta: null,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' },
    });
  }
});

export default app;
