import crypto from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { ValidationLimits } from './validation-limits.service.js';
import {
  InvalidFileFormatError,
  FileTooLargeError,
  DimensionsOutOfBoundsError,
} from '../errors/problem-details.js';

export interface FileMetadata {
  mimeType: string;
  fileType: 'image' | 'video';
  width: number;
  height: number;
  fileSizeBytes: number;
  contentHash: string;
  extension: string;
}

/**
 * Sanitize filename to prevent path traversal and other security issues
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Remove special chars
    .slice(0, 255); // Limit length
}

/**
 * Calculate SHA256 hash of buffer content
 */
export function calculateContentHash(buffer: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * Detect MIME type from file content (not from extension/filename)
 */
export async function detectMimeType(
  buffer: Buffer
): Promise<{ mime: string; ext: string } | null> {
  const result = await fileTypeFromBuffer(buffer);
  return result ? { mime: result.mime, ext: result.ext } : null;
}

/**
 * Extract image metadata using Sharp
 */
async function extractImageMetadata(buffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer, {
    limitInputPixels: 268402689, // 16384 x 16384, prevents decompression bombs
    sequentialRead: true, // Memory efficient for large files
    failOnError: false, // Don't crash on corrupt images
  }).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not extract image dimensions');
  }

  return {
    width: metadata.width,
    height: metadata.height,
  };
}

/**
 * For future video support - would use fluent-ffmpeg
 * For now, we'll skip video support to keep it simple
 */
// async function extractVideoMetadata(buffer: Buffer): Promise<{ width: number; height: number }> {
//   // TODO: Implement video metadata extraction with fluent-ffmpeg
//   throw new Error('Video support not implemented yet');
// }

/**
 * Validate file size against user limits
 */
function validateFileSize(
  fileSizeBytes: number,
  fileType: 'image' | 'video',
  limits: ValidationLimits
): void {
  const maxSize = fileType === 'image' ? limits.maxFileSizeImage : limits.maxFileSizeVideo;

  if (fileSizeBytes > maxSize) {
    throw new FileTooLargeError(fileSizeBytes, maxSize, fileType);
  }
}

/**
 * Validate file format against allowed formats
 */
function validateFileFormat(mimeType: string, limits: ValidationLimits): void {
  if (!limits.allowedFormats.includes(mimeType)) {
    throw new InvalidFileFormatError(mimeType);
  }
}

/**
 * Validate image dimensions against user limits
 */
function validateDimensions(width: number, height: number, limits: ValidationLimits): void {
  if (
    width < limits.minWidth ||
    height < limits.minHeight ||
    width > limits.maxWidth ||
    height > limits.maxHeight
  ) {
    throw new DimensionsOutOfBoundsError(
      width,
      height,
      limits.minWidth,
      limits.minHeight,
      limits.maxWidth,
      limits.maxHeight
    );
  }
}

/**
 * Process and validate uploaded file
 * Returns file metadata if valid, throws ProblemDetailsError if invalid
 */
export async function processFile(
  buffer: Buffer,
  _originalFilename: string,
  limits: ValidationLimits,
  providedMimeType?: string
): Promise<FileMetadata> {
  // Calculate content hash for idempotency
  const contentHash = calculateContentHash(buffer);

  // Get file size
  const fileSizeBytes = buffer.length;

  // Detect actual MIME type from content (not from filename)
  const fileType = await detectMimeType(buffer);

  let mimeType: string;
  let extension: string;
  let fileCategory: 'image' | 'video';

  if (!fileType) {
    // If file-type can't detect it, use provided MIME type if available
    if (providedMimeType) {
      mimeType = providedMimeType;
      // Extract extension from mime type (e.g., 'text/plain' -> 'txt')
      extension = mimeType.split('/')[1] || 'bin';
    } else {
      mimeType = 'unknown';
      extension = 'bin';
    }

    // Determine file category from provided MIME type for proper size validation
    fileCategory = mimeType.startsWith('image/') ? 'image' : 'video';

    // Check file size BEFORE throwing format error
    // This ensures large invalid files get 413 instead of 400
    const maxSize = fileCategory === 'image' ? limits.maxFileSizeImage : limits.maxFileSizeVideo;
    if (fileSizeBytes > maxSize) {
      throw new FileTooLargeError(fileSizeBytes, maxSize, fileCategory);
    }

    // Now throw format error (file is within size limit but invalid format)
    throw new InvalidFileFormatError(mimeType);
  }

  mimeType = fileType.mime;
  extension = fileType.ext;

  // Validate file format against allowed formats
  validateFileFormat(mimeType, limits);

  // Determine if it's image or video
  fileCategory = mimeType.startsWith('image/') ? 'image' : 'video';

  // Validate file size (precise check based on actual file type)
  validateFileSize(fileSizeBytes, fileCategory, limits);

  // Extract metadata based on file type
  let width: number;
  let height: number;

  if (fileCategory === 'image') {
    const dimensions = await extractImageMetadata(buffer);
    width = dimensions.width;
    height = dimensions.height;
  } else {
    // For now, skip video support
    throw new InvalidFileFormatError(mimeType);
  }

  // Validate dimensions
  validateDimensions(width, height, limits);

  return {
    mimeType,
    fileType: fileCategory,
    width,
    height,
    fileSizeBytes,
    contentHash,
    extension,
  };
}
