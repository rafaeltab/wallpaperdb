import { z } from 'zod';
import { zodToJsonSchema } from '@wallpaperdb/core/openapi';

/**
 * Upload success response schema.
 * Note: This schema matches the actual response from UploadOrchestrator.handleUpload()
 */
export const UploadSuccessResponseSchema = z.object({
  id: z.string().describe('Wallpaper ID (format: wlpr_<ulid>)'),
  status: z.enum(['stored', 'processing']).describe('Upload status'),
  fileType: z.enum(['image', 'video']).describe('File type'),
  mimeType: z.string().describe('MIME type of the file'),
  fileSizeBytes: z.number().int().describe('File size in bytes'),
  width: z.number().int().describe('Image/video width in pixels'),
  height: z.number().int().describe('Image/video height in pixels'),
  uploadedAt: z.string().describe('ISO 8601 timestamp of upload'),
});

// Export JSON Schema versions for registration in OpenAPI components
export const UploadSuccessResponseJsonSchema = zodToJsonSchema(UploadSuccessResponseSchema);

/**
 * Upload route schema definition for OpenAPI.
 *
 * Note on multipart handling:
 * - The `body` schema here is ONLY for OpenAPI documentation
 * - Fastify's multipart plugin handles actual request parsing
 * - We use `type: 'object'` with special format annotations for OpenAPI 3.0 multipart support
 *
 * Note on error responses:
 * - Error responses use $ref to ProblemDetails schema registered in OpenAPI components
 * - The actual error handling is done manually in the route handler with custom content-type
 * - Fastify won't validate/serialize these responses (they bypass the schema)
 */
export const uploadRouteSchema = {
  summary: 'Upload a wallpaper',
  description: `Upload an image or video file to be processed as a wallpaper.

**Supported formats:**
- Images: JPEG, PNG, WebP
- Videos: MP4, WebM

**Size limits:**
- Images: 50MB maximum
- Videos: 200MB maximum

**Dimension requirements:**
- Minimum: 1280x720 pixels
- Maximum: 7680x4320 pixels (8K)

The file content is validated by detecting the actual MIME type from the file bytes, not the provided Content-Type header.`,
  tags: ['Upload'],
  consumes: ['multipart/form-data'],
  response: {
    200: {
      description: 'Upload successful. The file has been stored and is being processed.',
      $ref: 'UploadSuccessResponse#',
    },
    // Note: Error responses (400, 409, 413, 429, 500) are handled manually in the route
    // with custom content-type 'application/problem+json'. They don't use Fastify's
    // serialization, so we document them here for OpenAPI but don't add $ref.
    // The ProblemDetails schema is available in components.schemas for documentation.
  },
};

/**
 * OpenAPI-specific body schema for documentation only.
 * This is NOT used by Fastify for validation (multipart is handled by plugin).
 * Use this with swagger's transform or hook to add to the OpenAPI spec.
 */
export const uploadBodySchemaForDocs = {
  type: 'object',
  required: ['file', 'userId'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'The wallpaper file to upload. Must be a valid image (JPEG, PNG, WebP) or video (MP4, WebM).',
    },
    userId: {
      type: 'string',
      description: 'User ID performing the upload. Used for rate limiting and ownership tracking.',
    },
  },
};

export type UploadSuccessResponse = z.infer<typeof UploadSuccessResponseSchema>;
