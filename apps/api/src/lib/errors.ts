/** Typed application errors mapped to HTTP responses by the global error handler. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'bad_request',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'resource not found') {
    super(message, 404, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'resource already exists') {
    super(message, 409, 'conflict');
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'validation failed') {
    super(message, 422, 'validation_failed');
    this.name = 'ValidationError';
  }
}
