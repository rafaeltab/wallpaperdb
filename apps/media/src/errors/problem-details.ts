/**
 * RFC 7807 Problem Details for HTTP APIs
 * https://datatracker.ietf.org/doc/html/rfc7807
 */

/**
 * Base interface for all RFC 7807 problem details.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

/**
 * Base class for HTTP errors that produce RFC 7807 problem details.
 */
export abstract class HttpError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly problemType: string;
  public abstract readonly title: string;

  constructor(
    message: string,
    public readonly instance?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to RFC 7807 problem details object.
   */
  public toProblemDetails(): ProblemDetails {
    return {
      type: this.problemType,
      title: this.title,
      status: this.statusCode,
      detail: this.message,
      instance: this.instance,
    };
  }
}

/**
 * 400 Bad Request - Invalid query parameters for dimension validation.
 */
export class InvalidDimensionsError extends HttpError {
  public readonly statusCode = 400;
  public readonly problemType = 'https://wallpaperdb.dev/problems/invalid-dimensions';
  public readonly title = 'Invalid Dimensions';
}
