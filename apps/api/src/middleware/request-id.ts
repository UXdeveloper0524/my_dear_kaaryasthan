import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger.js';

export const requestId: RequestHandler = (request, response, next) => {
  const id = randomUUID();
  const started = performance.now();
  response.locals.requestId = id;
  response.setHeader('x-request-id', id);

  response.on('finish', () => {
    logger.info(
      {
        requestId: id,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      },
      'request completed',
    );
  });
  next();
};
