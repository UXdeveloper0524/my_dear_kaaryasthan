import express from 'express';
import { healthResponseSchema } from '@kaaryasthan/shared';
import { readEnv } from './config/env.js';

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

export default app;
