export { Attributes, type AttributeKey } from "./attributes.js";
export {
  TelemetryExportTransport,
  telemetryBatchOptions,
  telemetryExportTimeoutMillis,
} from "./export-transport.js";
export {
  getTracer,
  getActiveSpan,
  addSpanEvent,
  setSpanAttribute,
  withSpan,
  withSpanSync,
} from "./tracing.js";
export {
  getMeter,
  recordCounter,
  recordHistogram,
  createCounter,
  createHistogram,
} from "./metrics.js";
