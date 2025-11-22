import { metrics, type Attributes } from "@opentelemetry/api";

const DEFAULT_METER_NAME = "wallpaperdb";
const DEFAULT_METER_VERSION = "1.0.0";

/**
 * Gets a meter instance for creating metrics.
 */
export function getMeter(name = DEFAULT_METER_NAME, version = DEFAULT_METER_VERSION) {
  return metrics.getMeter(name, version);
}

/**
 * Records a counter increment.
 *
 * @example
 * ```typescript
 * recordCounter('upload.requests', 1, { [Attributes.USER_ID]: userId });
 * ```
 */
export function recordCounter(
  name: string,
  value: number,
  attributes?: Attributes
): void {
  const meter = getMeter();
  const counter = meter.createCounter(name);
  counter.add(value, attributes);
}

/**
 * Records a histogram value (for durations, sizes, etc.).
 *
 * @example
 * ```typescript
 * recordHistogram('upload.duration_ms', durationMs, { [Attributes.FILE_TYPE]: 'image' });
 * ```
 */
export function recordHistogram(
  name: string,
  value: number,
  attributes?: Attributes
): void {
  const meter = getMeter();
  const histogram = meter.createHistogram(name);
  histogram.record(value, attributes);
}

/**
 * Creates a reusable counter for high-frequency recording.
 */
export function createCounter(name: string, description?: string) {
  const meter = getMeter();
  return meter.createCounter(name, { description });
}

/**
 * Creates a reusable histogram for high-frequency recording.
 */
export function createHistogram(name: string, description?: string, unit?: string) {
  const meter = getMeter();
  return meter.createHistogram(name, { description, unit });
}
