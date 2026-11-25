import { z } from 'zod';

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.literal('ok'),
    service: z.literal('kaaryasthan-api'),
  }),
  meta: z.null(),
  error: z.null(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
