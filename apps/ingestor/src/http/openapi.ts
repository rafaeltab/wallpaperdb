import { registerOpenAPI } from '@wallpaperdb/core/openapi';
import type { FastifyInstance, FastifySchema } from 'fastify';
export const uploadSchema: FastifySchema = {
  summary: 'Upload a wallpaper',
  security: [{ bearerAuth: [] }],
  description:
    'Upload a JPEG, PNG, or WebP image. Content is inspected from bytes; images may be at most 50 MiB and between 1280×720 and 7680×4320 pixels.',
  tags: ['Upload'],
  response: { 200: { $ref: 'UploadSuccessResponse#' } },
};
export async function installOpenApi(app: FastifyInstance) {
  await registerOpenAPI(app, {
    title: 'WallpaperDB Ingestor API',
    version: '1.0.0',
    description:
      'Authenticated wallpaper uploads with durable storage and recoverable event publication.',
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    additionalSchemas: {
      UploadSuccessResponse: {
        type: 'object',
        required: [
          'id',
          'status',
          'uploadedAt',
          'fileType',
          'mimeType',
          'width',
          'height',
          'fileSizeBytes',
        ],
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['processing', 'already_uploaded'] },
          uploadedAt: { type: 'string', format: 'date-time' },
          fileType: { type: 'string', enum: ['image'] },
          mimeType: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          fileSizeBytes: { type: 'integer' },
        },
      },
    },
    multipartBodies: [
      {
        url: '/upload',
        schema: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string', format: 'binary' } },
        },
        errorResponses: [
          { statusCode: 400, description: 'Invalid file or request' },
          { statusCode: 401, description: 'Authentication required' },
          { statusCode: 409, description: 'An upload of this content is already in progress' },
          { statusCode: 413, description: 'File too large' },
          { statusCode: 429, description: 'Upload quota exceeded' },
          { statusCode: 500, description: 'Unexpected internal failure' },
          { statusCode: 503, description: 'A required dependency is unavailable' },
        ],
      },
    ],
  });
}
