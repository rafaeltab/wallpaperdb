import {
  trace,
  SpanStatusCode,
  type Span,
  type SpanOptions,
  type Attributes,
} from "@opentelemetry/api";

const DEFAULT_TRACER_NAME = "wallpaperdb";
const DEFAULT_TRACER_VERSION = "1.0.0";

/**
 * Gets a tracer instance for creating spans.
 */
export function getTracer(name = DEFAULT_TRACER_NAME, version = DEFAULT_TRACER_VERSION) {
  return trace.getTracer(name, version);
}

/**
 * Gets the currently active span, if any.
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Adds an event to the currently active span.
 */
export function addSpanEvent(name: string, attributes?: Attributes): void {
  getActiveSpan()?.addEvent(name, attributes);
}

/**
 * Sets an attribute on the currently active span.
 */
export function setSpanAttribute(key: string, value: string | number | boolean): void {
  getActiveSpan()?.setAttribute(key, value);
}

/**
 * Wraps an async function in a span, automatically handling success/error status.
 *
 * Uses startActiveSpan to ensure proper context propagation - nested withSpan calls
 * will automatically create parent-child relationships.
 *
 * @example
 * ```typescript
 * const result = await withSpan(
 *   'upload.process',
 *   { [Attributes.USER_ID]: userId },
 *   async (span) => {
 *     span.addEvent('starting processing');
 *     const result = await processFile(file);
 *     span.setAttribute(Attributes.FILE_SIZE_BYTES, result.size);
 *     return result;
 *   }
 * );
 * ```
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions
): Promise<T> {
  const tracer = getTracer();

  // Use startActiveSpan instead of startSpan to ensure proper context propagation
  // NOTE: startActiveSpan automatically ends the span when the callback completes
  return tracer.startActiveSpan(name, { attributes, ...options }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Synchronous version of withSpan for non-async operations.
 *
 * Uses startActiveSpan to ensure proper context propagation - nested withSpanSync calls
 * will automatically create parent-child relationships.
 */
export function withSpanSync<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => T,
  options?: SpanOptions
): T {
  const tracer = getTracer();

  // Use startActiveSpan instead of startSpan to ensure proper context propagation
  // NOTE: startActiveSpan automatically ends the span when the callback completes
  return tracer.startActiveSpan(name, { attributes, ...options }, (span) => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
