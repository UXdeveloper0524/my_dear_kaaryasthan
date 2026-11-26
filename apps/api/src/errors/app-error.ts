export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super(404, 'NOT_FOUND', 'Resource not found');
  }
}

export class ValidationError extends AppError {
  constructor() {
    super(400, 'VALIDATION_ERROR', 'Invalid request');
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Authentication required');
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super(403, 'FORBIDDEN', 'Access denied');
  }
}

export class ConflictError extends AppError {
  constructor() {
    super(409, 'CONFLICT', 'Resource conflict');
  }
}
