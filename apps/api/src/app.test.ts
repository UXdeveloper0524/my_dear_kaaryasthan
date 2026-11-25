import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app.js';

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
