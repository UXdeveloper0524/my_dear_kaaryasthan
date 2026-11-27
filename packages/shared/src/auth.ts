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
export const forgotPasswordSchema = emailRequestSchema;
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(32).max(256),
  newPassword: passwordSchema,
});
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const mfaSetupSchema = z.strictObject({
  password: z.string().min(1).max(128),
});
export const mfaConfirmSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
});
export const mfaFactorSchema = z.enum(['totp', 'recovery']);
export const mfaChallengeSchema = z.strictObject({
  challengeToken: z.string().min(32).max(256),
  factor: mfaFactorSchema,
  code: z.string().min(6).max(19),
});
export const mfaDisableSchema = z.strictObject({
  password: z.string().min(1).max(128),
  factor: mfaFactorSchema,
  code: z.string().min(6).max(19),
});
export const mfaRegenerateSchema = z.strictObject({
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
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
  activeOrganizationId: z.string().nullable(),
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
export const loginResponseSchema = authEnvelope(
  z.union([
    z.object({ user: authUserSchema, session: sessionSummarySchema }),
    z.object({ mfaRequired: z.literal(true), challengeToken: z.string() }),
  ]),
);
export const resetPasswordResponseSchema = authEnvelope(
  z.object({ reset: z.literal(true) }),
);
export const changePasswordResponseSchema = authEnvelope(
  z.object({ changed: z.literal(true) }),
);
export const mfaSetupResponseSchema = authEnvelope(
  z.object({ otpauthUri: z.string() }),
);
export const mfaEnabledResponseSchema = authEnvelope(
  z.object({
    enabled: z.literal(true),
    recoveryCodes: z.array(z.string()).length(10),
  }),
);
export const mfaDisabledResponseSchema = authEnvelope(
  z.object({ enabled: z.literal(false) }),
);
export const mfaRegenerateResponseSchema = authEnvelope(
  z.object({
    recoveryCodes: z.array(z.string()).length(10),
    remainingCount: z.literal(10),
  }),
);
export const mfaChallengeResponseSchema = authEnvelope(
  z.object({
    user: authUserSchema,
    session: sessionSummarySchema,
    remainingRecoveryCodes: z.number().int().min(0).optional(),
  }),
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
