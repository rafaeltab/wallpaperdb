/**
 * RFC 7807 Problem Details for HTTP APIs
 * https://tools.ietf.org/html/rfc7807
 */

export interface ProblemDetails {
  /** URI identifying the problem type */
  type: string;
  /** Short, human-readable summary */
  title: string;
  /** HTTP status code */
  status: number;
  /** Human-readable explanation specific to this occurrence */
  detail: string;
  /** URI of the endpoint that generated the error */
  instance: string;
  /** Extension fields for additional context */
  [key: string]: unknown;
}

/**
 * Base class for all Problem Details errors.
 * Subclasses should define type, title, status, and instance.
 *
 * @example
 * ```typescript
 * export class MyCustomError extends ProblemDetailsError {
 *   readonly type = 'https://example.com/problems/my-error';
 *   readonly title = 'My Error';
 *   readonly status = 400;
 *   readonly instance = '/my-endpoint';
 *
 *   constructor(context: string) {
 *     super(`Something went wrong: ${context}`);
 *   }
 * }
 * ```
 */
export abstract class ProblemDetailsError extends Error {
  abstract readonly type: string;
  abstract readonly title: string;
  abstract readonly status: number;
  abstract readonly instance: string;

  constructor(
    public readonly detail: string,
    public readonly extensions: Record<string, unknown> = {}
  ) {
    super(detail);
    this.name = this.constructor.name;
  }

  toJSON(): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance: this.instance,
      ...this.extensions,
    };
  }
}
