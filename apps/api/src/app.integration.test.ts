import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from './app.js';
import { connectToDatabase } from './lib/db.js';
import { useInMemoryDatabase } from './test/mongo.js';

describe('real replica-set foundation', () => {
  useInMemoryDatabase();

  it('reports readiness and reuses the MongoDB connection', async () => {
    const connect = vi.spyOn(mongoose, 'connect');
    try {
      const first = await connectToDatabase();
      const second = await connectToDatabase();
      expect(first).toBe(second);
      expect((await request(app).get('/api/v1/ready')).status).toBe(200);
      expect((await request(app).get('/api/v1/ready')).status).toBe(200);
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      connect.mockRestore();
    }
  });
});
