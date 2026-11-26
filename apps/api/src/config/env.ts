import { z } from 'zod';

function optionalNonEmpty(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

export function parseAllowedOrigins(value: string): string[] {
  const origins = value.split(',').map((origin) => origin.trim());
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          !['http:', 'https:'].includes(url.protocol) ||
          url.origin !== origin ||
          origin.includes('*')
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('Invalid WEB_ORIGIN');
  }
  return [...new Set(origins)];
}

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.preprocess(optionalNonEmpty, z.string().optional()),
    MONGODB_URI: z.preprocess(optionalNonEmpty, z.string().optional()),
    MONGODB_DB_NAME: z.preprocess(optionalNonEmpty, z.string().optional()),
    KV_REST_API_URL: z.preprocess(optionalNonEmpty, z.url().optional()),
    KV_REST_API_TOKEN: z.preprocess(optionalNonEmpty, z.string().optional()),
  })
  .superRefine((env, context) => {
    if (env.WEB_ORIGIN) {
      try {
        parseAllowedOrigins(env.WEB_ORIGIN);
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['WEB_ORIGIN'],
          message: 'Invalid origin',
        });
      }
    }
    if (env.NODE_ENV === 'production') {
      for (const name of [
        'MONGODB_URI',
        'MONGODB_DB_NAME',
        'WEB_ORIGIN',
        'KV_REST_API_URL',
        'KV_REST_API_TOKEN',
      ] as const) {
        if (!env[name]) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required',
          });
        }
      }
    }
  });

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? 'environment'),
        ),
      ),
    ];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }
  return {
    ...result.data,
    WEB_ORIGIN: result.data.WEB_ORIGIN ?? 'http://localhost:3000',
    MONGODB_DB_NAME: result.data.MONGODB_DB_NAME ?? 'kaaryasthan',
  };
}
