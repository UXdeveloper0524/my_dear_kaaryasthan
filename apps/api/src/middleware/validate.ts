import type { RequestHandler } from 'express';
import type { z } from 'zod';

export function validateBody(schema: z.ZodType): RequestHandler {
  return (request, _response, next) => {
    request.body = schema.parse(request.body);
    next();
  };
}

export function validateParams(schema: z.ZodType): RequestHandler {
  return (request, response, next) => {
    response.locals.params = schema.parse(request.params);
    next();
  };
}

export function validateQuery(schema: z.ZodType): RequestHandler {
  return (request, response, next) => {
    response.locals.query = schema.parse(request.query);
    next();
  };
}
