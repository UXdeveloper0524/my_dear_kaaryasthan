import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler, notFound } from './error-handler.js';
import { requestId } from './request-id.js';
import { validateBody, validateParams, validateQuery } from './validate.js';

function createTestApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.post(
    '/items/:id',
    validateParams(z.object({ id: z.uuid() })),
    validateQuery(z.object({ count: z.coerce.number().int().positive() })),
    validateBody(z.object({ name: z.string().min(1) })),
    (req, res) =>
      res.json({
        data: {
          id: res.locals.params.id,
          count: res.locals.query.count,
          name: req.body.name,
        },
        meta: null,
        error: null,
      }),
  );
  app.get('/broken', () => {
    throw new Error('secret internal detail');
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('request validation and errors', () => {
  it('parses validated params, query and body', async () => {
    const response = await request(createTestApp())
      .post(`/items/${id}?count=2`)
      .send({ name: 'Sprint' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id, count: 2, name: 'Sprint' });
  });

  it('rejects invalid request data with a safe envelope', async () => {
    const response = await request(createTestApp())
      .post(`/items/${id}?count=0`)
      .send({ name: '' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      data: null,
      meta: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('does not disclose unexpected errors', async () => {
    const response = await request(createTestApp()).get('/broken');
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'secret internal detail',
    );
  });
});
