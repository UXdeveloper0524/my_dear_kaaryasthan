import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { pingDatabase } from './lib/db.js';
import app from './app.js';

vi.mock('./lib/db.js', () => ({ pingDatabase: vi.fn() }));
vi.mock('./middleware/rate-limit.js', () => ({
  rateLimit: (
    _request: unknown,
    response: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    response.setHeader('x-test-rate-limit', 'applied');
    next();
  },
}));

beforeAll(() => {
  vi.stubEnv('WEB_ORIGIN', 'http://localhost:3000,https://preview.example.com');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('returns the shared response envelope', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { status: 'ok', service: 'kaaryasthan-api' },
      meta: null,
      error: null,
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-test-rate-limit']).toBe('applied');
  });

  it('allows the configured web origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows an exact preview origin and rejects a suffix match', async () => {
    const allowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://preview.example.com');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://preview.example.com',
    );
    const blocked = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://preview.example.com.evil.test');
    expect(blocked.status).toBe(403);
  });

  it('answers credentialed preflight with explicit methods and headers', async () => {
    const response = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain(
      'Content-Type',
    );
  });

  it('validates query input on a live route', async () => {
    const response = await request(app).get('/api/v1/health?unexpected=1');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects another origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted.example');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API defaults', () => {
  it('returns a stable error for an unknown route', async () => {
    const response = await request(app).get('/api/v1/missing');
    expect(response.status).toBe(404);
    expect(response.headers['x-test-rate-limit']).toBe('applied');
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.headers['x-test-rate-limit']).toBe('applied');
    expect(
      response.body.paths['/api/v1/ready'].get.responses['503'],
    ).toBeDefined();
  });
});

describe('GET /api/v1/ready', () => {
  it('reports ready when MongoDB responds', async () => {
    vi.mocked(pingDatabase).mockResolvedValueOnce();
    const response = await request(app).get('/api/v1/ready');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.headers['x-test-rate-limit']).toBe('applied');
  });

  it('returns a safe error when MongoDB is unavailable', async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(
      new Error('connection failed'),
    );
    const response = await request(app).get('/api/v1/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      data: null,
      meta: null,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' },
    });
  });
});
