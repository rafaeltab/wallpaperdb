/**
 * Base class for all application errors.
 * Provides consistent error handling and type discrimination.
 */
export abstract class ApplicationError extends Error {
  /**
   * Machine-readable error code
   */
  abstract readonly code: string;

  /**
   * HTTP status code for this error (if applicable)
   */
  abstract readonly statusCode: number;

  /**
   * Additional context data for the error
   */
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to a loggable object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
    };
  }
}

/**
 * Internal server errors (500)
 */
export class InternalError extends ApplicationError {
  readonly code = 'INTERNAL_ERROR';
  readonly statusCode = 500;
}

/**
 * Data incomplete or inconsistent error
 */
export class DataIncompleteError extends ApplicationError {
  readonly code = 'DATA_INCOMPLETE';
  readonly statusCode = 500;
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends ApplicationError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
}

/**
 * Bad request / validation error (400)
 */
export class ValidationError extends ApplicationError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends ApplicationError {
  readonly code = 'UNAUTHORIZED';
  readonly statusCode = 401;
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends ApplicationError {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;
}

/**
 * Conflict error (409) - for duplicate resources
 */
export class ConflictError extends ApplicationError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
}
