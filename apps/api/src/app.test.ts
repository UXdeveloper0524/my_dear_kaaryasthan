import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { pingDatabase } from './lib/db.js';
import app from './app.js';

vi.mock('./lib/db.js', () => ({ pingDatabase: vi.fn() }));

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
  });

  it('allows the configured web origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
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
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
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
