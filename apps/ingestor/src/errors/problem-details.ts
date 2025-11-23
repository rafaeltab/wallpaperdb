// Re-export base class from core package
import { ProblemDetailsError } from '@wallpaperdb/core/errors';
export { ProblemDetailsError, type ProblemDetails } from '@wallpaperdb/core/errors';

/**
 * 400 - Missing user id
 */
export class MissingUserId extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/missing-user-id';
  readonly title = 'Missing userId';
  readonly status = 400;
  readonly instance = '/upload';

  constructor() {
    super('A userId must be provided');
  }
}

/**
 * 400 - Invalid file format
 */
export class InvalidFileFormatError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/invalid-file-format';
  readonly title = 'Invalid File Format';
  readonly status = 400;
  readonly instance = '/upload';

  constructor(receivedMimeType: string) {
    super('Only JPEG, PNG, WebP, WebM, and MP4 formats are supported', {
      receivedMimeType,
    });
  }
}

/**
 * 413 - File too large
 */
export class FileTooLargeError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/file-too-large';
  readonly title = 'File Too Large';
  readonly status = 413;
  readonly instance = '/upload';

  constructor(fileSizeBytes: number, maxFileSizeBytes: number, fileType: 'image' | 'video') {
    super(
      `File size of ${Math.round(fileSizeBytes / (1024 * 1024))}MB exceeds your limit of ${Math.round(maxFileSizeBytes / (1024 * 1024))}MB for ${fileType}s`,
      { fileSizeBytes, maxFileSizeBytes, fileType }
    );
  }
}

/**
 * 400 - Dimensions out of bounds
 */
export class DimensionsOutOfBoundsError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/dimensions-out-of-bounds';
  readonly title = 'Dimensions Out of Bounds';
  readonly status = 400;
  readonly instance = '/upload';

  constructor(
    width: number,
    height: number,
    minWidth: number,
    minHeight: number,
    maxWidth: number,
    maxHeight: number
  ) {
    super(
      `Image dimensions must be between ${minWidth}x${minHeight} and ${maxWidth}x${maxHeight}`,
      { width, height, minWidth, minHeight, maxWidth, maxHeight }
    );
  }
}

/**
 * 400 - Missing file
 */
export class MissingFileError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/missing-file';
  readonly title = 'Missing File';
  readonly status = 400;
  readonly instance = '/upload';

  constructor() {
    super('No file provided in the request');
  }
}

/**
 * 500 - Storage upload failed
 */
export class StorageUploadFailedError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/storage-upload-failed';
  readonly title = 'Storage Upload Failed';
  readonly status = 500;
  readonly instance = '/upload';

  constructor(traceId?: string) {
    super('Failed to upload file to object storage', traceId ? { traceId } : {});
  }
}

/**
 * 500 - Database error
 */
export class DatabaseError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/database-error';
  readonly title = 'Database Error';
  readonly status = 500;
  readonly instance = '/upload';

  constructor(traceId?: string) {
    super('Failed to save file metadata to database', traceId ? { traceId } : {});
  }
}

/**
 * 500 - Event publishing failed (partial success)
 */
export class EventPublishingFailedError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/event-publishing-failed';
  readonly title = 'Event Publishing Failed';
  readonly status = 500;
  readonly instance = '/upload';

  constructor(traceId?: string) {
    super('File uploaded successfully but event publishing failed', traceId ? { traceId } : {});
  }
}

/**
 * 429 - Rate limit exceeded
 */
export class RateLimitExceededError extends ProblemDetailsError {
  readonly type = 'https://wallpaperdb.example/problems/rate-limit-exceeded';
  readonly title = 'Rate Limit Exceeded';
  readonly status = 429;
  readonly instance = '/upload';

  constructor(max: number, windowMs: number, retryAfter: number) {
    const windowMinutes = Math.ceil(windowMs / 60000);
    super(
      `You have exceeded the upload limit of ${max} uploads per ${windowMinutes} minute${windowMinutes > 1 ? 's' : ''}. Please try again later.`,
      { max, windowMs, retryAfter }
    );
  }
}
