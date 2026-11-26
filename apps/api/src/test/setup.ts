// This runs in each worker before test files import the app or database.
import { randomBytes } from 'node:crypto';
delete process.env.MONGODB_URI;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.NODE_ENV = 'test';
process.env.KEY_MASTER_V1 = randomBytes(32).toString('base64url');
