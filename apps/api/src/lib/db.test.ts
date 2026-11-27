import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mongoose', () => ({
  default: {
    set: vi.fn(),
    connect: vi.fn(),
    connection: { db: { command: vi.fn() } },
  },
}));

const originalUri = process.env.MONGODB_URI;
const originalName = process.env.MONGODB_DB_NAME;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { mongoConnection?: unknown }).mongoConnection;
  process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
  process.env.MONGODB_DB_NAME = 'kaaryasthan_test';
});

afterEach(() => {
  if (originalUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = originalUri;
  if (originalName === undefined) delete process.env.MONGODB_DB_NAME;
  else process.env.MONGODB_DB_NAME = originalName;
});

describe('MongoDB connection cache', () => {
  it('reuses one connection for concurrent requests', async () => {
    vi.mocked(mongoose.connect).mockResolvedValue(mongoose);
    const { connectToDatabase } = await import('./db.js');

    await Promise.all([connectToDatabase(), connectToDatabase()]);

    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(mongoose.connect).toHaveBeenCalledWith(
      'mongodb://localhost:27017/test',
      expect.objectContaining({ dbName: 'kaaryasthan_test', maxPoolSize: 5 }),
    );
  });

  it('retries after a failed connection', async () => {
    vi.mocked(mongoose.connect)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(mongoose);
    const { connectToDatabase } = await import('./db.js');

    await expect(connectToDatabase()).rejects.toThrow('offline');
    await expect(connectToDatabase()).resolves.toBe(mongoose);

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
  });
});
