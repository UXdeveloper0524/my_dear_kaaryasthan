import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new NotFoundError());
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) return next(error);

  const safeError =
    error instanceof AppError
      ? error
      : error instanceof ZodError
        ? new ValidationError()
        : new AppError(500, 'INTERNAL_ERROR', 'Internal server error');

  if (safeError.statusCode >= 500) {
    logger.error(
      { requestId: response.locals.requestId, code: safeError.code },
      'request failed',
    );
  }

  response.status(safeError.statusCode).json({
    data: null,
    meta: null,
    error: { code: safeError.code, message: safeError.message },
  });
};
