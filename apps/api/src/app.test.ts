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
