import { z } from 'zod';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
} from '@kaaryasthan/shared';

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
