import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './error-handler.js';
import { createRateLimit } from './rate-limit.js';

function testApp(limit: Parameters<typeof createRateLimit>[0]) {
  const app = express();
  app.use(createRateLimit(limit));
  app.get('/resource', (_request, response) => response.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('Redis rate limit middleware', () => {
  it('allows a request while the limit is available', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true, reset: 0 });
    const response = await request(testApp(limit)).get('/resource');
    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledOnce();
    expect(limit.mock.calls[0]?.[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a stable 429 error and retry delay', async () => {
    const limit = vi.fn().mockResolvedValue({
      success: false,
      reset: Date.now() + 30_000,
    });
    const response = await request(testApp(limit)).get('/resource');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.body).toEqual({
      data: null,
      meta: null,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });
  });

  it('does not allow a request when the limit store fails', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    const response = await request(testApp(limit)).get('/resource');
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'RATE_LIMIT_UNAVAILABLE',
      message: 'Service unavailable',
    });
    expect(JSON.stringify(response.body)).not.toContain('Redis unavailable');
  });
});
