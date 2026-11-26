import { z } from 'zod';

export const emailSchema = z.email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const registerSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});
export const emailRequestSchema = z.strictObject({ email: emailSchema });
export const verifyEmailSchema = z.strictObject({
  token: z.string().min(32).max(256),
});
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const sessionIdSchema = z.strictObject({
  sessionId: z.string().regex(/^[a-f\d]{24}$/i),
});
export const authUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.email(),
  status: z.enum(['pending', 'active', 'disabled']),
  verifiedAt: z.string().nullable(),
});
export const sessionSummarySchema = z.object({
  id: z.string(),
  deviceLabel: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
  activeOrganizationId: z.null(),
});
export const authEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: z.null(), error: z.null() });
export const acceptedResponseSchema = authEnvelope(
  z.object({ accepted: z.literal(true) }),
);
export const verifiedResponseSchema = authEnvelope(
  z.object({ verified: z.literal(true) }),
);
export const sessionResponseSchema = authEnvelope(
  z.object({ user: authUserSchema, session: sessionSummarySchema }),
);
export const meResponseSchema = sessionResponseSchema;
export const sessionsResponseSchema = authEnvelope(
  z.object({ sessions: z.array(sessionSummarySchema) }),
);
export const revokedResponseSchema = authEnvelope(
  z.object({ revoked: z.literal(true) }),
);
export const logoutResponseSchema = authEnvelope(
  z.object({ loggedOut: z.literal(true) }),
);
export const csrfResponseSchema = authEnvelope(
  z.object({ csrfToken: z.string() }),
);
