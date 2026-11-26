import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './error-handler.js';
import { createRateLimit } from './rate-limit.js';

function testApp(
  limit: Parameters<typeof createRateLimit>[0],
  trustProxy = false,
) {
  const app = express();
  app.set('trust proxy', trustProxy ? 1 : false);
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

  it('fails open when the limit store fails', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    const response = await request(testApp(limit)).get('/resource');
    expect(response.status).toBe(200);
  });

  it('ignores spoofed forwarding headers without a trusted proxy', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true, reset: 0 });
    const app = testApp(limit);
    await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.1');
    await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.2');
    expect(limit.mock.calls[0]?.[0]).toBe(limit.mock.calls[1]?.[0]);
  });

  it('uses the nearest untrusted IP behind one proxy, not a spoofed prefix', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true, reset: 0 });
    const app = testApp(limit, true);
    await request(app)
      .get('/resource')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.5');
    await request(app)
      .get('/resource')
      .set('X-Forwarded-For', '198.51.100.2, 203.0.113.5');
    expect(limit.mock.calls[0]?.[0]).toBe(limit.mock.calls[1]?.[0]);
  });
});
