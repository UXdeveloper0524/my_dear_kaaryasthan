import { z } from 'zod';
export * from './auth.js';

export const emptyQuerySchema = z.strictObject({});

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.literal('ok'),
    service: z.literal('kaaryasthan-api'),
  }),
  meta: z.null(),
  error: z.null(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorResponseSchema = z.object({
  data: z.null(),
  meta: z.null(),
  error: z.object({ code: z.string(), message: z.string() }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
