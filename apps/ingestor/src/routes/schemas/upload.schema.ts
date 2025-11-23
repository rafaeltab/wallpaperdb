import { z } from 'zod';
import { zodToJsonSchema, ProblemDetailsJsonSchema } from '@wallpaperdb/core/openapi';

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

// Export JSON Schema versions
export const UploadSuccessResponseJsonSchema = zodToJsonSchema(UploadSuccessResponseSchema);

/**
 * Upload route schema definition for OpenAPI.
 * Note: Body schema is only for OpenAPI documentation, not for Fastify validation.
 * The multipart plugin handles request parsing.
 */
export const uploadRouteSchema = {
  summary: 'Upload a wallpaper',
  description: 'Upload an image or video file to be processed as a wallpaper. Supports JPEG, PNG, WebP images and MP4, WebM videos.',
  tags: ['Upload'],
  consumes: ['multipart/form-data'],
  // Note: We don't include body schema here as multipart requests are not validated by JSON schema.
  // The body schema below is only used for OpenAPI documentation generation.
  response: {
    200: {
      description: 'Upload successful',
      ...UploadSuccessResponseJsonSchema,
    },
    // Error responses are handled manually with custom content-type,
    // so we only include them for documentation purposes without strict serialization
  },
};

export type UploadSuccessResponse = z.infer<typeof UploadSuccessResponseSchema>;
