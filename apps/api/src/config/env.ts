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
    VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.preprocess(optionalNonEmpty, z.string().optional()),
    MONGODB_URI: z.preprocess(optionalNonEmpty, z.string().optional()),
    MONGODB_DB_NAME: z.preprocess(optionalNonEmpty, z.string().optional()),
    KV_REST_API_URL: z.preprocess(optionalNonEmpty, z.url().optional()),
    KV_REST_API_TOKEN: z.preprocess(optionalNonEmpty, z.string().optional()),
    KEY_MASTER_V1: z.preprocess(optionalNonEmpty, z.string().optional()),
    KEY_MASTER_V2: z.preprocess(optionalNonEmpty, z.string().optional()),
    AUTH_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1).max(2).default(1),
    JWT_ISSUER: z.string().default('kaaryasthan-api'),
    JWT_AUDIENCE: z.string().default('kaaryasthan-web'),
    COOKIE_DOMAIN: z.preprocess(optionalNonEmpty, z.string().optional()),
    AUTH_SESSION_ABSOLUTE_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .default(30),
    AUTH_SESSION_IDLE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .default(168),
    AUTH_IP_LIMIT_PER_10_MIN: z.coerce.number().int().min(1).default(30),
    AUTH_EMAIL_IP_LIMIT_PER_10_MIN: z.coerce.number().int().min(1).default(5),
    AUTH_EMAIL_DELAY_BASE_SECONDS: z.coerce.number().int().min(1).default(2),
    MAX_ORGANIZATIONS_PER_USER: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3),
    SESSION_TOUCH_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(300),
    CRON_SECRET: z.preprocess(optionalNonEmpty, z.string().min(32).optional()),
    JOB_SIGNING_SECRET: z.preprocess(
      optionalNonEmpty,
      z.string().min(32).optional(),
    ),
    AUTH_DEV_OUTBOX: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
    MAIL_PROVIDER: z.enum(['development', 'resend']).optional(),
    MAIL_API_KEY: z.preprocess(optionalNonEmpty, z.string().optional()),
    MAIL_FROM: z.preprocess(optionalNonEmpty, z.email().optional()),
    WEB_PUBLIC_URL: z.preprocess(optionalNonEmpty, z.url().optional()),
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
        'KEY_MASTER_V1',
        'MAIL_FROM',
        'WEB_PUBLIC_URL',
        'MAIL_API_KEY',
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
    if (
      env.AUTH_DEV_OUTBOX &&
      (env.NODE_ENV !== 'development' ||
        env.VERCEL_ENV === 'preview' ||
        env.VERCEL_ENV === 'production')
    )
      context.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_OUTBOX'],
        message: 'Development only',
      });
    if (env.NODE_ENV === 'production' && env.MAIL_PROVIDER !== 'resend')
      context.addIssue({
        code: 'custom',
        path: ['MAIL_PROVIDER'],
        message: 'Required',
      });
    for (const name of ['KEY_MASTER_V1', 'KEY_MASTER_V2'] as const) {
      if (
        env[name] &&
        (!/^[A-Za-z0-9_-]+={0,2}$/.test(env[name]) ||
          Buffer.from(env[name], 'base64url').length < 32)
      )
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Must decode to 32 bytes',
        });
    }
    if (env.AUTH_ACTIVE_KEY_VERSION === 2 && !env.KEY_MASTER_V2)
      context.addIssue({
        code: 'custom',
        path: ['KEY_MASTER_V2'],
        message: 'Required',
      });
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
