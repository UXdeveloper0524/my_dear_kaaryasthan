import { z } from 'zod';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  emailRequestSchema,
  acceptedResponseSchema,
  verifiedResponseSchema,
  sessionResponseSchema,
  csrfResponseSchema,
  sessionsResponseSchema,
  revokedResponseSchema,
  logoutResponseSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  mfaSetupSchema,
  mfaConfirmSchema,
  mfaChallengeSchema,
  mfaDisableSchema,
  mfaRegenerateSchema,
  loginResponseSchema,
  resetPasswordResponseSchema,
  changePasswordResponseSchema,
  mfaSetupResponseSchema,
  mfaEnabledResponseSchema,
  mfaChallengeResponseSchema,
  mfaDisabledResponseSchema,
  mfaRegenerateResponseSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  switchOrganizationSchema,
  createRoleSchema,
  updateRoleSchema,
  organizationListResponseSchema,
  createOrganizationResponseSchema,
  currentOrganizationResponseSchema,
  updateOrganizationResponseSchema,
  switchOrganizationResponseSchema,
  roleResponseSchema,
  roleListResponseSchema,
  deletedRoleResponseSchema,
} from '@kaaryasthan/shared';
const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, { target: 'openapi-3.0' });
const authResponse = (value: z.ZodType) => ({
  description: 'Successful auth response',
  content: { 'application/json': { schema: schema(value) } },
});
const authPost = (
  summary: string,
  body: z.ZodType | undefined,
  result: z.ZodType,
  status = '200',
) => ({
  summary,
  ...(body
    ? {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: schema(body) } },
        },
      }
    : {}),
  responses: {
    [status]: authResponse(result),
    '400': unavailable,
    '401': unavailable,
    '403': unavailable,
    '429': rateLimited,
  },
});

const success = {
  description: 'Service is available',
  content: {
    'application/json': {
      schema: z.toJSONSchema(healthResponseSchema, { target: 'openapi-3.0' }),
    },
  },
};
const unavailable = {
  description: 'Database is unavailable',
  content: {
    'application/json': {
      schema: z.toJSONSchema(apiErrorResponseSchema, { target: 'openapi-3.0' }),
    },
  },
};
const rateLimited = {
  description: 'Client rate limit exceeded',
  content: {
    'application/json': {
      schema: z.toJSONSchema(apiErrorResponseSchema, { target: 'openapi-3.0' }),
    },
  },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Kaaryasthan API', version: '0.1.0' },
  paths: {
    '/api/v1/organizations': {
      get: {
        summary: 'List active organizations',
        parameters: [
          { in: 'query', name: 'cursor', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
        ],
        responses: { '200': authResponse(organizationListResponseSchema) },
      },
      post: authPost(
        'Create organization',
        createOrganizationSchema,
        createOrganizationResponseSchema,
        '201',
      ),
    },
    '/api/v1/organizations/current': {
      get: {
        summary: 'Current organization',
        responses: { '200': authResponse(currentOrganizationResponseSchema) },
      },
      patch: authPost(
        'Update current organization',
        updateOrganizationSchema,
        updateOrganizationResponseSchema,
      ),
    },
    '/api/v1/organizations/switch': {
      post: authPost(
        'Switch active organization',
        switchOrganizationSchema,
        switchOrganizationResponseSchema,
      ),
    },
    '/api/v1/roles': {
      get: {
        summary: 'List organization roles',
        parameters: [
          { in: 'query', name: 'cursor', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
        ],
        responses: { '200': authResponse(roleListResponseSchema) },
      },
      post: authPost(
        'Create custom role',
        createRoleSchema,
        roleResponseSchema,
        '201',
      ),
    },
    '/api/v1/roles/{roleId}': {
      get: {
        summary: 'Get visible role',
        parameters: [
          {
            in: 'path',
            name: 'roleId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '200': authResponse(roleResponseSchema) },
      },
      patch: authPost(
        'Update custom role',
        updateRoleSchema,
        roleResponseSchema,
      ),
      delete: {
        summary: 'Delete custom role',
        responses: { '200': authResponse(deletedRoleResponseSchema) },
      },
    },
    '/api/v1/auth/csrf': {
      get: {
        summary: 'Issue CSRF token',
        responses: { '200': authResponse(csrfResponseSchema) },
      },
    },
    '/api/v1/auth/register': {
      post: authPost(
        'Register global account',
        registerSchema,
        acceptedResponseSchema,
        '202',
      ),
    },
    '/api/v1/auth/verify-email/resend': {
      post: authPost(
        'Resend verification email',
        emailRequestSchema,
        acceptedResponseSchema,
        '202',
      ),
    },
    '/api/v1/auth/verify-email': {
      post: authPost('Verify email', verifyEmailSchema, verifiedResponseSchema),
    },
    '/api/v1/auth/login': {
      post: authPost('Log in', loginSchema, loginResponseSchema),
    },
    '/api/v1/auth/forgot-password': {
      post: authPost(
        'Request password reset',
        forgotPasswordSchema,
        acceptedResponseSchema,
        '202',
      ),
    },
    '/api/v1/auth/reset-password': {
      post: authPost(
        'Reset password',
        resetPasswordSchema,
        resetPasswordResponseSchema,
      ),
    },
    '/api/v1/auth/change-password': {
      post: authPost(
        'Change password',
        changePasswordSchema,
        changePasswordResponseSchema,
      ),
    },
    '/api/v1/auth/2fa/setup': {
      post: authPost(
        'Start TOTP setup',
        mfaSetupSchema,
        mfaSetupResponseSchema,
      ),
    },
    '/api/v1/auth/2fa/setup/confirm': {
      post: authPost(
        'Confirm TOTP setup',
        mfaConfirmSchema,
        mfaEnabledResponseSchema,
      ),
    },
    '/api/v1/auth/2fa/challenge': {
      post: authPost(
        'Complete second factor',
        mfaChallengeSchema,
        mfaChallengeResponseSchema,
      ),
    },
    '/api/v1/auth/2fa/disable': {
      post: authPost(
        'Disable TOTP',
        mfaDisableSchema,
        mfaDisabledResponseSchema,
      ),
    },
    '/api/v1/auth/2fa/recovery-codes/regenerate': {
      post: authPost(
        'Regenerate recovery codes',
        mfaRegenerateSchema,
        mfaRegenerateResponseSchema,
      ),
    },
    '/api/v1/auth/refresh': {
      post: authPost('Rotate refresh token', undefined, sessionResponseSchema),
    },
    '/api/v1/auth/logout': {
      post: authPost('Log out', undefined, logoutResponseSchema),
    },
    '/api/v1/auth/me': {
      get: {
        summary: 'Current account and session',
        responses: { '200': authResponse(sessionResponseSchema) },
      },
    },
    '/api/v1/auth/sessions': {
      get: {
        summary: 'List current devices',
        responses: { '200': authResponse(sessionsResponseSchema) },
      },
    },
    '/api/v1/auth/sessions/{sessionId}': {
      delete: {
        summary: 'Revoke device',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '200': authResponse(revokedResponseSchema) },
      },
    },
    '/api/v1/health': {
      get: {
        summary: 'API health',
        responses: { '200': success, '429': rateLimited },
      },
    },
    '/api/v1/ready': {
      get: {
        summary: 'Database readiness',
        responses: { '200': success, '429': rateLimited, '503': unavailable },
      },
    },
    '/api/v1/openapi.json': {
      get: {
        summary: 'OpenAPI document',
        responses: {
          '200': { description: 'Raw OpenAPI 3.0 document' },
          '429': rateLimited,
        },
      },
    },
  },
};
