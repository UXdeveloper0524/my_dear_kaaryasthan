import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject) {
  if (process.env.MONGODB_URI?.trim()) {
    throw new Error('Tests refuse an inherited MONGODB_URI');
  }
  delete process.env.MONGODB_URI;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.NODE_ENV = 'test';
  process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(
    new URL(
      '../../../../node_modules/.cache/mongodb-binaries/',
      import.meta.url,
    ),
  );

  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({
    binary: { version: '8.0.38' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
