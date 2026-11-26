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
      post: authPost('Log in', loginSchema, sessionResponseSchema),
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
