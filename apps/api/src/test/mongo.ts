import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';

export function useInMemoryDatabase() {
  beforeAll(() => {
    process.env.MONGODB_URI = inject('mongoUri');
    process.env.MONGODB_DB_NAME = `kaaryasthan_test_${randomUUID().replaceAll('-', '')}`;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    delete (globalThis as { mongoConnection?: unknown }).mongoConnection;
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB_NAME;
  });
}
