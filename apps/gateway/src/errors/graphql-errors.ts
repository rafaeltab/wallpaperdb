import { GraphQLError } from 'graphql';

/**
 * Base class for GraphQL security errors
 */
export class SecurityError extends GraphQLError {
  constructor(message: string, code: string, extensions?: Record<string, unknown>) {
    super(message, {
      extensions: {
        code,
        ...extensions,
      },
    });
  }
}

/**
 * Error thrown when query complexity exceeds the limit
 */
export class ComplexityLimitError extends SecurityError {
  constructor(complexity: number, maxComplexity: number) {
    super(
      `Query complexity ${complexity} exceeds maximum ${maxComplexity}`,
      'COMPLEXITY_LIMIT_EXCEEDED',
      { complexity, maxComplexity }
    );
  }
}

/**
 * Error thrown when query breadth exceeds limits
 */
export class BreadthLimitError extends SecurityError {
  constructor(count: number, maxCount: number, type: 'unique_fields' | 'aliases') {
    super(
      `Query has ${count} ${type.replace('_', ' ')}, maximum is ${maxCount}`,
      'BREADTH_LIMIT_EXCEEDED',
      { [type]: count, [`max_${type}`]: maxCount }
    );
  }
}

/**
 * Error thrown when batch size exceeds limit
 */
export class BatchLimitError extends SecurityError {
  constructor(batchSize: number, maxBatchSize: number) {
    super(`Batch size ${batchSize} exceeds maximum ${maxBatchSize}`, 'BATCH_LIMIT_EXCEEDED', {
      batchSize,
      maxBatchSize,
    });
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitExceededError extends Error {
  public readonly retryAfter: number;

  constructor(limit: number, windowMs: number, retryAfter: number) {
    super(`Rate limit of ${limit} requests per ${windowMs}ms exceeded`);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Error thrown when cursor is invalid or expired
 */
export class InvalidCursorError extends GraphQLError {
  constructor(message: string) {
    super(message, {
      extensions: {
        code: 'INVALID_CURSOR',
      },
    });
  }
}
