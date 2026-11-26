import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { parseAllowedOrigins, readEnv } from './env.js';

const production = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://127.0.0.1:27017',
  MONGODB_DB_NAME: 'kaaryasthan',
  WEB_ORIGIN: 'https://app.example.com, https://preview.example.com',
  KV_REST_API_URL: 'https://redis.example.com',
  KV_REST_API_TOKEN: 'private-value',
};

describe('environment validation', () => {
  it('requires all production service variables without exposing values', () => {
    const invalid = { ...production, MONGODB_URI: '', KV_REST_API_TOKEN: '' };
    expect(() => readEnv(invalid)).toThrow(
      'Invalid environment variables: MONGODB_URI, KV_REST_API_TOKEN',
    );
    try {
      readEnv({ ...production, KV_REST_API_URL: 'not-a-url' });
    } catch (error) {
      expect(String(error)).not.toContain('not-a-url');
      expect(String(error)).not.toContain('private-value');
    }
  });

  it('permits local development without external services', () => {
    expect(readEnv({ NODE_ENV: 'development' }).MONGODB_URI).toBeUndefined();
    expect(readEnv({ NODE_ENV: 'test' }).KV_REST_API_TOKEN).toBeUndefined();
  });

  it('validates on the first app request without requiring secrets at import', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app).get('/api/v1/health');
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('MONGODB_URI');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('accepts only exact origins with no wildcard or path', () => {
    expect(parseAllowedOrigins(production.WEB_ORIGIN)).toEqual([
      'https://app.example.com',
      'https://preview.example.com',
    ]);
    expect(() =>
      readEnv({ ...production, WEB_ORIGIN: 'https://*.example.com' }),
    ).toThrow('WEB_ORIGIN');
    expect(() =>
      readEnv({ ...production, WEB_ORIGIN: 'https://app.example.com/path' }),
    ).toThrow('WEB_ORIGIN');
  });
});
