import { z } from 'zod';
import { zodToJsonSchema, ProblemDetailsJsonSchema } from '@wallpaperdb/core/openapi';

/**
 * Upload success response schema.
 */
export const UploadSuccessResponseSchema = z.object({
  id: z.string().describe('Wallpaper ID (format: wlpr_<ulid>)'),
  status: z.enum(['stored', 'processing']).describe('Upload status'),
  fileType: z.enum(['image', 'video']).describe('File type'),
  mimeType: z.string().describe('MIME type of the file'),
  fileSizeBytes: z.number().int().describe('File size in bytes'),
  width: z.number().int().describe('Image/video width in pixels'),
  height: z.number().int().describe('Image/video height in pixels'),
  aspectRatio: z.string().describe('Aspect ratio as decimal string'),
  contentHash: z.string().describe('SHA256 hash of the file content'),
  uploadedAt: z.string().describe('ISO 8601 timestamp of upload'),
});

// Export JSON Schema versions
export const UploadSuccessResponseJsonSchema = zodToJsonSchema(UploadSuccessResponseSchema);

/**
 * Upload route schema definition for OpenAPI.
 */
export const uploadRouteSchema = {
  summary: 'Upload a wallpaper',
  description: 'Upload an image or video file to be processed as a wallpaper. Supports JPEG, PNG, WebP images and MP4, WebM videos.',
  tags: ['Upload'],
  consumes: ['multipart/form-data'],
  body: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'The wallpaper file to upload (JPEG, PNG, WebP, MP4, WebM)',
      },
      userId: {
        type: 'string',
        description: 'User ID performing the upload',
      },
    },
    required: ['file', 'userId'],
  },
  response: {
    200: {
      description: 'Upload successful',
      ...UploadSuccessResponseJsonSchema,
    },
    400: {
      description: 'Validation error (invalid file format, size, dimensions)',
      ...ProblemDetailsJsonSchema,
    },
    409: {
      description: 'Duplicate file (same content hash already exists)',
      ...ProblemDetailsJsonSchema,
    },
    413: {
      description: 'File too large',
      ...ProblemDetailsJsonSchema,
    },
    429: {
      description: 'Rate limit exceeded',
      ...ProblemDetailsJsonSchema,
    },
    500: {
      description: 'Internal server error',
      ...ProblemDetailsJsonSchema,
    },
  },
};

export type UploadSuccessResponse = z.infer<typeof UploadSuccessResponseSchema>;
