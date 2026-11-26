import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from './app-error.js';

describe.each([
  [UnauthorizedError, 401, 'UNAUTHORIZED'],
  [ForbiddenError, 403, 'FORBIDDEN'],
  [ConflictError, 409, 'CONFLICT'],
] as const)('%s', (ErrorClass, status, code) => {
  it('returns a stable error envelope', async () => {
    const app = express();
    app.get('/failure', () => {
      throw new ErrorClass();
    });
    app.use(errorHandler);
    const response = await request(app).get('/failure');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      data: null,
      meta: null,
      error: { code, message: expect.any(String) },
    });
  });
});
