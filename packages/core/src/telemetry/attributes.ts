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
} as const;

export type AttributeKey = (typeof Attributes)[keyof typeof Attributes];
