import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  MONGODB_URI: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  MONGODB_DB_NAME: z.string().min(1).default('kaaryasthan'),
});

export function readEnv() {
  return envSchema.parse(process.env);
}
