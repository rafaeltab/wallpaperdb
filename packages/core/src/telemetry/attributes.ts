/**
 * Standard attribute keys for OpenTelemetry spans and metrics.
 * Using constants prevents typos and enables IDE autocomplete.
 */
export const Attributes = {
  // User context
  USER_ID: "user.id",

  // Wallpaper context
  WALLPAPER_ID: "wallpaper.id",
  WALLPAPER_STATE: "wallpaper.state",

  // File context
  FILE_TYPE: "file.type",
  FILE_MIME_TYPE: "file.mime_type",
  FILE_SIZE_BYTES: "file.size_bytes",
  FILE_WIDTH: "file.width",
  FILE_HEIGHT: "file.height",
  FILE_HASH: "file.hash",

  // Storage context
  STORAGE_BUCKET: "storage.bucket",
  STORAGE_KEY: "storage.key",

  // Operation context
  OPERATION_NAME: "operation.name",
  OPERATION_SUCCESS: "operation.success",

  // Error context
  ERROR_TYPE: "error.type",
  ERROR_MESSAGE: "error.message",

  // Reconciliation context
  RECONCILIATION_TYPE: "reconciliation.type",
  RECONCILIATION_RECORDS_FOUND: "reconciliation.records_found",
  RECONCILIATION_RECORDS_PROCESSED: "reconciliation.records_processed",

  // Event context
  EVENT_TYPE: "event.type",
  EVENT_ID: "event.id",
  EVENT_SUBJECT: "event.subject",
  EVENT_STREAM: "event.stream",
  EVENT_CONSUMER: "event.consumer",
  EVENT_DELIVERY_ATTEMPT: "event.delivery_attempt",

  // Resize context
  RESIZE_WIDTH: "resize.width",
  RESIZE_HEIGHT: "resize.height",
  RESIZE_FIT_MODE: "resize.fit_mode",
  RESIZE_SOURCE: "resize.source", // "original" | "variant"

  // Variant selection
  VARIANT_ID: "variant.id",
  VARIANT_SELECTION_RESULT: "variant.selection.result", // "hit" | "miss" | "no_resize" | "upscale_avoided"
  VARIANT_FALLBACK: "variant.fallback", // true if variant file missing, fell back to original

  // Image processing
  IMAGE_FORMAT: "image.format", // jpeg, png, webp
  IMAGE_QUALITY: "image.quality",
} as const;

export type AttributeKey = (typeof Attributes)[keyof typeof Attributes];
