import mongoose from 'mongoose';
import { readEnv } from '../config/env.js';

type ConnectionCache = { promise: Promise<typeof mongoose> | null };
mongoose.set('sanitizeFilter', true);

const globalWithMongo = globalThis as typeof globalThis & {
  mongoConnection?: ConnectionCache;
};

const cache = (globalWithMongo.mongoConnection ??= { promise: null });

export async function connectToDatabase(): Promise<typeof mongoose> {
  const { MONGODB_URI, MONGODB_DB_NAME } = readEnv();
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not configured');

  cache.promise ??= mongoose
    .connect(MONGODB_URI, {
      dbName: MONGODB_DB_NAME,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
    })
    .catch((error: unknown) => {
      cache.promise = null;
      throw error;
    });

  return cache.promise;
}

export async function pingDatabase(): Promise<void> {
  const connection = await connectToDatabase();
  const database = connection.connection.db;
  if (!database) throw new Error('MongoDB connection has no database');
  await database.command({ ping: 1 });
}
